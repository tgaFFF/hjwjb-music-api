// Vercel-side proxy implementation.
// This is a copy of `cloudflare-worker.js` so Vercel Serverless Functions can bundle it.
// (Vercel Node Functions don't automatically include files outside `api/` in the Lambda bundle.)

const SERVER_VERSION = '2026-02-03-vercel-proxy-v3';

const DEFAULT_UPSTREAM_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.7';
const MAX_TEXT_SNIFF_BYTES = 32768;

function corsHeaders(extra = {}) {
    const headers = new Headers(extra);
    headers.set('Access-Control-Allow-Origin', '*');
    // Keep in sync with Cloudflare Worker: allow POST/PUT for cross-origin preflight compatibility.
    headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT');
    headers.set(
        'Access-Control-Allow-Headers',
        'Range, Content-Type, Accept, Origin, Referer, Authorization, X-HJWJB-Token, X-User-Token, X-Auth-Token'
    );
    headers.set(
        'Access-Control-Expose-Headers',
        [
            'Accept-Ranges',
            'Content-Length',
            'Content-Range',
            'Content-Type',
            'ETag',
            'Last-Modified',
            'X-HJWJB-Server-Version',
            'X-Audio-Proxy-Final-Url',
            'X-Audio-Proxy-Status',
            'X-Audio-Proxy-Content-Type'
        ].join(', ')
    );
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('X-HJWJB-Server-Version', SERVER_VERSION);
    return headers;
}

function matchRoute(pathname, route) {
    if (!pathname) return false;
    if (pathname === route) return true;
    if (!pathname.endsWith(route)) return false;
    const prefix = pathname.slice(0, pathname.length - route.length);
    return prefix === '' || prefix.endsWith('/');
}

const KUGOU_DEV_COOKIE_CACHE_TTL_MS = 15 * 60 * 1000;
const kugouDevCookieState = { cookieHeader: '', expiresAt: 0, loading: null, authKey: '' };

const kugouParseStatsState = {
    dayUtc: '',
    parseCount: 0,
    successCount: 0,
    routes: {
        '/song/url': { total: 0, success: 0 },
        '/song/url/new': { total: 0, success: 0 },
        '/audio': { total: 0, success: 0 }
    },
    updatedAt: 0
};

function utcDayString(date = new Date()) {
    try {
        return date.toISOString().slice(0, 10);
    } catch (e) {
        return '';
    }
}

function ensureKugouParseStatsDay() {
    const day = utcDayString(new Date());
    if (!day) return;
    if (kugouParseStatsState.dayUtc !== day) {
        kugouParseStatsState.dayUtc = day;
        kugouParseStatsState.parseCount = 0;
        kugouParseStatsState.successCount = 0;
        kugouParseStatsState.routes = {
            '/song/url': { total: 0, success: 0 },
            '/song/url/new': { total: 0, success: 0 },
            '/audio': { total: 0, success: 0 }
        };
        kugouParseStatsState.updatedAt = Date.now();
    }
}

function getKugouParseStatsRouteKey(urlObj) {
    try {
        if (!urlObj || !urlObj.hostname) return '';
        const host = String(urlObj.hostname).toLowerCase();
        if (host !== '.') return '';
        const pathname = String(urlObj.pathname || '').replace(/\/+$/, '');
        if (pathname === '/song/url' || pathname === '/song/url/new' || pathname === '/audio') return pathname;
        return '';
    } catch (e) {
        return '';
    }
}

function countHttpUrlsInKugouValue(value) {
    const countUrlString = (v) => {
        const u = v != null ? String(v).trim() : '';
        if (!u) return 0;
        return /^https?:\/\//i.test(u) ? 1 : 0;
    };

    if (!value) return 0;
    if (typeof value === 'string') return countUrlString(value);

    if (Array.isArray(value)) {
        let count = 0;
        for (const item of value) {
            if (item && typeof item === 'object' && item.url != null) {
                count += countHttpUrlsInKugouValue(item.url);
            } else {
                count += countUrlString(item);
            }
        }
        return count;
    }

    if (value && typeof value === 'object') {
        let count = 0;
        if (value.url != null) count += countHttpUrlsInKugouValue(value.url);
        if (value.backupUrl != null) count += countHttpUrlsInKugouValue(value.backupUrl);
        return count;
    }

    return 0;
}

function parseKugouParseSuccess(routeKey, jsonText) {
    try {
        const data = JSON.parse(String(jsonText || ''));
        if (!data || typeof data !== 'object') return false;

        const errorCodeRaw = data.error_code ?? data.errorCode ?? data.code;
        const errCodeRaw = data.errcode ?? data.errCode;
        const statusRaw = data.status;

        const errorCode = errorCodeRaw != null ? Number(errorCodeRaw) : NaN;
        const errCode = errCodeRaw != null ? Number(errCodeRaw) : NaN;
        const status = statusRaw != null ? Number(statusRaw) : NaN;

        const hasExplicitError = Boolean(
            (typeof data.error === 'string' && data.error.trim()) ||
                (typeof data.errmsg === 'string' && data.errmsg.trim()) ||
                (typeof data.error_msg === 'string' && data.error_msg.trim())
        );

        const okIndicator =
            (!Number.isNaN(errorCode) ? errorCode === 0 : true) &&
            (!Number.isNaN(errCode) ? errCode === 0 || errCode === 200 : true) &&
            (!Number.isNaN(status) ? status === 1 || status === 200 : true) &&
            !hasExplicitError;

        if (!okIndicator) return false;

        if (routeKey === '/song/url' || routeKey === '/song/url/new') {
            const urlCount =
                countHttpUrlsInKugouValue(data.url) +
                countHttpUrlsInKugouValue(data.backupUrl) +
                (data.data ? countHttpUrlsInKugouValue(data.data.url) + countHttpUrlsInKugouValue(data.data.backupUrl) : 0);
            return urlCount > 0;
        }

        return true;
    } catch (e) {
        return false;
    }
}

function recordKugouParseStats(routeKey, { success } = {}) {
    const route = String(routeKey || '').trim();
    if (!route) return;
    ensureKugouParseStatsDay();

    kugouParseStatsState.parseCount += 1;
    if (!kugouParseStatsState.routes[route]) kugouParseStatsState.routes[route] = { total: 0, success: 0 };
    kugouParseStatsState.routes[route].total += 1;
    if (success) {
        kugouParseStatsState.successCount += 1;
        kugouParseStatsState.routes[route].success += 1;
    }
    kugouParseStatsState.updatedAt = Date.now();
}

function isKugouSongUrlEndpoint(urlObj) {
    try {
        if (!urlObj || !urlObj.hostname) return false;
        const host = String(urlObj.hostname).toLowerCase();
        if (host !== '') return false;
        const pathname = String(urlObj.pathname || '').replace(/\/+$/, '');
        return pathname === '/song/url' || pathname === '/song/url/new';
    } catch (e) {
        return false;
    }
}

function parseSetCookieValues(headers) {
    try {
        if (!headers) return [];

        // Node/Undici provides `getSetCookie()`; keep compatible with runtimes that don't.
        if (typeof headers.getSetCookie === 'function') {
            const values = headers.getSetCookie();
            if (Array.isArray(values) && values.length) return values;
        }

        const combined = headers.get('set-cookie');
        if (!combined) return [];
        return String(combined)
            .split(/,(?=[^;]+=)/g)
            .map((v) => String(v || '').trim())
            .filter(Boolean);
    } catch (e) {
        return [];
    }
}

function buildCookieHeaderFromSetCookie(values) {
    const lines = Array.isArray(values) ? values : [];
    const pairs = [];
    for (const line of lines) {
        const raw = String(line || '').trim();
        if (!raw) continue;
        const pair = raw.split(';')[0] ? raw.split(';')[0].trim() : '';
        if (!pair || !pair.includes('=')) continue;
        if (!pairs.includes(pair)) pairs.push(pair);
    }
    return pairs.join('; ');
}

async function getKugouDevCookieHeader(authKey = '') {
    const nextKey = String(authKey || '').trim();
    if (kugouDevCookieState.authKey !== nextKey) {
        kugouDevCookieState.cookieHeader = '';
        kugouDevCookieState.expiresAt = 0;
        kugouDevCookieState.loading = null;
        kugouDevCookieState.authKey = nextKey;
    }

    const now = Date.now();
    if (kugouDevCookieState.cookieHeader && kugouDevCookieState.expiresAt > now) {
        return kugouDevCookieState.cookieHeader;
    }

    if (kugouDevCookieState.loading) return kugouDevCookieState.loading;

    kugouDevCookieState.loading = (async () => {
        try {
            const url = new URL('');
            if (nextKey) url.searchParams.set('authKey', nextKey);
            const resp = await fetch(url.toString(), {
                method: 'GET',
                redirect: 'manual',
                headers: {
                    'User-Agent': DEFAULT_UPSTREAM_UA,
                    'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
                    Accept: 'application/json,*/*;q=0.9',
                    'Accept-Encoding': 'identity',
                    Referer: ''
                }
            });
            const cookieHeader = buildCookieHeaderFromSetCookie(parseSetCookieValues(resp && resp.headers));
            if (!cookieHeader) return '';
            kugouDevCookieState.cookieHeader = cookieHeader;
            kugouDevCookieState.expiresAt = Date.now() + KUGOU_DEV_COOKIE_CACHE_TTL_MS;
            return cookieHeader;
        } catch (e) {
            return '';
        }
    })().finally(() => {
        kugouDevCookieState.loading = null;
    });

    return kugouDevCookieState.loading;
}

function isAllowedProxyHost(hostname) {
    if (!hostname) return false;
    const host = hostname.toLowerCase();
    const allowExact = new Set([
        'music-dl.sayqz.com',
        'api.byfuns.top',
        'api.manhuaidc.cn',
        'musicapi.chuyel.top',
        'api.obdo.cc',
        'api.baka.plus',
        'api.qijieya.cn',
        'apis.uctb.cn',
        'oiapi.net',
        // API2 backend (QQ /api/*)
        '0',
        // API2 backend (Kugou / *)
        '',
        // Kuwo API4 (search/song/lyrics/rank/playlist)
        'kw-api.cenguigui.cn',
        // Kuwo LRCX (word-level lyrics)
        '',
        'y.gtimg.cn',
        'aqqmusic.tc.qq.com',
        'isure6.stream.qqmusic.qq.com',
        'music.126.net',
        'music.joox.com'
    ]);
    if (allowExact.has(host)) return true;
    if (host.endsWith('.music.126.net')) return true;
    if (host.endsWith('.music.joox.com')) return true;
    if (host.endsWith('.kuwo.cn')) return true;
    if (host.endsWith('.sycdn.kuwo.cn')) return true;
    if (host.endsWith('.stream.qqmusic.qq.com')) return true;
    if (host.endsWith('.gtimg.cn')) return true;
    if (host.endsWith('.sayqz.com')) return true;
    if (host.endsWith('.kugou.com')) return true;
    return false;
}

function detectAudioContentTypeFromBytes(bytes) {
    try {
        const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        if (b.length < 8) return null;

        const ascii = (start, len) => {
            const end = Math.min(b.length, start + len);
            let out = '';
            for (let i = start; i < end; i++) out += String.fromCharCode(b[i]);
            return out;
        };

        const ascii4 = ascii(0, 4);
        const ascii12 = ascii(0, 12);

        if (ascii4 === 'fLaC') return 'audio/flac';
        if (ascii4 === 'OggS') return 'audio/ogg';
        if (ascii4 === 'RIFF' && ascii12.includes('WAVE')) return 'audio/wav';
        if (b.length >= 8 && ascii(4, 4) === 'ftyp') return 'audio/mp4';

        // MP3 / AAC(ADTS) frame sync: 0xFFFx
        if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
        if (ascii4 === 'ID3') return 'audio/mpeg';

        // WebM/Matroska (EBML header): 1A 45 DF A3
        if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';

        return null;
    } catch (e) {
        return null;
    }
}

function looksLikeTextBytes(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!b.length) return false;
    const max = Math.min(b.length, 512);
    let printable = 0;
    for (let i = 0; i < max; i++) {
        const c = b[i];
        if (c === 9 || c === 10 || c === 13) printable += 1;
        else if (c >= 32 && c <= 126) printable += 1;
    }
    return printable / max > 0.9;
}

function looksLikeHtmlBytes(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!b.length) return false;
    try {
        const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 512)).trim().toLowerCase();
        return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<html');
    } catch (e) {
        return false;
    }
}

function extractFirstHttpUrlFromText(text) {
    const raw = String(text || '');
    const trimmed = raw.trim();
    if (!trimmed) return '';

    const visited = new Set();
    const tryFindUrlInJson = (node, depth = 0) => {
        if (depth > 4) return '';
        if (!node) return '';

        if (typeof node === 'string') {
            const str = node.trim();
            if (/^https?:\/\//i.test(str)) return str;
            return '';
        }

        if (typeof node !== 'object') return '';
        if (visited.has(node)) return '';
        visited.add(node);

        if (Array.isArray(node)) {
            for (const item of node) {
                const found = tryFindUrlInJson(item, depth + 1);
                if (found) return found;
            }
            return '';
        }

        const priorityKeys = ['finalUrl', 'url', 'playUrl', 'play_url', 'songUrl', 'song_url', 'src', 'link', 'location', 'data'];
        for (const key of priorityKeys) {
            if (Object.prototype.hasOwnProperty.call(node, key)) {
                const found = tryFindUrlInJson(node[key], depth + 1);
                if (found) return found;
            }
        }

        for (const value of Object.values(node)) {
            const found = tryFindUrlInJson(value, depth + 1);
            if (found) return found;
        }

        return '';
    };

    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            const parsed = JSON.parse(trimmed);
            const found = tryFindUrlInJson(parsed, 0);
            if (found) return found;
        } catch (e) {
            // ignore
        }
    }

    if (/^https?:\/\//i.test(trimmed)) return trimmed.split(/\s+/)[0];

    const match = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
    return match ? match[0] : '';
}

function inferAudioContentTypeFromUrl(urlObj) {
    try {
        const pathname = String(urlObj && urlObj.pathname ? urlObj.pathname : '');
        const lower = pathname.toLowerCase();
        if (lower.endsWith('.flac')) return 'audio/flac';
        if (lower.endsWith('.wav')) return 'audio/wav';
        if (lower.endsWith('.ogg')) return 'audio/ogg';
        if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
        if (lower.endsWith('.webm')) return 'audio/webm';
        if (lower.endsWith('.aac')) return 'audio/aac';
        return 'audio/mpeg';
    } catch (e) {
        return 'audio/mpeg';
    }
}

function errorResponse(status, message) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
    });
}

async function fetchWithManualRedirect(urlObj, init, redirectsLeft = 4) {
    let current = urlObj;
    let left = redirectsLeft;

    while (left >= 0) {
        const resp = await fetch(current.toString(), { ...init, redirect: 'manual' });
        if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get('Location');
            if (location) {
                try {
                    current = new URL(location, current);
                    left -= 1;
                    continue;
                } catch (e) {
                    return { resp, finalUrl: current };
                }
            }
        }
        return { resp, finalUrl: current };
    }

    return { resp: null, finalUrl: current };
}

async function handleTextProxy(request, targetUrl) {
    let urlObj;
    try {
        urlObj = new URL(String(targetUrl || '').trim());
    } catch (e) {
        return errorResponse(400, 'Invalid target url');
    }

    if (!isAllowedProxyHost(urlObj.hostname)) {
        return errorResponse(403, 'Host not allowed');
    }

    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return errorResponse(400, 'Only http(s) is supported');
    }

    const headers = new Headers();
    headers.set('User-Agent', DEFAULT_UPSTREAM_UA);
    headers.set('Accept-Language', DEFAULT_ACCEPT_LANGUAGE);
    headers.set('Accept', request.headers.get('Accept') || 'text/plain,*/*');
    const referer = request.headers.get('Referer');
    if (referer) headers.set('Referer', referer);

    if (isKugouSongUrlEndpoint(urlObj)) {
        const authKey = urlObj.searchParams.get('authKey') || urlObj.searchParams.get('authkey') || '';
        const cookieHeader = await getKugouDevCookieHeader(authKey);
        if (cookieHeader) headers.set('Cookie', cookieHeader);
    }

    let resp = null;
    try {
        const result = await fetchWithManualRedirect(urlObj, { method: 'GET', headers }, 3);
        resp = result.resp;
    } catch (e) {
        return errorResponse(502, 'Upstream fetch failed');
    }

    if (!resp) return errorResponse(502, 'Upstream fetch failed');
    if (!resp.ok) return errorResponse(resp.status, `Upstream error: ${resp.status}`);

    const outHeaders = corsHeaders({ 'Cache-Control': 'no-cache' });
    const ct = resp.headers.get('content-type');
    if (ct) outHeaders.set('Content-Type', ct);

    return new Response(resp.body, { status: resp.status, headers: outHeaders });
}

async function handleAudioResolve(_request, targetUrl) {
    let urlObj;
    try {
        urlObj = new URL(String(targetUrl || '').trim());
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid target url' }), {
            status: 400,
            headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
        });
    }

    if (!isAllowedProxyHost(urlObj.hostname)) {
        return new Response(JSON.stringify({ error: 'Host not allowed' }), {
            status: 403,
            headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
        });
    }

    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return new Response(JSON.stringify({ error: 'Only http(s) is supported' }), {
            status: 400,
            headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
        });
    }

    const headers = new Headers();
    headers.set('User-Agent', DEFAULT_UPSTREAM_UA);
    headers.set('Accept-Language', DEFAULT_ACCEPT_LANGUAGE);
    headers.set('Accept', '*/*');

    try {
        const result = await fetchWithManualRedirect(urlObj, { method: 'GET', headers }, 4);
        const resp = result.resp;
        const finalUrl = result.finalUrl ? result.finalUrl.toString() : urlObj.toString();
        if (!resp) throw new Error('no response');

        if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get('Location');
            if (location) {
                const next = new URL(location, urlObj);
                return new Response(JSON.stringify({ finalUrl: next.toString() }), {
                    status: 200,
                    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
                });
            }
        }

        const ct = String(resp.headers.get('content-type') || '').toLowerCase();
        if (ct.startsWith('audio/')) {
            return new Response(JSON.stringify({ finalUrl }), {
                status: 200,
                headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
            });
        }

        const text = await resp.text();
        const extracted = extractFirstHttpUrlFromText(text);
        return new Response(JSON.stringify({ finalUrl: extracted || finalUrl }), {
            status: 200,
            headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Resolve failed' }), {
            status: 502,
            headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
        });
    }
}

function createStreamFromReaderWithPrefix(prefixBytes, reader) {
    const prefix = prefixBytes instanceof Uint8Array ? prefixBytes : new Uint8Array(prefixBytes || []);
    const stream = new ReadableStream({
        start(controller) {
            try {
                if (prefix.length) controller.enqueue(prefix);
            } catch (e) {
                // ignore
            }

            const pump = () => {
                reader
                    .read()
                    .then(({ done, value }) => {
                        if (done) {
                            controller.close();
                            return;
                        }
                        controller.enqueue(value);
                        pump();
                    })
                    .catch((err) => {
                        controller.error(err);
                    });
            };
            pump();
        }
    });
    return stream;
}

async function handleAudioProxy(request, targetUrl) {
    let urlObj;
    try {
        urlObj = new URL(String(targetUrl || '').trim());
    } catch (e) {
        return errorResponse(400, 'Invalid target url');
    }

    if (!isAllowedProxyHost(urlObj.hostname)) {
        return errorResponse(403, 'Host not allowed');
    }

    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return errorResponse(400, 'Only http(s) is supported');
    }

    const clientMethod = request.method === 'HEAD' ? 'HEAD' : 'GET';

    const headers = new Headers();
    headers.set('User-Agent', DEFAULT_UPSTREAM_UA);
    headers.set('Accept-Language', DEFAULT_ACCEPT_LANGUAGE);
    headers.set('Accept', request.headers.get('Accept') || '*/*');

    const range = request.headers.get('Range');
    if (range) headers.set('Range', range);
    const referer = request.headers.get('Referer');
    if (referer) headers.set('Referer', referer);

    let redirectsLeft = 4;
    while (redirectsLeft >= 0) {
        let resp;
        try {
            resp = await fetch(urlObj.toString(), {
                method: clientMethod,
                mode: 'cors',
                headers,
                redirect: 'manual'
            });
        } catch (e) {
            return errorResponse(502, 'Upstream fetch failed');
        }

        if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get('Location');
            if (location) {
                try {
                    urlObj = new URL(location, urlObj);
                    redirectsLeft -= 1;
                    continue;
                } catch (e) {
                    break;
                }
            }
        }

        const headersOut = corsHeaders({ 'Cache-Control': 'no-cache' });
        const allow = new Set(['content-type', 'content-length', 'accept-ranges', 'content-range', 'etag', 'last-modified']);
        for (const key of allow) {
            const v = resp.headers.get(key);
            if (v) headersOut.set(key, v);
        }

        const ctRaw = String(resp.headers.get('content-type') || '');
        const outCt = String(headersOut.get('content-type') || '').toLowerCase();
        if (!outCt || outCt.includes('application/octet-stream')) {
            headersOut.set('Content-Type', inferAudioContentTypeFromUrl(urlObj));
        }

        headersOut.set('X-Audio-Proxy-Final-Url', urlObj.toString());
        headersOut.set('X-Audio-Proxy-Status', String(resp.status));
        headersOut.set('X-Audio-Proxy-Content-Type', ctRaw);

        // If upstream returns HTML error pages with 200, try to detect and fail fast.
        try {
            const reader = resp.body ? resp.body.getReader() : null;
            if (!reader) return new Response(clientMethod === 'HEAD' ? null : resp.body, { status: resp.status, headers: headersOut });

            const { value: prefixBytes } = await reader.read();
            const sniff = prefixBytes ? new Uint8Array(prefixBytes) : new Uint8Array();
            const detected = detectAudioContentTypeFromBytes(sniff);
            if (detected) {
                headersOut.set('Content-Type', detected);
                const body = createStreamFromReaderWithPrefix(sniff, reader);
                return new Response(clientMethod === 'HEAD' ? null : body, { status: resp.status, headers: headersOut });
            }

            if (looksLikeHtmlBytes(sniff)) {
                return errorResponse(502, 'Upstream returned HTML (not audio)');
            }

            if (looksLikeTextBytes(sniff)) {
                // Sometimes the upstream is a "resolver": it returns a playable URL in text/JSON.
                const decoder = new TextDecoder('utf-8', { fatal: false });
                let text = decoder.decode(sniff);
                let consumed = sniff.length;
                while (consumed < MAX_TEXT_SNIFF_BYTES) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = new Uint8Array(value);
                    consumed += chunk.length;
                    text += decoder.decode(chunk, { stream: true });
                    if (text.length > 2048) break;
                }
                text += decoder.decode();

                const extracted = extractFirstHttpUrlFromText(text);
                if (extracted) {
                    try {
                        const next = new URL(extracted);
                        urlObj = next;
                        redirectsLeft -= 1;
                        continue;
                    } catch (e) {
                        // ignore
                    }
                }

                return errorResponse(502, 'Upstream returned non-audio content (no playable URL found)');
            }

            // Unknown payload: passthrough by re-attaching the prefix.
            const body = createStreamFromReaderWithPrefix(sniff, reader);
            return new Response(clientMethod === 'HEAD' ? null : body, { status: resp.status, headers: headersOut });
        } catch (e) {
            return new Response(clientMethod === 'HEAD' ? null : resp.body, { status: resp.status, headers: headersOut });
        }
    }

    return errorResponse(504, 'Too many redirects');
}

export const proxyWorker = {
    async fetch(request) {
        const url = new URL(request.url);
        const pathname = url.pathname;

        if (matchRoute(pathname, '/__health')) {
            return new Response(
                JSON.stringify({
                    ok: true,
                    version: SERVER_VERSION,
                    routes: ['/audio-proxy', '/audio-resolve', '/text-proxy'],
                    time: new Date().toISOString()
                }),
                {
                    status: 200,
                    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
                }
            );
        }

        if (matchRoute(pathname, '/text-proxy')) {
            const target = url.searchParams.get('url');
            if (!target) return errorResponse(400, 'Missing url param');
            return handleTextProxy(request, target);
        }

        if (matchRoute(pathname, '/audio-resolve')) {
            const target = url.searchParams.get('url');
            if (!target) {
                return new Response(JSON.stringify({ error: 'Missing url param' }), {
                    status: 400,
                    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
                });
            }
            return handleAudioResolve(request, target);
        }

        if (matchRoute(pathname, '/audio-proxy')) {
            const target = url.searchParams.get('url');
            if (!target) return errorResponse(400, 'Missing url param');
            return handleAudioProxy(request, target);
        }

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
        }

        return errorResponse(404, 'Not found');
    }
};

// If someone visits /api/worker directly, avoid a 500 (Vercel treats every file in /api as a route).
export default function handler(_req, res) {
    try {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not found');
    } catch (e) {
        // ignore
    }
}
