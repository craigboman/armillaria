// ractive init  -------------------------------------------------------------

var ractive = new Ractive({
  el: 'app',

  template: '#template',

  data: {}

});

// keep a shadow copy of all values
var values = {};

// true before any changes made, needed for uri observer to not disable
// draft button on page load.
var firstLoad = true;

// deleteQuery generates the SPARQL query to remove a resource from the graph.
var deleteQuery = function( published ) {
  var graph = published ? ractive.data.publicGraph : ractive.data.draftsGraph;
  return 'DELETE { GRAPH ' + graph + ' { ' +
    ractive.get( 'existingURI' ) + ' ?p ?o } }\n' +
    'WHERE { ' + ractive.get( 'existingURI' ) + ' ?p ?o }';
};

// insertQuery generates the SPARQL query to insert the resource into the graph.
var insertQuery = function( publish ) {
  var uri = ractive.data.overview.uri;
  var now = new Date();
  var meta = [
    { 'p': internalPred( 'profile' ), 'o': '"' + urlParams.profile + '"' },
    { 'p': internalPred( 'displayLabel' ), 'o': ractive.data.overview.displayLabel },
    { 'p': internalPred( 'searchLabel' ), 'o': ractive.data.overview.searchLabel },
    { 'p': internalPred( 'updated' ), 'o': dateFormat( now.toISOString() ) }
  ];
  if ( ractive.data.existingResource ) {
    meta.push( {"p": internalPred( "created" ),
                "o": dateFormat(ractive.data.overview.created) } );
    if ( ractive.data.overview.published && publish ) {
      meta.push( {"p": internalPred( "published" ),
                  "o": dateFormat( ractive.data.overview.published ) } );
    }
  } else {
    meta.push( { 'p': internalPred( 'created' ), "o": dateFormat( now.toISOString() ) } );
  }
  if ( publish && !ractive.data.overview.published ) {
    meta.push( {'p': internalPred( 'published' ), 'o': dateFormat( now.toISOString() ) } );
  }
  metaPreds = _.reduce(meta, function(s, e) {
    return s + uri + " " + e.p + " " + e.o + " .\n";
  }, "");

  var preds = "";
  _.each(values, function(v, k) {
    _.each(v, function(e) {
      preds += uri + " " + e.predicate + " " + e.value + " . \n";
    });
  });
  var graph = publish ? ractive.data.publicGraph : ractive.data.draftsGraph;
  return 'INSERT { GRAPH ' + graph + ' {\n' + metaPreds + preds + '} }';
};

var doQuery = function( query, callback ) {
  var postData = 'query=' + encodeURIComponent( query );
  req = new XMLHttpRequest();
  req.open( 'POST', '/RDF/resource', true);
  req.setRequestHeader('Content-Type',
                       'application/x-www-form-urlencoded; charset=UTF-8');
  req.onload = function() {
    if ( req.status >= 200 && req.status < 400 ) {
      console.log( req.responseText );
      callback( JSON.parse( req.responseText ) );
    } else {
      console.log( 'SPARQL endpoint responed with an error' );
      ractive.set( { 'draftDisabled': true, 'deleteDisabled': true, 'publishDisabled': true } );
    }
  };

  req.onerror = function() {
    console.log( 'Failed to execute SPQRL query' );
  };

  req.send( postData );
};

// event handlers ------------------------------------------------------------

listener = ractive.on({
  saveDraft: function( event ) {
    var published = ractive.get( 'overview.published' ) ? true : false;
    var q;
    if ( ractive.get( 'existingURI' ) ) {
      q = deleteQuery( published ) + ';\n' + insertQuery( false );
    } else {
      q = insertQuery( false );
    }
    doQuery( q, function() {
      // Forward to saved uri
      window.location.replace( window.location.origin +
                                window.location.pathname +
                                "?uri=" + trimURI( ractive.get( 'overview.uri' ) ) );
    });
  },
  publish: function( event ) {
    var published = ractive.get( 'overview.published' ) ? true : false;
    var q;
    if ( ractive.get( 'existingURI' ) ) {
      q = deleteQuery( published ) + ';\n' + insertQuery( true );
    } else {
      q = insertQuery( true, 'forward' );
    }
    doQuery( q, function() {
     // Forward to saved uri
      window.location.replace( window.location.origin +
                               window.location.pathname +
                               "?uri=" + trimURI( ractive.get( 'overview.uri' ) ) );
    } );
  },
  delResource: function( event) {
    var published = ractive.get( 'overview.published' ) ? true : false;
    var q = deleteQuery( published );
    doQuery( q, function() {
      window.location.replace( window.location.origin +
                                  window.location.pathname +
                                  "?profile=" + urlParams.profile );
    } );
  },
  remove: function( event ) {
    var idx = event.index;
    ractive.data.views[idx.i1].elements[idx.i2].values.splice(idx.i3, 1);
  },
  searchBlur: function ( event ) {
    // delay a bit so that the on-click event has time to fire in case of searchhit select
    setTimeout( function () {
      event.node.value = "";
      ractive.set( event.keypath + ".searching", false);
    }, 100 );
  },
  newValue: function(event) {
    var value, predicate, predicateLabel, source;
    value = event.node.value.trim();

    predicate = event.context.predicates[0].uri;
    predicateLabel = event.context.predicates[0].label;
    source = 'local';

    var idx = event.index;
    ractive.data.views[idx.i1].elements[idx.i2].values.push(
      {"predicate": predicate, "predicateLabel": predicateLabel, "value": value, "source": source});
    event.node.value = "";
    ractive.merge( event.keypath + ".errorInfo", "");

  },
  searchForURI: _.debounce(function( event) {
    var q = event.node.value.trim();
    if (q === "") {
      ractive.set( event.keypath + ".searching", false);
      return;
    }
    console.log("searching for " + q);
    ractive.merge( event.keypath + ".searching", true);
  }, 100),
  selectURI: function( event ) {
    var label, uri, predicate, predicateLabel, source;
    label = event.context.label;
    uri = event.context.uri;
    source = 'local';

    var idx = event.index;
    predicate = data.views[idx.i1].elements[idx.i2].predicates[0].uri;
    predicateLabel = data.views[idx.i1].elements[idx.i2].predicates[0].label;
    ractive.data.views[idx.i1].elements[idx.i2].values.push(
      {"predicate": predicate, "predicateLabel": predicateLabel, "value": uri,
       "URILabel": label, "source": source});
  },
  validateFloat: function(event) {
    var value = event.node.value.trim();

    // validate float
    if ( !value.match(/^[0-9]+(?:\.[0-9]+)?$/) ) {
      ractive.merge( event.keypath + ".errorInfo",
                    "ugyldig verdi: må være et tall" );
      setTimeout( function () {
        event.node.focus();
      }, 0 );
      return;
    }

    ractive.fire( "newValue", event );
  },
  validateLangString: function( event ) {
    var value, lang;
    var idx = event.index;
    value = event.node.value.trim();
    lang = ractive.data.views[idx.i1].elements[idx.i2].selected;

    // associate language tag if it is chosen
    if ( lang === "") {
      event.node.value = "\"" + event.node.value + "\"";
    } else {
      event.node.value = "\"" + event.node.value + "\"@" + lang;
    }

    ractive.fire("newValue", event);
  }
});

// observers  ----------------------------------------------------------------

ractive.observe('views', function( newValue, oldValue, keypath) {
  // keep values in sync
  values = {};
  var missingValues = false;
  newValue.forEach(function(view, i) {
    view.elements.forEach(function(elem, j) {
      if (!values[elem.id]) {
        values[elem.id] = [];
      }
      // Check if all required attributes in the schema has a value
      if ( elem.required && elem.values.length === 0 ) {
        missingValues = true;
      }
      elem.values.forEach(function(v) {
        values[elem.id].push(v);
      });
    });
  });
  // Don't allow publish a resource with misssing required values.
  if ( missingValues ) {
    ractive.set( 'publishDisabled', true );
  } else if ( !ractive.get( 'duplicateURI') ) {
    ractive.set( { 'publishDisabled': false, 'draftDisabled': false } );
  }

  var createURI = _.every(ractive.data.uriNeedIds, function(id) {
    return (values[id].length > 0);
  });

  if ( createURI ) {
    // create URI if the needed id's are present
    ractive.set( 'overview.uri', ractive.data.uriFn( values ) );
  } else {
    // or remove uri if there is one
    ractive.set( 'overview.uri', '' );
  }
  firstLoad = false; //

  // create searchLabel and displayLabel
  ractive.set('overview.searchLabel', ractive.data.searchLabel(values));
  ractive.set('overview.displayLabel', ractive.data.displayLabel(values));
});

ractive.observe( 'overview.uri', function( newURI, oldURI, keyPath ) {
  // Check if URI allready exists in local RDF repo.
  if ( newURI !== "" && newURI !== ractive.get( 'existingURI' ) ) {
    var q = 'ASK WHERE { ' + newURI + '?p ?o }';
    doQuery( q, function( data) {
      var exists = data.boolean;
      ractive.set( 'duplicateURI', exists );
      ractive.set( 'draftDisabled', exists );
      if ( exists && !ractive.get( 'publishDisabled') ) {
        ractive.set( 'publishDisabled', true );
      }
    });
  } else {
    ractive.set( 'duplicateURI', false );
  }
  if ( newURI === "" && !firstLoad ) {
    ractive.set( 'draftDisabled', true );
  }
});

// load profile and (optionally) resource data -------------------------------

// loadScript dynamically loads a javascript file, executing callback on success.
var loadScript = function( src, callback ) {
  var s = document.createElement('script');
  s.type = 'text/javascript';
  s.async = false;
  s.src = src;

  s.onreadystatechange = s.onload = function() {
    var state = s.readyState;

    if (!callback.done && (!state || /loaded|complete/.test(state))) {
      callback.done = true;
      callback();
    }
  };

  (document.body || document.head).appendChild(s);
};

// Get the query parameters.
var urlParams;
(window.onpopstate = function () {
  var match,
      pl     = /\+/g,
      search = /([^&=]+)=?([^&]*)/g,
      decode = function (s) { return decodeURIComponent(s.replace(pl, ' ')); },
      query  = window.location.search.substring(1);

  urlParams = {};
  while ( match = search.exec(query) )
    urlParams[decode(match[1])] = decode(match[2]);
})();

// createSchema creates a schema acording to a loaded profile.
var createSchema = function() {
  // set values to empty array
  profile.views.forEach(function(view, i) {
    view.elements.forEach(function(elem, j) {
      profile.views[i].elements[j].values = [];
    });
  });
  ractive.set(_.extend(profile, common));
}

// Load resource if uri query parameter is given.
if ( urlParams.uri ) {
  ractive.set( 'existingResource', true );
  ractive.set( 'existingURI', "<" + urlParams.uri + ">" );

  var q = 'SELECT * WHERE { <' + urlParams.uri + '> ?p ?o }';
  doQuery( q, function( rdfRes ) {
    // If the SPARQL query returns an empty set, forward to create new resource page.
    // TODO display flash message 'resource not found' for the user
    if ( rdfRes.results.bindings.length === 0 && urlParams.profile ) {
      window.location.replace( window.location.origin +
                              window.location.pathname +
                              "?profile=" + urlParams.profile ); // TODO urlParams.profile is not set here
    }

    // get the profile from the response
    var p = "";
    rdfRes.results.bindings.forEach(function(b) {
      if ( b.p.value ===  trimURI( internalPred( 'profile' ) ) ) {
        p = b.o.value;
        urlParams.profile = p;
      }
    });

    if ( p === "" ) {
      console.log( 'ERROR: no profile in resource.' );
    } else {
      loadScript( '/public/profiles/' + p + ".js", function() {
        createSchema();
        // findElement returns the keypath of a predicate, or false if no match.
        var findElement = function(pred) {
          var kp = false;
          ractive.data.views.forEach(function(v, i) {
            v.elements.forEach(function(e, j) {
              e.predicates.forEach(function(p, k) {
                if (p.uri === pred) {
                  kp = "views."+i+".elements."+j;
                }
              });
            });
          });
          return kp;
        };

        // getValue returns the value of a binding, including surrounding quotes
        // for strings and language tag if present.
        var getValue = function(b) {
          if ( b.type === 'uri' || b.type === 'typed-literal' ) {
            return b.value;
          }
          if ( b.type === 'literal' ) {
            if ( b['xml:lang'] ) {
              return '"' + b.value + '"@' + b["xml:lang"];
            }
            return '"' + b.value + '"';
          }
        };

        rdfRes.results.bindings.forEach(function(b) {
          var pred = "<" + b.p.value + ">";
          var source = 'local';
          var kp = findElement(pred);
          if ( kp ) {
            var v = getValue(b.o);
            var predLabel = ractive.get(kp).label;
            ractive.get(kp + ".values").push(
              {"predicate": pred, "predicateLabel": predLabel, "value": v, "source": source});
          } else {
            switch ( pred ) {
              case '<armillaria://internal/displayLabel>':
                ractive.set( 'overview.displayLabel', getValue( b.o ) );
                break;
              case '<armillaria://internal/searchLabel>':
                ractive.set( 'overview.searchLabel', getValue( b.o ) );
                break;
              case '<armillaria://internal/created>':
                ractive.set( 'overview.created', getValue( b.o ) );
                break;
              case '<armillaria://internal/updated>':
                ractive.set( 'overview.updated', getValue( b.o ) );
                break;
              case '<armillaria://internal/published>':
                ractive.set( 'overview.published', getValue( b.o ) );
                break;
            }
          }
        }); // end rdfRes.results.bindings.forEach
      }); // end loadScript
    } // end p (profile) !== ""
  });
  ractive.set( { 'draftDisabled': false, 'deleteDisabled': false, 'publishDisabled': false } );
}


// Load profile if supplied in query string, and not allready fetched via
// loaded resource.
// TODO onerror: what if profile is not found?
if ( urlParams.profile && !urlParams.uri ) {
  // No URI given; assuming creating a new resource.
  ractive.set('existingResource', false);
  loadScript( '/public/profiles/' + urlParams.profile + ".js", createSchema );
  ractive.set( { 'draftDisabled': true, 'deleteDisabled': true, 'publishDisabled': true } );
}

