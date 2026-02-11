const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DEFAULT_UPSTREAM_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.6';

// Daily stats (UTC): count of resolved MIDs with non-empty URL returned by API2 `/api/song/url`.
// Note: We record only when the response flows through this proxy (`/text-proxy`).
const api2SongUrlStatsState = {
    dayUtc: '',
    resolvedMidCount: 0,
    updatedAt: 0
};

// Kugou parse stats (UTC): count of today's parse requests for selected endpoints.
// Scope: `/song/url`, `/song/url/new`, `/audio` (), counted via `/text-proxy` responses.
const api2KugouParseStatsState = {
    dayUtc: '',
    total: 0,
    success: 0,
    routes: {
        '/song/url': { total: 0, success: 0 },
        '/song/url/new': { total: 0, success: 0 },
        '/audio': { total: 0, success: 0 }
    },
    updatedAt: 0
};

// Kugou (``) requires cookies from `/register/dev` for `/song/url`
// (dfid + KUGOU_API_* device cookies). Browsers cannot set these cross-site, so we inject them here.
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

function ensureApi2SongUrlStatsDay() {
    const day = utcDayString(new Date());
    if (!day) return;
    if (api2SongUrlStatsState.dayUtc !== day) {
        api2SongUrlStatsState.dayUtc = day;
        api2SongUrlStatsState.resolvedMidCount = 0;
        api2SongUrlStatsState.updatedAt = Date.now();
    }
}

function ensureApi2KugouParseStatsDay() {
    const day = utcDayString(new Date());
    if (!day) return;
    if (api2KugouParseStatsState.dayUtc !== day) {
        api2KugouParseStatsState.dayUtc = day;
        api2KugouParseStatsState.total = 0;
        api2KugouParseStatsState.success = 0;
        api2KugouParseStatsState.routes = {
            '/song/url': { total: 0, success: 0 },
            '/song/url/new': { total: 0, success: 0 },
            '/audio': { total: 0, success: 0 }
        };
        api2KugouParseStatsState.updatedAt = Date.now();
    }
}

function isApi2SongUrlEndpoint(urlObj) {
    try {
        const pathname = String(urlObj && urlObj.pathname ? urlObj.pathname : '');
        if (!pathname) return false;
        return pathname.replace(/\/+$/, '') === '/api/song/url';
    } catch {
        return false;
    }
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

function recordApi2SongUrlStatsDelta(delta) {
    const n = Number(delta) || 0;
    if (n <= 0) return;
    ensureApi2SongUrlStatsDay();
    api2SongUrlStatsState.resolvedMidCount += n;
    api2SongUrlStatsState.updatedAt = Date.now();
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

        const hasExplicitError =
            typeof data.error === 'string' && data.error.trim() ||
            typeof data.errmsg === 'string' && data.errmsg.trim() ||
            typeof data.error_msg === 'string' && data.error_msg.trim();

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

function recordApi2KugouParseStats(routeKey, { success } = {}) {
    if (!routeKey) return;
    ensureApi2KugouParseStatsDay();
    api2KugouParseStatsState.total += 1;
    if (!api2KugouParseStatsState.routes[routeKey]) {
        api2KugouParseStatsState.routes[routeKey] = { total: 0, success: 0 };
    }
    api2KugouParseStatsState.routes[routeKey].total += 1;
    if (success) {
        api2KugouParseStatsState.success += 1;
        api2KugouParseStatsState.routes[routeKey].success += 1;
    }
    api2KugouParseStatsState.updatedAt = Date.now();
}

function getKugouDevCookieHeader(authKey = '') {
    const nextKey = String(authKey || '').trim();
    if (kugouDevCookieState.authKey !== nextKey) {
        kugouDevCookieState.cookieHeader = '';
        kugouDevCookieState.expiresAt = 0;
        kugouDevCookieState.loading = null;
        kugouDevCookieState.authKey = nextKey;
    }

    const now = Date.now();
    if (kugouDevCookieState.cookieHeader && kugouDevCookieState.expiresAt > now) {
        return Promise.resolve(kugouDevCookieState.cookieHeader);
    }

    if (kugouDevCookieState.loading) return kugouDevCookieState.loading;

    kugouDevCookieState.loading = new Promise((resolve) => {
        try {
            const urlObj = new URL('https:///register/dev');
            if (nextKey) urlObj.searchParams.set('authKey', nextKey);
            const req = https.request(
                urlObj,
                {
                    method: 'GET',
                    headers: {
                        'User-Agent': DEFAULT_UPSTREAM_UA,
                        'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
                        Accept: 'application/json,*/*;q=0.9',
                        'Accept-Encoding': 'identity',
                        Referer: 'https:///'
                    }
                },
                (resp) => {
                    const setCookie = resp && resp.headers ? resp.headers['set-cookie'] : null;
                    const cookieLines = Array.isArray(setCookie) ? setCookie : typeof setCookie === 'string' ? [setCookie] : [];
                    const cookiePairs = [];
                    for (const line of cookieLines) {
                        const raw = String(line || '').trim();
                        if (!raw) continue;
                        const pair = raw.split(';')[0] ? raw.split(';')[0].trim() : '';
                        if (!pair || !pair.includes('=')) continue;
                        if (!cookiePairs.includes(pair)) cookiePairs.push(pair);
                    }

                    const cookieHeader = cookiePairs.join('; ');
                    const chunks = [];
                    let total = 0;
                    resp.on('data', (chunk) => {
                        chunks.push(chunk);
                        total += chunk.length;
                    });
                    resp.on('end', () => {
                        if (cookieHeader) {
                            kugouDevCookieState.cookieHeader = cookieHeader;
                            // Empirically stable; keep a short TTL to be safe.
                            kugouDevCookieState.expiresAt = Date.now() + 15 * 60 * 1000;
                            resolve(cookieHeader);
                            return;
                        }

                        resolve('');
                    });
                    resp.on('error', () => resolve(''));
                }
            );
            req.on('error', () => resolve(''));
            req.end();
        } catch {
            resolve('');
        }
    }).finally(() => {
        kugouDevCookieState.loading = null;
    });

    return kugouDevCookieState.loading;
}

function shouldUseUtf8Charset(mimeType) {
    return (
        mimeType.startsWith('text/') ||
        mimeType === 'application/json' ||
        mimeType === 'application/javascript' ||
        mimeType === 'text/javascript' ||
        mimeType === 'image/svg+xml'
    );
}

function extractFirstHttpUrlFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const visited = new Set();
    const tryFindUrlInJson = (node, depth = 0) => {
        if (depth > 4) return null;
        if (!node) return null;

        if (typeof node === 'string') {
            const str = node.trim();
            if (/^https?:\/\//i.test(str)) return str;
            return null;
        }

        if (typeof node !== 'object') return null;
        if (visited.has(node)) return null;
        visited.add(node);

        if (Array.isArray(node)) {
            for (const item of node) {
                const found = tryFindUrlInJson(item, depth + 1);
                if (found) return found;
            }
            return null;
        }

        const priorityKeys = ['url', 'playUrl', 'play_url', 'songUrl', 'song_url', 'src', 'link', 'location', 'data'];
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

        return null;
    };

    if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
        try {
            const parsed = JSON.parse(trimmed);
            const found = tryFindUrlInJson(parsed, 0);
            if (found) return found;
        } catch {
            // ignore
        }
    }

    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed.split(/\s+/)[0];
    }

    const match = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
    return match ? match[0] : null;
}

function looksLikeHtmlBytes(buffer) {
    if (!buffer || !buffer.length) return false;
    const max = Math.min(buffer.length, 512);
    const head = buffer.slice(0, max).toString('utf8').trimStart().toLowerCase();
    if (!head) return false;
    return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<html');
}

function detectAudioContentTypeFromBytes(buffer) {
    if (!buffer || buffer.length < 8) return null;

    const ascii4 = buffer.slice(0, 4).toString('ascii');
    const ascii12 = buffer.slice(0, 12).toString('ascii');

    if (ascii4 === 'fLaC') return 'audio/flac';
    if (ascii4 === 'OggS') return 'audio/ogg';
    if (ascii4 === 'RIFF' && ascii12.includes('WAVE')) return 'audio/wav';
    if (buffer.length >= 8 && buffer.slice(4, 8).toString('ascii') === 'ftyp') return 'audio/mp4';

    // MP3 / AAC(ADTS) frame sync: 0xFFFx
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'audio/mpeg';
    if (ascii4 === 'ID3') return 'audio/mpeg';

    // WebM/Matroska (EBML header): 1A 45 DF A3
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'audio/webm';

    return null;
}

function looksLikeTextBytes(buffer) {
    if (!buffer || !buffer.length) return false;
    const max = Math.min(buffer.length, 512);
    let printable = 0;
    for (let i = 0; i < max; i++) {
        const c = buffer[i];
        if (c === 9 || c === 10 || c === 13) printable += 1;
        else if (c >= 32 && c <= 126) printable += 1;
    }
    return printable / max > 0.9;
}

function extractLikelyAudioUrlFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const urls = [];
    const re = /https?:\/\/[^\s"'<>]+/gi;
    let match;
    while ((match = re.exec(text)) && urls.length < 120) {
        urls.push(match[0]);
    }
    if (!urls.length) return null;

    const scoreUrl = (url) => {
        const u = String(url || '');
        const lower = u.toLowerCase();
        let score = 0;

        // Prefer obvious audio/media files
        if (/\.(mp3|flac|m4a|aac|ogg|wav|webm)(?:\?|$)/i.test(lower)) score += 100;
        if (/\.(mp4)(?:\?|$)/i.test(lower)) score += 70;

        // Prefer common music CDNs / path hints
        if (/trackmedia|resource\/|\/stream|\/audio|\/music|\.kuwo\.cn|\.music\.126\.net|\.qqmusic\.qq\.com/i.test(lower)) score += 15;

        // De-prioritize obvious non-media assets
        if (/\.(css|js|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|eot|otf)(?:\?|$)/i.test(lower)) score -= 80;

        // De-prioritize challenge/landing pages if present
        if (/captcha|challenge|cloudflare|login/i.test(lower)) score -= 30;

        return score;
    };

    let best = null;
    let bestScore = -Infinity;
    for (const url of urls) {
        const score = scoreUrl(url);
        if (score > bestScore) {
            bestScore = score;
            best = url;
        }
    }

    if (best && bestScore > 0) return best;
    return extractFirstHttpUrlFromText(text);
}

const server = http.createServer((req, res) => {
    const requestUrl = (() => {
        try {
            return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        } catch {
            return new URL('http://localhost/');
        }
    })();

    const requestPath = (() => {
        try {
            return decodeURIComponent((req.url || '/').split('?')[0]);
        } catch {
            return '/';
        }
    })();

    // 兼容部署在子路径（例如反代前缀、静态站点子目录）：
    // /audio-proxy 与 /xxx/audio-proxy 都视为同一路由
    function matchRoute(pathname, route) {
        try {
            const p = String(pathname || '');
            const r = String(route || '');
            return p === r || p.endsWith(r);
        } catch {
            return false;
        }
    }

    function writeCorsHeaders(extra = {}) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
        res.setHeader(
            'Access-Control-Expose-Headers',
            [
                'Content-Type',
                'Content-Length',
                'Accept-Ranges',
                'Content-Range',
                'ETag',
                'Last-Modified',
                'X-HJWJB-Server-Version',
                'X-Audio-Proxy-Final-Url',
                'X-Audio-Proxy-Status',
                'X-Audio-Proxy-Content-Type'
            ].join(', ')
        );
        for (const [k, v] of Object.entries(extra)) {
            res.setHeader(k, v);
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
            // API2 (QQ search proxy) + API4 (Kuwo)
            '0',
            // API2 (Kugou)
            '',
            'kw-api.cenguigui.cn',
            // API4 word-lyrics (LRCX)
            '',
            'y.gtimg.cn',
            // QQMusic track CDN
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
        if (host.endsWith('.kugou.com')) return true;
        return false;
    }

    function inferAudioContentTypeFromUrl(urlObj) {
        try {
            const ext = String(path.extname(urlObj.pathname || '')).toLowerCase();
            switch (ext) {
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
        } catch {
            return 'audio/mpeg';
        }
    }

    // 用于确认当前运行的是哪个 server.js（解决“旧进程没重启导致 /audio-resolve 404”）
    if (matchRoute(requestPath, '/__health')) {
        writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-HJWJB-Server-Version': '2026-02-03-audio-proxy-v5'
        });
        res.end(
            JSON.stringify({
                ok: true,
                version: '2026-02-03-audio-proxy-v5',
                routes: ['/audio-proxy', '/audio-resolve', '/text-proxy'],
                time: new Date().toISOString()
            })
        );
        return;
    }

    // 给所有响应加一个版本头，方便排查是否重启了新服务
    try {
        res.setHeader('X-HJWJB-Server-Version', '2026-02-03-audio-proxy-v5');
    } catch {
        // ignore
    }

    // 轻量文本代理：用于解决歌词等接口的 CORS 问题
    // Stats: today's resolved song count (UTC) for API2 `/api/song/url` (counted via `/text-proxy` responses).
    if (matchRoute(requestPath, '/api/stats')) {
        const method = (req.method || 'GET').toUpperCase();
        if (method === 'OPTIONS') {
            writeCorsHeaders();
            res.writeHead(204, { 'Cache-Control': 'no-cache' });
            res.end();
            return;
        }

        if (method !== 'GET' && method !== 'HEAD') {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
            return;
        }

        ensureApi2SongUrlStatsDay();
        writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        if (method === 'HEAD') {
            res.end();
            return;
        }
        res.end(
            JSON.stringify({
                ok: true,
                dayUtc: api2SongUrlStatsState.dayUtc || utcDayString(new Date()),
                resolvedMidCount: api2SongUrlStatsState.resolvedMidCount,
                updatedAt: api2SongUrlStatsState.updatedAt
            })
        );
        return;
    }

    // API2 Kugou stats: today's parse request counts (UTC) for `/song/url`, `/song/url/new`, `/audio` (counted via `/text-proxy`).
    if (matchRoute(requestPath, '/stats/parse/today')) {
        const method = (req.method || 'GET').toUpperCase();
        if (method === 'OPTIONS') {
            writeCorsHeaders();
            res.writeHead(204, { 'Cache-Control': 'no-cache' });
            res.end();
            return;
        }

        if (method !== 'GET' && method !== 'HEAD') {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
            return;
        }

        ensureApi2KugouParseStatsDay();
        writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        if (method === 'HEAD') {
            res.end();
            return;
        }
        res.end(
            JSON.stringify({
                ok: true,
                dayUtc: api2KugouParseStatsState.dayUtc || utcDayString(new Date()),
                parseCount: api2KugouParseStatsState.total,
                successCount: api2KugouParseStatsState.success,
                routes: api2KugouParseStatsState.routes,
                updatedAt: api2KugouParseStatsState.updatedAt
            })
        );
        return;
    }

    if (matchRoute(requestPath, '/text-proxy')) {
        if ((req.method || 'GET').toUpperCase() === 'OPTIONS') {
            writeCorsHeaders();
            res.writeHead(204, { 'Cache-Control': 'no-cache' });
            res.end();
            return;
        }

        const target = requestUrl.searchParams.get('url');
        if (!target) {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end('Missing url param');
            return;
        }

        let upstream;
        try {
            upstream = new URL(target);
        } catch {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end('Invalid url param');
            return;
        }

        if (!/^https?:$/.test(upstream.protocol) || !isAllowedProxyHost(upstream.hostname)) {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end('Host not allowed');
            return;
        }

        const maxRedirects = 5;
        const clientMethod = (req.method || 'GET').toUpperCase();

        const fetchUpstream = (urlObj, redirectsLeft, { cookieHeader = '' } = {}) => {
            const isHttps = urlObj.protocol === 'https:';
            const transport = isHttps ? https : http;

            const upstreamReq = transport.request(
                urlObj,
                {
                    method: clientMethod === 'HEAD' ? 'HEAD' : 'GET',
                    headers: {
                        'User-Agent': DEFAULT_UPSTREAM_UA,
                        'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
                        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
                        'Accept-Encoding': 'identity',
                        Origin: `${urlObj.protocol}//${urlObj.host}`,
                        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                        Referer: urlObj.hostname && urlObj.hostname.toLowerCase().endsWith('.kuwo.cn')
                            ? 'https://www.kuwo.cn/'
                            : `${urlObj.protocol}//${urlObj.host}/`
                    }
                },
                (upstreamRes) => {
                    const status = upstreamRes.statusCode || 502;
                    const location = upstreamRes.headers.location;

                    if ([301, 302, 303, 307, 308].includes(status) && location && redirectsLeft > 0) {
                        try {
                            const nextUrl = new URL(location, urlObj);
                            fetchUpstream(nextUrl, redirectsLeft - 1, { cookieHeader });
                            upstreamRes.resume();
                            return;
                        } catch {
                            // fallthrough
                        }
                    }

                    writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });

                    const passthroughHeaders = {};
                    const allowHeaders = new Set(['content-type', 'content-length', 'etag', 'last-modified']);
                    for (const [k, v] of Object.entries(upstreamRes.headers)) {
                        if (allowHeaders.has(String(k).toLowerCase()) && typeof v !== 'undefined') {
                            passthroughHeaders[k] = v;
                        }
                    }

                    const ct = String(upstreamRes.headers['content-type'] || '').toLowerCase();
                    if (!ct || ct.includes('application/octet-stream')) {
                        passthroughHeaders['content-type'] = 'text/plain; charset=utf-8';
                    }

                    const kugouParseRouteKey = getKugouParseStatsRouteKey(urlObj);
                    const shouldRecordApi2SongUrlStats =
                        clientMethod !== 'HEAD' && status >= 200 && status < 300 && isApi2SongUrlEndpoint(urlObj);
                    const shouldRecordKugouParseStats =
                        clientMethod !== 'HEAD' && status >= 200 && status < 300 && !!kugouParseRouteKey;
                    const shouldBufferForStats = shouldRecordApi2SongUrlStats || shouldRecordKugouParseStats;

                    if (shouldBufferForStats) {
                        const chunks = [];
                        let total = 0;

                        upstreamRes.on('data', (chunk) => {
                            chunks.push(chunk);
                            total += chunk.length;
                        });

                        upstreamRes.on('end', () => {
                            const body = Buffer.concat(chunks, total);
                            const text = body.toString('utf8');

                            if (shouldRecordApi2SongUrlStats) {
                                const delta = countResolvedMidsFromApi2SongUrlJsonText(text);
                                recordApi2SongUrlStatsDelta(delta);
                            }

                            if (shouldRecordKugouParseStats) {
                                const success = parseKugouParseSuccess(kugouParseRouteKey, text);
                                recordApi2KugouParseStats(kugouParseRouteKey, { success });
                            }
                            passthroughHeaders['content-length'] = String(body.length);
                            res.writeHead(status, passthroughHeaders);
                            res.end(body);
                        });

                        upstreamRes.on('error', () => {
                            const body = Buffer.concat(chunks, total);
                            passthroughHeaders['content-length'] = String(body.length);
                            res.writeHead(status, passthroughHeaders);
                            res.end(body);
                        });

                        return;
                    }

                    res.writeHead(status, passthroughHeaders);

                    if (clientMethod === 'HEAD') {
                        res.end();
                        upstreamRes.resume();
                        return;
                    }

                    upstreamRes.pipe(res);
                }
            );

            upstreamReq.on('error', (e) => {
                writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
                res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
                res.end(`Upstream error: ${e.message}`);
            });

            upstreamReq.end();
        };

        if (isKugouSongUrlEndpoint(upstream)) {
            const authKey = upstream.searchParams.get('authKey') || upstream.searchParams.get('authkey') || '';
            getKugouDevCookieHeader(authKey)
                .then((cookieHeader) => fetchUpstream(upstream, maxRedirects, { cookieHeader }))
                .catch(() => fetchUpstream(upstream, maxRedirects));
        } else {
            fetchUpstream(upstream, maxRedirects);
        }
        return;
    }

    // 轻量音频代理：解决部分音源直链在浏览器端无法播放/Range/CORS 的问题
    if (matchRoute(requestPath, '/audio-proxy')) {
        if ((req.method || 'GET').toUpperCase() === 'OPTIONS') {
            writeCorsHeaders();
            res.writeHead(204, { 'Cache-Control': 'no-cache' });
            res.end();
            return;
        }

        const target = requestUrl.searchParams.get('url');
        if (!target) {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end('Missing url param');
            return;
        }

        let upstream;
        try {
            upstream = new URL(target);
        } catch {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end('Invalid url param');
            return;
        }

        if (!/^https?:$/.test(upstream.protocol) || !isAllowedProxyHost(upstream.hostname)) {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end('Host not allowed');
            return;
        }

        const maxRedirects = 5;
        const clientMethod = (req.method || 'GET').toUpperCase();
        const rangeHeader = req.headers.range;

        const fetchUpstream = (urlObj, redirectsLeft) => {
            const isHttps = urlObj.protocol === 'https:';
            const transport = isHttps ? https : http;

            const hostnameLower = urlObj.hostname ? urlObj.hostname.toLowerCase() : '';
            const isKuwoHost = hostnameLower.endsWith('.kuwo.cn');
            const isNeteaseHost = hostnameLower === 'music.126.net' || hostnameLower.endsWith('.music.126.net');
            const isJooxHost = hostnameLower === 'music.joox.com' || hostnameLower.endsWith('.music.joox.com');
            const isQqMusicHost = hostnameLower.endsWith('.qqmusic.qq.com') || hostnameLower.endsWith('.gtimg.cn');

            const originHeader = isKuwoHost
                ? 'https://www.kuwo.cn'
                : isNeteaseHost
                    ? 'https://music.163.com'
                    : isJooxHost
                        ? 'https://www.joox.com'
                        : isQqMusicHost
                            ? 'https://y.qq.com'
                            : null;

            const refererHeader = isKuwoHost
                ? 'https://www.kuwo.cn/'
                : isNeteaseHost
                    ? 'https://music.163.com/'
                    : isJooxHost
                        ? 'https://www.joox.com/'
                        : isQqMusicHost
                            ? 'https://y.qq.com/'
                            : `${urlObj.protocol}//${urlObj.host}/`;

            const upstreamReq = transport.request(
                urlObj,
                {
                    method: clientMethod === 'HEAD' ? 'HEAD' : 'GET',
                    headers: {
                        'User-Agent': DEFAULT_UPSTREAM_UA,
                        'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
                        Accept: 'audio/*,*/*;q=0.9',
                        'Accept-Encoding': 'identity',
                        ...(originHeader ? { Origin: originHeader } : {}),
                        ...(rangeHeader ? { Range: rangeHeader } : {}),
                        // 部分酷我 CDN 可能校验 Referer：对 kuwo 域名固定使用官网 Referer，其他域名使用自身根路径
                        Referer: refererHeader
                    }
                },
                (upstreamRes) => {
                    const status = upstreamRes.statusCode || 502;
                    const location = upstreamRes.headers.location;

                    if ([301, 302, 303, 307, 308].includes(status) && location && redirectsLeft > 0) {
                        try {
                            const nextUrl = new URL(location, urlObj);
                            fetchUpstream(nextUrl, redirectsLeft - 1);
                            upstreamRes.resume();
                            return;
                        } catch {
                            // fallthrough
                        }
                    }

                    writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });

                    const upstreamCtRaw = String(upstreamRes.headers['content-type'] || '');
                    const upstreamCt = upstreamCtRaw.toLowerCase();
                    const contentLengthHeader = upstreamRes.headers['content-length'];
                    const contentLength =
                        typeof contentLengthHeader === 'string' && contentLengthHeader.trim()
                            ? Number(contentLengthHeader)
                            : 0;

                    // 某些“播放接口”不是直接返回音频，而是返回最终媒体地址（纯文本/JSON）
                    // 注意：对 content-type 不明确的响应，必须要求 content-length 很小，避免把“真实音频流”误判为文本并等待到结束。
                    const isTextLike = upstreamCt.includes('application/json') || upstreamCt.startsWith('text/');
                    const isUnknownOrOctet = !upstreamCt || upstreamCt.includes('application/octet-stream');
                    const hasSmallLength = Number.isFinite(contentLength) && contentLength > 0 && contentLength <= 16384;
                    const mightBeUrlPayload = status >= 200 && status < 300 && (isTextLike || (isUnknownOrOctet && hasSmallLength));

                    if (clientMethod !== 'HEAD' && mightBeUrlPayload && redirectsLeft > 0) {
                        const maxBodyBytes = 32768;
                        const chunks = [];
                        let total = 0;

                        const failNonAudio = (reason) => {
                            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
                            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                            res.end(reason);
                        };

                        upstreamRes.on('data', (chunk) => {
                            if (total >= maxBodyBytes) return;
                            chunks.push(chunk);
                            total += chunk.length;
                        });

                        upstreamRes.on('end', () => {
                            try {
                                const text = Buffer.concat(chunks, total).toString('utf8');
                                const extracted = extractLikelyAudioUrlFromText(text);
                                if (extracted) {
                                    try {
                                        const nextUrl = new URL(extracted, urlObj);
                                        if (!/^https?:$/.test(nextUrl.protocol) || !isAllowedProxyHost(nextUrl.hostname)) {
                                            failNonAudio('Upstream returned a URL but host is not allowed');
                                            return;
                                        }
                                        fetchUpstream(nextUrl, redirectsLeft - 1);
                                        return;
                                    } catch {
                                        // fallthrough
                                    }
                                }
                                failNonAudio('Upstream returned non-audio content (no playable URL found)');
                            } catch (e) {
                                failNonAudio(
                                    `Upstream returned non-audio content (${e && e.message ? e.message : 'parse error'})`
                                );
                            }
                        });

                        upstreamRes.on('error', () => {
                            failNonAudio('Upstream stream error');
                        });

                        return;
                    }

                    const shouldSniffNonAudio =
                        clientMethod !== 'HEAD' &&
                        status >= 200 &&
                        status < 300 &&
                        (isUnknownOrOctet && !mightBeUrlPayload);

                    if (shouldSniffNonAudio) {
                        const maxBodyBytes = 32768;
                        const chunks = [];
                        let total = 0;
                        let finished = false;

                        const failNonAudio = (reason) => {
                            if (finished) return;
                            finished = true;
                            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
                            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                            res.end(reason);
                        };

                        const tryRedirectFromText = (buffer) => {
                            try {
                                if (redirectsLeft <= 0) return false;
                                const text = buffer.toString('utf8');
                                const extracted = extractLikelyAudioUrlFromText(text);
                                if (!extracted) return false;
                                const nextUrl = new URL(extracted, urlObj);
                                if (!/^https?:$/.test(nextUrl.protocol) || !isAllowedProxyHost(nextUrl.hostname)) {
                                    failNonAudio('Upstream returned a URL but host is not allowed');
                                    return true;
                                }
                                if (finished) return true;
                                finished = true;
                                fetchUpstream(nextUrl, redirectsLeft - 1);
                                return true;
                            } catch {
                                return false;
                            }
                        };

                        const finishWithBuffered = () => {
                            if (finished) return;
                            const buffer = Buffer.concat(chunks, total);
                            if (tryRedirectFromText(buffer)) return;
                            if (looksLikeHtmlBytes(buffer)) {
                                failNonAudio('Upstream returned HTML, not audio');
                                return;
                            }
                            failNonAudio('Upstream returned non-audio content');
                        };

                        const cleanupHandlers = () => {
                            try {
                                upstreamRes.removeListener('data', onData);
                                upstreamRes.removeListener('end', finishWithBuffered);
                                upstreamRes.removeListener('error', onError);
                            } catch {
                                // ignore
                            }
                        };

                        const onData = (chunk) => {
                            if (finished) return;
                            if (total >= maxBodyBytes) return;
                            const remaining = maxBodyBytes - total;
                            const slice = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
                            chunks.push(slice);
                            total += slice.length;
                            if (total >= maxBodyBytes) {
                                cleanupHandlers();
                                try {
                                    upstreamRes.destroy();
                                } catch {
                                    // ignore
                                }
                                finishWithBuffered();
                            }
                        };

                        const onError = () => {
                            failNonAudio('Upstream stream error');
                        };

                        upstreamRes.once('readable', () => {
                            const firstChunk = upstreamRes.read(4096) || upstreamRes.read();
                            if (!firstChunk) {
                                failNonAudio('Upstream returned empty response');
                                upstreamRes.resume();
                                return;
                            }

                            const detectedAudioType = detectAudioContentTypeFromBytes(firstChunk);
                            if (detectedAudioType) {
                                // 还原到流里，继续走正常音频透传
                                upstreamRes.unshift(firstChunk);
                            } else {
                                const mightBeHtml = looksLikeHtmlBytes(firstChunk);
                                const mightBeText = looksLikeTextBytes(firstChunk);
                                if (mightBeHtml || mightBeText) {
                                    chunks.push(firstChunk);
                                    total += firstChunk.length;

                                    if (tryRedirectFromText(Buffer.concat(chunks, total))) {
                                        try {
                                            upstreamRes.destroy();
                                        } catch {
                                            // ignore
                                        }
                                        return;
                                    }

                                    upstreamRes.on('data', onData);
                                    upstreamRes.on('end', finishWithBuffered);
                                    upstreamRes.on('error', onError);
                                    upstreamRes.resume();
                                    return;
                                }

                                // 未识别为音频，也不像 HTML/文本：仍按音频透传（兜底走扩展名推断）
                                upstreamRes.unshift(firstChunk);
                            }

                            // 继续走音频透传；如果 upstream 没有 content-type，优先用 sniff 结果
                            const passthroughHeaders = {};
                            const allowHeaders = new Set([
                                'content-type',
                                'content-length',
                                'accept-ranges',
                                'content-range',
                                'etag',
                                'last-modified'
                            ]);
                            for (const [k, v] of Object.entries(upstreamRes.headers)) {
                                if (allowHeaders.has(String(k).toLowerCase()) && typeof v !== 'undefined') {
                                    passthroughHeaders[k] = v;
                                }
                            }

                            const ct = String(upstreamRes.headers['content-type'] || '').toLowerCase();
                            passthroughHeaders['x-audio-proxy-final-url'] = urlObj.toString();
                            passthroughHeaders['x-audio-proxy-status'] = String(status);
                            passthroughHeaders['x-audio-proxy-content-type'] = String(upstreamRes.headers['content-type'] || '');

                            if (!ct || ct.includes('application/octet-stream')) {
                                passthroughHeaders['content-type'] = detectedAudioType || inferAudioContentTypeFromUrl(urlObj);
                            }

                            if (ct.includes('text/html')) {
                                res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                                res.end('Upstream returned HTML, not audio');
                                upstreamRes.resume();
                                return;
                            }

                            res.writeHead(status, passthroughHeaders);
                            if (clientMethod === 'HEAD') {
                                res.end();
                                upstreamRes.resume();
                                return;
                            }
                            upstreamRes.pipe(res);
                        });

                        return;
                    }

                    const passthroughHeaders = {};
                    const allowHeaders = new Set([
                        'content-type',
                        'content-length',
                        'accept-ranges',
                        'content-range',
                        'etag',
                        'last-modified'
                    ]);
                    for (const [k, v] of Object.entries(upstreamRes.headers)) {
                        if (allowHeaders.has(String(k).toLowerCase()) && typeof v !== 'undefined') {
                            passthroughHeaders[k] = v;
                        }
                    }

                    // 兜底：某些音频源会返回 application/octet-stream，配合 nosniff 可能导致浏览器认为“不可播放”
                    const ct = String(upstreamRes.headers['content-type'] || '').toLowerCase();
                    // 便于在 DevTools Network 里直接看到最终实际取到的媒体地址/类型
                    passthroughHeaders['x-audio-proxy-final-url'] = urlObj.toString();
                    passthroughHeaders['x-audio-proxy-status'] = String(status);
                    passthroughHeaders['x-audio-proxy-content-type'] = String(upstreamRes.headers['content-type'] || '');

                    if (!ct || ct.includes('application/octet-stream')) {
                        passthroughHeaders['content-type'] = inferAudioContentTypeFromUrl(urlObj);
                    }

                    // 如果明显是 HTML，直接返回错误，避免把页面当音频喂给 <audio>
                    if (ct.includes('text/html')) {
                        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('Upstream returned HTML, not audio');
                        upstreamRes.resume();
                        return;
                    }

                    res.writeHead(status, passthroughHeaders);

                    if (clientMethod === 'HEAD') {
                        res.end();
                        upstreamRes.resume();
                        return;
                    }

                    upstreamRes.pipe(res);
                }
            );

            upstreamReq.on('error', (e) => {
                writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
                res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
                res.end(`Upstream error: ${e.message}`);
            });

            upstreamReq.end();
        };

        fetchUpstream(upstream, maxRedirects);
        return;
    }

    // 仅解析音频最终地址（跟随重定向），用于解决部分“播放接口返回 JSON/302”场景
    if (matchRoute(requestPath, '/audio-resolve')) {
        if ((req.method || 'GET').toUpperCase() === 'OPTIONS') {
            writeCorsHeaders();
            res.writeHead(204, { 'Cache-Control': 'no-cache' });
            res.end();
            return;
        }

        const target = requestUrl.searchParams.get('url');
        if (!target) {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(JSON.stringify({ error: 'Missing url param' }));
            return;
        }

        let upstream;
        try {
            upstream = new URL(target);
        } catch {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(JSON.stringify({ error: 'Invalid url param' }));
            return;
        }

        if (!/^https?:$/.test(upstream.protocol) || !isAllowedProxyHost(upstream.hostname)) {
            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(JSON.stringify({ error: 'Host not allowed' }));
            return;
        }

        const maxRedirects = 6;

        const resolveUpstream = (urlObj, redirectsLeft) => {
            const isHttps = urlObj.protocol === 'https:';
            const transport = isHttps ? https : http;

            const hostnameLower = urlObj.hostname ? urlObj.hostname.toLowerCase() : '';
            const isKuwoHost = hostnameLower.endsWith('.kuwo.cn');
            const isNeteaseHost = hostnameLower === 'music.126.net' || hostnameLower.endsWith('.music.126.net');
            const isJooxHost = hostnameLower === 'music.joox.com' || hostnameLower.endsWith('.music.joox.com');

            const refererHeader = isKuwoHost
                ? 'https://www.kuwo.cn/'
                : isNeteaseHost
                    ? 'https://music.163.com/'
                    : isJooxHost
                        ? 'https://www.joox.com/'
                        : `${urlObj.protocol}//${urlObj.host}/`;

            const upstreamReq = transport.request(
                urlObj,
                {
                    method: 'GET',
                    headers: {
                        'User-Agent': DEFAULT_UPSTREAM_UA,
                        'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
                        Accept: 'audio/*,application/json,text/plain;q=0.9,*/*;q=0.8',
                        // 避免拉取完整音频：只取很小一段即可完成“重定向/文本URL”解析
                        Range: 'bytes=0-32767',
                        Referer: refererHeader
                    }
                },
                (upstreamRes) => {
                    const status = upstreamRes.statusCode || 0;
                    const location = upstreamRes.headers.location;

                    if ([301, 302, 303, 307, 308].includes(status) && location && redirectsLeft > 0) {
                        try {
                            const nextUrl = new URL(location, urlObj);
                            upstreamRes.resume();
                            resolveUpstream(nextUrl, redirectsLeft - 1);
                            return;
                        } catch {
                            // fallthrough
                        }
                    }

                    const upstreamCtRaw = String(upstreamRes.headers['content-type'] || '');
                    const upstreamCt = upstreamCtRaw.toLowerCase();
                    const contentLengthHeader = upstreamRes.headers['content-length'];
                    const contentLength =
                        typeof contentLengthHeader === 'string' && contentLengthHeader.trim()
                            ? Number(contentLengthHeader)
                            : 0;

                    // 某些播放接口会直接返回“最终媒体URL”（纯文本/JSON），需要额外解析
                    // 注意：对 content-type 不明确的响应，必须要求 content-length 很小，避免把“真实音频流”误判为文本并等待到结束。
                    const isTextLike = upstreamCt.includes('application/json') || upstreamCt.startsWith('text/');
                    const isUnknownOrOctet = !upstreamCt || upstreamCt.includes('application/octet-stream');
                    const hasSmallLength = Number.isFinite(contentLength) && contentLength > 0 && contentLength <= 16384;
                    const mightBeUrlPayload = status >= 200 && status < 300 && (isTextLike || (isUnknownOrOctet && hasSmallLength));

                    if (mightBeUrlPayload && redirectsLeft > 0) {
                        const maxBodyBytes = 32768;
                        const chunks = [];
                        let total = 0;

                        upstreamRes.on('data', (chunk) => {
                            if (total >= maxBodyBytes) return;
                            chunks.push(chunk);
                            total += chunk.length;
                        });

                        upstreamRes.on('end', () => {
                            try {
                                const text = Buffer.concat(chunks, total).toString('utf8');
                                const extracted = extractLikelyAudioUrlFromText(text);
                                if (extracted) {
                                    try {
                                        const nextUrl = new URL(extracted, urlObj);
                                        if (/^https?:$/.test(nextUrl.protocol) && isAllowedProxyHost(nextUrl.hostname)) {
                                            resolveUpstream(nextUrl, redirectsLeft - 1);
                                            return;
                                        }
                                    } catch {
                                        // ignore
                                    }
                                }

                                writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
                                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                                res.end(
                                    JSON.stringify({
                                        finalUrl: urlObj.toString(),
                                        status,
                                        contentType: upstreamRes.headers['content-type'] || null,
                                        contentLength: upstreamRes.headers['content-length'] || null
                                    })
                                );
                            } finally {
                                upstreamRes.resume();
                            }
                        });

                        upstreamRes.on('error', () => {
                            writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
                            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                            res.end(
                                JSON.stringify({
                                    finalUrl: urlObj.toString(),
                                    status,
                                    contentType: upstreamRes.headers['content-type'] || null,
                                    contentLength: upstreamRes.headers['content-length'] || null
                                })
                            );
                        });

                        return;
                    }

                    writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(
                        JSON.stringify({
                            finalUrl: urlObj.toString(),
                            status,
                            contentType: upstreamRes.headers['content-type'] || null,
                            contentLength: upstreamRes.headers['content-length'] || null
                        })
                    );
                    upstreamRes.resume();
                }
            );

            upstreamReq.on('error', (e) => {
                writeCorsHeaders({ 'X-Content-Type-Options': 'nosniff' });
                res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
                res.end(JSON.stringify({ error: `Upstream error: ${e.message}` }));
            });

            upstreamReq.end();
        };

        resolveUpstream(upstream, maxRedirects);
        return;
    }

    let filePath = '.' + requestPath;
    if (filePath === './') {
        filePath = './index.html';
    } else if (!path.extname(filePath)) {
        // 如果URL没有扩展名，尝试添加.html
        filePath = filePath + '.html';
    }

    // 基础的路径穿越防护：禁止访问项目根目录之外的路径
    const normalizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '.');

    const extname = String(path.extname(normalizedPath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'font/otf',
        '.wasm': 'application/wasm'
    };

    const baseContentType = mimeTypes[extname] || 'application/octet-stream';
    const contentType = shouldUseUtf8Charset(baseContentType) ? `${baseContentType}; charset=utf-8` : baseContentType;
    const cacheControl = extname === '.html' ? 'no-cache' : 'no-cache';
    const commonHeaders = {
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': cacheControl
    };

    fs.readFile(normalizedPath, (error, content) => {
        if (error) {
            if(error.code == 'ENOENT') {
                res.writeHead(404, { ...commonHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('404 Not Found');
            }
            else {
                res.writeHead(500, { ...commonHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`Server error: ${error.code}`);
            }
        }
        else {
            res.writeHead(200, { ...commonHeaders, 'Content-Type': contentType });
            res.end(content);
        }
    });
});

function toPort(value, fallback) {
    const n = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

function listenWithRetry(startPort, { maxAttempts = 20 } = {}) {
    let port = startPort;
    let attempts = 0;

    const tryListen = () => {
        attempts += 1;
        server.listen(port, () => {
            console.log(`Server running at http://localhost:${port}/`);
        });
    };

    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            if (attempts >= maxAttempts) {
                console.error(`Port ${port} is in use (tried ${attempts} ports). Set PORT env var to choose another port.`);
                process.exit(1);
            }
            port += 1;
            console.warn(`Port in use, retrying on ${port}...`);
            setTimeout(tryListen, 80);
            return;
        }

        console.error('Server error:', err);
        process.exit(1);
    });

    tryListen();
}

const PORT = toPort(process.env.PORT, 8080);
listenWithRetry(PORT, { maxAttempts: 20 });
