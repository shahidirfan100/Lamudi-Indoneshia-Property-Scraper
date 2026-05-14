# API Discovery

## Selected API
- Endpoint: `https://www.lamudi.co.id/api/lamudi/cluster-listings`
- Method: `GET`
- Auth: No token auth. Uses request headers including `wl-locale` and browser-like request headers.
- Pagination: Driven by `search-url` input. Actor iterates pages by updating `search-url` with `?page=N`.
- Query parameters:
  - `search-url` (encoded full Lamudi search URL)
  - `type` (`click-on-cluster`)
  - `useGeo` (`true`)
- Data returned: Array of listing summary objects including IDs and primary listing fields.

## Detail API
- Endpoint: `https://www.lamudi.co.id/api/lamudi/listing/{listingId}`
- Method: `GET`
- Purpose: Enrich each summary listing with full listing fields.

## Why This API Was Chosen
- Returns direct JSON listing objects without HTML extraction.
- Supports search URL variants (base, location path, paginated URLs).
- Provides enough fields for production dataset and can be enriched by detail API.

## Rejected Candidates
- `/api/lamudi/listings`: returns map clusters/features, not full listing arrays for dataset output.
- HTML/JSON-LD extraction: rejected to keep actor API-based and avoid HTML parsing.
- Browser DOM scraping: rejected; actor remains API-first.

## Field Coverage
- Existing actor output fields are covered and expanded through detail API merge.
- Null and empty values are removed before dataset push.
