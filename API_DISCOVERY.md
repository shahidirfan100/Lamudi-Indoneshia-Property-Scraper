# API Discovery

## Selected API
- Endpoint: `https://www.lamudi.co.id/api/lamudi/cluster-listings`
- Method: `GET`
- Auth: No token auth. Uses request headers including `wl-locale` and browser-like request headers.
- Pagination behavior discovered in testing:
  - `cluster-listings` returns a fixed pool of up to 100 listing summaries.
  - `?page=N` in `search-url` does not reliably move beyond that 100-result pool.
  - Actor now treats this endpoint as primary but not authoritative for deep pagination.
- Query parameters:
  - `search-url` (encoded full Lamudi search URL)
  - `type` (`click-on-cluster`)
  - `useGeo` (`true`)
- Data returned: Array of listing summary objects including IDs and primary listing fields.

## Pagination Fallback
- For pages where API IDs repeat or API fails, actor fetches paginated SERP HTML (`?page=N`) and extracts listing URLs/IDs from page content.
- Extracted IDs are still enriched through detail API:
  - `https://www.lamudi.co.id/api/lamudi/listing/{listingId}`
- This allows collection to continue beyond the first 100 API summaries when user requests higher `results_wanted`.

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
