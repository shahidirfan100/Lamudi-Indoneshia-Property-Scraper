import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { readFile } from 'node:fs/promises';

await Actor.init();

const BASE_URL = 'https://www.lamudi.co.id';
const DEFAULT_SEARCH_URL = 'https://www.lamudi.co.id/en/for-sale/';
const LISTINGS_ENDPOINT_TYPES = ['click-on-cluster', 'initial'];
const DETAIL_BATCH_SIZE = 10;
const MAX_CONSECUTIVE_EMPTY_PAGES = 2;
const MAX_CONSECUTIVE_NO_NEW_ID_PAGES = 3;
const MAX_RETRIES = 5;

const BASE_HEADERS = {
    accept: 'application/json, text/plain, */*',
    'x-requested-with': 'XMLHttpRequest',
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    referer: DEFAULT_SEARCH_URL,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
};

const LOCALE_HEADERS = ['enUS', 'idID', 'en'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toInt = (value, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.trunc(num);
};

const toNumber = (value, fallback = null) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

const compactText = (value) => {
    if (value == null) return null;
    const text = String(value).replace(/\s+/g, ' ').trim();
    return text || null;
};

const toAbsoluteUrl = (value, base = BASE_URL) => {
    if (!value) return null;
    try {
        return new URL(String(value), base).href;
    } catch {
        return null;
    }
};

const normalizeSearchUrl = (value) => {
    const absolute = toAbsoluteUrl(value, BASE_URL);
    if (!absolute) return null;

    const parsed = new URL(absolute);
    let pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    pathname = pathname.endsWith('/') ? pathname : `${pathname}/`;
    pathname = pathname === '//' ? '/' : pathname;

    if (pathname === '/') pathname = '/en/for-sale/';
    if (pathname === '/en/jual/' || pathname === '/jual/en/') pathname = '/jual/';
    if (pathname === '/for-sale/' || pathname === '/en/for-sale') pathname = '/en/for-sale/';
    if (pathname === '/jual' || pathname === '/en/jual') pathname = '/jual/';

    parsed.pathname = pathname;
    return parsed.href;
};

const buildSearchUrl = ({ url, startUrl }) => {
    const directUrl = compactText(url) || compactText(startUrl);
    if (!directUrl) return DEFAULT_SEARCH_URL;

    const normalized = normalizeSearchUrl(directUrl);
    if (!normalized) throw new Error(`Invalid URL input: ${directUrl}`);
    return normalized;
};

const buildSearchUrlCandidates = (baseSearchUrl) => {
    const candidates = new Set();
    const add = (value) => {
        const normalized = normalizeSearchUrl(value);
        if (normalized) candidates.add(normalized);
    };

    add(baseSearchUrl);

    try {
        const parsed = new URL(baseSearchUrl);
        const path = parsed.pathname.toLowerCase();
        if (path.startsWith('/en/for-sale/')) {
            const alt = new URL(parsed.href);
            alt.pathname = parsed.pathname.replace(/^\/en\/for-sale\//i, '/jual/');
            add(alt.href);
        } else if (path.startsWith('/jual/')) {
            const alt = new URL(parsed.href);
            alt.pathname = parsed.pathname.replace(/^\/jual\//i, '/en/for-sale/');
            add(alt.href);
        }
    } catch {
        // noop
    }

    return [...candidates];
};

const withPage = (searchUrl, pageNo) => {
    const url = new URL(searchUrl);
    if (pageNo <= 1) {
        url.searchParams.delete('page');
    } else {
        url.searchParams.set('page', String(pageNo));
    }
    return url.href;
};

const buildClusterListingsUrl = (searchUrl, endpointType, pageNo) => {
    const api = new URL('/api/lamudi/cluster-listings', BASE_URL);

    // Apply pagination directly to the search-url
    // Lamudi Indonesia pattern: /buy/jakarta/house/?page=2
    const paginatedSearchUrl = new URL(searchUrl);
    if (pageNo > 1) {
        paginatedSearchUrl.searchParams.set('page', String(pageNo));
    }

    api.searchParams.set('search-url', paginatedSearchUrl.href);
    api.searchParams.set('type', endpointType);
    api.searchParams.set('useGeo', 'true');

    return api.href;
};

const buildDetailUrl = (listingId) => `${BASE_URL}/api/lamudi/listing/${encodeURIComponent(listingId)}`;

const extractListingIdFromUrl = (value) => {
    const absolute = toAbsoluteUrl(value, BASE_URL);
    if (!absolute) return null;

    try {
        const parsed = new URL(absolute);
        const match = parsed.pathname.match(/\/property\/([^/?#]+)/i);
        return compactText(match?.[1]) || null;
    } catch {
        return null;
    }
};

const cleanValue = (value) => {
    if (value == null) return undefined;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
    }

    if (Array.isArray(value)) {
        const cleaned = value.map(cleanValue).filter((item) => item !== undefined);
        return cleaned.length ? cleaned : undefined;
    }

    if (typeof value === 'object') {
        const out = {};
        for (const [key, entry] of Object.entries(value)) {
            const cleaned = cleanValue(entry);
            if (cleaned !== undefined) out[key] = cleaned;
        }
        return Object.keys(out).length ? out : undefined;
    }

    return value;
};

const cleanRecord = (record) => cleanValue(record) ?? {};

const parsePrice = (priceTag) => {
    const text = compactText(priceTag);
    if (!text) return null;
    const digits = text.replace(/[^\d]/g, '');
    if (!digits) return null;
    return toInt(digits, null);
};

const parseArea = (areaValue) => {
    const text = compactText(areaValue);
    if (!text) return null;
    const match = text.match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return null;
    return toNumber(match[0].replace(/,/g, ''), null);
};

const extractTagLabels = (tags) => {
    if (!tags || typeof tags !== 'object') return undefined;
    const labels = Object.values(tags)
        .map((tag) => compactText(tag?.text))
        .filter(Boolean);
    return labels.length ? labels : undefined;
};

const isPropertyImageUrl = (value) => {
    const url = toAbsoluteUrl(value, BASE_URL);
    if (!url) return false;

    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === 'img.lamudi.com' || host.endsWith('.img.lamudi.com');
    } catch {
        return false;
    }
};

const collectImageUrls = (...sources) => {
    const out = [];
    const seen = new Set();

    const add = (value) => {
        const absolute = toAbsoluteUrl(value, BASE_URL);
        if (!absolute || !isPropertyImageUrl(absolute) || seen.has(absolute)) return;
        seen.add(absolute);
        out.push(absolute);
    };

    const visit = (value, parentKey = '') => {
        if (value == null) return;
        if (typeof value === 'string') {
            const keyLooksLikeImage = /image|photo|gallery/i.test(parentKey);
            if (keyLooksLikeImage || isPropertyImageUrl(value)) add(value);
            return;
        }
        if (Array.isArray(value)) {
            for (const entry of value) visit(entry, parentKey);
            return;
        }
        if (typeof value === 'object') {
            for (const [key, entry] of Object.entries(value)) visit(entry, key);
        }
    };

    for (const source of sources) visit(source);
    return out;
};

const requestListingsWithHealing = async ({ pageSearchUrl, pageNo, proxyConfiguration }) => {
    const searchCandidates = buildSearchUrlCandidates(pageSearchUrl);
    const errors = [];

    for (const searchCandidate of searchCandidates) {
        for (const endpointType of LISTINGS_ENDPOINT_TYPES) {
            try {
                const apiUrl = buildClusterListingsUrl(searchCandidate, endpointType, pageNo);
                const response = await requestJsonWithRetries({
                    url: apiUrl,
                    proxyConfiguration,
                    referer: searchCandidate,
                });
                const listings = Array.isArray(response) ? response : [];
                if (listings.length) {
                    if (searchCandidate !== pageSearchUrl) {
                        log.info(`Auto-healed listings URL from ${pageSearchUrl} to ${searchCandidate}`);
                    }
                    return { listings, healedSearchUrl: searchCandidate };
                }
            } catch (error) {
                errors.push(`${endpointType}@${searchCandidate} -> ${error.message}`);
            }
        }
    }

    throw new Error(errors.slice(0, 3).join(' | ') || 'No listing data from healing attempts');
};

const extractHtmlListingSummaries = (html) => {
    if (!html || typeof html !== 'string') return [];

    const out = [];
    const seen = new Set();
    const matches = html.matchAll(/https?:\/\/www\.lamudi\.co\.id\/(?:en\/)?property\/([^"'?#<\s]+)/gi);

    for (const match of matches) {
        const id = compactText(match?.[1]);
        const url = toAbsoluteUrl(match?.[0], BASE_URL);
        if (!id || !url || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, url });
    }

    return out;
};

const requestHtmlWithRetries = async ({ url, proxyConfiguration, referer }) => {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const localeHeader = LOCALE_HEADERS[(attempt - 1) % LOCALE_HEADERS.length];

        try {
            const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
            const response = await gotScraping({
                url,
                proxyUrl,
                headers: {
                    ...BASE_HEADERS,
                    referer: referer || BASE_HEADERS.referer,
                    'wl-locale': localeHeader,
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                responseType: 'text',
                throwHttpErrors: false,
                timeout: { request: 45000 },
            });

            if (response.statusCode < 200 || response.statusCode >= 300) {
                throw new Error(`HTTP ${response.statusCode}`);
            }

            const html = response.body || '';
            if (!html) throw new Error('Empty HTML response');
            return html;
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                const waitMs = Math.min(800 * (2 ** (attempt - 1)), 7000);
                await sleep(waitMs);
            }
        }
    }

    throw lastError ?? new Error(`Failed to fetch HTML from ${url}`);
};

const requestPaginatedListingsFromHtml = async ({ pageSearchUrl, proxyConfiguration }) => {
    const searchCandidates = buildSearchUrlCandidates(pageSearchUrl);
    const errors = [];

    for (const searchCandidate of searchCandidates) {
        try {
            const html = await requestHtmlWithRetries({
                url: searchCandidate,
                proxyConfiguration,
                referer: searchCandidate,
            });
            const listings = extractHtmlListingSummaries(html);
            if (listings.length) {
                if (searchCandidate !== pageSearchUrl) {
                    log.info(`Auto-healed HTML listings URL from ${pageSearchUrl} to ${searchCandidate}`);
                }
                return { listings, healedSearchUrl: searchCandidate };
            }
        } catch (error) {
            errors.push(`${searchCandidate} -> ${error.message}`);
        }
    }

    throw new Error(errors.slice(0, 3).join(' | ') || 'No listing data from HTML pagination attempts');
};

const requestJsonWithRetries = async ({ url, proxyConfiguration, referer }) => {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const localeHeader = LOCALE_HEADERS[(attempt - 1) % LOCALE_HEADERS.length];

        try {
            const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
            const response = await gotScraping({
                url,
                proxyUrl,
                headers: {
                    ...BASE_HEADERS,
                    referer: referer || BASE_HEADERS.referer,
                    'wl-locale': localeHeader,
                },
                responseType: 'text',
                throwHttpErrors: false,
                timeout: { request: 45000 },
            });

            if (response.statusCode < 200 || response.statusCode >= 300) {
                throw new Error(`HTTP ${response.statusCode}`);
            }

            const bodyText = response.body || '';
            try {
                return JSON.parse(bodyText);
            } catch (error) {
                throw new Error(`Invalid JSON response: ${error.message}`);
            }
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                const waitMs = Math.min(800 * (2 ** (attempt - 1)), 7000);
                await sleep(waitMs);
            }
        }
    }

    throw lastError ?? new Error(`Failed to fetch JSON from ${url}`);
};

const mapListingRecord = ({ detail, summary, searchUrl, page }) => {
    const id = compactText(detail?.id) || compactText(summary?.id);
    const url = toAbsoluteUrl(detail?.url || summary?.url, BASE_URL);

    const imageUrls = collectImageUrls(detail, summary);
    const imageUrl = imageUrls[0] || toAbsoluteUrl(detail?.image || summary?.image, BASE_URL);

    return cleanRecord({
        id,
        title: compactText(detail?.title || summary?.title),
        url,
        imageUrl,
        imageUrls: imageUrls.length ? imageUrls : undefined,
        numberOfImages: toInt(detail?.numberOfImages ?? summary?.numberOfImages, null),
        exactLocation: detail?.exactLocation ?? summary?.exactLocation,
        description: compactText(detail?.description || summary?.description),
        price: parsePrice(detail?.priceTag || summary?.priceTag),
        priceText: compactText(detail?.priceTag || summary?.priceTag),
        location: compactText(detail?.location || summary?.location),
        bedrooms: toInt(detail?.bedrooms ?? summary?.bedrooms, null),
        bathrooms: toInt(detail?.bathrooms ?? summary?.bathrooms, null),
        area: parseArea(detail?.area || summary?.area),
        areaText: compactText(detail?.area || summary?.area),
        carSpaces: toInt(detail?.carSpaces ?? summary?.carSpaces, null),
        latitude: toNumber(detail?.latitude ?? summary?.latitude, null),
        longitude: toNumber(detail?.longitude ?? summary?.longitude, null),
        moreInfo: compactText(detail?.moreInfo || summary?.moreInfo),
        agencyData: detail?.agencyData ?? summary?.agencyData,
        tags: detail?.tags ?? summary?.tags,
        tagLabels: extractTagLabels(detail?.tags ?? summary?.tags),
        sourceSearchUrl: searchUrl,
        sourcePage: page,
    });
};

async function main() {
    const actorInput = await Actor.getInput();
    let input = actorInput ?? {};

    const isAtHome = (typeof Actor.isAtHome === 'function' ? Actor.isAtHome() : false) || process.env.APIFY_IS_AT_HOME === '1';
    const isEmptyObject = input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0;

    if (!isAtHome && (actorInput == null || isEmptyObject)) {
        try {
            const raw = await readFile(new URL('../INPUT.json', import.meta.url), 'utf8');
            input = JSON.parse(raw);
        } catch {
            input = {};
        }
    }

    const {
        url,
        startUrl,
        results_wanted: resultsWantedRaw = 20,
        max_pages: maxPagesRaw = 3,
        proxyConfiguration,
    } = input;

    const resultsWanted = Math.max(1, toInt(resultsWantedRaw, 20));
    const maxPages = Math.max(1, toInt(maxPagesRaw, 3));

    const searchBaseUrl = buildSearchUrl({ url, startUrl });
    const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

    log.info(`Using base search URL: ${searchBaseUrl}`);

    const seenIds = new Set();
    let saved = 0;
    let consecutiveEmptyPages = 0;
    let consecutiveNoNewIdPages = 0;

    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        if (saved >= resultsWanted) break;

        const pageSearchUrl = withPage(searchBaseUrl, pageNo);
        let listings = [];
        let effectiveSearchUrl = pageSearchUrl;
        let listingsSource = 'api';
        let listingsApiFailed = false;
        try {
            const response = await requestListingsWithHealing({
                pageSearchUrl,
                pageNo,
                proxyConfiguration: proxyConf,
            });
            listings = response.listings;
            effectiveSearchUrl = response.healedSearchUrl;
        } catch (error) {
            listingsApiFailed = true;
            log.warning(`Page ${pageNo} listings API failed: ${error.message}`);
        }

        const remaining = resultsWanted - saved;
        let candidates = listings
            .filter((item) => compactText(item?.id) && !seenIds.has(compactText(item.id)))
            .slice(0, remaining);

        const shouldTryHtmlPagination = listingsApiFailed || !listings.length || !candidates.length;
        if (shouldTryHtmlPagination) {
            try {
                const htmlResponse = await requestPaginatedListingsFromHtml({
                    pageSearchUrl,
                    proxyConfiguration: proxyConf,
                });
                const htmlCandidates = htmlResponse.listings
                    .filter((item) => compactText(item?.id) && !seenIds.has(compactText(item.id)))
                    .slice(0, remaining);

                if (htmlCandidates.length || !listings.length) {
                    listings = htmlResponse.listings;
                    candidates = htmlCandidates;
                    effectiveSearchUrl = htmlResponse.healedSearchUrl;
                    listingsSource = 'html';
                    log.info(`Using HTML pagination source for page ${pageNo}. Found ${listings.length} candidate summaries.`);
                }
            } catch (error) {
                log.warning(`Page ${pageNo} HTML pagination fallback failed: ${error.message}`);
            }
        }

        if (!listings.length) {
            consecutiveEmptyPages += 1;
            log.warning(`No listing summaries found on page ${pageNo}. (${consecutiveEmptyPages}/${MAX_CONSECUTIVE_EMPTY_PAGES})`);
            if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY_PAGES) break;
            continue;
        }

        consecutiveEmptyPages = 0;

        if (!candidates.length) {
            consecutiveNoNewIdPages += 1;
            log.info(
                `No new listing IDs found on page ${pageNo} from ${listingsSource} source. ` +
                `(${consecutiveNoNewIdPages}/${MAX_CONSECUTIVE_NO_NEW_ID_PAGES})`,
            );
            if (consecutiveNoNewIdPages >= MAX_CONSECUTIVE_NO_NEW_ID_PAGES) break;
            continue;
        }
        consecutiveNoNewIdPages = 0;

        let pageSaved = 0;

        for (let idx = 0; idx < candidates.length; idx += DETAIL_BATCH_SIZE) {
            const batch = candidates.slice(idx, idx + DETAIL_BATCH_SIZE);
            const batchRecords = await Promise.all(batch.map(async (summary) => {
                const listingId = compactText(summary?.id) || extractListingIdFromUrl(summary?.url);
                if (!listingId) return null;

                try {
                    const detail = await requestJsonWithRetries({
                        url: buildDetailUrl(listingId),
                        proxyConfiguration: proxyConf,
                        referer: effectiveSearchUrl,
                    });

                    const mapped = mapListingRecord({
                        detail,
                        summary,
                        searchUrl: effectiveSearchUrl,
                        page: pageNo,
                    });

                    if (!mapped.id || !mapped.url) return null;
                    return mapped;
                } catch (error) {
                    log.warning(`Detail API failed for ${listingId}: ${error.message}`);
                    return null;
                }
            }));

            const recordsToPush = [];

            for (const record of batchRecords) {
                if (!record?.id || seenIds.has(record.id)) continue;

                const cleaned = cleanRecord(record);
                if (!cleaned?.id || seenIds.has(cleaned.id)) continue;

                seenIds.add(cleaned.id);
                recordsToPush.push(cleaned);
                if (saved + pageSaved + recordsToPush.length >= resultsWanted) break;
            }

            if (recordsToPush.length) {
                await Dataset.pushData(recordsToPush);
                pageSaved += recordsToPush.length;
                saved += recordsToPush.length;
                log.info(`Saved batch of ${recordsToPush.length} records from page ${pageNo}. Total: ${saved}/${resultsWanted}`);
            }

            if (saved >= resultsWanted) break;
        }

        if (pageSaved === 0) {
            log.warning(`No detail records saved from page ${pageNo}.`);
        }
    }

    if (saved === 0) {
        throw new Error('No data extracted from Lamudi Indonesia APIs.');
    }

    log.info(`Completed successfully. Total records saved: ${saved}`);
}

try {
    await main();
} finally {
    await Actor.exit();
}
