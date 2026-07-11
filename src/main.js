import { readdir, readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { Impit } from 'impit';

await Actor.init();

const BASE_URL = 'https://www.lamudi.co.id';
const DEFAULT_SEARCH_URL = 'https://www.lamudi.co.id/en/for-sale/';
const LISTINGS_ENDPOINT_TYPES = ['click-on-cluster', 'initial'];
const MAX_CONSECUTIVE_EMPTY_PAGES = 2;
const MAX_CONSECUTIVE_NO_NEW_ID_PAGES = 3;
const MAX_RETRIES = 3;
const JSON_TIMEOUT_MS = 15000;
const HTML_TIMEOUT_MS = 20000;

const BASE_HEADERS = {
    accept: 'application/json, text/plain, */*',
    'x-requested-with': 'XMLHttpRequest',
    'accept-language': 'en-US,en;q=0.9,id;q=0.8',
    referer: DEFAULT_SEARCH_URL,
};

const LOCALE_HEADERS = ['enUS', 'idID', 'en'];

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

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
    const text = compactText(value);
    if (!text) return null;

    try {
        const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(text);
        const looksLikeHost = /^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(text);
        let candidate = text;
        if (!hasScheme && !text.startsWith('/') && looksLikeHost) {
            candidate = `https://${text}`;
        }
        return new URL(candidate, base).href;
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
    if (!normalized) return null;
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
    api.searchParams.set('search-url', searchUrl);
    api.searchParams.set('type', endpointType);
    api.searchParams.set('useGeo', 'true');
    if (pageNo > 1) api.searchParams.set('page', String(pageNo));
    return api.href;
};



const findCaseInsensitiveKey = (source, wantedKey) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const wanted = wantedKey.toLowerCase();
    return Object.keys(source).find((key) => key.toLowerCase() === wanted) ?? null;
};

const getCaseInsensitive = (source, wantedKey) => {
    const key = findCaseInsensitiveKey(source, wantedKey);
    return key ? source[key] : undefined;
};

const getFirstField = (source, keys) => {
    for (const key of keys) {
        const value = getCaseInsensitive(source, key);
        if (value !== undefined && value !== null) return value;
    }
    return undefined;
};

const getNestedField = (source, path) => {
    let current = source;
    for (const key of path) {
        current = getCaseInsensitive(current, key);
        if (current == null) return undefined;
    }
    return current;
};

const normalizeToArray = (value) => {
    if (Array.isArray(value)) return value;
    return [];
};

const extractListingsFromResponse = (response) => {
    if (Array.isArray(response)) return response;
    if (!response || typeof response !== 'object') return [];

    const direct = getFirstField(response, ['listings', 'results', 'items', 'data']);
    if (Array.isArray(direct)) return direct;

    const nested = getNestedField(response, ['data', 'listings']) ??
        getNestedField(response, ['data', 'results']) ??
        getNestedField(response, ['payload', 'listings']) ??
        getNestedField(response, ['response', 'listings']);

    return normalizeToArray(nested);
};



const readApiDiscoveryText = async () => {
    try {
        const rootUrl = new URL('../', import.meta.url);
        const entries = await readdir(rootUrl);
        const discoveryFile = entries.find((entry) => entry.toLowerCase() === 'api_discovery.md');
        if (!discoveryFile) return null;
        return await readFile(new URL(discoveryFile, rootUrl), 'utf8');
    } catch (error) {
        log.warning(`Could not read API discovery notes: ${error.message}`);
        return null;
    }
};

const parseApiDiscovery = (text) => {
    if (!text) return {};
    const endpoints = [];
    const params = new Set();
    const headers = new Set();
    const fields = new Set();

    for (const line of text.split(/\r?\n/)) {
        const endpointMatch = line.match(/endpoint:\s*`?([^`\s]+)`?/i);
        if (endpointMatch?.[1]) endpoints.push(endpointMatch[1]);

        for (const param of line.matchAll(/`([a-z][\w-]*)`\s*(?:\(|:)/gi)) params.add(param[1].toLowerCase());
        for (const header of line.matchAll(/`(wl-locale|accept|referer|user-agent|x-requested-with|[\w-]*header[\w-]*)`/gi)) {
            headers.add(header[1].toLowerCase());
        }
        for (const field of line.matchAll(/\b(id|url|title|price|location|bedrooms|bathrooms|area|data|results|listings|items)\b/gi)) {
            fields.add(field[1].toLowerCase());
        }
    }

    return {
        endpoints,
        params: [...params],
        headers: [...headers],
        fields: [...fields],
    };
};

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
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        if (host.endsWith('.lamudi.com') || host.endsWith('.cloudfront.net') || host.includes('cloudinary')) return true;
        return /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(parsed.pathname);
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

const shouldRetryError = (error) => {
    const message = String(error?.message || '');
    return /\b(429|5\d\d|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|Timeout|timed out|socket hang up)\b/i.test(message);
};

const createImpit = (proxyUrl) => new Impit({
    browser: 'firefox',
    http3: true,
    ignoreTlsErrors: true,
    ...(proxyUrl ? { proxyUrl } : {}),
});

const requestHtmlWithRetries = async ({ url, proxyConfiguration, referer }) => {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const localeHeader = LOCALE_HEADERS[(attempt - 1) % LOCALE_HEADERS.length];

        try {
            const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
            const impit = createImpit(proxyUrl);

            const response = await impit.fetch(url, {
                headers: {
                    ...BASE_HEADERS,
                    referer: referer || BASE_HEADERS.referer,
                    'wl-locale': localeHeader,
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                timeout: HTML_TIMEOUT_MS,
                redirect: 'follow',
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const html = await response.text();
            if (!html) throw new Error('Empty HTML response');
            return html;
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES && shouldRetryError(error)) {
                const waitMs = Math.min(800 * (2 ** (attempt - 1)), 7000);
                await sleep(waitMs + Math.random() * 500);
            } else {
                break;
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
            const impit = createImpit(proxyUrl);

            const response = await impit.fetch(url, {
                headers: {
                    ...BASE_HEADERS,
                    referer: referer || BASE_HEADERS.referer,
                    'wl-locale': localeHeader,
                },
                timeout: JSON_TIMEOUT_MS,
                redirect: 'follow',
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const bodyText = await response.text();
            const contentType = response.headers.get('content-type') || '';
            const trimmedBody = bodyText.trim();
            if (/html/i.test(contentType) || trimmedBody.startsWith('<')) {
                throw new Error('Expected JSON but received HTML response');
            }
            if (!trimmedBody) {
                throw new Error('Empty JSON response');
            }

            try {
                return JSON.parse(trimmedBody);
            } catch (error) {
                throw new Error(`Invalid JSON response: ${error.message}`);
            }
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES && shouldRetryError(error)) {
                const waitMs = Math.min(800 * (2 ** (attempt - 1)), 7000);
                await sleep(waitMs + Math.random() * 500);
            } else {
                break;
            }
        }
    }

    throw lastError ?? new Error(`Failed to fetch JSON from ${url}`);
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
                const listings = extractListingsFromResponse(response);
                if (!listings.length && response && typeof response === 'object') {
                    log.warning(`Listings API response did not contain an array. Top-level keys: ${Object.keys(response).join(', ')}`);
                }
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

const mapListingRecord = (item, searchUrl, page) => {
    const id = compactText(getFirstField(item, ['id', 'listingId', 'listing_id'])) ||
        extractListingIdFromUrl(getFirstField(item, ['url', 'absoluteUrl', 'link']));
    const url = toAbsoluteUrl(getFirstField(item, ['url', 'absoluteUrl', 'link']), BASE_URL);

    const imageUrls = collectImageUrls(item);
    const imageUrl = imageUrls[0] || toAbsoluteUrl(
        getFirstField(item, ['image', 'imageUrl', 'mainImage']),
        BASE_URL,
    );
    const tags = getFirstField(item, ['tags']);

    return cleanRecord({
        id,
        title: compactText(getFirstField(item, ['title'])),
        url,
        imageUrl,
        imageUrls: imageUrls.length ? imageUrls : undefined,
        numberOfImages: toInt(getFirstField(item, ['numberOfImages']), null),
        exactLocation: getFirstField(item, ['exactLocation']),
        description: compactText(getFirstField(item, ['description'])),
        price: parsePrice(getFirstField(item, ['priceTag', 'priceText', 'price'])),
        priceText: compactText(getFirstField(item, ['priceTag', 'priceText', 'price'])),
        location: compactText(getFirstField(item, ['location'])),
        bedrooms: toInt(getFirstField(item, ['bedrooms']), null),
        bathrooms: toInt(getFirstField(item, ['bathrooms']), null),
        area: parseArea(getFirstField(item, ['area', 'floorArea'])),
        areaText: compactText(getFirstField(item, ['area', 'floorArea'])),
        carSpaces: toInt(getFirstField(item, ['carSpaces']), null),
        latitude: toNumber(getFirstField(item, ['latitude', 'lat']), null),
        longitude: toNumber(getFirstField(item, ['longitude', 'lng', 'lon']), null),
        moreInfo: compactText(getFirstField(item, ['moreInfo'])),
        agencyData: getFirstField(item, ['agencyData']),
        tags,
        tagLabels: extractTagLabels(tags),
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

    const discovery = parseApiDiscovery(await readApiDiscoveryText());
    if (!discovery.endpoints?.length) {
        log.warning('API discovery notes were missing or did not contain endpoint metadata.');
    }

    let searchBaseUrl = buildSearchUrl({ url, startUrl });
    if (!searchBaseUrl) {
        log.warning(`Invalid URL input skipped, using default search URL instead: ${compactText(url) || compactText(startUrl)}`);
        searchBaseUrl = DEFAULT_SEARCH_URL;
    }
    const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

    log.info(`Using base search URL: ${searchBaseUrl}`);

    const seenIds = new Set();
    let saved = 0;
    let consecutiveEmptyPages = 0;
    let skipAhead = 0;

    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        if (saved >= resultsWanted) break;

        if (skipAhead > 0) {
            pageNo += skipAhead;
            skipAhead = 0;
            if (pageNo > maxPages) break;
        }

        if (pageNo > 1) await sleep(1500 + Math.random() * 2000);

        const pageSearchUrl = withPage(searchBaseUrl, pageNo);
        let listings = [];
        let effectiveSearchUrl = pageSearchUrl;
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
            .filter((item) => {
                const listingId = compactText(getFirstField(item, ['id', 'listingId', 'listing_id'])) ||
                    extractListingIdFromUrl(getFirstField(item, ['url', 'absoluteUrl', 'link']));
                return listingId && !seenIds.has(listingId);
            })
            .slice(0, remaining);

        const shouldTryHtmlPagination = listingsApiFailed || !listings.length || !candidates.length;
        if (shouldTryHtmlPagination) {
            try {
                const htmlResponse = await requestPaginatedListingsFromHtml({
                    pageSearchUrl,
                    proxyConfiguration: proxyConf,
                });
                const htmlCandidates = htmlResponse.listings
                    .filter((item) => {
                        const listingId = compactText(getFirstField(item, ['id', 'listingId', 'listing_id'])) ||
                            extractListingIdFromUrl(getFirstField(item, ['url', 'absoluteUrl', 'link']));
                        return listingId && !seenIds.has(listingId);
                    })
                    .slice(0, remaining);

                if (htmlCandidates.length || !listings.length) {
                    listings = htmlResponse.listings;
                    candidates = htmlCandidates;
                    effectiveSearchUrl = htmlResponse.healedSearchUrl;
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
            skipAhead = Math.min(3, maxPages - pageNo);
            log.info(`No new IDs on page ${pageNo}. Skipping ahead ${skipAhead} page(s) to page ${pageNo + skipAhead}.`);
            continue;
        }

        const recordsToPush = [];
        for (const item of candidates) {
            const mapped = mapListingRecord(item, effectiveSearchUrl, pageNo);
            if (!mapped?.id || seenIds.has(mapped.id)) continue;
            const cleaned = cleanRecord(mapped);
            if (!cleaned?.id || seenIds.has(cleaned.id)) continue;
            seenIds.add(cleaned.id);
            recordsToPush.push(cleaned);
            if (saved + recordsToPush.length >= resultsWanted) break;
        }

        if (recordsToPush.length) {
            await Dataset.pushData(recordsToPush);
            saved += recordsToPush.length;
            log.info(`Saved ${recordsToPush.length} records from page ${pageNo}. Total: ${saved}/${resultsWanted}`);
        } else {
            log.warning(`No records saved from page ${pageNo}.`);
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
