// +build ignore

/*

Basic script to index rdf data, using the mappings in data/mappings

To index all of type work, run:
go run indexrdf.go rdfstore.go indexing.go -t=work

*/

package main

import (
	"bytes"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/knakk/sparql"
)

const (
	qCount        = `SELECT COUNT(DISTINCT ?s) FROM <%s> WHERE { ?s <armillaria://internal/profile> "%s"}`
	qAll          = `SELECT ?res WHERE { { SELECT DISTINCT ?res FROM <%s> WHERE { ?res <armillaria://internal/profile> "%s" } ORDER BY ASC(?res) } } OFFSET %d LIMIT %d`
	resourceQuery = `
SELECT * FROM <%s> WHERE {
   { <%s> ?p ?o .
     MINUS { <%s> ?p ?o . ?o <armillaria://internal/displayLabel> _:l . } }
   UNION
   { <%s> ?p ?o .
     ?o <armillaria://internal/displayLabel> ?l . }
}`
	head = `
{ "index" : { "_index" : "public", "_type" : "%s" } }
`
	limit = 10000
)

var (
	db = newLocalRDFStore("http://localhost:8890/sparql-auth", "dba", "dba")
)

func urlify(s string) string { return fmt.Sprintf("<%s>", s) }

func main() {
	resType := flag.String("t", "", "resource type to index (the value of the <armillaria://internal/profile> predicate.)")
	graph := flag.String("g", "http://data.deichman.no/public", "graph from rdfstore to index from")

	flag.Parse()

	if resType == nil || *resType == "" {
		log.Println("Missing parameters:")
		flag.PrintDefaults()
		os.Exit(1)
	}

	indexMappings, err := loadFromProfiles()
	if err != nil {
		log.Fatal(err)
	}

	// Get total count of this resource type
	res, err := db.Query(fmt.Sprintf(qCount, *graph, *resType))
	if err != nil {
		log.Fatal(err)
	}

	total, err := strconv.Atoi(res.Results.Bindings[0][res.Head.Vars[0]].Value)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Found %d resources of type %v\n", total, *resType)

	// Fetch resources in batches of <limit>
	for i := 0; i < total; i += limit {
		fmt.Printf("Processing batch %d - %d ...\n", i, i+limit)

		for ok := false; ok == false; {
			res, err = db.Query(fmt.Sprintf(qAll, *graph, *resType, i, limit))
			if err != nil {
				fmt.Println(err)
				fmt.Println("SPARQL endpoint unavaialable? Trying againt in 5 seconds.")
				time.Sleep(5 * time.Second)
			} else {
				ok = true
			}
		}

		var docs bytes.Buffer

		bulkHead := []byte(string(fmt.Sprintf(head, *resType)))

		for _, r := range res.Results.Bindings {
			uri := r["res"].Value

			var res *sparql.Results
			for ok := false; ok == false; {
				res, err = db.Query(fmt.Sprintf(resourceQuery, *graph, uri, uri, uri))
				if err != nil {
					fmt.Println(err)
					fmt.Println("SPARQL endpoint unavaialable? Trying again in 5 seconds...")
					time.Sleep(5 * time.Second)
				} else {
					ok = true
				}
			}

			resourceBody, _, err := createIndexDoc(indexMappings, res, uri)
			if err != nil {
				fmt.Println("Failed to index:", uri)
				fmt.Println(err)
				continue
			}
			docs.Write(bulkHead)
			docs.Write(resourceBody)
		}

		docs.Write([]byte("\n"))
		fmt.Print("Sending batch to Elassticsearch: ")
		resp, err := http.Post("http://localhost:9200/_bulk", "application/json", &docs)
		if err != nil {
			log.Fatal(err)
		}
		if resp.StatusCode != http.StatusOK {
			fmt.Print("FAILED\n")
			log.Fatalf("http request failed with %v", resp.Status)
		} else {
			fmt.Print("OK\n")
		}
		docs.Reset()
	}
	fmt.Println("Done!")
}
