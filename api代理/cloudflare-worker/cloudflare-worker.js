// Cloudflare Worker proxy for HJWJB player
// Routes:
//   /__health
//   /audio-proxy?url=<http(s)://...>
//   /audio-resolve?url=<http(s)://...>
//   /text-proxy?url=<http(s)://...>
//
// Deploy:
//   - Cloudflare Dashboard -> Workers -> Create Worker -> paste this file
//   - Or use wrangler with a wrangler.toml (see wrangler.toml example)

const SERVER_VERSION = '2026-02-03-worker-proxy-v6';

const DEFAULT_UPSTREAM_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.7';
const MAX_TEXT_SNIFF_BYTES = 32768;

// Optional KV binding for ops metrics + API2 stats.
// Bind a KV namespace in your Worker/Pages project settings.
// We support both legacy `HJWJB_KV` and the Cloudflare docs-style `MY_BINDING`.
const KV_BINDING_NAMES = ['HJWJB_KV', 'MY_BINDING'];

function corsHeaders(extra = {}) {
    const headers = new Headers(extra);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin, Referer, Cache-Control, Pragma');
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

const API2_SONG_URL_STATS_TTL_SECONDS = 60 * 60 * 24 * 30;
const API2_KUGOU_PARSE_STATS_TTL_SECONDS = 60 * 60 * 24 * 30;
const KUGOU_DEV_COOKIE_CACHE_TTL_MS = 15 * 60 * 1000;

const kugouDevCookieState = {
    cookieHeader: '',
    expiresAt: 0,
    loading: null,
    authKey: ''
};

function utcDayString(date = new Date()) {
    try {
        return date.toISOString().slice(0, 10);
    } catch {
        return '';
    }
}

function isApi2SongUrlEndpoint(urlObj) {
    try {
        const pathname = String(urlObj && urlObj.pathname ? urlObj.pathname : '').replace(/\/+$/, '');
        return pathname === '/api/song/url';
    } catch {
        return false;
    }
}

function isKugouSongUrlEndpoint(urlObj) {
    try {
        if (!urlObj || !urlObj.hostname) return false;
        const host = String(urlObj.hostname).toLowerCase();
        if (host !== '') return false;
        const pathname = String(urlObj.pathname || '').replace(/\/+$/, '');
        return pathname === '/song/url' || pathname === '/song/url/new';
    } catch {
        return false;
    }
}

function parseSetCookieValues(headers) {
    try {
        if (!headers) return [];

        // Cloudflare Workers may provide a dedicated API for multi-value Set-Cookie.
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
            const url = new URL('https:///register/dev');
            if (nextKey) url.searchParams.set('authKey', nextKey);
            const resp = await fetch(url.toString(), {
                method: 'GET',
                redirect: 'manual',
                headers: {
                    'User-Agent': DEFAULT_UPSTREAM_UA,
                    'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
                    Accept: 'application/json,*/*;q=0.9',
                    'Accept-Encoding': 'identity',
                    Referer: 'https:///'
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

function countResolvedMidsFromApi2SongUrlJsonText(text) {
    try {
        const parsed = JSON.parse(String(text || ''));
        const map = parsed && parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? parsed.data : null;
        if (!map) return 0;
        let count = 0;
        for (const value of Object.values(map)) {
            if (typeof value === 'string' && value.trim() !== '') count += 1;
        }
        return count;
    } catch {
        return 0;
    }
}

function api2SongUrlStatsKey(dayUtc) {
    return `api2:song_url_stats:${String(dayUtc || '').trim()}`;
}

async function getApi2SongUrlStats(env, dayUtc) {
    const kv = getKv(env);
    if (!kv) return null;

    const day = String(dayUtc || '').trim() || utcDayString(new Date());
    const key = api2SongUrlStatsKey(day);
    try {
        const record = await kv.get(key, { type: 'json' });
        if (record && typeof record === 'object') return record;
    } catch {
        // ignore
    }
    return { dayUtc: day, resolvedMidCount: 0, updatedAt: 0 };
}

async function recordApi2SongUrlStatsDelta(env, delta) {
    const kv = getKv(env);
    if (!kv) return;

    const n = Number(delta) || 0;
    if (n <= 0) return;

    try {
        const dayUtc = utcDayString(new Date());
        if (!dayUtc) return;
        const key = api2SongUrlStatsKey(dayUtc);
        const current = await getApi2SongUrlStats(env, dayUtc);
        const resolvedMidCount = Number(current && current.resolvedMidCount != null ? current.resolvedMidCount : 0) || 0;

        const next = {
            dayUtc,
            resolvedMidCount: resolvedMidCount + n,
            updatedAt: Date.now()
        };
        await kv.put(key, JSON.stringify(next), { expirationTtl: API2_SONG_URL_STATS_TTL_SECONDS });
    } catch {
        // Never break user traffic due to stats write failures.
    }
}

function api2KugouParseStatsKey(dayUtc) {
    return `api2:kugou_parse_stats:${String(dayUtc || '').trim()}`;
}

function getKugouParseStatsRouteKey(urlObj) {
    try {
        if (!urlObj || !urlObj.hostname) return '';
        const host = String(urlObj.hostname).toLowerCase();
        if (host !== '') return '';
        const pathname = String(urlObj.pathname || '').replace(/\/+$/, '');
        if (pathname === '/song/url' || pathname === '/song/url/new' || pathname === '/audio') return pathname;
        return '';
    } catch {
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
    } catch {
        return false;
    }
}

function defaultKugouParseStatsRecord(dayUtc) {
    const day = String(dayUtc || '').trim() || utcDayString(new Date());
    return {
        dayUtc: day,
        parseCount: 0,
        successCount: 0,
        routes: {
            '/song/url': { total: 0, success: 0 },
            '/song/url/new': { total: 0, success: 0 },
            '/audio': { total: 0, success: 0 }
        },
        updatedAt: 0
    };
}

async function getApi2KugouParseStats(env, dayUtc) {
    const kv = getKv(env);
    if (!kv) return null;

    const day = String(dayUtc || '').trim() || utcDayString(new Date());
    const key = api2KugouParseStatsKey(day);
    try {
        const record = await kv.get(key, { type: 'json' });
        if (record && typeof record === 'object') return record;
    } catch {
        // ignore
    }
    return defaultKugouParseStatsRecord(day);
}

async function recordApi2KugouParseStats(env, routeKey, { success } = {}) {
    const kv = getKv(env);
    if (!kv) return;

    const route = String(routeKey || '').trim();
    if (!route) return;

    try {
        const dayUtc = utcDayString(new Date());
        if (!dayUtc) return;

        const key = api2KugouParseStatsKey(dayUtc);
        const current = await getApi2KugouParseStats(env, dayUtc);
        const base = current && typeof current === 'object' ? current : defaultKugouParseStatsRecord(dayUtc);

        const nextRoutes = base.routes && typeof base.routes === 'object' ? { ...base.routes } : {};
        if (!nextRoutes[route] || typeof nextRoutes[route] !== 'object') nextRoutes[route] = { total: 0, success: 0 };

        const total = Number(base.parseCount != null ? base.parseCount : base.total) || 0;
        const successCount = Number(base.successCount != null ? base.successCount : base.success) || 0;

        const next = {
            dayUtc,
            parseCount: total + 1,
            successCount: success ? successCount + 1 : successCount,
            routes: {
                ...nextRoutes,
                [route]: {
                    total: (Number(nextRoutes[route].total) || 0) + 1,
                    success: success ? (Number(nextRoutes[route].success) || 0) + 1 : Number(nextRoutes[route].success) || 0
                }
            },
            updatedAt: Date.now()
        };

        await kv.put(key, JSON.stringify(next), { expirationTtl: API2_KUGOU_PARSE_STATS_TTL_SECONDS });
    } catch {
        // Never break user traffic due to stats write failures.
    }
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

function inferAudioContentTypeFromUrl(urlObj) {
    try {
        const pathname = String(urlObj && urlObj.pathname ? urlObj.pathname : '');
        const ext = pathname.toLowerCase().split('.').pop();
        switch (`.${ext}`) {
        case '.mp3':
            return 'audio/mpeg';
        case '.m4a':
        case '.mp4':
            return 'audio/mp4';
        case '.aac':
            return 'audio/aac';
        case '.flac':
            return 'audio/flac';
        case '.ogg':
            return 'audio/ogg';
        case '.wav':
            return 'audio/wav';
        case '.webm':
            return 'audio/webm';
        default:
            return 'audio/mpeg';
        }
    } catch (e) {
        return 'audio/mpeg';
    }
}

function pickRefererForHost(urlObj) {
    const host = (urlObj && urlObj.hostname ? urlObj.hostname : '').toLowerCase();
    const isKuwo = host.endsWith('.kuwo.cn') || host.endsWith('.sycdn.kuwo.cn') || host === 'kuwo.cn';
    const isNetease = host === 'music.126.net' || host.endsWith('.music.126.net');
    const isJoox = host === 'music.joox.com' || host.endsWith('.music.joox.com');
    const isQqMusic = host.endsWith('.qqmusic.qq.com') || host.endsWith('.gtimg.cn');
    if (isKuwo) return 'https://www.kuwo.cn/';
    if (isNetease) return 'https://music.163.com/';
    if (isJoox) return 'https://www.joox.com/';
    if (isQqMusic) return 'https://y.qq.com/';
    try {
        return `${urlObj.protocol}//${urlObj.host}/`;
    } catch (e) {
        return 'https://example.com/';
    }
}

function pickOriginForHost(urlObj) {
    const host = (urlObj && urlObj.hostname ? urlObj.hostname : '').toLowerCase();
    const isKuwo = host.endsWith('.kuwo.cn') || host.endsWith('.sycdn.kuwo.cn') || host === 'kuwo.cn';
    const isNetease = host === 'music.126.net' || host.endsWith('.music.126.net');
    const isJoox = host === 'music.joox.com' || host.endsWith('.music.joox.com');
    const isQqMusic = host.endsWith('.qqmusic.qq.com') || host.endsWith('.gtimg.cn');
    if (isKuwo) return 'https://www.kuwo.cn';
    if (isNetease) return 'https://music.163.com';
    if (isJoox) return 'https://www.joox.com';
    if (isQqMusic) return 'https://y.qq.com';
    return null;
}

function extractLikelyAudioUrlFromText(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const normalized = raw
        .replace(/&amp;/g, '&')
        .replace(/\\u0026/gi, '&')
        .replace(/\\u002F/gi, '/')
        .replace(/\\\//g, '/');

    const tryFromJson = () => {
        try {
            const json = JSON.parse(normalized);
            const seen = new Set();
            const stack = [json];
            while (stack.length) {
                const node = stack.pop();
                if (!node || typeof node !== 'object') continue;
                if (seen.has(node)) continue;
                seen.add(node);
                for (const value of Object.values(node)) {
                    if (typeof value === 'string') {
                        const v = value.trim();
                        if (/^https?:\/\//i.test(v)) return v;
                    } else if (value && typeof value === 'object') {
                        stack.push(value);
                    }
                }
            }
        } catch (e) {
            // ignore
        }
        return '';
    };

    const fromJson = tryFromJson();
    if (fromJson) return fromJson;

    const urlRe = /https?:\/\/[^\s"'<>]+/gi;
    let match;
    while ((match = urlRe.exec(normalized))) {
        const candidate = match[0].replace(/\\u0026/g, '&');
        if (!candidate) continue;
        return candidate;
    }
    return '';
}

async function fetchWithHeaders(urlObj, request, options = {}) {
    const method = options.method || (request.method === 'HEAD' ? 'HEAD' : 'GET');
    const rangeHeader = options.rangeHeader || request.headers.get('Range') || '';
    const cookieHeader = options.cookieHeader || '';

    const headers = new Headers();
    headers.set('User-Agent', DEFAULT_UPSTREAM_UA);
    headers.set('Accept-Language', DEFAULT_ACCEPT_LANGUAGE);
    headers.set('Accept', options.accept || 'audio/*,*/*;q=0.9');
    headers.set('Accept-Encoding', 'identity');

    const referer = pickRefererForHost(urlObj);
    headers.set('Referer', referer);

    const origin = pickOriginForHost(urlObj);
    if (origin) headers.set('Origin', origin);

    if (rangeHeader) headers.set('Range', rangeHeader);
    if (cookieHeader) headers.set('Cookie', cookieHeader);

    return fetch(urlObj.toString(), {
        method,
        headers,
        redirect: 'manual',
        cf: { cacheEverything: false, cacheTtl: 0 }
    });
}

function errorResponse(status, message) {
    return new Response(message, {
        status,
        headers: corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
    });
}

async function readUpToBytesFromBody(body, maxBytes) {
    const reader = body && typeof body.getReader === 'function' ? body.getReader() : null;
    if (!reader) return { bytes: new Uint8Array(), reader: null };

    const chunks = [];
    let total = 0;
    try {
        while (total < maxBytes) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value || !value.byteLength) continue;
            chunks.push(value);
            total += value.byteLength;
        }
    } catch (e) {
        // ignore
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return { bytes: merged, reader };
}

function createStreamFromReaderWithPrefix(prefixBytes, reader) {
    let prefix = prefixBytes && prefixBytes.byteLength ? prefixBytes : null;
    return new ReadableStream({
        async pull(controller) {
            if (prefix) {
                controller.enqueue(prefix);
                prefix = null;
                return;
            }
            const { value, done } = await reader.read();
            if (done) {
                controller.close();
                return;
            }
            controller.enqueue(value);
        },
        cancel(reason) {
            try {
                reader.cancel(reason);
            } catch (e) {
                // ignore
            }
        }
    });
}

async function handleTextProxy(request, targetUrl, env, ctx) {
    let upstream;
    try {
        upstream = new URL(targetUrl);
    } catch (e) {
        return errorResponse(400, 'Invalid url param');
    }
    if (!/^https?:$/.test(upstream.protocol) || !isAllowedProxyHost(upstream.hostname)) {
        return errorResponse(403, 'Host not allowed');
    }

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
    }

    const authKey = upstream.searchParams.get('authKey') || upstream.searchParams.get('authkey') || '';
    const cookieHeader = isKugouSongUrlEndpoint(upstream) ? await getKugouDevCookieHeader(authKey) : '';

    const resp = await fetchWithHeaders(upstream, request, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        cookieHeader
    });

    const headers = corsHeaders({ 'Cache-Control': 'no-cache' });
    const contentType = resp.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);

    const isHead = request.method === 'HEAD';
    const kugouParseRouteKey = getKugouParseStatsRouteKey(upstream);
    const shouldRecordApi2SongUrlStats = !isHead && resp.status >= 200 && resp.status < 300 && isApi2SongUrlEndpoint(upstream);
    const shouldRecordKugouParseStats = !isHead && resp.status >= 200 && resp.status < 300 && !!kugouParseRouteKey;
    const shouldBufferForStats = shouldRecordApi2SongUrlStats || shouldRecordKugouParseStats;

    if (shouldBufferForStats) {
        let text = '';
        try {
            text = await resp.text();
        } catch {
            text = '';
        }

        if (shouldRecordApi2SongUrlStats) {
            const delta = countResolvedMidsFromApi2SongUrlJsonText(text);
            if (delta > 0) {
                try {
                    const task = recordApi2SongUrlStatsDelta(env, delta);
                    if (ctx && typeof ctx.waitUntil === 'function') {
                        ctx.waitUntil(task);
                    } else {
                        await task;
                    }
                } catch {
                    // ignore
                }
            }
        }

        if (shouldRecordKugouParseStats) {
            try {
                const success = parseKugouParseSuccess(kugouParseRouteKey, text);
                const task = recordApi2KugouParseStats(env, kugouParseRouteKey, { success });
                if (ctx && typeof ctx.waitUntil === 'function') {
                    ctx.waitUntil(task);
                } else {
                    await task;
                }
            } catch {
                // ignore
            }
        }

        return new Response(text, { status: resp.status, headers });
    }

    return new Response(isHead ? null : resp.body, { status: resp.status, headers });
}

async function handleAudioResolve(request, targetUrl) {
    let upstream;
    try {
        upstream = new URL(targetUrl);
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid url param' }), {
            status: 400,
            headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
        });
    }
    if (!/^https?:$/.test(upstream.protocol) || !isAllowedProxyHost(upstream.hostname)) {
        return new Response(JSON.stringify({ error: 'Host not allowed' }), {
            status: 403,
            headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
        });
    }

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
    }

    let urlObj = upstream;
    let redirectsLeft = 6;
    let lastStatus = 0;
    let lastContentType = null;
    let lastContentLength = null;

    while (redirectsLeft >= 0) {
        const resp = await fetchWithHeaders(urlObj, request, {
            method: 'GET',
            rangeHeader: 'bytes=0-32767'
        });

        lastStatus = resp.status;
        lastContentType = resp.headers.get('content-type');
        lastContentLength = resp.headers.get('content-length');

        const location = resp.headers.get('location');
        if ([301, 302, 303, 307, 308].includes(resp.status) && location && redirectsLeft > 0) {
            try {
                urlObj = new URL(location, urlObj);
                redirectsLeft -= 1;
                continue;
            } catch (e) {
                // fallthrough
            }
        }

        const ct = String(lastContentType || '').toLowerCase();
        const cl = String(lastContentLength || '').trim();
        const contentLength = cl ? Number(cl) : 0;
        const isTextLike = ct.includes('application/json') || ct.startsWith('text/');
        const isUnknownOrOctet = !ct || ct.includes('application/octet-stream');
        const hasSmallLength = Number.isFinite(contentLength) && contentLength > 0 && contentLength <= 16384;
        const mightBeUrlPayload = resp.status >= 200 && resp.status < 300 && (isTextLike || (isUnknownOrOctet && hasSmallLength));

        if (mightBeUrlPayload && redirectsLeft > 0) {
            const text = await resp.text();
            const extracted = extractLikelyAudioUrlFromText(text);
            if (extracted) {
                try {
                    const next = new URL(extracted, urlObj);
                    if (/^https?:$/.test(next.protocol) && isAllowedProxyHost(next.hostname)) {
                        urlObj = next;
                        redirectsLeft -= 1;
                        continue;
                    }
                } catch (e) {
                    // ignore
                }
            }
        }

        break;
    }

    return new Response(
        JSON.stringify({
            finalUrl: urlObj.toString(),
            status: lastStatus,
            contentType: lastContentType,
            contentLength: lastContentLength
        }),
        { status: 200, headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }) }
    );
}

async function handleAudioProxy(request, targetUrl) {
    let upstream;
    try {
        upstream = new URL(targetUrl);
    } catch (e) {
        return errorResponse(400, 'Invalid url param');
    }
    if (!/^https?:$/.test(upstream.protocol) || !isAllowedProxyHost(upstream.hostname)) {
        return errorResponse(403, 'Host not allowed');
    }

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
    }

    const clientMethod = request.method === 'HEAD' ? 'HEAD' : 'GET';
    const clientRange = request.headers.get('Range') || '';

    let urlObj = upstream;
    let redirectsLeft = 5;

    while (redirectsLeft >= 0) {
        const resp = await fetchWithHeaders(urlObj, request, {
            method: clientMethod,
            rangeHeader: clientRange
        });

        const location = resp.headers.get('location');
        if ([301, 302, 303, 307, 308].includes(resp.status) && location && redirectsLeft > 0) {
            try {
                urlObj = new URL(location, urlObj);
                redirectsLeft -= 1;
                continue;
            } catch (e) {
                // fallthrough
            }
        }

        const ctRaw = String(resp.headers.get('content-type') || '');
        const ct = ctRaw.toLowerCase();
        const clRaw = String(resp.headers.get('content-length') || '').trim();
        const contentLength = clRaw ? Number(clRaw) : 0;
        const isTextLike = ct.includes('application/json') || ct.startsWith('text/');
        const isUnknownOrOctet = !ct || ct.includes('application/octet-stream');
        const hasSmallLength = Number.isFinite(contentLength) && contentLength > 0 && contentLength <= 16384;
        const mightBeUrlPayload = resp.status >= 200 && resp.status < 300 && (isTextLike || (isUnknownOrOctet && hasSmallLength));
        if (clientMethod !== 'HEAD' && resp.status >= 200 && resp.status < 300 && mightBeUrlPayload) {
            const { bytes: prefixBytes, reader } = await readUpToBytesFromBody(resp.body, Math.min(MAX_TEXT_SNIFF_BYTES, 4096));
            if (reader) {
                const detectedAudioType = detectAudioContentTypeFromBytes(prefixBytes);
                const mightBeHtmlOrText = looksLikeHtmlBytes(prefixBytes) || looksLikeTextBytes(prefixBytes);

                if (detectedAudioType) {
                    const headers = corsHeaders({ 'Cache-Control': 'no-cache' });
                    const allow = new Set([
                        'content-type',
                        'content-length',
                        'accept-ranges',
                        'content-range',
                        'etag',
                        'last-modified'
                    ]);
                    for (const key of allow) {
                        const v = resp.headers.get(key);
                        if (v) headers.set(key, v);
                    }

                    headers.set('Content-Type', detectedAudioType);
                    headers.set('X-Audio-Proxy-Final-Url', urlObj.toString());
                    headers.set('X-Audio-Proxy-Status', String(resp.status));
                    headers.set('X-Audio-Proxy-Content-Type', ctRaw);

                    const body = createStreamFromReaderWithPrefix(prefixBytes, reader);
                    return new Response(body, { status: resp.status, headers });
                }

                if (mightBeHtmlOrText && redirectsLeft > 0) {
                    const chunks = [prefixBytes];
                    let total = prefixBytes.byteLength;
                    try {
                        while (total < MAX_TEXT_SNIFF_BYTES) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            if (!value || !value.byteLength) continue;
                            chunks.push(value);
                            total += value.byteLength;
                        }
                    } catch (e) {
                        // ignore
                    }
                    try {
                        await reader.cancel();
                    } catch (e) {
                        // ignore
                    }

                    const combined = new Uint8Array(total);
                    let offset = 0;
                    for (const chunk of chunks) {
                        combined.set(chunk, offset);
                        offset += chunk.byteLength;
                    }
                    const text = new TextDecoder('utf-8', { fatal: false }).decode(combined);
                    const extracted = extractLikelyAudioUrlFromText(text);
                    if (extracted) {
                        try {
                            const next = new URL(extracted, urlObj);
                            if (!/^https?:$/.test(next.protocol)) {
                                return errorResponse(502, `Upstream returned a URL but protocol not supported: ${next.protocol}`);
                            }
                            if (!isAllowedProxyHost(next.hostname)) {
                                return errorResponse(502, `Upstream returned a URL but host not allowed: ${next.hostname}`);
                            }
                            urlObj = next;
                            redirectsLeft -= 1;
                            continue;
                        } catch (e) {
                            // ignore
                        }
                    }

                    const sample = text.slice(0, 320).replace(/\s+/g, ' ').trim();
                    console.warn('audio-proxy non-audio payload', {
                        url: urlObj.toString(),
                        status: resp.status,
                        contentType: ctRaw,
                        contentLength: clRaw,
                        sample
                    });
                    return errorResponse(502, 'Upstream returned non-audio content (no playable URL found)');
                }

                // 鍏滃簳锛氭棦涓嶅儚闊抽锛屼篃涓嶅儚鏂囨湰锛涗絾鎴戜滑宸茬粡娑堣垂浜嗗紑澶村瓧鑺傦紝鍙兘鐢ㄢ€滃墠缂€+reader鈥濋噸鏂版嫾鍥炴祦閫忎紶
                const passthroughHeaders = corsHeaders({ 'Cache-Control': 'no-cache' });
                const allow = new Set(['content-type', 'content-length', 'accept-ranges', 'content-range', 'etag', 'last-modified']);
                for (const key of allow) {
                    const v = resp.headers.get(key);
                    if (v) passthroughHeaders.set(key, v);
                }

                const outCt = String(passthroughHeaders.get('content-type') || '').toLowerCase();
                if (!outCt || outCt.includes('application/octet-stream')) {
                    passthroughHeaders.set('Content-Type', inferAudioContentTypeFromUrl(urlObj));
                }
                passthroughHeaders.set('X-Audio-Proxy-Final-Url', urlObj.toString());
                passthroughHeaders.set('X-Audio-Proxy-Status', String(resp.status));
                passthroughHeaders.set('X-Audio-Proxy-Content-Type', ctRaw);

                const body = createStreamFromReaderWithPrefix(prefixBytes, reader);
                return new Response(body, { status: resp.status, headers: passthroughHeaders });
            }
        }

        const headers = corsHeaders({ 'Cache-Control': 'no-cache' });
        const allow = new Set(['content-type', 'content-length', 'accept-ranges', 'content-range', 'etag', 'last-modified']);
        for (const key of allow) {
            const v = resp.headers.get(key);
            if (v) headers.set(key, v);
        }

        const outCt = String(headers.get('content-type') || '').toLowerCase();
        if (!outCt || outCt.includes('application/octet-stream')) {
            headers.set('Content-Type', inferAudioContentTypeFromUrl(urlObj));
        }

        headers.set('X-Audio-Proxy-Final-Url', urlObj.toString());
        headers.set('X-Audio-Proxy-Status', String(resp.status));
        headers.set('X-Audio-Proxy-Content-Type', ctRaw);

        return new Response(clientMethod === 'HEAD' ? null : resp.body, { status: resp.status, headers });
    }

    return errorResponse(504, 'Too many redirects');
}

function jsonResponse(data, { status = 200, headers = {}, cache = 'no-cache' } = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders({
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': cache,
            ...headers
        })
    });
}

function getKv(env) {
    try {
        if (!env) return null;
        for (const name of KV_BINDING_NAMES) {
            const candidate = env[name];
            // Guard against misconfigured bindings (e.g. bound as a plain variable, D1, etc.)
            // Without this, auth/register/login can throw and Cloudflare will return a 500 HTML page (no CORS headers).
            if (
                candidate &&
                typeof candidate.get === 'function' &&
                typeof candidate.put === 'function' &&
                typeof candidate.delete === 'function'
            ) {
                return candidate;
            }
        }
        return null;
    } catch {
        return null;
    }
}

async function recordOpsMetric(env, record) {
    const kv = getKv(env);
    if (!kv) return;

    try {
        const now = new Date();
        const day = now.toISOString().slice(0, 10);
        const route = String(record && record.route ? record.route : 'unknown');
        const status = Number(record && record.status != null ? record.status : 0) || 0;
        const ms = Number(record && record.ms != null ? record.ms : 0) || 0;

        const bucket = status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx';
        const key = `ops:stats:${day}`;
        const raw = await kv.get(key);
        const stats = raw ? JSON.parse(raw) : { day, updatedAt: 0, routes: {} };

        if (!stats.routes[route]) {
            stats.routes[route] = { total: 0, slow: 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
        }
        stats.routes[route].total += 1;
        stats.routes[route][bucket] += 1;
        if (ms >= 2500) stats.routes[route].slow += 1;
        stats.updatedAt = Date.now();

        // Keep last 30 days of stats.
        await kv.put(key, JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 30 });

        // Store last errors for quick debugging.
        if (status >= 500) {
            const errKey = 'ops:last_errors';
            const errRaw = await kv.get(errKey);
            const list = errRaw ? JSON.parse(errRaw) : [];
            list.unshift({
                at: new Date().toISOString(),
                route,
                status,
                ms,
                path: record && record.path ? String(record.path) : ''
            });
            const trimmed = Array.isArray(list) ? list.slice(0, 100) : [];
            await kv.put(errKey, JSON.stringify(trimmed), { expirationTtl: 60 * 60 * 24 * 30 });
        }
    } catch (e) {
        // Never break user traffic due to metrics write failures.
    }
}

const UPSTREAM_CHECKS = [
    { name: 'baka-meting', url: 'https://api.baka.plus/meting/?server=netease&type=song&id=1299550532' },
    { name: 'byfuns-resolve', url: 'https://api.byfuns.top/1/?id=1299550532' },
    { name: 'api2-qq', url: 'https://0/api/search?keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=song&num=1&page=1' },
    { name: 'proxy-backup', url: 'https:///__health' }
];

async function runUpstreamChecks(env) {
    const kv = getKv(env);
    if (!kv) return { ok: false, error: 'KV not configured' };

    const timeoutMs = 4500;
    const startedAt = Date.now();

    const checkOne = async ({ name, url }) => {
        const begin = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);

        try {
            const resp = await fetch(url, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal,
                headers: {
                    'Accept': '*/*',
                    'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
                    'User-Agent': DEFAULT_UPSTREAM_UA
                }
            });
            return { name, url, ok: resp.ok, status: resp.status, ms: Date.now() - begin };
        } catch (e) {
            return { name, url, ok: false, status: 0, ms: Date.now() - begin, error: String(e && e.message ? e.message : e) };
        } finally {
            clearTimeout(timer);
        }
    };

    const results = await Promise.all(UPSTREAM_CHECKS.map(checkOne));
    const ok = results.every((r) => r && r.ok);
    const payload = {
        ok,
        checkedAt: new Date().toISOString(),
        ms: Date.now() - startedAt,
        results
    };

    await kv.put('ops:upstreams', JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 7 });
    return payload;
}

export default {
    async fetch(request, env, ctx) {
        try {
        const startedAt = Date.now();
        const url = new URL(request.url);
        const pathname = url.pathname;
        let response;

        if (matchRoute(pathname, '/__health') || matchRoute(pathname, '/health')) {
            const kv = getKv(env);
            const wantCheck = String(url.searchParams.get('check') || '').trim() === '1';
            let upstreams = null;
            if (kv) {
                try {
                    upstreams = await kv.get('ops:upstreams', { type: 'json' });
                } catch {
                    upstreams = null;
                }
            }
            if (wantCheck) {
                try {
                    upstreams = await runUpstreamChecks(env);
                } catch {
                    // ignore
                }
            }
            response = new Response(
                JSON.stringify({
                    ok: true,
                    version: SERVER_VERSION,
                    routes: ['/audio-proxy', '/audio-resolve', '/text-proxy'],
                    upstreams,
                    time: new Date().toISOString()
                }),
                {
                    status: 200,
                    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
                }
            );
        } else if (matchRoute(pathname, '/_hjwjb/ops/stats')) {
            const kv = getKv(env);
            if (request.method === 'OPTIONS') {
                response = new Response(null, { status: 204, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
            } else if (!kv) {
                response = jsonResponse({ ok: false, error: 'KV not configured', binding: KV_BINDING_NAMES }, { status: 501 });
            } else if (request.method !== 'GET') {
                response = jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
            } else {
                const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10) || 7, 1), 30);
                const out = [];
                for (let i = 0; i < days; i++) {
                    const d = new Date(Date.now() - i * 86400000);
                    const day = d.toISOString().slice(0, 10);
                    const stats = await kv.get(`ops:stats:${day}`, { type: 'json' });
                    out.push(stats || { day, routes: {}, updatedAt: 0 });
                }
                response = jsonResponse({ ok: true, days, stats: out.reverse() });
            }
        } else if (matchRoute(pathname, '/_hjwjb/ops/errors')) {
            const kv = getKv(env);
            if (request.method === 'OPTIONS') {
                response = new Response(null, { status: 204, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
            } else if (!kv) {
                response = jsonResponse({ ok: false, error: 'KV not configured', binding: KV_BINDING_NAMES }, { status: 501 });
            } else if (request.method !== 'GET') {
                response = jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
            } else {
                const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
                const list = (await kv.get('ops:last_errors', { type: 'json' })) || [];
                response = jsonResponse({ ok: true, items: Array.isArray(list) ? list.slice(0, limit) : [] });
            }
        } else if (matchRoute(pathname, '/_hjwjb/ops/upstreams')) {
            const kv = getKv(env);
            if (request.method === 'OPTIONS') {
                response = new Response(null, { status: 204, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
            } else if (!kv) {
                response = jsonResponse({ ok: false, error: 'KV not configured', binding: KV_BINDING_NAMES }, { status: 501 });
            } else if (request.method !== 'GET') {
                response = jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
            } else {
                const wantCheck = String(url.searchParams.get('check') || '').trim() === '1';
                const upstreams = wantCheck ? await runUpstreamChecks(env) : await kv.get('ops:upstreams', { type: 'json' });
                response = jsonResponse({ ok: true, upstreams: upstreams || null });
            }
        } else if (matchRoute(pathname, '/api/stats')) {
            const kv = getKv(env);
            if (request.method === 'OPTIONS') {
                response = new Response(null, { status: 204, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
            } else if (!kv) {
                response = jsonResponse({ ok: false, error: 'KV not configured', binding: KV_BINDING_NAMES }, { status: 501 });
            } else if (request.method !== 'GET' && request.method !== 'HEAD') {
                response = jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
            } else {
                const dayUtc = utcDayString(new Date());
                const stats = await getApi2SongUrlStats(env, dayUtc);
                const payload = { ok: true, ...(stats || { dayUtc, resolvedMidCount: 0, updatedAt: 0 }) };
                if (request.method === 'HEAD') {
                    response = new Response(null, {
                        status: 200,
                        headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
                    });
                } else {
                    response = jsonResponse(payload);
                }
            }
        } else if (matchRoute(pathname, '/stats/parse/today')) {
            const kv = getKv(env);
            if (request.method === 'OPTIONS') {
                response = new Response(null, { status: 204, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
            } else if (!kv) {
                response = jsonResponse({ ok: false, error: 'KV not configured', binding: KV_BINDING_NAMES }, { status: 501 });
            } else if (request.method !== 'GET' && request.method !== 'HEAD') {
                response = jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
            } else {
                const dayUtc = utcDayString(new Date());
                const stats = await getApi2KugouParseStats(env, dayUtc);
                const payload = { ok: true, ...(stats || defaultKugouParseStatsRecord(dayUtc)) };
                if (request.method === 'HEAD') {
                    response = new Response(null, {
                        status: 200,
                        headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
                    });
                } else {
                    response = jsonResponse(payload);
                }
            }
        } else if (matchRoute(pathname, '/text-proxy')) {
            const target = url.searchParams.get('url');
            response = target ? await handleTextProxy(request, target, env, ctx) : errorResponse(400, 'Missing url param');
        } else if (matchRoute(pathname, '/audio-resolve')) {
            const target = url.searchParams.get('url');
            response = target
                ? await handleAudioResolve(request, target)
                : new Response(JSON.stringify({ error: 'Missing url param' }), {
                      status: 400,
                      headers: corsHeaders({
                          'Content-Type': 'application/json; charset=utf-8',
                          'Cache-Control': 'no-cache'
                      })
                  });
        } else if (matchRoute(pathname, '/audio-proxy')) {
            const target = url.searchParams.get('url');
            response = target ? await handleAudioProxy(request, target) : errorResponse(400, 'Missing url param');
        } else if (request.method === 'OPTIONS') {
            response = new Response(null, { status: 204, headers: corsHeaders({ 'Cache-Control': 'no-cache' }) });
        } else {
            response = errorResponse(404, 'Not found');
        }

        const ms = Date.now() - startedAt;
        try {
            const route = (() => {
                if (matchRoute(pathname, '/__health') || matchRoute(pathname, '/health')) return 'health';
                if (matchRoute(pathname, '/audio-proxy')) return 'audio-proxy';
                if (matchRoute(pathname, '/audio-resolve')) return 'audio-resolve';
                if (matchRoute(pathname, '/text-proxy')) return 'text-proxy';
                if (matchRoute(pathname, '/api/stats')) return 'api-stats';
                if (matchRoute(pathname, '/stats/parse/today')) return 'kugou-parse-stats';
                if (matchRoute(pathname, '/_hjwjb/ops/stats')) return 'ops-stats';
                if (matchRoute(pathname, '/_hjwjb/ops/errors')) return 'ops-errors';
                if (matchRoute(pathname, '/_hjwjb/ops/upstreams')) return 'ops-upstreams';
                return 'other';
            })();
            const record = {
                at: new Date().toISOString(),
                method: request.method,
                route,
                path: pathname,
                status: response.status,
                ms
            };
            if (record.status >= 500 || record.ms >= 2500) {
                console.warn('[proxy]', JSON.stringify(record));
            } else {
                console.log('[proxy]', JSON.stringify(record));
            }

            if (ctx && typeof ctx.waitUntil === 'function') {
                ctx.waitUntil(recordOpsMetric(env, record));
            } else {
                // Fallback (should be rare in Workers runtime).
                await recordOpsMetric(env, record);
            }
        } catch (e) {
            // ignore
        }

        return response;
        } catch (e) {
            // Always return CORS JSON on unexpected errors (avoid Cloudflare HTML 1101 pages).
            console.warn('Unhandled worker error', e);
            const message = e && e.message ? String(e.message) : String(e || 'Unknown error');
            return jsonResponse({ ok: false, error: 'Internal error', message }, { status: 500 });
        }
    },

    async scheduled(event, env, ctx) {
        try {
            if (ctx && typeof ctx.waitUntil === 'function') {
                ctx.waitUntil(runUpstreamChecks(env));
            } else {
                await runUpstreamChecks(env);
            }
        } catch (e) {
            // ignore
        }
    }
};

