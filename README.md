# Lamudi Indonesia Property Scraper

Collect property listings from Lamudi Indonesia in a clean, structured dataset for research, monitoring, and operational workflows. Capture sale listings with pricing, location, listing media, and listing attributes at scale.

## Features

- **Flexible URL support** — Works with Lamudi language paths such as `/en/for-sale/` and `/jual/`.
- **Paginated collection control** — Limit extraction with result and page caps.
- **Detailed listing records** — Collect title, price, location, room counts, area, media, and agency metadata.
- **Clean dataset output** — Empty and null values are removed automatically.
- **Deduplicated results** — Listing IDs are used to prevent duplicate output.

## Use Cases

### Property Market Monitoring
Track listing supply and price movement by area or category. Run recurring collections and compare snapshots over time.

### Lead Research
Build listing datasets with URLs, agencies, and location context for acquisition or outreach pipelines.

### Price Benchmarking
Analyze price patterns by bedrooms, bathrooms, and area to compare market segments.

### Content and Trend Analysis
Use listing descriptions and tags to identify market themes, common property features, and demand signals.

### Data Enrichment
Feed collected records into BI tools, spreadsheets, CRM systems, or internal analytics workflows.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | String | No | `https://www.lamudi.co.id/en/for-sale/` | Lamudi Indonesia listing URL to collect from. |
| `results_wanted` | Integer | No | `20` | Maximum number of records to save. |
| `max_pages` | Integer | No | `3` | Maximum number of pages to request. |
| `include_image_gallery` | Boolean | No | `false` | Fetch full gallery image URLs from property pages (slower and more block-prone). Keep `false` for fastest API mode. |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": true}` | Proxy settings for reliable runs. |

---

## Output Data

Each dataset item can include:

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Listing identifier. |
| `title` | String | Listing title. |
| `url` | String | Full listing URL. |
| `imageUrl` | String | Primary image URL. |
| `imageUrls` | Array | Available image URL list. |
| `numberOfImages` | Number | Image count. |
| `exactLocation` | Boolean | Whether exact location is available. |
| `description` | String | Listing description. |
| `price` | Number | Numeric listing price. |
| `priceText` | String | Raw price text. |
| `location` | String | Listing location text. |
| `bedrooms` | Number | Bedroom count. |
| `bathrooms` | Number | Bathroom count. |
| `area` | Number | Numeric area value. |
| `areaText` | String | Raw area text. |
| `carSpaces` | Number | Car space count. |
| `latitude` | Number | Latitude value. |
| `longitude` | Number | Longitude value. |
| `moreInfo` | String | Additional listing text. |
| `agencyData` | Object | Agency information object. |
| `tags` | Object | Listing tags object. |
| `tagLabels` | Array | Readable tag labels. |
| `sourceSearchUrl` | String | Source URL used for retrieval. |
| `sourcePage` | Number | Page number used in the run. |
Fields with empty values are omitted from the final output.

---

## Usage Examples

### Default Collection

```json
{
  "url": "https://www.lamudi.co.id/en/for-sale/",
  "results_wanted": 20,
  "max_pages": 3,
  "include_image_gallery": false
}
```

### Location URL Collection

```json
{
  "url": "https://www.lamudi.co.id/en/for-sale/jakarta/",
  "results_wanted": 60,
  "max_pages": 5,
  "include_image_gallery": true
}
```

## Sample Output

```json
{
  "id": "41032-73-2bd718958e85-a9d7-19e2295-a5f4-7ff3",
  "title": "New, Ready-to-Occupy House with SHM for 300 Million in Tajur Halang",
  "url": "https://www.lamudi.co.id/en/property/41032-73-2bd718958e85-a9d7-19e2295-a5f4-7ff3",
  "imageUrl": "https://img.lamudi.com/...",
  "numberOfImages": 11,
  "price": 360000000,
  "priceText": "Rp 360,000,000",
  "location": "Tajurhalang, Bogor Regency, West Java",
  "bedrooms": 2,
  "bathrooms": 1,
  "area": 38,
  "areaText": "38 m²",
  "sourceSearchUrl": "https://www.lamudi.co.id/en/for-sale/jakarta/",
  "sourcePage": 1
}
```

---

## Tips for Best Results

### Use Valid Listing URLs
- Prefer tested Lamudi Indonesia listing pages.
- Use location-specific URLs for targeted data.

### Start Small, Then Scale
- Run with `results_wanted: 20` first.
- Increase limits after output validation.

### Keep Runs Reliable
- Use proxy settings for heavier or repeated runs.
- Split very large collections into multiple runs.

### Work with Optional Fields
- Some listings include fewer attributes than others.
- Build downstream handling with optional field support.

---

## Integrations

Connect your dataset with:

- **Google Sheets** — Build shareable listing trackers.
- **Airtable** — Create searchable property databases.
- **Slack** — Send listing updates and run summaries.
- **Make** — Build no-code automation flows.
- **Zapier** — Connect to CRM and sales workflows.

### Export Formats

- **JSON** — Developer-friendly data pipelines.
- **CSV** — Spreadsheet and tabular analysis.
- **Excel** — Business reporting workflows.
- **XML** — Legacy integration needs.

---

## Frequently Asked Questions

### Can I use Indonesian path URLs such as `/jual/`?
Yes. The actor supports Lamudi language URL variants and applies URL auto-healing fallback internally.

### Why are some fields missing in some records?
Some listings do not publish every field. Empty values are omitted intentionally.

### Can I collect beyond one page?
Yes. Set `max_pages` above `1` to request additional pages.

### How is duplicate data handled?
Duplicate listing IDs are skipped automatically.

---

## Support

For issues or feature requests, use the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Scheduling](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is intended for legitimate data collection and analysis workflows. Users are responsible for compliance with website terms and applicable laws.
