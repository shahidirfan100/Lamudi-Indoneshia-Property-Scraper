# API Discovery

## Selected API
- **Endpoint:** `https://www.lamudi.co.id/api/lamudi/cluster-listings`
- **Method:** `GET`
- **Auth:** No token. Relies on browser-like headers (Firefox fingerprint via impit, `wl-locale`, `x-requested-with`, `referer`).
- **HTTP client:** `impit` with `browser: firefox`, `http3: true`, `ignoreTlsErrors: true` for stealth TLS + HTTP fingerprinting.
- **Proxy:** Optional Apify proxy; a new impit client is created per request with the proxy URL bound at construction.

## Query Parameters

| Parameter | Value | Description |
|---|---|---|
| `search-url` | Full Lamudi search URL (e.g. `https://www.lamudi.co.id/en/for-sale/`) | Encoded search context |
| `type` | `click-on-cluster` or `initial` | Endpoint variant; both tried as fallback |
| `useGeo` | `true` | Geolocation flag |
| `page` | `2`, `3`, etc. | Passed as a **separate** top-level param (not embedded in `search-url`) for reliable pagination |

## Pagination
- Page 1 returns up to ~60 listing objects.
- Pages 2+ pass `page=N` as a separate query parameter (not inside `search-url`).
- HTML pagination fallback (`?page=N` on search URL) is used when the API returns no new IDs or returns HTML (rate-limited).

## Detail API — DEPRECATED / BROKEN
- **Endpoint:** `https://www.lamudi.co.id/api/lamudi/listing/{listingId}`
- **Status:** Returns HTML for all requests (likely deprecated, redirects to property page or returns captcha page).
- **Action:** Completely removed from actor. All fields are extracted from the `cluster-listings` response directly.

## URLScan.io Findings
Two recent scans of `lamudi.co.id` were found (Feb 2026, May 2026). Site runs on Jetty/PWS behind CloudFront + Cloudflare CDN. Anti-bot protection (Cloudflare challenge) triggers after ~60 JSON requests or when TLS/header fingerprints mismatch. No hidden internal APIs were found that return richer data than `cluster-listings`.

## Why This API Was Chosen
- Returns JSON listing objects directly — no HTML extraction needed.
- Contains all core fields: id, title, url, price, location, bedrooms, bathrooms, area, images, lat/lng, tags.
- Works with impit's Firefox impersonation and stays HTTP-only (no browser).
- Fast — single request per page returns all listings.

## Impit Stealth Configuration
```js
const impit = new Impit({
    browser: 'firefox',       // Firefox TLS + HTTP fingerprint
    http3: true,               // QUIC protocol support
    ignoreTlsErrors: true,     // Resilience
    proxyUrl: '...',           // Per-request Apify proxy
});
```
- No custom User-Agent is set — impit generates a matching Firefox UA from its fingerprint.
- No `Sec-Fetch-*` headers are manually set — impit auto-generates correct browser-level headers.
- Retries use exponential backoff with random jitter.
- Between pages: 1.5–3.5s random delay.

## Field Coverage

All fields are extracted from the `cluster-listings` response item objects:

| Field | Source |
|---|---|
| `id` | `item.id` / `item.listingId` / `item.listing_id` |
| `title` | `item.title` |
| `url` | `item.url` / `item.absoluteUrl` / `item.link` |
| `imageUrl` | First from `collectImageUrls(item)` or `item.image` / `item.mainImage` |
| `imageUrls` | All URLs matching `*.lamudi.com`, `*.cloudfront.net`, cloudinary, or image extensions |
| `numberOfImages` | `item.numberOfImages` |
| `price` | Parsed from `item.priceTag` / `item.priceText` / `item.price` |
| `location` | `item.location` |
| `bedrooms` | `item.bedrooms` |
| `bathrooms` | `item.bathrooms` |
| `area` | Parsed from `item.area` / `item.floorArea` |
| `carSpaces` | `item.carSpaces` |
| `latitude` / `longitude` | `item.latitude` / `item.lat` / `item.longitude` / `item.lng` |
| `tags` / `tagLabels` | `item.tags` |
| `description` | `item.description` (when available) |
| `agencyData` | `item.agencyData` (when available) |
| `exactLocation` | `item.exactLocation` (when available) |

## Rejected Candidates
- `/api/lamudi/listings` — returns map cluster features, not full listing arrays.
- `/api/lamudi/listing/{id}` — deprecated; returns HTML instead of JSON.
- HTML/JSON-LD extraction — only used as pagination fallback when API is rate-limited.
- Browser DOM scraping — avoided; actor is HTTP-only with impit.
