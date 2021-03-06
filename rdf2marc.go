package main

import (
	"bytes"
	"encoding/xml"
	"fmt"

	"github.com/knakk/sparql"
)

// Data structures for MARCXML marshalling
// =======================================

// marcRecord represents the top <record> node
type marcRecord struct {
	XMLName xml.Name `xml:"record"`
	//Leader     string   `xml:"leader"`
	CtrlFields []cField `xml:"controlfield"`
	DataFields []dField `xml:"datafield"`
}

// cField represents a <controlfield>
type cField struct {
	Tag   string `xml:"tag,attr"`
	Field string `xml:",chardata"`
}

// dField represents a <datafield>
type dField struct {
	Tag       string     `xml:"tag,attr"`
	Ind1      string     `xml:"ind1,attr"`
	Ind2      string     `xml:"ind2,attr"`
	SubFields []subField `xml:"subfield"`
}

// subField represents a <subfield> under a <datafield>
type subField struct {
	Code  string `xml:"code,attr"`
	Value string `xml:",chardata"`
}

// RDF2MARC Mappings
// =================

// literalMappings contains the mappings of URIs into string values
// used in DeichmanMARC/NORMARC.
var literalMappings = map[string]string{
	"http://data.deichman.no/format/Book":         "l",
	"http://dbpedia.org/resource/Novel":           "R",
	"http://dbpedia.org/resource/Poetry":          "D",
	"http://dbpedia.org/resource/Comic_book":      "T",
	"http://dbpedia.org/resource/Short_stories":   "N",
	"http://data.deichman.no/audience/ages_0-5":   "a",
	"http://data.deichman.no/audience/ages_8-9":   "bu",
	"http://data.deichman.no/audience/ages_6-7":   "b",
	"http://data.deichman.no/audience/ages_10-11": "u",
	"http://data.deichman.no/audience/ages_12-15": "mu",
	"http://data.deichman.no/bindingInfo/h":       "h",
	"http://data.deichman.no/bindingInfo/ib":      "ib",
	"http://data.deichman.no/audience/adult":      "a",
	"http://data.deichman.no/audience/juvenile":   "j",
	"http://lexvo.org/id/iso639-3/nob":            "nob",
	"http://lexvo.org/id/iso639-3/eng":            "eng",
	"http://data.deichman.no/nationality/n":       "n",
	"http://dbpedia.org/resource/Fiction":         "1",
	"http://dbpedia.org/resource/Non-Fiction":     "0",
}

type dMapping struct {
	dataField  string
	index1     string
	index2     string
	repeatable bool
	subFields  []sMapping
}

type sMapping struct {
	code       string
	repeatable bool
}

type ctrlMapping struct {
	field string
	pos   []int
}

// dataFieldMappings says which MARC fields and subfields we want to populate.
var dataFieldMappings = []dMapping{
	{
		dataField: "019",
		subFields: []sMapping{
			{code: "b"},
			{code: "d", repeatable: true},
		},
	},
	{
		dataField: "020",
		subFields: []sMapping{
			{code: "a"},
			{code: "b"},
		},
	},
	{
		dataField: "090",
		subFields: []sMapping{
			{code: "b"},
		},
	},
	{
		dataField: "100", index2: "0",
		subFields: []sMapping{
			{code: "a"},
			{code: "d"},
			{code: "j"},
		},
	},
	{
		dataField: "245", index1: "1", index2: "0",
		subFields: []sMapping{
			{code: "a"},
			{code: "b"},
			{code: "c"},
		},
	},
	{
		dataField: "260",
		subFields: []sMapping{
			{code: "a"},
			{code: "b"},
			{code: "c"},
		},
	},
	{
		dataField: "300",
		subFields: []sMapping{
			{code: "a"},
			{code: "b"},
		},
	},
}

// controlFieldMappings says which position in control fields we want to populate.
var controlFieldMappings = []ctrlMapping{
	{field: "001", pos: []int{0}},
	{field: "008", pos: []int{35, 33, 22}},
}

// Helper functions
// ================

// bindings takes a sparql.Reusults and returns a map where each
// bound variable has a key.
// TODO use sparql.Results.Bindings()
func bindings(rdf *sparql.Results) map[string][]string {
	rb := make(map[string][]string)
	for _, k := range rdf.Head.Vars {
		for _, b := range rdf.Results.Bindings {
			if b[k].Value != "" {
				rb[k] = append(rb[k], b[k].Value)
			}
		}
	}
	return rb
}

// API
// ===

// convertRDF2MARC takes a SPARQL result response, and converts it into
// a marcRecord, which is easily serializable as marcxml.
// TODO error not necessary? Given a parsed sparql response, nothing can panic..
func convertRDF2MARC(rdf *sparql.Results) (marcRecord, error) {
	rec := marcRecord{}
	bindings := bindings(rdf)

	// 1. populate controlfields
	cf := make(map[string][]byte)
	for _, c := range controlFieldMappings {
		for _, p := range c.pos {
			boundVar := fmt.Sprintf("c%s_%d", c.field, p)
			if v, ok := bindings[boundVar]; ok {
				val := v[0]
				if v2, ok := literalMappings[val]; ok {
					val = v2
				}
				l := len([]byte(val))
				if _, ok := cf[c.field]; !ok {
					cf[c.field] = bytes.Repeat([]byte(" "), l)
				}
				if len(cf[c.field]) < (p + l) {
					biggerSlice := bytes.Repeat([]byte(" "), (p + l))
					copy(biggerSlice, cf[c.field])
					cf[c.field] = biggerSlice
				}
				copy(cf[c.field][p:], []byte(val))
			}
		}
	}
	for k, v := range cf {
		rec.CtrlFields = append(rec.CtrlFields,
			cField{Tag: k, Field: string(v)})
	}

	// 2. populate datafields
	for _, m := range dataFieldMappings {
		field := dField{Tag: m.dataField, Ind1: m.index1, Ind2: m.index2}
		var foundMatch bool
		for _, s := range m.subFields {
			boundVar := m.dataField + "_" + s.code
			if v, ok := bindings[boundVar]; ok {
				val := v[0] // we only deal with non-repeatable fields for now
				if v2, ok := literalMappings[val]; ok {
					val = v2
				}
				field.SubFields = append(field.SubFields,
					subField{Code: s.code, Value: val})
				foundMatch = true
			}
		}
		if foundMatch {
			rec.DataFields = append(rec.DataFields, field)
		}
	}

	return rec, nil
}
