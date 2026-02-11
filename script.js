// HJWJB音乐API静态播放器 JavaScript

// 立即执行的调试日志，验证脚本是否开始执行
console.log('🔧 主页脚本开始执行');
console.log('🔧 当前时间:', new Date().toLocaleString());

// 弹幕消息列表
const danmakuMessages = [
    '欢迎使用HJWJB音乐',
    '免责声明：本页内容仅供参考学习交流。',
    '🎵 HJWJB音乐 - 您的专属音乐播放器',
    '💖 如果喜欢这个播放器，请给个五星好评！',
    '🎶 发现好音乐，分享好心情',
    '☕ 制作不易，请勿转载',
    '📱 支持手机和电脑访问',
    '🔍 使用搜索功能查找你喜欢的歌曲',
    '🎨 搅沫沫',
];

// 全局变量
let currentSongIndex = -1;
let playlist = [];
let isPlaying = false;
let currentMusicSource = '网易云音乐'; // 当前选择的音乐源
let currentApi = 'api10'; // 当前选择的API (api3~api10)
let currentQuality = '999'; // 当前选择的音质（部分API使用：128/192/320/740/999）

const BR_QUALITY_DEFAULT = '999';
const BR_QUALITIES = ['999', '740', '320', '192', '128'];
const API8_LEVEL_DEFAULT = 'standard';
const API8_LEVELS = ['standard', 'higher', 'exhigh', 'lossless', 'hire'];
const API8_LEVELS_DESC = ['hire', 'lossless', 'exhigh', 'higher', 'standard'];
const METING_BR_DEFAULT = '128';
const METING_BR_HIGHEST = '400';
const METING_BR_LEVELS = ['128', '320', '380', '400'];
// API10 优先使用 chuyel 的 meting 实现；API9 恢复使用原本的 meting 上游。
const METING_API_BASE_URLS = {
    // Prefer endpoints that can be used directly by <audio> on file:// (redirect/audio stream),
    // and keep multiple upstreams for failover.
    api9: ['https://mapi-org.baka.plus/meting/', 'https://api.baka.plus/meting/', 'https://api.obdo.cc/meting/'],
    api10: [
        // chuyel requires auth tokens for url/pic/lrc; handled via `type=song` below.
        'https://musicapi.chuyel.top/api',
        // stable fallback (QQ url -> audio stream)
        'https://mapi-org.baka.plus/meting/',
        'https://api.baka.plus/meting/',
        'https://api.obdo.cc/meting/',
        'https://api.qijieya.cn/meting/'
    ]
};

// API3 (NetEase / 163) - https://api.bugpk.com/api/163_music
const API3_BASE_URL = 'https://api.bugpk.com/api/163_music';
const API3_LEVEL_DEFAULT = 'standard';

// API4 (Kuwo) - https://kw-api.cenguigui.cn
const API4_BASE_URL = 'https://kw-api.cenguigui.cn';

// User data (local only)
const RECENT_PLAYED_STORAGE_KEY = 'hjwjb_recent_played_v1';
const RECENT_PLAYED_LIMIT = 100;

let recentPlayed = [];

function getSongKey(song) {
    try {
        if (!song) return '';
        const api = String(song.api || currentApi || '').trim();
        const source = String(song.source || currentMusicSource || '').trim();
        const id = String(song.mid || song.id || song.rid || song.musicId || song.songid || '').trim();
        if (!id) return '';
        return `${api}|${source}|${id}`;
    } catch (e) {
        return '';
    }
}

function pickSongLite(song) {
    if (!song) return null;
    return {
        id: song.id ?? song.rid ?? song.musicId ?? song.songid ?? '',
        mid: song.mid ?? song.songmid ?? '',
        api: song.api || currentApi,
        source: song.source || currentMusicSource,
        title: song.title || '',
        artist: song.artist || '',
        album: song.album || '',
        cover: song.cover || 'IMG_20251115_090141.png'
    };
}

function loadRecentPlayed() {
    try {
        const saved = StorageManager.getItem(RECENT_PLAYED_STORAGE_KEY, []);
        recentPlayed = Array.isArray(saved) ? saved : [];
    } catch (e) {
        recentPlayed = [];
    }
}

function saveRecentPlayed() {
    try {
        StorageManager.setItem(RECENT_PLAYED_STORAGE_KEY, recentPlayed);
    } catch (e) {
        // ignore
    }
}

function recordRecentPlay(song) {
    const key = getSongKey(song);
    if (!key) return;
    if (!Array.isArray(recentPlayed)) recentPlayed = [];

    const lite = pickSongLite(song);
    const now = Date.now();

    // De-dup (move to front)
    recentPlayed = recentPlayed.filter((item) => item && item.key !== key);
    recentPlayed.unshift({ key, song: lite, at: now });
    if (recentPlayed.length > RECENT_PLAYED_LIMIT) recentPlayed = recentPlayed.slice(0, RECENT_PLAYED_LIMIT);
    saveRecentPlayed();
}

function normalizeBrQuality(value) {
    const raw = value == null ? '' : String(value);
    const text = raw.trim();
    if (!text) return BR_QUALITY_DEFAULT;

    const lower = text.toLowerCase();
    const legacyMap = {
        flac24bit: '999',
        flac: '999',
        lossless: '999',
        '999k': '999',
        '740k': '740',
        '320k': '320',
        '192k': '192',
        '128k': '128',
    };

    const mapped = legacyMap[lower];
    if (mapped) return mapped;

    if (/^\d+$/.test(text) && BR_QUALITIES.includes(text)) return text;

    return BR_QUALITY_DEFAULT;
}

function getBrQualityDisplayName(value) {
    const br = normalizeBrQuality(value);
    if (br === '999') return '无损 (999)';
    if (br === '740') return '无损 (740)';
    return `${br}K`;
}

function normalizeApi8Level(value) {
    const raw = value == null ? '' : String(value);
    const text = raw.trim().toLowerCase();
    if (!text) return API8_LEVEL_DEFAULT;

    const aliasMap = {
        std: 'standard',
        standard: 'standard',
        higher: 'higher',
        high: 'higher',
        exhigh: 'exhigh',
        lossless: 'lossless',
        hire: 'hire',
        hires: 'hire',
        'hi-res': 'hire',
        'hires': 'hire'
    };

    const mapped = aliasMap[text];
    if (mapped) return mapped;
    if (API8_LEVELS.includes(text)) return text;
    return API8_LEVEL_DEFAULT;
}

function getApi8LevelDisplayName(value) {
    const level = normalizeApi8Level(value);
    const nameMap = {
        lossless: '无损',
        higher: '较高',
        exhigh: '极高',
        standard: '标准',
        hire: '高清'
    };
    return nameMap[level] || nameMap[API8_LEVEL_DEFAULT];
}

function normalizeApi3Level(value) {
    const raw = value == null ? '' : String(value);
    const text = raw.trim().toLowerCase();
    if (!text) return API3_LEVEL_DEFAULT;

    // Map legacy BR-quality (128/192/320/740/999) to API3 level.
    if (/^\d+$/.test(text)) {
        if (text === '999') return 'hires';
        if (text === '740') return 'lossless';
        if (text === '320') return 'exhigh';
        return 'standard';
    }

    const aliasMap = {
        std: 'standard',
        standard: 'standard',
        exhigh: 'exhigh',
        higher: 'exhigh',
        lossless: 'lossless',
        flac: 'lossless',
        hires: 'hires',
        hire: 'hires',
        'hi-res': 'hires',
        jyeffect: 'jyeffect',
        sky: 'sky',
        jymaster: 'jymaster'
    };

    const mapped = aliasMap[text];
    if (mapped) return mapped;
    return API3_LEVEL_DEFAULT;
}

function getApi3LevelCandidates(value) {
    const desired = normalizeApi3Level(value);
    const orderMap = {
        jymaster: ['jymaster', 'sky', 'jyeffect', 'hires', 'lossless', 'exhigh', 'standard'],
        sky: ['sky', 'jyeffect', 'hires', 'lossless', 'exhigh', 'standard'],
        jyeffect: ['jyeffect', 'hires', 'lossless', 'exhigh', 'standard'],
        hires: ['hires', 'lossless', 'exhigh', 'standard'],
        lossless: ['lossless', 'exhigh', 'standard'],
        exhigh: ['exhigh', 'standard'],
        standard: ['standard']
    };
    return orderMap[desired] || ['standard'];
}

function buildApi3Url(params) {
    try {
        const url = new URL(API3_BASE_URL);
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value == null || value === '') return;
            url.searchParams.set(String(key), String(value));
        });
        return url.toString();
    } catch (e) {
        return '';
    }
}

function buildApi3DownUrl(songId, level) {
    const id = songId == null ? '' : String(songId).trim();
    if (!id) return '';
    const normalizedLevel = normalizeApi3Level(level);
    return buildApi3Url({ ids: id, type: 'down', level: normalizedLevel });
}

function pickApi3Payload(data, songId) {
    const id = songId == null ? '' : String(songId).trim();

    const pickFromArray = (list) => {
        if (!Array.isArray(list) || !list.length) return null;
        const normalizedId = id ? String(id) : '';
        if (normalizedId) {
            const found = list.find((item) => {
                if (!item || typeof item !== 'object') return false;
                const candidateId = item.id ?? item.ids ?? item.songId ?? item.songid ?? item.musicId ?? item.mid;
                if (candidateId == null) return false;
                return String(candidateId).trim() === normalizedId;
            });
            if (found) return found;
        }
        const firstObj = list.find((item) => item && typeof item === 'object');
        return firstObj || null;
    };

    if (Array.isArray(data)) return pickFromArray(data);
    if (!data || typeof data !== 'object') return null;

    if (data.data != null) {
        const inner = data.data;
        if (Array.isArray(inner)) return pickFromArray(inner);
        if (inner && typeof inner === 'object') return inner;
    }

    if (data.result && typeof data.result === 'object') return data.result;
    return data;
}

function buildApi8RequestUrl(songId, level) {
    const id = songId == null ? '' : String(songId).trim();
    if (!id) return '';
    const normalizedLevel = normalizeApi8Level(level);
    const levelParam =
        normalizedLevel && normalizedLevel !== API8_LEVEL_DEFAULT
            ? `&level=${encodeURIComponent(normalizedLevel)}`
            : '';
    return `https://api.byfuns.top/1/?id=${encodeURIComponent(id)}${levelParam}`;
}

function extractFirstHttpUrlFromText(text) {
    const raw = text == null ? '' : String(text);
    const trimmed = raw.trim();
    if (!trimmed) return '';

    if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === 'string') return parsed.trim();
            if (parsed && typeof parsed === 'object') {
                const candidates = [
                    parsed.url,
                    parsed.data,
                    parsed.link,
                    parsed.playUrl,
                    parsed.play_url,
                    parsed.songUrl,
                    parsed.song_url
                ];
                for (const candidate of candidates) {
                    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate.trim())) {
                        return candidate.trim();
                    }
                }
            }
        } catch (e) {
            // ignore
        }
    }

    if (/^https?:\/\//i.test(trimmed)) return trimmed.split(/\s+/)[0];
    const match = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
    return match ? match[0] : '';
}

async function fetchApi8SongUrl(songId, level, { useProxy = false } = {}) {
    const targetUrl = buildApi8RequestUrl(songId, level);
    if (!targetUrl) return '';

    const requestUrl = useProxy ? buildProxyEndpointUrl('text-proxy', targetUrl) : targetUrl;
    if (useProxy && !requestUrl) return '';

    const upgradeToHttpsIfNeeded = (url) => {
        const raw = String(url || '').trim();
        if (!raw) return '';
        // Avoid mixed-content on HTTPS pages (api8 often returns http://music.126.net/...).
        if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, 'https://');
        return raw;
    };

    const fetchOnce = async () => {
        try {
            const response = await fetch(requestUrl, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': '*/*' },
                redirect: 'manual'
            });

            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('Location');
                if (location) return upgradeToHttpsIfNeeded(location);
            }

            if (!response.ok) return '';

            const rawText = await response.text();
            const extracted = extractFirstHttpUrlFromText(rawText);
            return upgradeToHttpsIfNeeded(extracted);
        } catch (e) {
            return '';
        }
    };

    if (useProxy) return await fetchOnce();

    for (let tryIndex = 1; tryIndex <= 2; tryIndex += 1) {
        const result = await fetchOnce();
        if (result) return result;
        if (tryIndex < 2) await new Promise((resolve) => setTimeout(resolve, 220));
    }
    return '';
}

function getApi2BaseUrl() {
    try {
        const raw = localStorage.getItem(API2_BASE_URL_STORAGE_KEY);
        const value = String(raw || '').trim();
        if (value) {
            const u = new URL(value);
            if (u.protocol === 'http:' || u.protocol === 'https:') {
                return u.origin;
            }
        }
    } catch (e) {
        // ignore
    }
    return API2_BASE_URL_FALLBACK;
}

function getApi2KugouBaseUrl() {
    try {
        const raw = localStorage.getItem(API2_KUGOU_BASE_URL_STORAGE_KEY);
        const value = String(raw || '').trim();
        if (value) {
            const u = new URL(value);
            if (u.protocol === 'http:' || u.protocol === 'https:') {
                return u.origin;
            }
        }
    } catch (e) {
        // ignore
    }
    return API2_KUGOU_BASE_URL_FALLBACK;
}

function getApi2KugouAuthKey() {
    try {
        const raw = localStorage.getItem(API2_KUGOU_AUTH_KEY_STORAGE_KEY);
        return String(raw || '').trim();
    } catch (e) {
        return '';
    }
}

function buildApi2Url(pathname, params) {
    const base = getApi2BaseUrl();
    try {
        const url = new URL(String(pathname || ''), `${base}/`);
        Object.entries(params || {}).forEach(([k, v]) => {
            if (v == null || v === '') return;
            url.searchParams.set(k, String(v));
        });
        return url.toString();
    } catch (e) {
        return '';
    }
}

function buildApi2KugouUrl(pathname, params) {
    const base = getApi2KugouBaseUrl();
    try {
        const url = new URL(String(pathname || ''), `${base}/`);
        Object.entries(params || {}).forEach(([k, v]) => {
            if (v == null || v === '') return;
            url.searchParams.set(k, String(v));
        });
        const savedAuthKey = getApi2KugouAuthKey();
        if (savedAuthKey && !url.searchParams.has('authKey')) {
            url.searchParams.set('authKey', savedAuthKey);
        }
        return url.toString();
    } catch (e) {
        return '';
    }
}

async function fetchApi2JsonWithFallback(pathname, params) {
    const url = buildApi2Url(pathname, params);
    if (!url) return null;

    // Try direct first, then via proxy (for cross-origin / network flakiness).
    let data = await fetchJsonWithOptionalProxy(url, { useProxy: false });
    if (!data) data = await fetchJsonWithOptionalProxy(url, { useProxy: true });
    return data;
}

async function fetchApi2KugouJsonWithFallback(pathname, params) {
    const url = buildApi2KugouUrl(pathname, params);
    if (!url) return null;

    // Prefer direct (with cookies), then fallback to proxy if needed.
    let data = await fetchJsonWithOptionalProxy(url, { useProxy: false, fetchOptions: { credentials: 'include' } });
    if (!data) data = await fetchJsonWithOptionalProxy(url, { useProxy: true });
    return data;
}

let api2KugouDeviceReadyPromise = null;
let api2KugouDeviceReadyAt = 0;
let api2KugouDeviceAuthErrorUntil = 0;
let api2KugouDeviceAuthPromptedAt = 0;

async function ensureApi2KugouDeviceCookiesReady({ force = false } = {}) {
    const now = Date.now();
    // Refresh occasionally to reduce chances of expired/invalid cookies.
    if (!force && api2KugouDeviceReadyAt && now - api2KugouDeviceReadyAt < 1000 * 60 * 60 * 4) {
        return true;
    }

    if (!force && api2KugouDeviceAuthErrorUntil && now < api2KugouDeviceAuthErrorUntil) {
        return false;
    }

    if (!api2KugouDeviceReadyPromise) {
        api2KugouDeviceReadyPromise = (async () => {
            try {
                const url = buildApi2KugouUrl('/register/dev', {});
                if (!url) return false;

                const resp = await fetch(url, {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'include',
                    headers: { Accept: 'application/json,*/*' }
                });

                const status = resp && typeof resp.status === 'number' ? resp.status : 0;
                let text = '';
                try {
                    text = await resp.text();
                } catch (e) {
                    text = '';
                }
                let data = null;
                try {
                    const trimmed = String(text || '').trim();
                    if (trimmed) data = JSON.parse(trimmed);
                } catch (e) {
                    data = null;
                }

                const msg = data && typeof data.msg === 'string' ? data.msg : '';
                const unauthorized = status === 401 || (msg && /unauthorized/i.test(msg));
                if (unauthorized) {
                    api2KugouDeviceAuthErrorUntil = Date.now() + 5 * 60 * 1000;

                    const hasKey = !!getApi2KugouAuthKey();
                    const promptNow = Date.now() - api2KugouDeviceAuthPromptedAt > 5 * 60 * 1000;
                    if (promptNow) api2KugouDeviceAuthPromptedAt = Date.now();

                    const hint = hasKey
                        ? 'API2 酷狗 AuthKey 无效/已失效，请重新设置。'
                        : 'API2 酷狗需要 AuthKey，请先设置后再播放。';
                    if (promptNow) {
                        try {
                            createDanmaku(hint);
                        } catch (e) {
                            // ignore
                        }
                        try {
                            if (window.confirm(`${hint}\n是否现在设置 AuthKey？`)) {
                                openApi2KugouAuthKeySettings();
                            }
                        } catch (e) {
                            // ignore
                        }
                    }

                    return false;
                }

                const ok = !!(data && (data.status === 1 || data.status === '1'));
                if (ok) {
                    api2KugouDeviceReadyAt = Date.now();
                    api2KugouDeviceAuthErrorUntil = 0;
                }
                return ok;
            } catch (e) {
                return false;
            }
        })();

        api2KugouDeviceReadyPromise = api2KugouDeviceReadyPromise.finally(() => {
            api2KugouDeviceReadyPromise = null;
        });
    }

    try {
        return await api2KugouDeviceReadyPromise;
    } catch (e) {
        return false;
    }
}

function isMetingApi(apiName) {
    return ['api9', 'api10'].includes(String(apiName || '').trim());
}

function getMetingBaseUrls(apiName, serverParam) {
    const key = String(apiName || '').trim();
    const urls = METING_API_BASE_URLS[key];
    const list = Array.isArray(urls) ? urls : [];
    if (key !== 'api10') return list;

    // API10: use different upstreams per music source.
    // - QQ (tencent): prefer chuyel
    // - NetEase (netease): prefer qijieya
    const server = mapMetingServerParam(serverParam);
    const chuyelBase = 'https://musicapi.chuyel.top/api';
    const qijieyaBase = 'https://api.qijieya.cn/meting/';

    const cleaned = list.map((u) => String(u || '').trim()).filter(Boolean);

    if (server === 'tencent') {
        return uniqUrls([chuyelBase, ...cleaned.filter((u) => u !== chuyelBase && u !== qijieyaBase)]);
    }

    // netease (default): do not use chuyel for API10 NetEase requests.
    return uniqUrls([qijieyaBase, ...cleaned.filter((u) => u !== qijieyaBase && u !== chuyelBase)]);
}

function uniqUrls(list) {
    const raw = Array.isArray(list) ? list : [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const u = String(item || '').trim();
        if (!u || seen.has(u)) continue;
        seen.add(u);
        out.push(u);
    }
    return out;
}

function buildMetingUrl(baseUrl, params) {
    try {
        const url = new URL(baseUrl);
        Object.entries(params || {}).forEach(([k, v]) => {
            if (v == null || v === '') return;
            url.searchParams.set(k, String(v));
        });
        return url.toString();
    } catch (e) {
        return '';
    }
}

function getMetingRequestUrls(apiName, params) {
    return getMetingBaseUrls(apiName, params && params.server)
        .map((baseUrl) => buildMetingUrl(baseUrl, params))
        .filter(Boolean);
}

function normalizeMetingBr(value) {
    const raw = value == null ? '' : String(value).trim();
    if (METING_BR_LEVELS.includes(raw)) return raw;
    return METING_BR_DEFAULT;
}

function getMetingBrParam(userQuality) {
    const raw = userQuality == null ? '' : String(userQuality).trim();
    if (raw && METING_BR_LEVELS.includes(raw)) {
        return normalizeMetingBr(raw);
    }
    return isHighestQualityMode ? METING_BR_HIGHEST : METING_BR_DEFAULT;
}

function mapMetingServerParam(sourceKey) {
    const raw = String(sourceKey || '').trim().toLowerCase();
    if (raw === 'qq' || raw === 'tencent') return 'tencent';
    return 'netease';
}

function isChuyelAuthRequiredMetingUrl(url) {
    try {
        const u = new URL(String(url || ''), window.location.href);
        const hostname = String(u.hostname || '').toLowerCase();
        const pathname = String(u.pathname || '').replace(/\/+$/, '');
        const type = String(u.searchParams.get('type') || '').toLowerCase();
        const auth = String(u.searchParams.get('auth') || '').trim();
        return hostname === 'musicapi.chuyel.top' && pathname === '/api' && type === 'url' && !auth;
    } catch (e) {
        return false;
    }
}

function pickDirectPlayableMetingUpstream(urls) {
    const list = Array.isArray(urls) ? urls : [];
    const cleaned = list.map((u) => String(u || '').trim()).filter(Boolean);
    if (!cleaned.length) return '';

    const preferHosts = ['mapi-org.baka.plus', 'api.baka.plus', 'api.obdo.cc', 'api.qijieya.cn'];
    for (const host of preferHosts) {
        const found = cleaned.find((value) => {
            try {
                return new URL(value).hostname.toLowerCase() === host;
            } catch (e) {
                return false;
            }
        });
        if (found && !isChuyelAuthRequiredMetingUrl(found)) return found;
    }

    const firstOk = cleaned.find((value) => !isChuyelAuthRequiredMetingUrl(value));
    return firstOk || '';
}

const chuyelMetingSongMetaCache = new Map();

async function fetchChuyelMetingSongMeta(serverParam, songId) {
    try {
        const id = songId == null ? '' : String(songId).trim();
        if (!id) return null;
        const server = mapMetingServerParam(serverParam);
        const cacheKey = `${server}|${id}`;

        const cached = chuyelMetingSongMetaCache.get(cacheKey);
        if (cached && cached.data && Date.now() - cached.at < 5 * 60 * 1000) {
            return cached.data;
        }

        const upgradeToHttps = (value) => {
            const raw = value == null ? '' : String(value).trim();
            if (!raw) return '';
            if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, 'https://');
            return raw;
        };

        const apiUrl = buildMetingUrl('https://musicapi.chuyel.top/api', { server, type: 'song', id });
        const data = apiUrl ? await fetchJsonWithOptionalProxy(apiUrl, { useProxy: false }) : null;
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
        const first = list && list.length ? list[0] : null;
        if (!first || typeof first !== 'object') return null;

        const meta = {
            url: upgradeToHttps(first.url),
            lrc: upgradeToHttps(first.lrc),
            pic: upgradeToHttps(first.pic)
        };

        if (!meta.url && !meta.lrc && !meta.pic) return null;

        chuyelMetingSongMetaCache.set(cacheKey, { at: Date.now(), data: meta });
        return meta;
    } catch (e) {
        return null;
    }
}

async function fetchMetingSongUrlWithFallback(apiName, server, songId, br) {
    const params = {
        server: mapMetingServerParam(server),
        type: 'url',
        id: songId
    };
    if (br) params.br = br;

    const upgradeToHttps = (value) => {
        const raw = value == null ? '' : String(value).trim();
        if (!raw) return '';
        if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, 'https://');
        return raw;
    };

    const fetchChuyelAuthorizedUrl = async () => {
        const meta = await fetchChuyelMetingSongMeta(server, songId);
        return meta && meta.url ? meta.url : '';
    };

    const urls = getMetingRequestUrls(apiName, params);
    const attempt = async (requestUrl, useProxy) => {
        const finalUrl = useProxy ? buildProxyEndpointUrl('text-proxy', requestUrl) : requestUrl;
        if (useProxy && !finalUrl) return '';

        // chuyel: `type=url` requires `auth`, which is provided by `type=song` response.
        try {
            const u = new URL(String(requestUrl), window.location.href);
            const hostname = String(u.hostname || '').toLowerCase();
            const pathname = String(u.pathname || '').replace(/\/+$/, '');
            const type = String(u.searchParams.get('type') || '').toLowerCase();
            const auth = String(u.searchParams.get('auth') || '').trim();
            if (hostname === 'musicapi.chuyel.top' && pathname === '/api' && type === 'url') {
                if (auth) return upgradeToHttps(requestUrl);
                const authorized = await fetchChuyelAuthorizedUrl();
                if (authorized) return authorized;
                return '';
            }
        } catch (e) {
            // ignore and continue normal flow
        }
        try {
            const response = await fetch(finalUrl, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': '*/*' },
                redirect: 'manual'
            });

            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('Location');
                if (location) return location;
            }

            if (!response.ok) return '';

            const contentType = response.headers.get('Content-Type') || '';
            if (/^audio\//i.test(contentType) || /application\/octet-stream/i.test(contentType)) {
                // Some upstreams may respond with an audio stream directly.
                return requestUrl;
            }

            const rawText = await response.text();
            const extracted = extractFirstHttpUrlFromText(rawText);
            return extracted;
        } catch (e) {
            return '';
        }
    };

    for (const url of urls) {
        let result = '';
        for (let tryIndex = 1; tryIndex <= 2; tryIndex += 1) {
            result = await attempt(url, false);
            if (result) return result;
            if (tryIndex < 2) await new Promise((resolve) => setTimeout(resolve, 220));
        }
        result = await attempt(url, true);
        if (result) return result;
    }

    return '';
}
// 歌词手动滑动相关变量
let isManualScrolling = false;
let scrollTimeout = null;
let isAutoScrollingLyrics = false;
let lyricsAutoScrollToken = 0;
let lyricsAutoScrollEndTimer = null;
// Put the active line slightly above center so it doesn't feel "too low" on screen.
const LYRICS_ACTIVE_LINE_TARGET_RATIO = 0.42;

const PROXY_BASE_URL_STORAGE_KEY = 'hjwjb_proxy_base_url_v1';
const PROXY_ACTIVE_BASE_URL_STORAGE_KEY = 'hjwjb_proxy_base_url_active_v1';
const PROXY_DISABLED_STORAGE_KEY = 'hjwjb_proxy_disabled_v1';
// Proxy base URLs must implement `/text-proxy` (and ideally `/audio-proxy`).
// NOTE: `` is an API2 backend (QQ) and does NOT provide these proxy routes.
const DEFAULT_PROXY_BASE_URLS = ['/'];
const API7_KEY_STORAGE_KEY = 'hjwjb_api7_key';
const API7_DEFAULT_KEYS = [
    'oiapi-5a9f214b-6523-9144-91a8-569ab3a41e36',
    'oiapi-148cca90-908f-51da-fe96-2349ac30051a'
];
const API7_SAVED_PLAYLISTS_STORAGE_KEY = 'hjwjb_api7_saved_playlists_v1';
const MOTION_ENABLED_STORAGE_KEY = 'hjwjb_motion_enabled_v1';
const STREAM_LIGHT_ENABLED_STORAGE_KEY = 'hjwjb_stream_light_enabled_v1';
const LYRICS_OFFSET_SECONDS_STORAGE_KEY = 'hjwjb_lyrics_offset_seconds_v1';
const LYRICS_COLLAPSED_STORAGE_KEY = 'hjwjb_lyrics_collapsed_v1';
const DAILY_QUOTE_STORAGE_KEY = 'hjwjb_daily_quote_v1';
const DOWNLOAD_CAPABILITIES_STORAGE_KEY = 'hjwjb_download_capabilities_v1';
const DOWNLOAD_CAPABILITIES_MAX_SONGS = 300;
const QQ_GROUP_NUMBER = '725614306';

let lyricsOffsetSeconds = 0;
let isLyricsCollapsed = false;
let lyricsCollapseBound = false;
let isMotionEnabled = true;
let isStreamLightEnabled = false;
let settingsMenuBound = false;
let isDailyQuoteLoading = false;
let dailyQuoteLastFetchAt = 0;
let audioAutoResumeToken = 0;
let initHasRun = false;
let eventsBound = false;
let autoResumeTimer = 0;
let autoResumeInFlight = false;
let autoResumeLastAttemptAt = 0;
const AUTO_RESUME_MIN_INTERVAL_MS = 1600;

function scheduleAutoResumePlayback(reason, { delayMs = 0 } = {}) {
    try {
        if (!isPlaying || !Array.isArray(playlist) || playlist.length === 0) return false;
        if (!audioPlayer) return false;
        if (!audioPlayer.paused) return false;

        // Avoid fighting with in-flight playback init/recovery.
        if (handlePlaybackInProgress) return false;
        if (audioErrorRecoveryPromise) return false;

        // Don't auto-retry when the circuit is open (weak network / repeated failures).
        try {
            if (typeof isPlaybackCircuitOpen === 'function' && isPlaybackCircuitOpen()) return false;
        } catch (e) {
            // ignore
        }

        // Multi-tab: try to claim leadership when resuming, otherwise skip (avoids multiple tabs autoplay).
        try { claimPlayerLeader(`autoResume:${String(reason || '')}`, { force: true }); } catch {}
        try {
            if (typeof isPlayerLeader === 'function' && !isPlayerLeader()) return false;
        } catch (e) {
            // ignore
        }

        const now = Date.now();
        if (now - autoResumeLastAttemptAt < AUTO_RESUME_MIN_INTERVAL_MS) return false;
    } catch (e) {
        return false;
    }

    const token = ++audioAutoResumeToken;
    if (autoResumeTimer) window.clearTimeout(autoResumeTimer);
    autoResumeTimer = window.setTimeout(() => {
        autoResumeTimer = 0;
        attemptAutoResumePlayback(reason, token);
    }, Math.max(0, Number(delayMs) || 0));
    return true;
}

async function attemptAutoResumePlayback(reason, token) {
    const now = Date.now();
    if (autoResumeInFlight) return;
    if (now - autoResumeLastAttemptAt < AUTO_RESUME_MIN_INTERVAL_MS) return;
    autoResumeLastAttemptAt = now;
    autoResumeInFlight = true;

    try {
        if (token !== audioAutoResumeToken) return;
        if (!isPlaying || !Array.isArray(playlist) || playlist.length === 0) return;
        if (!audioPlayer || !audioPlayer.paused) return;
        if (handlePlaybackInProgress || audioErrorRecoveryPromise) return;

        try {
            if (typeof isPlaybackCircuitOpen === 'function' && isPlaybackCircuitOpen()) return;
        } catch (e) {
            // ignore
        }

        try { claimPlayerLeader(`autoResume:${String(reason || '')}:attempt`, { force: true }); } catch {}
        try {
            if (typeof isPlayerLeader === 'function' && !isPlayerLeader()) return;
        } catch (e) {
            // ignore
        }

        // If src is missing (previous failure cleaned it), re-init via playSong.
        const hasSrc = !!(audioPlayer.currentSrc || audioPlayer.src);
        if (!hasSrc) {
            if (Number.isInteger(currentSongIndex) && currentSongIndex >= 0) {
                requestPlaySong(currentSongIndex, { debounceMs: 0, reason: `autoResume:${String(reason || '')}` });
            }
            return;
        }

        await audioPlayer.play();
        if (token !== audioAutoResumeToken) return;

        isPlaying = true;
        try { playIcon.className = 'fas fa-pause'; } catch {}
        try { touchPlayerLeaderHeartbeat(); } catch {}
        try { broadcastPlaybackClaim(); } catch {}
        updateMediaSessionPlaybackState();
        console.log('✅ 自动恢复播放成功:', reason);
    } catch (error) {
        if (token !== audioAutoResumeToken) return;
        if (error && error.name === 'AbortError') return;
        console.error('❌ 自动恢复播放失败:', error);

        // Avoid retry storm: stop auto-resume and let user click play.
        if (!isPlaying) return;
        isPlaying = false;
        try { playIcon.className = 'fas fa-play'; } catch {}
        updateMediaSessionPlaybackState();
        createDanmaku('播放被系统打断，请点击播放继续');
        try { recordPlaybackFailure('autoResume', { reason: String(reason || ''), message: String(error && error.message ? error.message : '') }); } catch {}
    } finally {
        autoResumeInFlight = false;
    }
}

function isFirefoxBrowser() {
    try {
        // eslint-disable-next-line no-undef
        if (typeof InstallTrigger !== 'undefined') return true;
    } catch (e) {
        // ignore
    }
    try {
        const ua = String(navigator && navigator.userAgent ? navigator.userAgent : '').toLowerCase();
        return ua.includes('firefox') && !ua.includes('seamonkey');
    } catch (e) {
        return false;
    }
}

const ALWAYS_REVEAL_LYRICS = isFirefoxBrowser();

function setLyricsRevealAll(enabled) {
    try {
        if (!lyricsContainer) return;
        if (ALWAYS_REVEAL_LYRICS) {
            lyricsContainer.classList.add('lyrics-reveal-all');
            return;
        }
        lyricsContainer.classList.toggle('lyrics-reveal-all', !!enabled);
    } catch (e) {
        // ignore
    }
}

function markLyricsManualScroll() {
    isManualScrolling = true;
    setLyricsRevealAll(true);
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        isManualScrolling = false;
        setLyricsRevealAll(false);
        try {
            const baseTime = audioPlayer && typeof audioPlayer.currentTime === 'number' ? audioPlayer.currentTime : 0;
            updateLyrics(baseTime + lyricsOffsetSeconds);
        } catch (e) {
            // ignore
        }
    }, 3000); // 3秒延迟后恢复自动滚动
}

function isCompactLayout() {
    try {
        return window.matchMedia && window.matchMedia('(max-width: 992px)').matches;
    } catch (e) {
        return false;
    }
}

function applyLyricsCollapseState() {
    try {
        if (lyricsContainer) {
            lyricsContainer.classList.toggle('lyrics-collapsed', !!isLyricsCollapsed);
        }
    } catch (e) {
        // ignore
    }

    try {
        document.body.classList.toggle('lyrics-collapsed', !!isLyricsCollapsed);
    } catch (e) {
        // ignore
    }

    try {
        const titleEl = document.querySelector('.middle-section .section-title');
        if (titleEl) {
            titleEl.classList.add('lyrics-toggle-title');
            titleEl.setAttribute('aria-expanded', String(!isLyricsCollapsed));
            titleEl.setAttribute('title', isLyricsCollapsed ? '点击展开歌词' : '点击收起歌词');
        }
    } catch (e) {
        // ignore
    }
}

function loadLyricsCollapseSettings() {
    let value = null;
    try {
        const raw = String(localStorage.getItem(LYRICS_COLLAPSED_STORAGE_KEY) || '').trim().toLowerCase();
        if (raw === 'true') value = true;
        if (raw === 'false') value = false;
    } catch (e) {
        value = null;
    }

    if (value == null) value = isCompactLayout();
    isLyricsCollapsed = !!value;
    applyLyricsCollapseState();
}

function setLyricsCollapsed(collapsed, { persist = true } = {}) {
    isLyricsCollapsed = !!collapsed;
    if (persist) {
        try {
            localStorage.setItem(LYRICS_COLLAPSED_STORAGE_KEY, String(isLyricsCollapsed));
        } catch (e) {
            // ignore
        }
    }
    applyLyricsCollapseState();
}

function toggleLyricsCollapsed() {
    setLyricsCollapsed(!isLyricsCollapsed);
}

function setupLyricsCollapseToggle() {
    if (lyricsCollapseBound) return;
    if (!lyricsContainer) return;
    const titleEl = document.querySelector('.middle-section .section-title');
    if (!titleEl) return;
    lyricsCollapseBound = true;

    try {
        titleEl.classList.add('lyrics-toggle-title');
        titleEl.setAttribute('role', 'button');
        titleEl.setAttribute('tabindex', '0');
        titleEl.setAttribute('aria-controls', 'lyrics-container');
    } catch (e) {
        // ignore
    }

    titleEl.addEventListener('click', (e) => {
        e.preventDefault();
        toggleLyricsCollapsed();
    });

    titleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleLyricsCollapsed();
        }
    });
}

function bumpLyricsAutoScrollGuard(token) {
    isAutoScrollingLyrics = true;
    if (lyricsAutoScrollEndTimer) clearTimeout(lyricsAutoScrollEndTimer);
    // scroll 事件常常异步触发，稍微延迟关闭 guard，避免把程序滚动误判成手动滚动
    lyricsAutoScrollEndTimer = setTimeout(() => {
        if (token === lyricsAutoScrollToken) isAutoScrollingLyrics = false;
    }, 200);
}
// 弹幕系统相关变量
let isBarrageEnabled = false; // 弹幕开关状态（默认关闭）
// 主题相关变量
let currentTheme = 'neutral'; // 默认使用中性主题，可选值: neutral, light, dark

// 逐字歌词开关（优先启用 QQ/网易云 的 yrc，以及酷我 API4 的逐字 LRCX；其他来源仍展示普通歌词）
let isWordLyricsEnabled = false;
const WORD_LYRICS_ENABLED_STORAGE_KEY = 'hjwjb_word_lyrics_enabled_v1';
const BAKA_METING_LRC_ENDPOINT = 'https://api.baka.plus/meting/';
// Kuwo (API4) word-timing lyrics (LRCX) provider.
const API4_WORD_LYRICS_BASE_URL = '';

// 音质切换相关变量
let isHighestQualityMode = true; // 是否为最高音质模式，默认最高音质

// 流光效果相关变量
const streamLightElement = null;

// 添加调试日志
console.log('📺 初始化 isBarrageEnabled:', isBarrageEnabled);

// DOM元素
const audioPlayer = document.getElementById('audio-player');
const currentCover = document.getElementById('current-cover');
const currentSong = document.getElementById('current-song');
const currentArtist = document.getElementById('current-artist');
const currentAlbum = document.getElementById('current-album');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const progressBar = document.querySelector('.progress-bar');
const progress = document.getElementById('progress');
const prevBtn = document.getElementById('prev-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const playIcon = document.getElementById('play-icon');
const nextBtn = document.getElementById('next-btn');
const lyricsContainer = document.getElementById('lyrics-container');
const playlistContainer = document.getElementById('playlist-container');
const deleteAllBtn = document.querySelector('.delete-all-btn');
const surpriseBtn = document.querySelector('.surprise-btn');
const importBtn = document.querySelector('.import-btn');
const exportBtn = document.querySelector('.export-btn');
const apiSelect = document.getElementById('api-select'); // API选择器
const qualitySelect = document.getElementById('quality-select'); // 音质选择器
const qualitySwitchBtn = document.getElementById('quality-switch-btn'); // 音质切换按钮
const api2StatsPanel = document.getElementById('api2-stats');
const api2StatsCountEl = document.getElementById('api2-stats-count');
const api2StatsDescEl = api2StatsPanel ? api2StatsPanel.querySelector('.api2-stats-desc') : null;

// Firefox 下默认关闭歌词顶部遮罩（避免“上半部分发黑/歌词被遮住”的观感）
setLyricsRevealAll(false);

// API 可用的音乐源（用于音乐源切换与兜底）
const api2Sources = ['QQ音乐', '酷狗音乐'];
const api3Sources = ['网易云音乐'];
const api4Sources = ['酷我音乐'];
const api7Sources = ['QQ音乐'];
const api8Sources = ['网易云音乐'];
const api9Sources = ['网易云音乐', 'QQ音乐'];
const api10Sources = api9Sources.slice();

let apiSources = api10Sources.slice();

function ensureApiSelectOptions() {
    if (!apiSelect) return;
    const options = [
        { value: 'api3', label: 'API 3' },
        { value: 'api4', label: 'API 4' },
        { value: 'api7', label: 'API 7' },
        { value: 'api8', label: 'API 8' },
        { value: 'api9', label: 'API 9' },
        { value: 'api10', label: 'API 10' }
    ];

    apiSelect.innerHTML = options
        .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
        .join('');

    if (options.some((opt) => opt.value === currentApi)) {
        apiSelect.value = currentApi;
    }
}

// ========================================
   // 存储管理器 - 防抖优化 localStorage 操作
// ========================================
// 确保 StorageManager 正确初始化
(function() {
    // 如果 window.StorageManager 已经存在且有 getItem 方法，直接使用
    if (window.StorageManager && typeof window.StorageManager.getItem === 'function') {
        return;
    }
    
    // 否则创建完整的 StorageManager
    window.StorageManager = {
        pendingWrites: new Map(),
        writeTimeout: null,

        setItem(key, value) {
            this.pendingWrites.set(key, typeof value === 'string' ? value : JSON.stringify(value));
            if (this.writeTimeout) clearTimeout(this.writeTimeout);
            this.writeTimeout = setTimeout(() => this.flush(), 100);
        },

        flush() {
            this.pendingWrites.forEach((value, key) => {
                try { localStorage.setItem(key, value); } catch (e) { console.error(`保存 ${key} 失败:`, e); }
            });
            this.pendingWrites.clear();
        },

        getItem(key, defaultValue = null) {
            try {
                const value = localStorage.getItem(key);
                return value === null ? defaultValue : JSON.parse(value);
            } catch (e) { return defaultValue; }
        },

        removeItem(key) {
            this.pendingWrites.delete(key);
            localStorage.removeItem(key);
        }
    };
})();

// 获取引用供当前脚本使用
const StorageManager = window.StorageManager;

// ========================================
// 错误处理中间件
// ========================================
const ErrorHandler = {
    handlers: new Map(),

    register(errorType, handler) {
        this.handlers.set(errorType, handler);
    },

    handle(error, context = '未知操作') {
        console.error(`❌ ${context}失败:`, error);
        const errorType = this.getErrorType(error);
        const handler = this.handlers.get(errorType) || this.defaultHandler;
        handler.call(this, error, context);
    },

    getErrorType(error) {
        if (error.name === 'NetworkError') return 'network';
        if (error.name === 'TypeError') return 'type';
        if (error.code === 'quota_exceeded') return 'storage';
        return 'unknown';
    },

    defaultHandler(error, context) {
        const messages = {
            network: '🌐 网络连接失败，请检查网络后重试',
            type: '📝 数据格式错误，请稍后重试',
            storage: '💾 存储空间不足，请清理缓存',
            unknown: `❌ ${context}失败，请稍后重试`
        };
        createDanmaku(messages[this.getErrorType(error)] || messages.unknown);
    },

    wrap(asyncFn, context) {
        return async (...args) => {
            try { return await asyncFn(...args); }
            catch (error) { this.handle(error, context); return null; }
        };
    }
};

ErrorHandler.register('network', (error, context) => createDanmaku('🌐 网络连接失败，请检查网络后重试'));
ErrorHandler.register('storage', (error, context) => createDanmaku('💾 本地存储已满，请清理后再试'));

// ========================================
// Blob URL 内存管理器（优先使用共享实现）
// ========================================
const usingFallbackBlobManager = !window.BlobManager;
const BlobManager = window.BlobManager || {
    urls: new Map(),

    create(blob, key) {
        const url = URL.createObjectURL(blob);
        const mapKey = key != null ? key : url;
        // Avoid leaking old object URLs when reusing the same key.
        if (this.urls.has(mapKey)) {
            try {
                const prev = this.urls.get(mapKey);
                if (prev && prev.url) URL.revokeObjectURL(prev.url);
            } catch (e) {
                // ignore
            }
        }
        const info = { url, key: mapKey, createdAt: Date.now() };
        this.urls.set(mapKey, info);
        if (this.urls.size > 50) this.cleanupOldest(10);
        return url;
    },

    revoke(keyOrUrl) {
        if (this.urls.has(keyOrUrl)) {
            const info = this.urls.get(keyOrUrl);
            URL.revokeObjectURL(info.url);
            this.urls.delete(keyOrUrl);
            return;
        }
        this.revokeUrl(keyOrUrl);
    },

    revokeUrl(url) {
        this.urls.forEach((info, key) => {
            if (info.url === url) {
                URL.revokeObjectURL(info.url);
                this.urls.delete(key);
            }
        });
    },

    cleanupOldest(count) {
        const sorted = Array.from(this.urls.entries())
            .sort((a, b) => a[1].createdAt - b[1].createdAt)
            .slice(0, count);
        sorted.forEach(([key, info]) => {
            URL.revokeObjectURL(info.url);
            this.urls.delete(key);
        });
    },

    cleanupAll() {
        this.urls.forEach((info) => {
            URL.revokeObjectURL(info.url);
        });
        this.urls.clear();
    },

    getStats() {
        const oldest = Array.from(this.urls.values())
            .sort((a, b) => a.createdAt - b.createdAt)[0];
        return { count: this.urls.size, oldest: oldest || null };
    }
};

if (usingFallbackBlobManager) {
    window.addEventListener('beforeunload', () => BlobManager.cleanupAll());
}

// ========================================
// 通用模态框组件
// ========================================
const Modal = {
    escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    create(options = {}) {
        const { title = '', content = '', buttons = [], onClose = null, style = '' } = options;
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        if (style) {
            const styleEl = document.createElement('style');
            styleEl.textContent = style;
            document.head.appendChild(styleEl);
        }

        modalContent.innerHTML = `
            <div class="modal-header"><h3>${title}</h3><button class="modal-close-btn" type="button" aria-label="关闭">×</button></div>
            <div class="modal-body">${content}</div>
            ${buttons.length ? '<div class="modal-footer"></div>' : ''}
        `;

        const footer = modalContent.querySelector('.modal-footer');
        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = `modal-btn ${btn.className || ''}`;
            button.textContent = btn.text;
            button.type = 'button';
            button.addEventListener('click', () => { if (btn.onClick) btn.onClick(); if (btn.close !== false) modal.remove(); });
            footer.appendChild(button);
        });

        const closeBtn = modalContent.querySelector('.modal-close-btn');
        closeBtn.addEventListener('click', () => { modal.remove(); if (onClose) onClose(); });
        modal.addEventListener('click', (e) => { if (e.target === modal) { modal.remove(); if (onClose) onClose(); } });
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        return modal;
    },

    prompt(options = {}) {
        const {
            title = '请输入',
            message = '',
            defaultValue = '',
            placeholder = '',
            okText = '确定',
            cancelText = '取消',
            inputType = 'text',
            inputMode = '',
            returnFocusTo = null,
            onConfirm = null,
            onCancel = null
        } = options;

        const inputId = `modal-input-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const safeTitle = this.escapeHtml(title);
        const safeMessage = this.escapeHtml(message);
        const safePlaceholder = this.escapeHtml(placeholder);
        const safeInputType = this.escapeHtml(inputType);
        const safeInputMode = this.escapeHtml(inputMode);

        const content = `
            ${message ? `<div class="modal-message">${safeMessage}</div>` : ''}
            <div class="modal-input-row">
                <input
                    id="${inputId}"
                    class="modal-input"
                    type="${safeInputType}"
                    ${inputMode ? `inputmode="${safeInputMode}"` : ''}
                    placeholder="${safePlaceholder}"
                    autocomplete="off"
                    spellcheck="false"
                />
                <div class="modal-error" style="display:none"></div>
            </div>
        `;

        const prevActive = document.activeElement;
        const focusBackTo = returnFocusTo || prevActive;
        let modal = null;
        let inputEl = null;
        let errorEl = null;
        let closed = false;

        const setError = (msg) => {
            if (!errorEl) return;
            const text = String(msg || '').trim();
            if (!text) {
                errorEl.textContent = '';
                errorEl.style.display = 'none';
                return;
            }
            errorEl.textContent = text;
            errorEl.style.display = '';
        };

        const cleanup = () => {
            try {
                document.removeEventListener('keydown', onKeyDown, true);
            } catch (e) {
                // ignore
            }
            try {
                if (modal) modal.remove();
            } catch (e) {
                // ignore
            }
            try {
                if (focusBackTo && typeof focusBackTo.focus === 'function') focusBackTo.focus({ preventScroll: true });
            } catch (e) {
                // ignore
            }
        };

        const close = () => {
            if (closed) return;
            closed = true;
            cleanup();
        };

        const handleCancel = () => {
            if (closed) return;
            try {
                if (typeof onCancel === 'function') onCancel();
            } catch (e) {
                // ignore
            }
            close();
        };

        const handleOk = () => {
            if (closed) return;
            setError('');
            const value = inputEl ? String(inputEl.value || '') : '';
            let shouldClose = true;
            try {
                if (typeof onConfirm === 'function') {
                    const result = onConfirm(value, setError);
                    if (result === false) shouldClose = false;
                }
            } catch (e) {
                shouldClose = false;
                setError(e && e.message ? e.message : '输入有误，请重试');
            }
            if (shouldClose) close();
        };

        const onKeyDown = (e) => {
            if (!modal) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                handleCancel();
                return;
            }
            if (e.key === 'Enter') {
                if (inputEl && e.target === inputEl) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleOk();
                }
            }
        };

        modal = this.create({
            title: safeTitle,
            content,
            buttons: [
                { text: cancelText, className: 'modal-btn-secondary', close: false, onClick: handleCancel },
                { text: okText, className: 'modal-btn-primary', close: false, onClick: handleOk }
            ],
            onClose: handleCancel
        });

        try {
            inputEl = modal.querySelector(`#${inputId}`);
            errorEl = modal.querySelector('.modal-error');
            if (inputEl) {
                inputEl.value = String(defaultValue ?? '');
                inputEl.focus({ preventScroll: true });
                try {
                    inputEl.select();
                } catch (e) {
                    // ignore
                }
            }
        } catch (e) {
            // ignore
        }

        try {
            document.addEventListener('keydown', onKeyDown, true);
        } catch (e) {
            // ignore
        }

        return modal;
    },

    confirm(message, onConfirm, onCancel) {
        return this.create({
            title: '确认操作',
            content: `<div class="modal-message">${this.escapeHtml(message)}</div>`,
            buttons: [
                { text: '取消', className: 'modal-btn-secondary', onClick: onCancel },
                { text: '确定', className: 'modal-btn-primary', onClick: onConfirm }
            ]
        });
    },

    alert(message, onClose) {
        return this.create({
            title: '提示',
            content: `<div class="modal-message">${this.escapeHtml(message)}</div>`,
            buttons: [{ text: '确定', className: 'modal-btn-primary', onClick: onClose }],
        });
    }
};

function openCopyTextModal(options = {}) {
    const {
        title = '复制',
        message = '复制下面内容：',
        text = '',
        autoCopy = false,
        returnFocusTo = null
    } = options;

    const textareaId = `copy-text-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const safeTitle = Modal.escapeHtml(title);
    const safeMessage = Modal.escapeHtml(message);
    const safeText = Modal.escapeHtml(String(text ?? ''));
    const rows = Math.min(10, Math.max(4, String(text ?? '').split('\n').length + 1));

    const prevActive = document.activeElement;
    const focusBackTo = returnFocusTo || prevActive;

    const modal = Modal.create({
        title: safeTitle,
        content: `
            <div class="modal-message">${safeMessage}</div>
            <div class="modal-input-row">
                <textarea id="${textareaId}" class="modal-input" rows="${rows}" readonly>${safeText}</textarea>
                <div class="modal-error" style="display:none"></div>
            </div>
        `,
        buttons: [
            {
                text: '复制',
                className: 'modal-btn-primary',
                close: false,
                onClick: () => {
                    doCopy();
                }
            },
            {
                text: '关闭',
                className: 'modal-btn-secondary',
                close: false,
                onClick: () => {
                    try {
                        modal.remove();
                    } catch (e) {
                        // ignore
                    }
                    focusBack();
                }
            }
        ],
        onClose: () => {
            focusBack();
        }
    });

    const textarea = modal.querySelector(`#${textareaId}`);
    const hintEl = modal.querySelector('.modal-error');

    const setHint = (msg, kind = 'error') => {
        if (!hintEl) return;
        const textMsg = String(msg || '').trim();
        if (!textMsg) {
            hintEl.textContent = '';
            hintEl.style.display = 'none';
            hintEl.classList.remove('success');
            return;
        }
        hintEl.textContent = textMsg;
        hintEl.style.display = '';
        hintEl.classList.toggle('success', kind === 'success');
    };

    const focusBack = () => {
        try {
            if (focusBackTo && typeof focusBackTo.focus === 'function') {
                focusBackTo.focus({ preventScroll: true });
            }
        } catch (e) {
            // ignore
        }
    };

    const selectTextarea = () => {
        try {
            if (textarea) {
                textarea.focus({ preventScroll: true });
                textarea.select();
            }
        } catch (e) {
            // ignore
        }
    };

    const doCopy = () => {
        setHint('');
        selectTextarea();

        try {
            if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(String(text ?? '')).then(
                    () => {
                        setHint('已复制到剪贴板', 'success');
                        try {
                            if (isBarrageEnabled) createDanmaku('已复制');
                        } catch (e) {
                            // ignore
                        }
                    },
                    () => {
                        setHint('复制失败，请长按/手动复制', 'error');
                    }
                );
                return;
            }
        } catch (e) {
            // ignore
        }

        setHint('当前环境不支持一键复制，请长按/手动复制', 'error');
    };

    // initial focus/select
    selectTextarea();

    if (autoCopy) {
        doCopy();
    }

    return modal;
}

function setDailyQuoteText(text) {
    const value = String(text || '').trim();
    const el = document.getElementById('daily-quote-text');
    if (el) {
        el.textContent = value || '点击“惊喜按钮”获取';
        el.title = value || '';
    }
    try {
        if (value) localStorage.setItem(DAILY_QUOTE_STORAGE_KEY, value);
    } catch (e) {
        // ignore
    }
}

function loadDailyQuoteText() {
    try {
        const saved = String(localStorage.getItem(DAILY_QUOTE_STORAGE_KEY) || '').trim();
        if (saved) setDailyQuoteText(saved);
    } catch (e) {
        // ignore
    }
}

function setDailyQuoteLoadingState(isLoading) {
    const panel = document.getElementById('daily-quote-panel');
    if (panel) panel.setAttribute('aria-busy', isLoading ? 'true' : 'false');

    const btn = document.getElementById('daily-quote-refresh-btn');
    if (!btn) return;
    btn.disabled = !!isLoading;
    btn.innerHTML = isLoading
        ? '<i class="fas fa-spinner fa-spin"></i> 刷新中'
        : '<i class="fas fa-rotate-right"></i> 刷新';
}

function extractQuoteContentFromAny(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    if (typeof data !== 'object') return '';

    if (typeof data.content === 'string' && data.content.trim()) return data.content;
    if (typeof data.text === 'string' && data.text.trim()) return data.text;

    if (data.data != null) {
        if (typeof data.data === 'string' && data.data.trim()) return data.data;
        if (typeof data.data === 'object') {
            if (typeof data.data.content === 'string' && data.data.content.trim()) return data.data.content;
            if (typeof data.data.text === 'string' && data.data.text.trim()) return data.data.text;
        }
    }

    for (const key of Object.keys(data)) {
        const v = data[key];
        if (typeof v === 'string' && v.trim()) return v;
        if (v && typeof v === 'object') {
            const nested = extractQuoteContentFromAny(v);
            if (nested) return nested;
        }
    }

    return '';
}

function normalizeQuoteText(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchDailyQuoteFromApi() {
    const url = 'https://openapi.dwo.cc/api/saohua';
    const resp = await fetch(url, {
        mode: 'cors',
        headers: { 'Accept': 'application/json, text/plain' }
    });

    const text = await resp.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        data = { content: text };
    }

    const content = normalizeQuoteText(extractQuoteContentFromAny(data) || text);
    if (!resp.ok) {
        const err = new Error(`HTTP ${resp.status}`);
        err.status = resp.status;
        err.body = text;
        throw err;
    }
    return content;
}

async function refreshDailyQuote(options = {}) {
    const { reason = 'manual' } = options;

    if (isDailyQuoteLoading) return '';

    const now = Date.now();
    if (reason === 'manual' && now - dailyQuoteLastFetchAt < 800) return '';
    dailyQuoteLastFetchAt = now;

    isDailyQuoteLoading = true;
    setDailyQuoteLoadingState(true);

    try {
        const content = await fetchDailyQuoteFromApi();
        if (!content) throw new Error('empty quote');

        setDailyQuoteText(content);

        if (reason === 'surprise') {
            if (isBarrageEnabled) {
                createDanmaku(`🎈 每日一言：${content}`, true);
            } else {
                openCopyTextModal({
                    title: '每日一言',
                    message: '已获取到内容（可复制）：',
                    text: content,
                    autoCopy: false,
                    returnFocusTo: surpriseBtn
                });
            }
        } else if (reason === 'manual') {
            if (isBarrageEnabled) createDanmaku('每日一言已刷新');
        }

        return content;
    } catch (error) {
        console.error('❌ 获取每日一言失败:', error);
        if (reason !== 'init') {
            if (isBarrageEnabled) createDanmaku('获取每日一言失败');
            else Modal.alert('获取每日一言失败（网络或接口异常）');
        }
        return '';
    } finally {
        setDailyQuoteLoadingState(false);
        isDailyQuoteLoading = false;
    }
}

function setupDailyQuoteControls() {
    const btn = document.getElementById('daily-quote-refresh-btn');
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            refreshDailyQuote({ reason: 'manual' }).catch(() => {});
        });
    }
}

function setupFooterLinks() {
    const copyBtn = document.getElementById('copy-group-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openCopyTextModal({
                title: '进群',
                message: '群号已准备好，复制后在 QQ 搜索加入：',
                text: QQ_GROUP_NUMBER,
                autoCopy: true,
                returnFocusTo: copyBtn
            });
        });
    }

    const joinLink = document.getElementById('join-group-link');
    if (joinLink) {
        joinLink.addEventListener('click', () => {
            // Best-effort: click join link also copies group number for convenience.
            try {
                if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(QQ_GROUP_NUMBER).catch(() => {});
                }
            } catch (e) {
                // ignore
            }
        });
    }
}

// ========================================
// 歌曲播放管理器 - 单一职责函数
// ========================================
function loadSongInfo(song) {
    currentSong.textContent = song.title;
    currentArtist.textContent = song.artist;
    currentAlbum.textContent = song.album;
}

async function setupCoverImage(song) {
    const coverUrl = song && song.cover ? processAudioUrl(song.cover) : '';
    currentCover.src = coverUrl || 'IMG_20251115_090141.png';
}

async function fetchApi3SongInfo(song, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const force = !!opts.force;
    if (!song || String(song.api || '') !== 'api3') return song;

    const idRaw = song.id ?? song.songid ?? song.musicId ?? song.rid;
    const id = idRaw == null ? '' : String(idRaw).trim();
    if (!id) return song;

    const hasUrl = (() => {
        const url = song && song.url != null ? String(song.url).trim() : '';
        if (!url) return false;
        return isValidAudioUrl(url);
    })();

    const hasCover = (() => {
        const cover = song && song.cover != null ? String(song.cover).trim() : '';
        if (!cover) return false;
        if (/^blob:/i.test(cover)) return false;
        return true;
    })();

    const hasLyrics = (() => {
        if (!song) return false;
        if (typeof song.lyrics === 'string') return !!String(song.lyrics).trim();
        if (!Array.isArray(song.lyrics) || !song.lyrics.length) return false;
        if (lyricsLooksUnparsed(song.lyrics)) return false;
        return true;
    })();

    // Already good enough: skip network.
    if (!force && hasUrl && hasCover && hasLyrics) return song;

    const requestedQuality = opts.quality != null ? opts.quality : (opts.level != null ? opts.level : currentQuality);
    const candidates = getApi3LevelCandidates(requestedQuality);

    let chosenLevel = '';

    for (const level of candidates) {
        const apiUrl = buildApi3Url({ ids: id, type: 'json', level });
        if (!apiUrl) continue;

        const data = await fetchJsonWithOptionalProxy(apiUrl, { useProxy: false });
        if (!data) continue;

        const payload = pickApi3Payload(data, id);
        if (!payload || typeof payload !== 'object') continue;

        // Cover
        const coverRaw =
            payload.pic ??
            payload.cover ??
            payload.picUrl ??
            payload.picurl ??
            payload.img ??
            payload.image ??
            payload.coverUrl ??
            payload.cover_url ??
            '';
        const cover = coverRaw != null ? String(coverRaw).trim() : '';
        if (cover) song.cover = cover;

        // Lyrics
        const lyricNode = payload.lyrics ?? payload.lyric ?? payload.lrc ?? payload.text ?? payload.Lyric;
        try {
            if (typeof lyricNode === 'string' && lyricNode.trim()) {
                song.lyrics = parseLRC(lyricNode);
            } else if (Array.isArray(lyricNode)) {
                song.lyrics = lyricNode;
            }
        } catch (e) {
            // ignore
        }

        const urlRaw = payload.url ?? payload.playUrl ?? payload.play_url ?? payload.songUrl ?? payload.song_url ?? '';
        const url = urlRaw != null ? String(urlRaw).trim() : '';
        if (url && /^https?:\/\//i.test(url)) {
            chosenLevel = String(level || '').trim();
            break;
        }
    }

    // Playback: prefer the API endpoint (`type=down`) to avoid CDN hotlink issues.
    const finalLevel = chosenLevel || normalizeApi3Level(requestedQuality);
    const downUrl = buildApi3DownUrl(id, finalLevel);
    if (downUrl && (force || !hasUrl || !String(song.url || '').includes('api.bugpk.com/api/163_music'))) {
        song.url = downUrl;
        song.urlRefreshedAt = Date.now();
    }

    // Persist if this song exists in playlist.
    try {
        const sid = String(id);
        let idx = -1;
        if (Number.isInteger(opts.index)) {
            idx = opts.index;
        } else if (
            Number.isInteger(currentSongIndex) &&
            playlist &&
            playlist[currentSongIndex] &&
            String(playlist[currentSongIndex].id ?? '').trim() === sid
        ) {
            idx = currentSongIndex;
        } else if (Array.isArray(playlist)) {
            idx = playlist.findIndex((s) => s && String(s.id ?? '').trim() === sid && String(s.api || '') === 'api3');
        }

        if (idx >= 0 && idx < playlist.length) {
            playlist[idx] = song;
            savePlaylist();
        }
    } catch (e) {
        // ignore
    }

    return song;
}

function buildApi4Url(params) {
    try {
        const url = new URL(API4_BASE_URL);
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value == null || value === '') return;
            url.searchParams.set(String(key), String(value));
        });
        return url.toString();
    } catch (e) {
        return '';
    }
}

function buildApi4WordLyricsUrl(params) {
    try {
        const url = new URL('/api/lrcx', API4_WORD_LYRICS_BASE_URL);
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value == null || value === '') return;
            url.searchParams.set(String(key), String(value));
        });
        return url.toString();
    } catch (e) {
        return '';
    }
}

function getApi4LevelCandidates(brValue) {
    const br = normalizeBrQuality(brValue);
    if (br === '999') return ['hires', 'lossless', 'exhigh', 'standard'];
    if (br === '740') return ['lossless', 'exhigh', 'standard'];
    if (br === '128') return ['standard'];
    // 320 / 192: API4 doesn't expose a dedicated 192k mp3, so prefer "exhigh" (320 mp3).
    return ['exhigh', 'standard'];
}

async function fetchApi4SongInfoWithFallback(song, { force = false, quality = null } = {}) {
    try {
        if (!song || String(song.api || '') !== 'api4') return song;
        if (!force && song.url && isValidAudioUrl(String(song.url))) return song;

        const idRaw = song.id ?? song.rid ?? song.musicId ?? song.songid;
        const id = idRaw == null ? '' : String(idRaw).trim();
        if (!id) return song;

        const candidates = getApi4LevelCandidates(quality != null ? quality : currentQuality);
        for (const level of candidates) {
            const apiUrl = buildApi4Url({ id, type: 'song', level, format: 'json' });
            if (!apiUrl) continue;

            const data = await fetchJsonWithOptionalProxy(apiUrl, { useProxy: false });
            if (!data) continue;

            const ok = data && (data.code === 200 || data.code === '200');
            const payload = ok && data.data && typeof data.data === 'object' ? data.data : null;
            if (!payload) continue;

            const url = payload.url != null ? String(payload.url).trim() : '';
            if (!url || !/^https?:\/\//i.test(url)) continue;

            song.url = url;
            song.urlRefreshedAt = Date.now();

            const cover = payload.pic != null ? String(payload.pic).trim() : '';
            if (cover) song.cover = cover;

            const title = payload.name != null ? String(payload.name).trim() : '';
            if (title) song.title = title;

            const artist = payload.artist != null ? String(payload.artist).trim() : '';
            if (artist) song.artist = artist;

            const album = payload.album != null ? String(payload.album).trim() : '';
            if (album) song.album = album;

            return song;
        }
    } catch (e) {
        // ignore
    }

    return song;
}

async function fetchApi4SongAudioUrlWithFallback(song, { quality = null } = {}) {
    const updated = await fetchApi4SongInfoWithFallback(song, { force: true, quality });
    return updated && updated.url ? String(updated.url).trim() : '';
}

async function fetchApi4LyricsWithFallback(songId) {
    try {
        const id = songId == null ? '' : String(songId).trim();
        if (!id) return [];

        const apiUrl = buildApi4Url({ id, type: 'lyr', format: 'lineLyric' });
        if (!apiUrl) return [];

        const data = await fetchJsonWithOptionalProxy(apiUrl, { useProxy: false });
        if (!data) return [];

        const ok = data && (data.code === 200 || data.code === '200');
        const payload = ok && data.data && typeof data.data === 'object' ? data.data : null;
        const list = payload && Array.isArray(payload.lrclist) ? payload.lrclist : [];
        if (!list.length) return [];

        return list
            .map((item) => {
                if (!item || typeof item !== 'object') return null;
                const text = item.lineLyric != null ? String(item.lineLyric) : '';
                const time = Number.parseFloat(String(item.time == null ? '' : item.time));
                if (!Number.isFinite(time) || time < 0) return null;
                return { time, text };
            })
            .filter(Boolean);
    } catch (e) {
        return [];
    }
}

async function fetchApi4WordLyricsRawWithFallback(songId) {
    try {
        const rid = songId == null ? '' : String(songId).trim();
        if (!rid) return '';

        const jsonUrl = buildApi4WordLyricsUrl({ rid, format: 'json' });
        const textUrl = buildApi4WordLyricsUrl({ rid });
        const rawUrl = buildApi4WordLyricsUrl({ rid, raw: '1' });
        const accept = 'application/json,text/plain;q=0.9,*/*;q=0.8';

        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        const directTry = async (url) => {
            if (!url) return '';
            for (let attempt = 1; attempt <= 2; attempt += 1) {
                const text = await fetchTextWithOptionalProxy(url, { useProxy: false, accept, timeoutMs: 8000 });
                if (text) return text;
                if (attempt < 2) await sleep(260);
            }
            return '';
        };

        // 直连两次：优先 JSON（parseLRC 会自动从 JSON 中提取 lyric 字段）。
        let text = await directTry(jsonUrl);
        if (text) return text;

        // 兜底：有些时候 JSON 参数可能不可用，尝试纯文本/原始格式。
        text = await directTry(textUrl);
        if (text) return text;
        text = await directTry(rawUrl);
        if (text) return text;

        return '';
    } catch (e) {
        return '';
    }
}

function isKuwoHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    if (host === 'kuwo.cn') return true;
    if (host.endsWith('.kuwo.cn')) return true;
    if (host.endsWith('.sycdn.kuwo.cn')) return true;
    return false;
}

function isProxyDisabled() {
    try {
        return localStorage.getItem(PROXY_DISABLED_STORAGE_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

function buildProxyEndpointUrl(endpoint, targetUrl) {
    if (isProxyDisabled()) return '';
    const base = getProxyBaseUrlSetting();
    if (!base) return '';
    const name = String(endpoint || '').trim().replace(/^\/+/, '');
    if (!name) return '';
    return `${base}${name}?url=${encodeURIComponent(targetUrl)}`;
}

function processAudioUrl(url, options = {}) {
    let raw = String(url || '').trim();
    if (!raw) return url;
    if (/^(blob|data):/i.test(raw)) return raw;

    const opts = options && typeof options === 'object' ? options : {};
    const globallyDisabled = isProxyDisabled();
    const forceProxy = !!opts.forceProxy && !globallyDisabled;
    const disableProxy = globallyDisabled || (!!opts.disableProxy && !forceProxy);

    const extractUpstreamFromAudioProxy = (value) => {
        try {
            const u = new URL(String(value || ''), window.location.href);
            const pathname = String(u.pathname || '').toLowerCase();
            if (!pathname.endsWith('/audio-proxy')) return '';
            const inner = u.searchParams.get('url');
            return inner ? String(inner) : '';
        } catch (e) {
            return '';
        }
    };

    // If URL is already proxied, unwrap it so we can:
    // - attempt direct (disableProxy)
    // - re-proxy with the current active proxy base (forceProxy/auto + failover)
    const unwrapped = extractUpstreamFromAudioProxy(raw);
    if (unwrapped) {
        if (disableProxy) return unwrapped;
        raw = unwrapped;
    }

    let urlObj;
    try {
        urlObj = new URL(raw, window.location.href);
    } catch (e) {
        return raw;
    }

    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') return raw;

    const proxyBase = getProxyBaseUrlSetting();
    const pageIsHttps = !!(window.location && window.location.protocol === 'https:');
    const pageIsFile = !!(window.location && window.location.protocol === 'file:');
    const pageIsSecureLike = pageIsHttps || pageIsFile;

    const kuwo = isKuwoHost(urlObj.hostname);
    const kugou = (() => {
        try {
            const host = String(urlObj.hostname || '').toLowerCase();
            return host === 'kugou.com' || host.endsWith('.kugou.com');
        } catch (e) {
            return false;
        }
    })();
    const directOnly = kugou || kuwo;
    const isSayqzUrlEndpoint = (() => {
        try {
            const host = String(urlObj.hostname || '').toLowerCase();
            if (!host.endsWith('.sayqz.com')) return false;
            const type = String(urlObj.searchParams.get('type') || '').toLowerCase();
            return type === 'url' || type === 'pic';
        } catch (e) {
            return false;
        }
    })();

    const canProxy = !!proxyBase && !disableProxy && !directOnly;

    // Mixed-content: on HTTPS/file pages, browsers usually block loading `http:` media directly.
    // If proxy is disabled for this attempt, prefer upgrading to https first.
    if (pageIsSecureLike && urlObj.protocol === 'http:' && (disableProxy || directOnly)) {
        urlObj.protocol = 'https:';
    }

    // Kugou returns many http://*.kugou.com links but they usually support HTTPS with proper CORS.
    // Prefer upgrading to https to avoid relying on proxy for mixed-content.
    if (kugou && pageIsSecureLike && urlObj.protocol === 'http:') {
        urlObj.protocol = 'https:';
    }

    const target = urlObj.href;
    if (!canProxy) return target;

    const needsProxy =
        forceProxy ||
        (pageIsSecureLike && urlObj.protocol === 'http:') ||
        (pageIsSecureLike && isSayqzUrlEndpoint);
    if (!needsProxy) return target;

    return buildProxyEndpointUrl('audio-proxy', target) || target;
}

// 检查音频格式是否被浏览器支持
function checkAudioSupport(url) {
    // 如果浏览器不支持canPlayType方法，直接返回true（无法检查）
    if (!audioPlayer.canPlayType) {
        return true;
    }
    
    // 根据URL扩展名判断MIME类型
    const ext = url.split('.').pop().toLowerCase();
    
    // 特殊处理：MGG是酷我音乐的加密音频格式，浏览器无法直接播放
    if (ext === 'mgg') {
        console.log(`🎵 检查音频格式支持: ${ext} = 不支持（加密格式）`);
        return false;
    }
    
    const mimeTypes = {
        'mp3': 'audio/mpeg',
        'flac': 'audio/flac',
        'wav': 'audio/wav',
        'aac': 'audio/aac',
        'ogg': 'audio/ogg',
        'm4a': 'audio/mp4',
        'webm': 'audio/webm',
        'mp4': 'audio/mp4'
    };
    
    const mimeType = mimeTypes[ext] || '';
    if (!mimeType) {
        // 无法确定MIME类型，返回true（尝试播放）
        return true;
    }
    
    // 检查浏览器是否支持该MIME类型
    const support = audioPlayer.canPlayType(mimeType);
    console.log(`🎵 检查音频格式支持: ${ext} (${mimeType}) = ${support}`);
    
    // 某些 WebView / 低版本浏览器会对可播放的格式也返回空字符串，
    // 这里保持宽松：除已知加密格式（mgg）外都尝试播放，由运行时错误兜底。
    return true;
}

// 验证音频URL是否有效
function isValidAudioUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const raw = String(url).trim();
    if (!raw) return false;

    // Keep this check permissive: many providers use signed URLs without extensions,
    // and some APIs return "resolver" endpoints that can still be played by <audio> via redirects.
    try {
        const u = new URL(raw, window.location.href);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

        // `/text-proxy` is meant for JSON/text and should never be used as an audio src.
        const pathname = String(u.pathname || '').toLowerCase();
        if (pathname.endsWith('/text-proxy')) return false;

        return true;
    } catch {
        return false;
    }
}

// 初始化流光效果 - 使用CSS伪元素实现，无需JavaScript创建
function initStreamLight() {
    // 移除可能存在的旧流光元素
    const existingStreamLight = document.querySelector('.stream-light');
    if (existingStreamLight) {
        existingStreamLight.remove();
    }
    // 流光效果现在通过CSS伪元素实现，无需JavaScript创建
}

async function handlePlayback(songUrl, songMeta = null, playbackOptions = null) {
    handlePlaybackInProgress = true;
    suppressAudioErrorsUntil = Math.max(suppressAudioErrorsUntil, Date.now() + 1200);

    try {
    const apiForSong = songMeta && songMeta.api ? String(songMeta.api) : String(currentApi || '');
    const opts = playbackOptions && typeof playbackOptions === 'object' ? playbackOptions : {};
    const suppressErrorDanmaku = !!opts.suppressErrorDanmaku;
    const resumeTimeSecondsRaw = Number(opts.resumeTime);
    const resumeTimeSeconds = Number.isFinite(resumeTimeSecondsRaw) && resumeTimeSecondsRaw > 0 ? resumeTimeSecondsRaw : 0;

    lastPlaybackFailureInfo = null;
    let proxySwapsLeft = 0;
    try {
        proxySwapsLeft = Math.max(0, getProxyBaseUrlListSetting().length - 1);
    } catch (e) {
        proxySwapsLeft = 0;
    }

    const maxRetries = 2;
    let retryCount = 0;
    
    while (retryCount <= maxRetries) {
        let processedUrl = '';
        try {
            const attemptIndex = retryCount;
            const useProxyThisAttempt = attemptIndex >= 2;

            processedUrl = processAudioUrl(songUrl, {
                forceProxy: useProxyThisAttempt,
                disableProxy: !useProxyThisAttempt
            });
            
            // 验证URL格式是否有效
            if (!isValidAudioUrl(processedUrl)) {
                throw new Error('无效的音频URL格式');
            }
            
            const strategyLabel = useProxyThisAttempt ? '代理' : '直连';
            console.log(`🔄 尝试播放音频（${retryCount + 1}/${maxRetries + 1}｜${strategyLabel}）: ${processedUrl}`);
            
            // 清除之前的错误
            audioPlayer.removeAttribute('error');
            
            // 重置播放器状态
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
            
            // 设置音频源
            audioPlayer.src = processedUrl;
            
            // 等待音频元数据加载完成
            await new Promise((resolve, reject) => {
                // NOTE: must cleanup listeners on resolve/reject/timeout to avoid leaks.
                let settled = false;
                let timeoutId = 0;

                const settleResolve = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve();
                };
                const settleReject = (err) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(err);
                };

                const onLoadedMetadata = () => {
                    console.log('✅ 音频元数据加载成功');
                    console.log('📊 音频时长:', audioPlayer.duration);
                    console.log('🎵 音频编码:', audioPlayer.codecs || '未知');
                    settleResolve();
                };

                const onError = (event) => {
                    const errObj = event && event.target ? event.target.error : null;
                    const code = errObj && typeof errObj.code === 'number' ? errObj.code : 0;
                    const errorTypes = {
                        1: 'MEDIA_ERR_ABORTED',
                        2: 'MEDIA_ERR_NETWORK',
                        3: 'MEDIA_ERR_DECODE',
                        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
                    };

                    console.error('❌ 音频加载错误:', errorTypes[code] || `未知错误: ${code}`);
                    console.error('📝 错误详情:', (errObj && errObj.message) ? errObj.message : '无详情');

                    const currentSrc =
                        (event && event.target ? (event.target.currentSrc || event.target.src) : '') || processedUrl;
                    const mediaError = new Error(`音频加载失败: ${errorTypes[code] || code}`);
                    mediaError.mediaErrorCode = code;
                    mediaError.mediaErrorMessage = errObj && errObj.message ? errObj.message : '';
                    mediaError.currentSrc = currentSrc;
                    settleReject(mediaError);
                };

                const cleanup = () => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = 0;
                    }
                    try { audioPlayer.removeEventListener('loadedmetadata', onLoadedMetadata); } catch {}
                    try { audioPlayer.removeEventListener('error', onError); } catch {}
                };

                timeoutId = setTimeout(() => {
                    console.error('⏱️ 音频加载超时');
                    settleReject(new Error('音频加载超时'));
                }, 20000);

                audioPlayer.addEventListener('loadedmetadata', onLoadedMetadata);
                audioPlayer.addEventListener('error', onError);

                // 开始加载
                console.log('📥 开始加载音频数据...');
                audioPlayer.load();
            });
            
            if (resumeTimeSeconds > 0) {
                try {
                    const dur = Number(audioPlayer.duration);
                    const seekTo =
                        Number.isFinite(dur) && dur > 0 ? Math.max(0, Math.min(resumeTimeSeconds, Math.max(0, dur - 0.5))) : resumeTimeSeconds;
                    audioPlayer.currentTime = seekTo;
                } catch (e) {
                    // ignore
                }
            }

            // 播放音频
            console.log('▶️ 尝试播放音频...');
            await audioPlayer.play();
            
            isPlaying = true;
            playIcon.className = 'fas fa-pause';
            try { claimPlayerLeader('handlePlayback:success', { force: true }); } catch {}
            touchPlayerLeaderHeartbeat();
            broadcastPlaybackClaim();
            
            // 初始化流光效果（不使用音频分析器）
            initStreamLight();
            
            console.log('✅ 音频播放成功');
            try { recordPlaybackSuccess(); } catch {}
            return true;
        } catch (error) {
            // 特殊处理AbortError，这是正常的切换歌曲行为
            if (error.name === 'AbortError') {
                console.log('ℹ️ 播放请求被正常中断（快速切换歌曲）');
                isPlaying = false;
                playIcon.className = 'fas fa-play';
                lastPlaybackFailureInfo = { type: 'abort' };
                return false;
            }

            // 如果走的是代理且出现网络/超时类错误，自动切换到下一个代理并“原地重试”（不消耗直连/代理次数）
            try {
                const msg = String(error && error.message ? error.message : '');
                const code = Number(error && error.mediaErrorCode != null ? error.mediaErrorCode : NaN);
                const isNetworkLike =
                    code === 2 ||
                    msg.includes('MEDIA_ERR_NETWORK') ||
                    msg.includes('网络') ||
                    msg.includes('超时') ||
                    String(error && error.name ? error.name : '').includes('Network');
                const isProxied = !!processedUrl && processedUrl.includes('audio-proxy?url=');
                if (proxySwapsLeft > 0 && isProxied && isNetworkLike) {
                    const next = switchToNextProxyBaseUrl();
                    if (next) {
                        proxySwapsLeft -= 1;
                        console.warn(`🔁 代理不可用，切换到: ${next}`);

                        audioPlayer.pause();
                        audioPlayer.removeAttribute('src');
                        audioPlayer.load();

                        await new Promise(resolve => setTimeout(resolve, 200));
                        continue;
                    }
                }
            } catch (e) {
                // ignore
            }

            retryCount++;
            console.error(`❌ 音频播放失败（尝试 ${retryCount}/${maxRetries + 1}）:`, error);
            
            // 重置播放器状态
            audioPlayer.pause();
            audioPlayer.removeAttribute('src');
            audioPlayer.load();
            
            if (retryCount > maxRetries) {
                isPlaying = false;
                playIcon.className = 'fas fa-play';
                
                // 根据错误类型显示不同的提示
                let errorMessage;
                if (error.name === 'NotSupportedError') {
                    errorMessage = '不支持的音频格式或编码';
                } else if (error.name === 'NetworkError') {
                    errorMessage = '网络错误导致音频加载失败';
                } else if (error.message === '无效的音频URL格式') {
                    errorMessage = `音频播放失败: ${error.message}`;
                } else if (error.message.includes('MEDIA_ERR_SRC_NOT_SUPPORTED')) {
                    errorMessage = '不支持的音频格式，请尝试其他音质或音乐源';
                } else if (error.message.includes('MEDIA_ERR_DECODE')) {
                    errorMessage = '音频解码失败，可能是格式损坏或不支持';
                } else if (error.message.includes('MEDIA_ERR_NETWORK')) {
                    errorMessage = '网络错误，无法加载音频文件';
                } else if (error.message.includes('超时')) {
                    errorMessage = '音频加载超时，请检查网络连接';
                } else {
                    // 对于其他错误，显示详细信息，帮助用户理解
                    errorMessage = `音频播放失败: ${error.message}`;
                }
                
                console.error(`⚠️ 最终错误: ${errorMessage}`);
                lastPlaybackFailureInfo = { type: 'error', message: errorMessage, name: error && error.name ? String(error.name) : '' };
                try {
                    recordPlaybackFailure('handlePlayback', {
                        message: errorMessage,
                        name: error && error.name ? String(error.name) : '',
                        code: error && error.mediaErrorCode != null ? Number(error.mediaErrorCode) : null
                    });
                } catch (e) {
                    // ignore
                }
                if (!suppressErrorDanmaku) createDanmaku(errorMessage);
                return false;
            }
            
            // 重试前等待一段时间
            console.log('⏱️ 等待1秒后重试...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    return false;
    } finally {
        handlePlaybackInProgress = false;
    }
}

function lyricsLooksUnparsed(lyrics) {
    if (!Array.isArray(lyrics) || lyrics.length !== 1) return false;
    const only = lyrics[0];
    if (!only || typeof only !== 'object') return false;
    const text = typeof only.text === 'string' ? only.text : '';
    if (!text) return false;

    // KSC-like millisecond tags: "[7100,7100]...". When we only have 1 line but contain many tags,
    // it usually means upstream text wasn't parsed into timed lines and got cached in playlist.
    const msTags = text.match(/\[\d+\s*,\s*\d+\s*\]/g);
    if (msTags && msTags.length >= 2) return true;

    // Some providers wrap KSC content behind a single "[00:00]" time tag; still treat it as unparsed.
    if (/\[\d+\s*,\s*\d+\s*\]/.test(text) && text.length > 180) return true;

    return false;
}

function normalizeSongLyricsInPlace(song, index) {
    if (!song) return false;

    const wasString = typeof song.lyrics === 'string';
    const wasUnparsed = lyricsLooksUnparsed(song.lyrics);
    if (!wasString && !wasUnparsed) return false;

    const rawText = wasString
        ? String(song.lyrics || '')
        : (song.lyrics && song.lyrics[0] && typeof song.lyrics[0].text === 'string' ? song.lyrics[0].text : '');
    if (!rawText || !String(rawText).trim()) return false;

    let parsed = [];
    try {
        parsed = parseLRC(rawText);
    } catch (e) {
        parsed = [];
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    if (wasUnparsed && parsed.length <= 1) return false; // "repair" should split into multiple lines

    song.lyrics = parsed;

    if (Number.isInteger(index) && Array.isArray(playlist) && playlist[index]) {
        playlist[index].lyrics = parsed;
        savePlaylist();
    }
    return true;
}

function resolvePlaylistIndexForSong(song, indexHint = null) {
    if (Number.isInteger(indexHint) && indexHint >= 0 && indexHint < playlist.length) return indexHint;
    if (!song || !Array.isArray(playlist) || playlist.length === 0) return -1;

    try {
        const key = getSongKey(song);
        if (key) {
            try {
                if (
                    Number.isInteger(currentSongIndex) &&
                    currentSongIndex >= 0 &&
                    currentSongIndex < playlist.length &&
                    getSongKey(playlist[currentSongIndex]) === key
                ) {
                    return currentSongIndex;
                }
            } catch (e) {
                // ignore
            }

            const idxByKey = playlist.findIndex((item) => item && getSongKey(item) === key);
            if (idxByKey !== -1) return idxByKey;
        }
    } catch (e) {
        // ignore and fallback
    }

    // Fallback: match by best-effort id/mid (may be ambiguous when playlist has duplicates).
    const songId = String(song.mid ?? song.songmid ?? song.id ?? song.rid ?? song.musicId ?? song.songid ?? '').trim();
    if (!songId) return -1;
    return playlist.findIndex((item) => {
        if (!item || typeof item !== 'object') return false;
        const itemId = String(item.mid ?? item.songmid ?? item.id ?? item.rid ?? item.musicId ?? item.songid ?? '').trim();
        if (!itemId) return false;
        if (itemId !== songId) return false;

        const a = String(song.api || '').trim();
        const b = String(item.api || '').trim();
        if (a && b && a !== b) return false;

        const sa = String(song.source || '').trim();
        const sb = String(item.source || '').trim();
        if (sa && sb && sa !== sb) return false;

        return true;
    });
}

async function handleLyrics(song, indexHint = null) {
    const idx = resolvePlaylistIndexForSong(song, indexHint);
    const isCurrent = Number.isInteger(currentSongIndex) && idx >= 0 && currentSongIndex === idx;

    // Repair cached broken lyrics (usually 1 giant line) before deciding to refetch.
    const unparsed = song && lyricsLooksUnparsed(song.lyrics);
    if (song && (typeof song.lyrics === 'string' || unparsed)) {
        const normalized = normalizeSongLyricsInPlace(song, idx);
        if (normalized && Array.isArray(song.lyrics) && song.lyrics.length) {
            if (isCurrent) loadLyrics(song.lyrics);
            return;
        }

        if (unparsed) {
            // Keep showing whatever we have, but also force refetch to get a clean source.
            if (isCurrent && Array.isArray(song.lyrics) && song.lyrics.length) loadLyrics(song.lyrics);
            fetchLyricsForSong(song, idx, { force: true });
            return;
        }
    }

    if (!song.lyrics || song.lyrics.length === 0) {
        fetchLyricsForSong(song, idx);
    } else {
        if (isCurrent) loadLyrics(song.lyrics);
    }
}

let lastPlaybackFailureInfo = null;
let lastSongUrlRefreshAttempt = { key: '', at: 0 };
let playSongToken = 0;
let pendingPlaySongIndex = null;
let pendingPlaySongTimer = null;
let playPauseActionInFlight = false;
let playPauseLastActionAt = 0;
let handlePlaybackInProgress = false;
let suppressAudioErrorsUntil = 0;
let audioErrorRecoveryPromise = null;
let lastAudioErrorRecoveryAt = 0;
const PLAYBACK_CIRCUIT_WINDOW_MS = 30000;
const PLAYBACK_CIRCUIT_FAIL_THRESHOLD = 4;
const PLAYBACK_CIRCUIT_OPEN_MS = 25000;
let playbackFailureHistory = [];
let playbackCircuitOpenUntil = 0;

function prunePlaybackFailureHistory(now = Date.now()) {
    playbackFailureHistory = (Array.isArray(playbackFailureHistory) ? playbackFailureHistory : [])
        .filter((t) => typeof t === 'number' && now - t < PLAYBACK_CIRCUIT_WINDOW_MS);
}

function isPlaybackCircuitOpen() {
    const now = Date.now();
    return typeof playbackCircuitOpenUntil === 'number' && now < playbackCircuitOpenUntil;
}

function recordPlaybackFailure(reason, details = null) {
    try {
        const now = Date.now();
        const wasOpen = isPlaybackCircuitOpen();
        prunePlaybackFailureHistory(now);
        playbackFailureHistory.push(now);

        if (playbackFailureHistory.length >= PLAYBACK_CIRCUIT_FAIL_THRESHOLD) {
            playbackCircuitOpenUntil = Math.max(playbackCircuitOpenUntil || 0, now + PLAYBACK_CIRCUIT_OPEN_MS);
            if (!wasOpen) {
                try { createDanmaku('网络不稳定，已暂停自动重试，请点击播放重试'); } catch {}
            }
            console.warn('⛔ 播放失败过多，已暂停自动重试一段时间', {
                reason: String(reason || ''),
                count: playbackFailureHistory.length,
                openUntil: playbackCircuitOpenUntil,
                details
            });
        }
    } catch (e) {
        // ignore
    }
}

function recordPlaybackSuccess() {
    playbackFailureHistory = [];
    playbackCircuitOpenUntil = 0;
}

function requestPlaySong(index, { debounceMs = 120, reason = '' } = {}) {
    const rawIndex = Number.parseInt(String(index), 10);
    if (!Number.isInteger(rawIndex)) return;

    try { claimPlayerLeader('requestPlaySong', { force: true }); } catch {}
    pendingPlaySongIndex = rawIndex;

    if (pendingPlaySongTimer) clearTimeout(pendingPlaySongTimer);
    pendingPlaySongTimer = setTimeout(() => {
        const idx = pendingPlaySongIndex;
        pendingPlaySongIndex = null;
        pendingPlaySongTimer = null;

        if (!Number.isInteger(idx)) return;
        if (!Array.isArray(playlist) || idx < 0 || idx >= playlist.length) return;

        if (reason) console.log(`🎬 requestPlaySong -> playSong(${idx})`, reason);

        playSong(idx).catch((e) => {
            console.error('❌ playSong 执行失败:', e);
        });
    }, Math.max(0, Number.isFinite(Number(debounceMs)) ? Math.floor(Number(debounceMs)) : 0));
}

function normalizeMusicIdForSource(source, rawId) {
    if (rawId == null) return '';
    const idStr = String(rawId).trim();
    if (!idStr) return '';

    const normalizedSource = String(source || '').trim().toLowerCase();
    if (normalizedSource === 'kuwo' || normalizedSource === 'netease') {
        if (/^\d+$/.test(idStr)) return idStr;
        const matches = idStr.match(/(\d{4,})/g);
        if (matches && matches.length) return matches[matches.length - 1];
    }
    return idStr;
}

function parseApi7KeyListInput(value) {
    const raw = value == null ? '' : String(value);
    return raw
        .split(/[\s,]+/g)
        .map((part) => part.trim())
        .filter(Boolean);
}

function getApi7KeyCandidates() {
    let saved = '';
    try {
        saved = String(localStorage.getItem(API7_KEY_STORAGE_KEY) || '').trim();
    } catch (e) {
        saved = '';
    }

    const merged = [...parseApi7KeyListInput(saved), ...API7_DEFAULT_KEYS];
    const seen = new Set();
    const unique = [];
    for (const key of merged) {
        const k = String(key || '').trim();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        unique.push(k);
    }
    return unique;
}

function normalizeApi7Br(value) {
    const num = Number.parseInt(String(value == null ? '' : value).trim(), 10);
    if (num === 1 || num === 2 || num === 3 || num === 4) return String(num);
    return '4';
}

function getApi7BrSetting() {
    try {
        const raw = localStorage.getItem('hjwjb_current_quality');
        const num = Number.parseInt(String(raw == null ? '' : raw).trim(), 10);
        if (num === 1 || num === 2 || num === 3 || num === 4) return num;
    } catch (e) {
        // ignore
    }
    return isHighestQualityMode ? 4 : 3;
}

async function fetchJsonWithOptionalProxy(targetUrl, { useProxy = false, fetchOptions = null } = {}) {
    const upstreamUrl = String(targetUrl || '').trim();
    if (!upstreamUrl) return null;

    const isKugouSongUrlEndpoint = (() => {
        try {
            const u = new URL(upstreamUrl);
            const host = String(u.hostname || '').toLowerCase();
            if (host !== '') return false;
            const pathname = String(u.pathname || '').replace(/\/+$/, '');
            return pathname === '/song/url';
        } catch (e) {
            return false;
        }
    })();

    const isKugouVerificationError = (data) => {
        if (!data || typeof data !== 'object') return false;
        const codeRaw = data.errcode ?? data.error_code ?? data.code;
        const code = Number(codeRaw);
        if (Number.isFinite(code) && code === 20028) return true;
        const msg = String(data.error ?? data.errmsg ?? data.error_msg ?? data.message ?? '');
        return msg.includes('本次请求需要验证');
    };

    const attempt = async (requestUrl) => {
        try {
            const headers = { 'Accept': 'application/json,*/*' };
            if (fetchOptions && typeof fetchOptions === 'object' && fetchOptions.headers) {
                try {
                    if (fetchOptions.headers instanceof Headers) {
                        fetchOptions.headers.forEach((value, key) => {
                            headers[String(key)] = String(value);
                        });
                    } else if (typeof fetchOptions.headers === 'object') {
                        Object.entries(fetchOptions.headers).forEach(([key, value]) => {
                            if (value == null) return;
                            headers[String(key)] = String(value);
                        });
                    }
                } catch (e) {
                    // ignore
                }
            }

            const init = {
                method: 'GET',
                mode: 'cors',
                headers
            };
            if (fetchOptions && typeof fetchOptions === 'object') {
                Object.entries(fetchOptions).forEach(([key, value]) => {
                    if (key === 'headers') return;
                    if (value === undefined) return;
                    init[key] = value;
                });
            }

            const resp = await fetch(requestUrl, init);
            if (!resp.ok) return null;
            const text = await resp.text();
            const trimmed = String(text || '').trim();
            if (!trimmed) return null;
            const parsed = JSON.parse(trimmed);
            if (isKugouSongUrlEndpoint && isKugouVerificationError(parsed)) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    };

    if (!useProxy) {
        for (let tryIndex = 1; tryIndex <= 2; tryIndex += 1) {
            const data = await attempt(upstreamUrl);
            if (data) return data;
            if (tryIndex < 2) await new Promise((resolve) => setTimeout(resolve, 220));
        }
        return null;
    }

    if (isProxyDisabled()) return null;

    // User preference: direct ×2, then proxy ×1 (no proxy rotation here).
    const endpoint = 'text-proxy';
    const name = String(endpoint).trim().replace(/^\/+/, '');
    if (!name) return null;

    const normalizedBase = normalizeProxyBaseUrlInput(getProxyBaseUrlSetting());
    if (!normalizedBase) return null;
    const requestUrl = `${normalizedBase}${name}?url=${encodeURIComponent(upstreamUrl)}`;
    const data = await attempt(requestUrl);
    if (data) {
        try {
            localStorage.setItem(PROXY_ACTIVE_BASE_URL_STORAGE_KEY, normalizedBase);
        } catch (e) {
            // ignore
        }
    }
    return data;
}

async function fetchTextWithOptionalProxy(
    targetUrl,
    { useProxy = false, accept = 'text/plain,*/*;q=0.9', timeoutMs = 8000 } = {}
) {
    const upstreamUrl = String(targetUrl || '').trim();
    if (!upstreamUrl) return '';

    const attempt = async (requestUrl) => {
        let controller = null;
        let timer = null;
        try {
            controller = new AbortController();
            timer = setTimeout(() => controller.abort('timeout'), timeoutMs);

            const resp = await fetch(requestUrl, {
                method: 'GET',
                mode: 'cors',
                signal: controller.signal,
                headers: { 'Accept': accept }
            });
            if (!resp || !resp.ok) return '';
            const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
            const text = await resp.text();
            if (!text || !text.trim()) return '';
            if (contentType.includes('text/html') && /<html|<!doctype/i.test(text)) return '';
            return text;
        } catch (e) {
            return '';
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    if (!useProxy) {
        for (let tryIndex = 1; tryIndex <= 2; tryIndex += 1) {
            const text = await attempt(upstreamUrl);
            if (text) return text;
            if (tryIndex < 2) await new Promise((resolve) => setTimeout(resolve, 220));
        }
        return '';
    }

    if (isProxyDisabled()) return '';

    // User preference: direct ×2, then proxy ×1 (no proxy rotation here).
    const endpoint = 'text-proxy';
    const name = String(endpoint).trim().replace(/^\/+/, '');
    if (!name) return '';

    const normalizedBase = normalizeProxyBaseUrlInput(getProxyBaseUrlSetting());
    if (!normalizedBase) return '';
    const requestUrl = `${normalizedBase}${name}?url=${encodeURIComponent(upstreamUrl)}`;
    const text = await attempt(requestUrl);
    if (text) {
        try {
            localStorage.setItem(PROXY_ACTIVE_BASE_URL_STORAGE_KEY, normalizedBase);
        } catch (e) {
            // ignore
        }
    }
    return text || '';
}

function getApi7IdCandidates(song) {
    const idRaw = song && (song.mid ?? song.songmid ?? song.id ?? song.songId ?? song.songid);
    const idStr = idRaw == null ? '' : String(idRaw).trim();

    const midRaw = song && (song.mid ?? song.songmid);
    const midStr = midRaw == null ? '' : String(midRaw).trim();

    const songIdRaw = song && (song.songId ?? song.songid);
    const songIdStr = songIdRaw == null ? '' : String(songIdRaw).trim();

    const candidates = [];

    const tryAddMid = (value) => {
        const v = String(value || '').trim();
        if (!v) return;
        if (/^\d+$/.test(v)) return;
        if (candidates.some((c) => c.kind === 'mid' && c.value === v)) return;
        candidates.push({ kind: 'mid', value: v });
    };

    const tryAddSongId = (value) => {
        const v = String(value || '').trim();
        if (!v) return;
        if (!/^\d+$/.test(v)) return;
        if (candidates.some((c) => c.kind === 'songId' && c.value === v)) return;
        candidates.push({ kind: 'songId', value: v });
    };

    if (midStr) tryAddMid(midStr);
    if (songIdStr) tryAddSongId(songIdStr);

    // Fallback: infer from generic id field.
    if (idStr) {
        if (/^\d+$/.test(idStr)) tryAddSongId(idStr);
        else tryAddMid(idStr);
    }

    return candidates;
}

async function fetchApi7SongInfoWithFallback(song, { br = 4 } = {}) {
    const brParam = normalizeApi7Br(br);
    const ids = getApi7IdCandidates(song);
    if (!ids.length) return null;

    const keys = getApi7KeyCandidates();
    for (const key of keys) {
        for (const cand of ids) {
            const apiUrl = `https://oiapi.net/api/QQ_Music/${cand.kind}/${encodeURIComponent(cand.value)}/key/${encodeURIComponent(
                String(key)
            )}/br/${encodeURIComponent(brParam)}`;

            let data = await fetchJsonWithOptionalProxy(apiUrl, { useProxy: false });
            if (!data) data = await fetchJsonWithOptionalProxy(apiUrl, { useProxy: true });
            if (!data) continue;

            const ok = !!(data && (data.code === 1 || data.code === '1'));
            if (!ok) continue;

            const info = data && data.data && typeof data.data === 'object' ? data.data : null;
            if (!info) continue;

            const musicUrl = info.music != null ? String(info.music).trim() : '';
            if (musicUrl && /^https?:\/\//i.test(musicUrl)) {
                return { info, musicUrl };
            }
        }
    }

    return null;
}

async function fetchApi7SongAudioUrlWithFallback(song, { br = 4 } = {}) {
    const result = await fetchApi7SongInfoWithFallback(song, { br });
    return result && result.musicUrl ? String(result.musicUrl).trim() : '';
}

function getApi2KugouHashCandidates(song) {
    const candidates = [];

    const tryAdd = (value) => {
        const v = String(value == null ? '' : value).trim();
        if (!v) return;
        if (candidates.includes(v)) return;
        candidates.push(v);
    };

    // Primary hash/id
    tryAdd(song && (song.hash ?? song.id));

    // Extra hashes from API2 Kugou payloads (set by search.js normalization).
    tryAdd(song && song.kugou_hash_flac);
    tryAdd(song && song.kugou_hash_320);
    tryAdd(song && song.kugou_hash_128);
    tryAdd(song && song.kugou_hash_ogg_320);
    tryAdd(song && song.kugou_hash_ogg_128);

    tryAdd(song && song.mid);
    tryAdd(song && song.songmid);

    // Support optional arrays or alternate field names.
    if (song && Array.isArray(song.kugou_hashes)) {
        for (const h of song.kugou_hashes) tryAdd(h);
    }

    return candidates;
}

async function fetchApi2KugouSongAudioUrlWithFallback(song, { quality } = {}) {
    const baseHashes = getApi2KugouHashCandidates(song);
    if (!baseHashes.length) return '';

    // `/song/url` requires device cookies from `/register/dev`.
    // Users requested direct-only for Kugou, so we do a best-effort direct register here (no proxy).
    let api2KugouDidForceRegister = false;
    try {
        await ensureApi2KugouDeviceCookiesReady({ force: false });
    } catch (e) {
        // ignore
    }
    if (api2KugouDeviceAuthErrorUntil && Date.now() < api2KugouDeviceAuthErrorUntil) {
        return '';
    }

    const commonParams = {};
    if (song && song.kugou_album_id != null && String(song.kugou_album_id).trim()) {
        commonParams.album_id = String(song.kugou_album_id).trim();
    }
    if (song && song.kugou_album_audio_id != null && String(song.kugou_album_audio_id).trim()) {
        commonParams.album_audio_id = String(song.kugou_album_audio_id).trim();
    }

    const wanted = normalizeApi2Quality(quality != null ? quality : currentQuality, { sourceKey: 'kugou' });
    const ordered = [wanted, ...API2_KUGOU_QUALITIES.filter((q) => q !== wanted)];

    const extractAllUrls = (value) => {
        const out = [];
        const tryPush = (v) => {
            const u = v != null ? String(v).trim() : '';
            if (!u) return;
            if (!/^https?:\/\//i.test(u)) return;
            out.push(u);
        };

        if (!value) return out;
        if (typeof value === 'string') {
            tryPush(value);
            return out;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item && typeof item === 'object' && item.url != null) {
                    tryPush(item.url);
                } else {
                    tryPush(item);
                }
            }
            return out;
        }
        if (value && typeof value === 'object') {
            if (value.url != null) tryPush(value.url);
            if (value.backupUrl != null) {
                const nested = extractAllUrls(value.backupUrl);
                if (nested.length) out.push(...nested);
            }
        }
        return out;
    };

    for (const q of ordered) {
        // Prefer hashes that match the requested quality.
        const prioritized = [];
        const tryPrior = (value) => {
            const v = String(value == null ? '' : value).trim();
            if (!v) return;
            if (prioritized.includes(v)) return;
            prioritized.push(v);
        };

        if (q === 'flac') {
            tryPrior(song && song.kugou_hash_flac);
        } else if (q === '320') {
            tryPrior(song && song.kugou_hash_320);
            tryPrior(song && song.kugou_hash_ogg_320);
        } else {
            tryPrior(song && song.kugou_hash_128);
            tryPrior(song && song.kugou_hash_ogg_128);
        }

        const hashes = uniqUrls([...prioritized, ...baseHashes]);

        for (const hash of hashes) {
            const encodedHash = String(hash || '').trim();
            if (!encodedHash) continue;

            const attempt = async (freePart) => {
                const params = { ...commonParams, hash: encodedHash, quality: q };
                if (freePart) params.free_part = '1';
                let data = await fetchApi2KugouJsonWithFallback('/song/url', params);
                if (
                    (!data || typeof data !== 'object') &&
                    !api2KugouDidForceRegister &&
                    (!api2KugouDeviceAuthErrorUntil || Date.now() >= api2KugouDeviceAuthErrorUntil)
                ) {
                    api2KugouDidForceRegister = true;
                    try {
                        await ensureApi2KugouDeviceCookiesReady({ force: true });
                    } catch (e) {
                        // ignore
                    }
                    data = await fetchApi2KugouJsonWithFallback('/song/url', params);
                }
                if (!data || typeof data !== 'object') return '';
                const candidates = uniqUrls([
                    ...extractAllUrls(data.url),
                    ...extractAllUrls(data.backupUrl),
                    ...(data.data ? extractAllUrls(data.data.url) : []),
                    ...(data.data ? extractAllUrls(data.data.backupUrl) : [])
                ]);

                if (song) {
                    try {
                        song.kugou_audio_candidates = candidates;
                    } catch (e) {
                        // ignore
                    }
                }

                for (const candidate of candidates) {
                    const u = String(candidate || '').trim();
                    if (u && /^https?:\/\//i.test(u)) return u;
                }

                return '';
            };

            // Prefer full URL; fallback to试听片段（free_part=1）
            let url = await attempt(false);
            if (!url) url = await attempt(true);
            if (url) return url;
        }
    }

    return '';
}

function decodeBase64Utf8(base64Text) {
    const raw = String(base64Text == null ? '' : base64Text).trim();
    if (!raw) return '';

    try {
        if (typeof atob !== 'function') return '';
        const binary = atob(raw);
        if (!binary) return '';

        if (typeof TextDecoder !== 'undefined') {
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new TextDecoder('utf-8').decode(bytes);
        }

        // Fallback: percent-decode
        let encoded = '';
        for (let i = 0; i < binary.length; i += 1) {
            encoded += `%${`00${binary.charCodeAt(i).toString(16)}`.slice(-2)}`;
        }
        return decodeURIComponent(encoded);
    } catch (e) {
        return '';
    }
}

const KUGOU_KRC_XOR_KEY = new Uint8Array([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]);

async function decodeKugouKrcFromBase64(base64Text) {
    const raw = String(base64Text == null ? '' : base64Text).trim();
    if (!raw) return '';

    let bytes;
    try {
        if (typeof atob !== 'function') return '';
        const binary = atob(raw);
        if (!binary) return '';
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    } catch (e) {
        return '';
    }

    if (!bytes || bytes.length < 8) return '';

    const prefix = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (prefix !== 'krc1') return '';

    const encrypted = bytes.slice(4);
    const xored = new Uint8Array(encrypted.length);
    for (let i = 0; i < encrypted.length; i += 1) {
        xored[i] = encrypted[i] ^ KUGOU_KRC_XOR_KEY[i % KUGOU_KRC_XOR_KEY.length];
    }

    const decodeText = (arrayBuffer) => {
        try {
            if (typeof TextDecoder !== 'undefined') {
                return new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer));
            }
        } catch (e) {
            // ignore
        }
        return '';
    };

    const tryDecompress = async (format) => {
        try {
            if (typeof DecompressionStream === 'undefined') return '';
            const ds = new DecompressionStream(format);
            const stream = new Blob([xored]).stream().pipeThrough(ds);
            const ab = await new Response(stream).arrayBuffer();
            return decodeText(ab);
        } catch (e) {
            return '';
        }
    };

    // Most KRC payloads are zlib/deflate-compressed after XOR.
    const text =
        (await tryDecompress('deflate')) ||
        (await tryDecompress('deflate-raw')) ||
        '';
    return text && text.trim() ? text : '';
}

async function fetchApi2KugouLyricTextWithFallback(hash, { fmt = 'lrc', keywords = '' } = {}) {
    const h = String(hash == null ? '' : hash).trim();
    if (!h) return '';

    const kw = String(keywords == null ? '' : keywords).trim();
    const searchData = await fetchApi2KugouJsonWithFallback('/search/lyric', kw ? { hash: h, keywords: kw } : { hash: h });
    const candidates = searchData && Array.isArray(searchData.candidates) ? searchData.candidates : [];
    const first = candidates && candidates.length ? candidates[0] : null;
    const id = first && first.id != null ? String(first.id).trim() : '';
    const accesskey = first && first.accesskey != null ? String(first.accesskey).trim() : '';
    if (!id || !accesskey) return '';

    const safeFmt = String(fmt || 'lrc').trim().toLowerCase();
    const fmtParam = safeFmt === 'krc' ? 'krc' : 'lrc';
    const lyricData = await fetchApi2KugouJsonWithFallback('/lyric', {
        id,
        accesskey,
        fmt: fmtParam,
        decode: 'true'
    });
    if (!lyricData || typeof lyricData !== 'object') return '';

    const decoded = lyricData.decodeContent != null ? String(lyricData.decodeContent) : '';
    if (decoded && decoded.trim()) return decoded;

    const content = lyricData.content != null ? String(lyricData.content).trim() : '';
    if (!content) return '';
    if (fmtParam === 'krc') {
        const krc = await decodeKugouKrcFromBase64(content);
        if (krc) return krc;
    }
    return decodeBase64Utf8(content);
}

async function fetchApi2CoverUrlWithFallback(song, { size = 300 } = {}) {
    const mid = await resolveApi2MidFromSong(song);
    if (!mid) return '';

    const safeSize = Number.isFinite(Number(size)) ? Math.max(50, Math.min(1000, Math.floor(Number(size)))) : 300;
    const data = await fetchApi2JsonWithFallback('/api/song/cover', { mid, size: safeSize, validate: 'false' });
    const url = data && data.data && data.data.url ? String(data.data.url).trim() : '';
    if (url && /^https?:\/\//i.test(url)) return url;
    return '';
}

function buildFallbackPlaybackUrlForSong(song, apiForSong) {
    try {
        if (!song) return '';
        const id = song && (song.id ?? song.rid ?? song.musicId ?? song.songid);
        if (id == null) return '';

        const apiName = String(apiForSong || '').trim();
        const sourceRaw = getSourceForApi(song.source || currentMusicSource);
        const normalizedId = normalizeMusicIdForSource(sourceRaw, id);
        if (!normalizedId) return '';

        const safeId = encodeURIComponent(String(normalizedId));

        if (apiName === 'api8') {
            return buildApi8RequestUrl(normalizedId, normalizeApi8Level(currentQuality));
        }

        if (apiName === 'api3') {
            return buildApi3DownUrl(normalizedId, currentQuality);
        }

        if (isMetingApi(apiName)) {
            const serverParam = mapMetingServerParam(sourceRaw);
            const brParam = getMetingBrParam();
            const urls = getMetingRequestUrls(apiName, {
                server: serverParam,
                type: 'url',
                id: normalizedId,
                br: brParam
            });
            return pickDirectPlayableMetingUpstream(urls);
        }

        if (apiName === 'api7') {
            // API7（QQ）通过 oiapi 返回 JSON（需先请求解析出 music 直链），这里不返回“可直接播放”的 URL。
            return '';
        }

        if (apiName === 'api2') {
            // API2（QQ）需要先请求 /api/song/url 拿到直链。
            return '';
        }
    } catch (e) {
        // ignore
    }

    return '';
}

function appendCacheBusterToUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return url;
    try {
        const u = new URL(raw, window.location.href);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;
        u.searchParams.set('t', String(Date.now()));
        return u.toString();
    } catch (e) {
        return raw;
    }
}

function getSongRefreshKey(song) {
    if (!song) return '';
    const api = song.api != null ? String(song.api) : '';
    const source = song.source != null ? String(song.source) : '';
    const id = song.id != null ? String(song.id) : '';
    if (!api && !id) return '';
    return `${api}|${source}|${id}`;
}

function shouldThrottleSongUrlRefresh(song, minIntervalMs = 15000) {
    const key = getSongRefreshKey(song);
    if (!key) return true;
    const now = Date.now();
    if (lastSongUrlRefreshAttempt.key === key && now - lastSongUrlRefreshAttempt.at < minIntervalMs) {
        return true;
    }
    lastSongUrlRefreshAttempt = { key, at: now };
    return false;
}

async function resolveAudioUrlViaProxy(upstreamUrl, { timeoutMs = 10000 } = {}) {
    const upstream = String(upstreamUrl || '').trim();
    if (!upstream) return '';

    const proxyUrl = buildProxyEndpointUrl('audio-resolve', upstream);
    if (!proxyUrl) return '';

    let timer = null;
    let controller = null;
    try {
        if (typeof AbortController !== 'undefined') {
            controller = new AbortController();
            timer = setTimeout(() => controller.abort(), timeoutMs);
        }
        const resp = await fetch(proxyUrl, {
            method: 'GET',
            mode: 'cors',
            headers: { 'Accept': 'application/json' },
            signal: controller ? controller.signal : undefined
        });
        if (!resp.ok) return '';
        const data = await resp.json();
        const finalUrl = data && data.finalUrl ? String(data.finalUrl) : '';
        return finalUrl;
    } catch (e) {
        return '';
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function refreshSongUrlForPlayback(index, song, { reason = '' } = {}) {
    try {
        if (!song || !Number.isInteger(index) || index < 0 || index >= playlist.length) {
            return { success: false, url: '' };
        }

        const apiForSong = song && song.api ? String(song.api) : String(currentApi || '');
        if (!apiForSong) return { success: false, url: '' };

        const currentUrl = String(song.url || '').trim();
        if (!currentUrl || /^(blob|data):/i.test(currentUrl)) {
            return { success: false, url: '' };
        }

        if (shouldThrottleSongUrlRefresh(song)) {
            return { success: false, url: '' };
        }

        const sourceKey = getSourceForApi(song.source || currentMusicSource);
        const id = song.id != null ? song.id : '';
        const normalizedId = normalizeMusicIdForSource(sourceKey, id);
        if (!normalizedId && apiForSong !== 'api3') {
            return { success: false, url: '' };
        }

        console.log(`🔄 检测到可能过期的播放链接，尝试刷新（${reason || apiForSong}）`);

        let newUrl = '';

        if (apiForSong === 'api3') {
            const updated = await fetchApi3SongInfo(song, { force: true, index, quality: currentQuality });
            newUrl = updated && updated.url ? String(updated.url) : '';
        } else if (apiForSong === 'api4') {
            newUrl = await fetchApi4SongAudioUrlWithFallback(song, { quality: currentQuality });
        } else if (apiForSong === 'api7') {
            newUrl = await fetchApi7SongAudioUrlWithFallback(song, { br: getApi7BrSetting() });
        } else if (apiForSong === 'api8') {
            const level = normalizeApi8Level(currentQuality);
            newUrl = await fetchApi8SongUrl(normalizedId, level);
            if (!newUrl) {
                newUrl = await fetchApi8SongUrl(normalizedId, level, { useProxy: true });
            }
        } else if (isMetingApi(apiForSong)) {
            const serverParam = mapMetingServerParam(sourceKey);
            const brParam = getMetingBrParam();
            // Prefer direct resolution first (works on file:// when upstream returns 302/audio stream).
            newUrl = await fetchMetingSongUrlWithFallback(apiForSong, serverParam, normalizedId, brParam);

            if (!newUrl && !isProxyDisabled()) {
                const upstreams = getMetingRequestUrls(apiForSong, {
                    server: serverParam,
                    type: 'url',
                    id: normalizedId,
                    br: brParam
                });
                for (const upstream of upstreams) {
                    newUrl = await resolveAudioUrlViaProxy(upstream);
                    if (newUrl) break;
                }
            }

            if (!newUrl && isProxyDisabled()) {
                const upstreams = getMetingRequestUrls(apiForSong, {
                    server: serverParam,
                    type: 'url',
                    id: normalizedId,
                    br: brParam
                });
                newUrl = pickDirectPlayableMetingUpstream(upstreams);
            }
        } else {
            const upstream = buildFallbackPlaybackUrlForSong(song, apiForSong);
            newUrl = upstream ? await resolveAudioUrlViaProxy(upstream) : '';
        }

        if (!newUrl) return { success: false, url: '' };
        if (!isValidAudioUrl(String(newUrl))) return { success: false, url: '' };

        if (newUrl === currentUrl) {
            newUrl = appendCacheBusterToUrl(newUrl);
        }

        song.url = newUrl;
        song.urlRefreshedAt = Date.now();
        playlist[index] = song;
        savePlaylist();
        return { success: true, url: newUrl };
    } catch (e) {
        return { success: false, url: '' };
    }
}

function getApiFailoverCandidatesForSong(song, apiForSong) {
    const apiName = String(apiForSong || '').trim();
    const sourceKey = getSourceForApi(song && song.source ? song.source : currentMusicSource);

    // If the song is explicitly set to API8, do not auto-switch to other APIs.
    // Users expect "API8 means API8" (otherwise it silently becomes API9).
    if (apiName === 'api8') return [];

    if (sourceKey === 'qq') {
        return ['api9', 'api7', 'api10'].filter(a => a !== apiName);
    }
    if (sourceKey === 'kuwo') return ['api4'].filter(a => a !== apiName);
    if (sourceKey === 'netease') {
        return ['api9', 'api8', 'api3', 'api10'].filter(a => a !== apiName);
    }
    if (sourceKey === 'kugou') return [];
    if (sourceKey === 'joox') return [];
    return ['api7', 'api9', 'api10'].filter(a => a !== apiName);
}

async function tryPlaybackWithApiFailover(index, song) {
    try {
        if (!song) return { success: false };
        const currentApiForSong = song && song.api ? String(song.api) : String(currentApi || '');
        const candidates = getApiFailoverCandidatesForSong(song, currentApiForSong);
        const originalUrl = String(song.url || '').trim();

        for (const candidateApi of candidates) {
            const url =
                candidateApi === 'api7'
                    ? await fetchApi7SongAudioUrlWithFallback(song, { br: getApi7BrSetting() })
                    : candidateApi === 'api4'
                        ? await fetchApi4SongAudioUrlWithFallback(song, { quality: currentQuality })
                        : buildFallbackPlaybackUrlForSong(song, candidateApi);
            if (!url) continue;
            if (originalUrl && originalUrl === url) continue;

            console.warn(`🔁 播放失败，尝试切换到 ${candidateApi} 重试...`);
            const ok = await handlePlayback(url, { ...song, api: candidateApi, url }, { suppressErrorDanmaku: true });
            if (!ok) {
                if (lastPlaybackFailureInfo && lastPlaybackFailureInfo.type === 'abort') return { success: false, aborted: true };
                continue;
            }

            playlist[index].api = candidateApi;
            playlist[index].url = url;
            savePlaylist();

            try {
                if (apiSelect) apiSelect.value = candidateApi;
            } catch (e) {
                // ignore
            }

            if (candidateApi !== currentApi) {
                selectApi(candidateApi);
            }

            return { success: true, api: candidateApi, url };
        }
    } catch (e) {
        // ignore
    }
    return { success: false };
}

async function playSong(index) {
    if (index < 0 || index >= playlist.length) {
        console.error('播放索引超出范围');
        createDanmaku('播放失败：歌曲索引无效');
        return;
    }

    const token = ++playSongToken;
    const isStale = () => token !== playSongToken;
    suppressAudioErrorsUntil = Date.now() + 1200;

    const song = playlist[index];
    currentSongIndex = index;

    // 统一：如果歌曲自带 api/source（来自搜索页/历史列表），则同步到全局选择器，避免“实际播放API/音质”与顶部选择不一致。
    try {
        const desiredApi = song && song.api != null ? String(song.api).trim() : '';
        const desiredSource = song && song.source != null ? String(song.source).trim() : '';
        let changed = false;

        if (desiredApi && desiredApi !== String(localStorage.getItem('hjwjb_current_api') || '').trim()) {
            localStorage.setItem('hjwjb_current_api', desiredApi);
            changed = true;
        }
        if (desiredSource && desiredSource !== String(localStorage.getItem('hjwjb_current_music_source') || '').trim()) {
            localStorage.setItem('hjwjb_current_music_source', desiredSource);
            changed = true;
        }

        if (changed) {
            loadSavedMusicSource();
            updateMusicSourceDisplay();
        }
    } catch (e) {
        // ignore
    }

    console.log(`▶️ 开始播放歌曲 #${index}:`, song.title);
    
    // 保存当前播放状态，用于后续恢复
    const wasPlaying = isPlaying;
    
    // 中断当前播放，避免冲突
    audioAutoResumeToken += 1;
    isPlaying = false;
    playIcon.className = 'fas fa-play';
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    audioPlayer.load();

    loadSongInfo(song);
    const coverBeforeFetch = song && song.cover ? String(song.cover) : '';
    await setupCoverImage(song);
    if (isStale()) return;
    const api3UpdatedSong = await fetchApi3SongInfo(song);
    if (isStale()) return;

    // API3 的封面/歌词信息是播放时再补齐的：如果拿到新封面，立即刷新 UI（否则看起来像“切歌图片没变”）。
    try {
        if (api3UpdatedSong && api3UpdatedSong.api === 'api3') {
            const coverAfterFetch = api3UpdatedSong.cover ? String(api3UpdatedSong.cover) : '';
            if (coverAfterFetch && coverAfterFetch !== coverBeforeFetch && currentSongIndex === index) {
                const coverUrl = processAudioUrl(coverAfterFetch);
                currentCover.src = coverUrl || 'IMG_20251115_090141.png';
                updateMediaSessionMetadata(api3UpdatedSong);
            }
        }
    } catch (e) {
        // ignore
    }

    // 验证/兜底歌曲URL：部分来源（例如 API7/QQ）在列表中可能未提前填充 url，播放时再补齐
    let effectiveUrl = String(song.url || '').trim();
    if (!effectiveUrl) {
        const apiForSong = song && song.api ? String(song.api) : String(currentApi || '');
        if (apiForSong === 'api7') {
            const fetched = await fetchApi7SongAudioUrlWithFallback(song, { br: getApi7BrSetting() });
            if (fetched) {
                playlist[index].url = fetched;
                savePlaylist();
                effectiveUrl = fetched;
                console.log('✅ 已为歌曲补齐API7播放URL:', effectiveUrl);
            }
        } else if (apiForSong === 'api4') {
            const updated = await fetchApi4SongInfoWithFallback(song, { force: true, quality: currentQuality });
            const fetched = updated && updated.url ? String(updated.url).trim() : '';
            if (fetched) {
                playlist[index] = updated;
                savePlaylist();
                effectiveUrl = fetched;
                console.log('✅ 已为歌曲补齐API4播放URL:', effectiveUrl);
            }
        } else if (apiForSong === 'api8') {
            // API8 的 url 是“解析接口”，不能直接给 audio.src；必须先请求并提取真正的音频直链。
            try {
                const sourceKey = getSourceForApi(song.source || currentMusicSource);
                const id = song.id ?? song.rid ?? song.musicId ?? song.songid;
                const normalizedId = normalizeMusicIdForSource(sourceKey, id);
                const level = normalizeApi8Level(currentQuality);
                let fetched = normalizedId ? await fetchApi8SongUrl(normalizedId, level) : '';
                if (!fetched && normalizedId) fetched = await fetchApi8SongUrl(normalizedId, level, { useProxy: true });

                if (fetched) {
                    playlist[index].url = fetched;
                    savePlaylist();
                    effectiveUrl = fetched;
                    console.log('✅ 已为歌曲补齐API8播放URL:', effectiveUrl);
                }
            } catch (e) {
                // ignore
            }
        } else if (isMetingApi(apiForSong)) {
            try {
                const sourceKey = getSourceForApi(song.source || currentMusicSource);
                const id = song.id ?? song.rid ?? song.musicId ?? song.songid;
                const normalizedId = normalizeMusicIdForSource(sourceKey, id);
                const serverParam = mapMetingServerParam(sourceKey);
                const brParam = getMetingBrParam();
                const fetched = normalizedId
                    ? await fetchMetingSongUrlWithFallback(apiForSong, serverParam, normalizedId, brParam)
                    : '';
                const finalUrl = fetched || buildFallbackPlaybackUrlForSong(song, apiForSong);
                if (finalUrl) {
                    playlist[index].url = finalUrl;
                    savePlaylist();
                    effectiveUrl = finalUrl;
                    console.log('✅ 已为歌曲补齐Meting播放URL:', effectiveUrl);
                }
            } catch (e) {
                // ignore
            }
        } else {
            const fallback = buildFallbackPlaybackUrlForSong(song, apiForSong);
            if (fallback) {
                playlist[index].url = fallback;
                savePlaylist();
                effectiveUrl = fallback;
                console.log('✅ 已为歌曲补齐播放URL（兜底）:', effectiveUrl);
            }
        }
    }
    if (isStale()) return;
    if (!effectiveUrl) {
        const switched = await tryPlaybackWithApiFailover(index, song);
        if (isStale()) return;
        if (switched && switched.success) {
            const finalSong = playlist[index];
            await handleLyrics(finalSong, index);
            updateMediaSessionMetadata(finalSong);
            updateMediaSessionPlaybackState();
            console.log('✅ 歌曲播放初始化完成（自动切换API）');
            return;
        }
        createDanmaku(`播放失败：歌曲"${song.title}"缺少音频URL`);
        return;
    }

    // API8: if we still have the "resolver endpoint" URL, resolve it to the real audio URL before playback.
    try {
        const apiForSong = song && song.api ? String(song.api) : String(currentApi || '');
        const isApi8ResolverUrl = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return false;
            try {
                const u = new URL(raw, window.location.href);
                const host = String(u.hostname || '').toLowerCase();
                const path = String(u.pathname || '').toLowerCase();
                return host === 'api.byfuns.top' && (path === '/1/' || path === '/1' || path.startsWith('/1/'));
            } catch (e) {
                return false;
            }
        };

        const isApi4ResolverUrl = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return false;
            try {
                const u = new URL(raw, window.location.href);
                const host = String(u.hostname || '').toLowerCase();
                if (host !== 'kw-api.cenguigui.cn') return false;
                const type = String(u.searchParams.get('type') || '').toLowerCase();
                if (type !== 'song') return false;
                // format=mp3 usually 302, format=json returns metadata. Either way we should resolve to a direct URL.
                return true;
            } catch (e) {
                return false;
            }
        };

        if (apiForSong === 'api4' && isApi4ResolverUrl(effectiveUrl)) {
            console.log('🔄 API4 解析接口URL检测到，开始获取真实音频直链...');
            const updated = await fetchApi4SongInfoWithFallback(song, { force: true, quality: currentQuality });
            const fetched = updated && updated.url ? String(updated.url).trim() : '';
            if (fetched) {
                playlist[index] = updated;
                savePlaylist();
                effectiveUrl = fetched;
                console.log('✅ API4 已解析为可播放直链:', effectiveUrl);
            } else {
                console.warn('⚠️ API4 解析失败，继续使用原URL尝试播放（可能失败）:', effectiveUrl);
            }
        }

        if (apiForSong === 'api8' && isApi8ResolverUrl(effectiveUrl)) {
            console.log('🔄 API8 解析接口URL检测到，开始解析真实音频直链...');
            const sourceKey = getSourceForApi(song.source || currentMusicSource);
            const id = song.id ?? song.rid ?? song.musicId ?? song.songid;
            const normalizedId = normalizeMusicIdForSource(sourceKey, id);
            const level = normalizeApi8Level(currentQuality);

            let fetched = normalizedId ? await fetchApi8SongUrl(normalizedId, level) : '';
            if (!fetched && normalizedId) fetched = await fetchApi8SongUrl(normalizedId, level, { useProxy: true });

            if (fetched) {
                playlist[index].url = fetched;
                savePlaylist();
                effectiveUrl = fetched;
                console.log('✅ API8 已解析为可播放直链:', effectiveUrl);
            } else {
                console.warn('⚠️ API8 解析失败，继续使用原URL尝试播放（可能失败）:', effectiveUrl);
            }
        }
    } catch (e) {
        // ignore
    }
    if (isStale()) return;
    
    // 验证URL
    const rawUrl = String(effectiveUrl || '').trim();
    if (!isValidAudioUrl(rawUrl)) {
        console.error(`无效的音频URL: ${rawUrl}`);
        if (isStale()) return;
        const switched = await tryPlaybackWithApiFailover(index, song);
        if (isStale()) return;
        if (switched && switched.success) {
            const finalSong = playlist[index];
            await handleLyrics(finalSong, index);
            updateMediaSessionMetadata(finalSong);
            updateMediaSessionPlaybackState();
            console.log('✅ 歌曲播放初始化完成（自动切换API）');
            return;
        }
        createDanmaku(`播放失败：歌曲"${song.title}"的音频URL无效`);
        return;
    }
    
    // 检查音频格式是否被浏览器支持
    if (!checkAudioSupport(rawUrl)) {
        const ext = rawUrl.split('.').pop().toLowerCase();
        let errorMessage;
        
        if (ext === 'mgg') {
            errorMessage = `播放失败：歌曲"${song.title}"是酷我音乐的加密格式(MGG)，浏览器无法直接播放`;
        } else {
            errorMessage = `播放失败：歌曲"${song.title}"的音频格式不被浏览器支持`;
        }
        
        console.error(`不支持的音频格式: ${rawUrl}`);
        if (isStale()) return;
        const switched = await tryPlaybackWithApiFailover(index, song);
        if (isStale()) return;
        if (switched && switched.success) {
            const finalSong = playlist[index];
            await handleLyrics(finalSong, index);
            updateMediaSessionMetadata(finalSong);
            updateMediaSessionPlaybackState();
            console.log('✅ 歌曲播放初始化完成（自动切换API）');
            return;
        }
        createDanmaku(errorMessage);
        return;
    }

    // 更新播放列表显示，确保用户看到当前播放的歌曲
    updatePlaylistDisplay();
    if (isStale()) return;
    
    // 尝试播放歌曲
    const playbackSuccess = await handlePlayback(rawUrl, song, { suppressErrorDanmaku: true });
    if (isStale()) return;
    
    if (playbackSuccess) {
        // User data: record recent play only after playback succeeds.
        try { recordRecentPlay(song); } catch {}

        // 播放成功后处理歌词
        await handleLyrics(song, index);
        
        // 更新Media Session元数据和播放状态
        updateMediaSessionMetadata(song);
        updateMediaSessionPlaybackState();
        
        console.log('✅ 歌曲播放初始化完成');
    } else {
        if (isStale()) return;
        if (lastPlaybackFailureInfo && lastPlaybackFailureInfo.type === 'abort') {
            console.log('ℹ️ 播放被中断，跳过自动切换API');
            return;
        }

        if (isStale()) return;
        const refreshed = await refreshSongUrlForPlayback(index, song, { reason: 'playSong' });
        if (isStale()) return;
        if (refreshed && refreshed.success && refreshed.url) {
            const retrySuccess = await handlePlayback(refreshed.url, song, { suppressErrorDanmaku: true });
            if (isStale()) return;
            if (retrySuccess) {
                await handleLyrics(song, index);
                updateMediaSessionMetadata(song);
                updateMediaSessionPlaybackState();
                console.log('✅ 歌曲播放初始化完成（已刷新链接）');
                return;
            }
        }

        if (isStale()) return;
        const switched = await tryPlaybackWithApiFailover(index, song);
        if (isStale()) return;
        if (switched && switched.success) {
            const finalSong = playlist[index];
            await handleLyrics(finalSong, index);
            updateMediaSessionMetadata(finalSong);
            updateMediaSessionPlaybackState();
            console.log('✅ 歌曲播放初始化完成（自动切换API）');
            return;
        }

        console.log('❌ 歌曲播放失败');
        createDanmaku(
            lastPlaybackFailureInfo && lastPlaybackFailureInfo.message ? String(lastPlaybackFailureInfo.message) : '音频播放失败，请稍后重试'
        );
    }
}

// ========================================
// DOM 操作优化 - 使用 DocumentFragment
// ========================================
function createPlaylistItemElement(song, index) {
    const div = document.createElement('div');
    div.className = `playlist-item ${index === currentSongIndex ? 'active' : ''}`;

    const info = document.createElement('div');
    info.className = 'playlist-item-info';

    const title = document.createElement('div');
    title.className = 'playlist-item-title';
    title.textContent = song.title;

    const artist = document.createElement('div');
    artist.className = 'playlist-item-artist';
    artist.textContent = song.artist;

    info.appendChild(title);
    info.appendChild(artist);

    const actions = document.createElement('div');
    actions.className = 'playlist-item-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'playlist-item-btn download-btn';
    downloadBtn.title = '下载';
    downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
    downloadBtn.addEventListener('click', (e) => { e.stopPropagation(); downloadSong(index); });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'playlist-item-btn delete-btn';
    deleteBtn.title = '删除';
    deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteSong(index); });

    actions.appendChild(downloadBtn);
    actions.appendChild(deleteBtn);

    div.appendChild(info);
    div.appendChild(actions);

    div.addEventListener('click', (e) => { if (!e.target.closest('.playlist-item-btn')) requestPlaySong(index, { reason: 'playlist-item' }); });

    return div;
}

function updatePlaylistDisplay(options = {}) {
    console.log('%c🖥️ 开始更新播放列表显示', 'color: #2ecc71; font-weight: bold');

    const opts = options && typeof options === 'object' ? options : {};
    if (opts.reloadFromStorage) {
        playlist = StorageManager.getItem('hjwjb_playlist', []);
    }
    if (!Array.isArray(playlist)) playlist = [];

    console.log('🔄 当前播放列表（内存）共', playlist.length, '首歌曲');

    const fragment = document.createDocumentFragment();
    playlistContainer.innerHTML = '';

    if (playlist.length === 0) {
        playlistContainer.innerHTML = '<div class="empty-playlist"><i class="fas fa-list"></i><p>播放列表为空</p></div>';
        return;
    }

    if (currentSongIndex === -1) {
        const coverImage = findFirstSongWithCover();
        if (coverImage && !coverImage.includes('blob:null') && coverImage.length >= 10) {
            currentCover.src = coverImage;
        } else {
            currentCover.src = 'IMG_20251115_090141.png';
        }
    }

    playlist.forEach((song, index) => {
        fragment.appendChild(createPlaylistItemElement(song, index));
    });

    playlistContainer.appendChild(fragment);
    console.log('✅ 播放列表显示更新完成，使用DocumentFragment优化');
}

// ========================================
// 歌词加载优化 - 使用 DocumentFragment
// ========================================
function loadLyrics(lyrics) {
    console.log('%c📝 加载歌词', 'color: #9b59b6; font-weight: bold');

    const render = (withTransition) => {
        lyricsContainer.innerHTML = '';
        lyricsContainer.classList.remove('has-lyrics', 'lyrics-empty');

        if (!lyrics || lyrics.length === 0) {
            lyricsContainer.innerHTML = '<div class="no-lyrics"><i class="fas fa-music"></i><p>暂无歌词</p></div>';
            lyricsContainer.classList.add('lyrics-empty');
            if (withTransition) {
                lyricsContainer.classList.remove('lyrics-transition-out');
                lyricsContainer.classList.add('lyrics-transition-in');
                // 淡入动画完成后移除类
                setTimeout(() => {
                    lyricsContainer.classList.remove('lyrics-transition-in');
                }, 500);
            } else {
                lyricsContainer.classList.remove('lyrics-transition-out', 'lyrics-transition-in');
            }
            return;
        }

        lyricsContainer.classList.add('has-lyrics');
        const fragment = document.createDocumentFragment();
        const sortedLyrics = [...lyrics].sort((a, b) => a.time - b.time);

        sortedLyrics.forEach(lyric => {
            const div = document.createElement('div');
            div.className = 'lyric-line';
            div.dataset.time = lyric.time;
            if (isWordLyricsEnabled && Array.isArray(lyric.words) && lyric.words.length) {
                div.classList.add('has-words');
                lyric.words.forEach((word) => {
                    const span = document.createElement('span');
                    span.className = 'lyric-word';
                    span.dataset.time = word.time;
                    span.textContent = word.text;
                    div.appendChild(span);
                });
            } else {
                const fallbackText =
                    lyric && typeof lyric.text === 'string' && lyric.text
                        ? lyric.text
                        : (Array.isArray(lyric && lyric.words) ? lyric.words.map(w => (w && w.text != null ? String(w.text) : '')).join('') : '');
                div.textContent = fallbackText;
            }
            fragment.appendChild(div);
        });

        lyricsContainer.appendChild(fragment);

        if (withTransition) {
            // 移除淡出动画，添加淡入动画
            lyricsContainer.classList.remove('lyrics-transition-out');
            lyricsContainer.classList.add('lyrics-transition-in');

            // 淡入动画完成后移除类
            setTimeout(() => {
                lyricsContainer.classList.remove('lyrics-transition-in');
            }, 500);
        } else {
            lyricsContainer.classList.remove('lyrics-transition-out', 'lyrics-transition-in');
        }
        
        console.log('✅ 歌词容器已更新，使用DocumentFragment优化');
    };

    // 关闭动效时：不做淡入淡出，直接渲染
    if (!isMotionEnabled) {
        render(false);
        return;
    }

    // 添加淡出动画
    lyricsContainer.classList.add('lyrics-transition-out');

    // 等待淡出动画完成后更新内容
    setTimeout(() => {
        render(true);
    }, 500);
}

// ========================================
// 存储和删除函数优化
// ========================================
// 保存播放列表到本地存储
// 直接使用 localStorage.setItem 确保立即保存（与 search.html 保持一致）
function savePlaylist() {
    try {
        const cleanedPlaylist = playlist.map(song => {
            if (!song || typeof song !== 'object') return song;
            const cleaned = { ...song };
            // Blob URL 无法跨刷新持久化（刷新后会失效），统一清理成默认封面
            if (typeof cleaned.cover === 'string' && cleaned.cover.startsWith('blob:')) {
                cleaned.cover = 'IMG_20251115_090141.png';
            }
            return cleaned;
        });
        // 直接使用 localStorage.setItem 立即保存，与 search.html 保持一致
        localStorage.setItem('hjwjb_playlist', JSON.stringify(cleanedPlaylist));
        console.log('✅ 播放列表已保存到 localStorage，共', cleanedPlaylist.length, '首歌曲');
    } catch (error) {
        console.error('❌ 保存播放列表失败:', error);
    }
}

function deleteSong(index) {
    const song = playlist[index];
    const isCurrentSong = (index === currentSongIndex);
    
    // 清理 Blob URL
    if (song.url && song.url.startsWith('blob:')) BlobManager.revoke(song.url);

    // 删除歌曲
    playlist.splice(index, 1);
    
    // 调整当前播放索引
    if (currentSongIndex > index) {
        currentSongIndex--;
    } else if (currentSongIndex === index) {
        // 删除的是当前播放的歌曲
        if (playlist.length > 0) {
            // 播放下一首
            const nextIndex = Math.min(index, playlist.length - 1);
            requestPlaySong(nextIndex, { debounceMs: 0, reason: 'delete-song' });
        } else {
            // 没有歌曲了，停止播放
            stopPlayback();
            currentSongIndex = -1;
        }
    }
    
    // 如果播放列表为空，停止播放并重置
    if (playlist.length === 0) {
        stopPlayback();
        currentCover.src = 'IMG_20251115_090141.png';
        resetLyrics();
        resetProgress();
    }
    
    savePlaylist();
    updatePlaylistDisplay();
    createDanmaku('已删除歌曲');
}

// 停止播放
function stopPlayback() {
    audioAutoResumeToken += 1;
    isPlaying = false;
    playIcon.className = 'fas fa-play';
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
}

// 重置歌词显示
function resetLyrics() {
    const lyricsContainer = document.getElementById('lyrics-container');
    if (lyricsContainer) {
        lyricsContainer.innerHTML = '<div class="no-lyrics">暂无歌词</div>';
        lyricsContainer.classList.remove('has-lyrics');
        lyricsContainer.classList.add('lyrics-empty');
    }
}

// 重置进度条
function resetProgress() {
    const progress = document.getElementById('progress');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');
    if (progress) progress.style.width = '0%';
    if (currentTimeEl) currentTimeEl.textContent = '00:00';
    if (totalTimeEl) totalTimeEl.textContent = '00:00';
}

function deleteAllSongs() {
    Modal.confirm('确定要清空整个播放列表吗？', () => {
        // 清理所有 Blob URL
        playlist.forEach(song => {
            if (song.url && song.url.startsWith('blob:')) BlobManager.revoke(song.url);
        });
        
        // 停止音频播放
        audioAutoResumeToken += 1;
        isPlaying = false;
        playIcon.className = 'fas fa-play';
        audioPlayer.pause();
        audioPlayer.removeAttribute('src');
        audioPlayer.load();
        
        // 重置播放列表状态
        playlist = [];
        currentSongIndex = -1;
        
        // 重置封面
        currentCover.src = 'IMG_20251115_090141.png';
        
        // 重置歌词显示
        const lyricsContainer = document.getElementById('lyrics-container');
        if (lyricsContainer) {
            lyricsContainer.innerHTML = '<div class="no-lyrics">暂无歌词</div>';
            lyricsContainer.classList.remove('has-lyrics');
            lyricsContainer.classList.add('lyrics-empty');
        }
        
        // 重置进度条
        const progress = document.getElementById('progress');
        const currentTimeEl = document.getElementById('current-time');
        const totalTimeEl = document.getElementById('total-time');
        if (progress) progress.style.width = '0%';
        if (currentTimeEl) currentTimeEl.textContent = '00:00';
        if (totalTimeEl) totalTimeEl.textContent = '00:00';
        
        // 保存并更新显示
        savePlaylist();
        updatePlaylistDisplay();
        createDanmaku('已清空播放列表');
    });
}

// 初始化Service Worker
async function initServiceWorker() {
    // 检查是否支持Service Worker，并且页面是通过HTTP/HTTPS访问的
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        try {
            const registration = await navigator.serviceWorker.register('service-worker.js');
            console.log('✅ Service Worker注册成功:', registration);
            return registration;
        } catch (error) {
            console.error('❌ Service Worker注册失败:', error);
            return null;
        }
    } else {
        console.log('ℹ️ Service Worker不可用：当前环境不支持或页面通过file://协议访问');
        return null;
    }
}

// 初始化Media Session API
function initMediaSession() {
    if ('mediaSession' in navigator) {
        const ACTION_THROTTLE_MS = 220;
        let actionInFlight = false;
        let lastActionAt = 0;

        const shouldHandleAction = (action) => {
            const now = Date.now();
            if (actionInFlight) return false;
            if (now - lastActionAt < ACTION_THROTTLE_MS) return false;
            lastActionAt = now;

            try { claimPlayerLeader(`mediaSession:${String(action || '')}`, { force: true }); } catch {}
            try {
                if (typeof isPlayerLeader === 'function' && !isPlayerLeader()) return false;
            } catch (e) {
                // ignore
            }
            return true;
        };

        // 设置媒体会话事件处理程序
        // Do NOT use toggle for media-session actions; OS buttons expect idempotent play/pause.
        navigator.mediaSession.setActionHandler('play', () => {
            if (!shouldHandleAction('play')) return;
            try {
                if (currentSongIndex === -1 || playlist.length === 0) {
                    if (playlist.length > 0) requestPlaySong(0, { debounceMs: 0, reason: 'mediaSession:play-first' });
                    return;
                }

                // Idempotent: already playing -> noop.
                const hasSrc = !!(audioPlayer && (audioPlayer.currentSrc || audioPlayer.src));
                if (hasSrc && !audioPlayer.paused && !audioPlayer.ended) {
                    isPlaying = true;
                    try { playIcon.className = 'fas fa-pause'; } catch {}
                    updateMediaSessionPlaybackState();
                    return;
                }

                // If src was cleared by a previous failure, re-init via playSong.
                if (!hasSrc) {
                    requestPlaySong(currentSongIndex, { debounceMs: 0, reason: 'mediaSession:play-reinit' });
                    return;
                }

                actionInFlight = true;
                audioPlayer.play()
                    .then(() => {
                        isPlaying = true;
                        try { playIcon.className = 'fas fa-pause'; } catch {}
                        touchPlayerLeaderHeartbeat();
                        broadcastPlaybackClaim();
                        updateMediaSessionPlaybackState();
                    })
                    .catch(() => {
                        // fallback to existing logic
                        try { if (!isPlaying) togglePlayPause(); } catch { /* ignore */ }
                    })
                    .finally(() => {
                        actionInFlight = false;
                    });
            } catch (e) {
                // ignore
                actionInFlight = false;
            }
        });
        navigator.mediaSession.setActionHandler('pause', () => {
            if (!shouldHandleAction('pause')) return;
            try {
                if (currentSongIndex === -1 || playlist.length === 0) return;
                if (!audioPlayer.paused) {
                    pauseSong();
                } else {
                    isPlaying = false;
                    playIcon.className = 'fas fa-play';
                    updateMediaSessionPlaybackState();
                }
            } catch (e) {
                // ignore
            }
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
            if (!shouldHandleAction('previoustrack')) return;
            playPrevious();
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
            if (!shouldHandleAction('nexttrack')) return;
            playNext();
        });
        
        // 进度条支持（如果浏览器支持）
        if ('setPositionState' in navigator.mediaSession) {
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (details.fastSeek && audioPlayer.fastSeek) {
                    audioPlayer.fastSeek(details.seekTime);
                } else {
                    audioPlayer.currentTime = details.seekTime;
                }
                updateProgress();
            });
        }
        
        console.log('✅ Media Session API初始化完成');
    }
}

// 更新Media Session元数据
function updateMediaSessionMetadata(song) {
    if ('mediaSession' in navigator && song) {
        const pickArtworkSrc = () => {
            const candidates = [];
            try { if (song.cover) candidates.push(song.cover); } catch {}
            try { if (currentCover && currentCover.src) candidates.push(currentCover.src); } catch {}

            for (const candidate of candidates) {
                const raw = candidate != null ? String(candidate).trim() : '';
                if (!raw) continue;

                // Allow absolute http(s)/data/blob directly.
                if (/^(https?:|data:|blob:)/i.test(raw)) return raw;

                // Resolve relative paths only if they become an allowed scheme.
                try {
                    const u = new URL(raw, window.location.href);
                    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:' || u.protocol === 'blob:') {
                        return u.href;
                    }
                } catch (e) {
                    // ignore
                }
            }

            return '';
        };

        const artworkSrc = pickArtworkSrc();
        const payload = {
            title: song.title,
            artist: song.artist,
            album: song.album
        };

        if (artworkSrc) {
            payload.artwork = [{ src: artworkSrc, sizes: '512x512', type: 'image/png' }];
        }

        try {
            navigator.mediaSession.metadata = new MediaMetadata(payload);
        } catch (e) {
            // 某些浏览器对 artwork scheme 更严格，失败则回退为无 artwork
            try {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: song.title,
                    artist: song.artist,
                    album: song.album
                });
            } catch (e2) {
                // ignore
            }
        }
    }
}

// 更新Media Session播放状态
function updateMediaSessionPlaybackState() {
    if ('mediaSession' in navigator) {
        const actuallyPlaying = (() => {
            try {
                if (!audioPlayer) return false;
                const hasSrc = !!(audioPlayer.currentSrc || audioPlayer.src);
                if (!hasSrc) return false;
                return !audioPlayer.paused && !audioPlayer.ended;
            } catch (e) {
                return false;
            }
        })();

        navigator.mediaSession.playbackState = actuallyPlaying ? 'playing' : 'paused';
        
        // 更新进度条状态
        if ('setPositionState' in navigator.mediaSession) {
            navigator.mediaSession.setPositionState({
                duration: audioPlayer.duration || 0,
                playbackRate: audioPlayer.playbackRate || 1.0,
                position: audioPlayer.currentTime || 0
            });
        }
    }
}

const PLAYER_INSTANCE_ID_SESSION_KEY = 'hjwjb_player_instance_id_v1';
const PLAYER_LEADER_STORAGE_KEY = 'hjwjb_player_leader_v1';
const PLAYER_LEADER_TTL_MS = 4500;
let playerLeaderLastHeartbeatAt = 0;

function getPlayerInstanceId() {
    try {
        const existing = sessionStorage.getItem(PLAYER_INSTANCE_ID_SESSION_KEY);
        if (existing) return String(existing);
    } catch (e) {
        // ignore
    }

    let id = '';
    try {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const bytes = new Uint8Array(10);
            crypto.getRandomValues(bytes);
            id = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (e) {
        id = '';
    }
    if (!id) id = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;

    try {
        sessionStorage.setItem(PLAYER_INSTANCE_ID_SESSION_KEY, id);
    } catch (e) {
        // ignore
    }
    return id;
}

function readPlayerLeader() {
    try {
        const raw = localStorage.getItem(PLAYER_LEADER_STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        const id = data.id != null ? String(data.id) : '';
        const at = Number(data.at);
        if (!id || !Number.isFinite(at)) return null;
        return { id, at };
    } catch (e) {
        return null;
    }
}

function isPlayerLeader() {
    const leader = readPlayerLeader();
    if (!leader) return false;
    const now = Date.now();
    if (now - leader.at > PLAYER_LEADER_TTL_MS) return false;
    return leader.id === getPlayerInstanceId();
}

function claimPlayerLeader(reason = '', { force = false } = {}) {
    const now = Date.now();
    const id = getPlayerInstanceId();
    const leader = readPlayerLeader();
    const expired = !leader || now - leader.at > PLAYER_LEADER_TTL_MS;
    const same = leader && leader.id === id;

    if (force || expired || same) {
        try {
            localStorage.setItem(PLAYER_LEADER_STORAGE_KEY, JSON.stringify({ id, at: now, reason: reason || '' }));
            playerLeaderLastHeartbeatAt = now;
        } catch (e) {
            // ignore
        }
        return true;
    }

    return false;
}

function touchPlayerLeaderHeartbeat() {
    if (!isPlayerLeader()) return;
    const now = Date.now();
    if (now - playerLeaderLastHeartbeatAt < 2500) return;
    try {
        localStorage.setItem(PLAYER_LEADER_STORAGE_KEY, JSON.stringify({ id: getPlayerInstanceId(), at: now, reason: 'heartbeat' }));
        playerLeaderLastHeartbeatAt = now;
    } catch (e) {
        // ignore
    }
}

const HJWJB_PLAYER_CONTROL_CHANNEL = 'hjwjb_player_control_v1';
let hjwjbPlayerControlChannel = null;
let playNowConsumeTimer = null;

function initPlayerControlChannel() {
    if (hjwjbPlayerControlChannel || typeof BroadcastChannel === 'undefined') return;
    try {
        hjwjbPlayerControlChannel = new BroadcastChannel(HJWJB_PLAYER_CONTROL_CHANNEL);
        hjwjbPlayerControlChannel.addEventListener('message', (event) => {
            const data = event && event.data ? event.data : null;
            if (!data || typeof data !== 'object') return;

            if (data.type === 'PING') {
                try {
                    hjwjbPlayerControlChannel.postMessage({ type: 'PONG', at: Date.now(), id: getPlayerInstanceId() });
                } catch (e) {
                    // ignore
                }
                return;
            }

            if (data.type === 'FOCUS') {
                try {
                    window.focus();
                } catch (e) {
                    // ignore
                }
                return;
            }

            if (data.type === 'PLAY_NOW' && data.song) {
                try {
                    localStorage.setItem('hjwjb_current_song', JSON.stringify(data.song));
                    localStorage.setItem('hjwjb_play_now', 'true');
                } catch (e) {
                    // ignore
                }
                scheduleConsumePlayNowRequest('broadcast');
                return;
            }

            if (data.type === 'CLAIM_PLAYBACK') {
                const claimedId = data.id != null ? String(data.id) : '';
                if (!claimedId || claimedId === getPlayerInstanceId()) return;

                // Another tab started playback: pause this tab to avoid multiple instances playing simultaneously.
                try {
                    const actuallyPlaying = !!(audioPlayer && !audioPlayer.paused && (audioPlayer.currentSrc || audioPlayer.src));
                    if (actuallyPlaying || isPlaying) {
                        console.warn('🛑 检测到其他页面正在播放，本页暂停以避免多实例同时播放');
                        pauseSong();
                        createDanmaku('已在其他页面播放，本页已暂停');
                    }
                } catch (e) {
                    // ignore
                }
            }
        });
    } catch (e) {
        hjwjbPlayerControlChannel = null;
    }
}

function broadcastPlaybackClaim() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
        if (!hjwjbPlayerControlChannel) initPlayerControlChannel();
        if (!hjwjbPlayerControlChannel) return;
        hjwjbPlayerControlChannel.postMessage({ type: 'CLAIM_PLAYBACK', id: getPlayerInstanceId(), at: Date.now() });
    } catch (e) {
        // ignore
    }
}

function scheduleConsumePlayNowRequest(reason) {
    if (playNowConsumeTimer) clearTimeout(playNowConsumeTimer);
    playNowConsumeTimer = setTimeout(() => {
        consumePlayNowRequest({ reason: reason || 'storage' }).catch(() => {});
    }, 80);
}

async function consumePlayNowRequest({ reason = 'unknown' } = {}) {
    const playNow = StorageManager.getItem('hjwjb_play_now');
    const currentSongStr = StorageManager.getItem('hjwjb_current_song');

    if (!((playNow === true || playNow === 'true') && currentSongStr)) {
        return false;
    }

    // Only the active leader tab should consume PLAY_NOW; avoids multiple player tabs playing at once.
    try { claimPlayerLeader('consumePlayNowRequest'); } catch {}
    if (!isPlayerLeader()) {
        console.log('ℹ️ 当前标签页非主播放器，忽略 PLAY_NOW:', reason);
        return false;
    }

    console.log('🚀 检测到需要立即播放的歌曲（跨页/跨标签触发）:', reason);

    let song;
    try {
        song = typeof currentSongStr === 'string' ? JSON.parse(currentSongStr) : currentSongStr;
    } catch (e) {
        console.error('❌ 解析当前歌曲失败:', e);
        return false;
    }

    try {
        if (!song) return false;
        const songApi = song.api != null ? String(song.api).trim() : '';
        if (songApi === 'api15' || songApi === 'api2') {
            song.api = 'api10';
        }

        const songId = song.id != null ? String(song.id) : '';
        const index = songId
            ? playlist.findIndex((item) => item && item.id != null && String(item.id) === songId)
            : -1;

        if (index === -1) {
            console.log('➕ 将歌曲添加到播放列表并立即播放');
            playlist.push(song);
            savePlaylist();
            updatePlaylistDisplay();
            requestPlaySong(playlist.length - 1, { debounceMs: 0, reason: 'PLAY_NOW:add' });
        } else {
            console.log('🎯 歌曲已在播放列表中，直接播放');
            requestPlaySong(index, { debounceMs: 0, reason: 'PLAY_NOW:existing' });
        }
    } catch (e) {
        console.error('❌ 立即播放处理失败:', e);
    } finally {
        StorageManager.removeItem('hjwjb_play_now');
        StorageManager.removeItem('hjwjb_current_song');
    }

    return true;
}

// 初始化
async function init() {
    if (initHasRun) {
        console.warn('⚠️ init() 已执行，忽略重复初始化');
        return;
    }
    initHasRun = true;
    console.log('%c🎵 HJWJB音乐播放器初始化开始', 'color: #2ecc71; font-weight: bold');
    initPlayerControlChannel();
    try { claimPlayerLeader('init'); } catch {}
    
    // 初始化Service Worker
    await initServiceWorker();
    
    // 初始化Media Session API
    initMediaSession();
    
    // 加载本地存储的播放列表
    loadPlaylist();
    console.log('📋 加载的播放列表:', playlist);

    // 用户数据
    loadRecentPlayed();
    
    // 确保 API 选择器选项完整
    ensureApiSelectOptions();

    // 加载保存的音乐源选择
    loadSavedMusicSource();
    console.log('🎵 当前音乐源:', currentMusicSource);
    console.log('🔌 当前API:', currentApi);

    // 加载全局动画开关（会影响：弹幕/流光/滚动动画等）
    loadMotionSettings();
    
    // 加载弹幕设置
    loadBarrageSettings();
    console.log('📺 弹幕状态:', isBarrageEnabled ? '开启' : '关闭');
    
    // 加载主题设置
    loadThemeSettings();
    console.log('🎨 当前主题:', currentTheme === 'dark' ? '深色' : (currentTheme === 'light' ? '浅色' : '中性'));
    
    // 加载流光开关与歌词对齐设置
    loadStreamLightSettings();
    loadLyricsOffsetSettings();
    loadWordLyricsSettings();
    loadLyricsCollapseSettings();
    loadDailyQuoteText();
    setupFooterLinks();
    setupDailyQuoteControls();
    refreshDailyQuote({ reason: 'init' }).catch(() => {});
    
    // 绑定事件监听器
    bindEvents();
    console.log('🔗 事件监听器绑定完成');
    
    // 更新播放列表显示
    updatePlaylistDisplay();
    console.log('🖥️  播放列表显示更新完成');
    
    // 添加localStorage监听器，当播放列表数据变化时自动更新
    window.addEventListener('storage', function(e) {
        if (e.key === 'hjwjb_playlist') {
            console.log('🔄 检测到播放列表数据变化，自动更新');
            try {
                playlist = JSON.parse(e.newValue || '[]');
            } catch (err) {
                playlist = [];
            }
            updatePlaylistDisplay();
            scheduleApi2StatsRefresh({ forceFetch: true });
        }

        if (e.key === RECENT_PLAYED_STORAGE_KEY) {
            try { loadRecentPlayed(); } catch {}
        }

        if (e.key === 'hjwjb_play_now' || e.key === 'hjwjb_current_song') {
            scheduleConsumePlayNowRequest('storage');
        }

        if (e.key === 'hjwjb_current_api' || e.key === 'hjwjb_current_quality' || e.key === 'hjwjb_current_music_source') {
            console.log('🔄 检测到API/音质/音乐源设置变化，自动同步');
            try {
                loadSavedMusicSource();
                updateMusicSourceDisplay();
            } catch (err) {
                // ignore
            }
        }

        if (e.key === MOTION_ENABLED_STORAGE_KEY) {
            try { loadMotionSettings(); } catch {}
        }

        if (e.key === 'hjwjb_barrage_enabled') {
            try { loadBarrageSettings(); } catch {}
        }

        if (e.key === STREAM_LIGHT_ENABLED_STORAGE_KEY) {
            try { loadStreamLightSettings(); } catch {}
        }
    });
    console.log('👂 localStorage监听器添加完成');

    // Same-tab StorageManager writes (cloud sync apply, etc.)
    window.addEventListener('hjwjb-storage-write', function (e) {
        try {
            const key = e && e.detail ? e.detail.key : '';
            if (!key) return;

            if (key === 'hjwjb_playlist') {
                playlist = StorageManager.getItem('hjwjb_playlist', []);
                updatePlaylistDisplay({ reloadFromStorage: true });
                scheduleApi2StatsRefresh({ forceFetch: true });
                return;
            }

            if (key === RECENT_PLAYED_STORAGE_KEY) {
                loadRecentPlayed();
            }
        } catch (err) {
            // ignore
        }
    });
    
    // 添加页面可见性监听器，当页面重新获得焦点时更新播放列表
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            console.log('👁️  页面重新获得焦点，更新播放列表');
            playlist = StorageManager.getItem('hjwjb_playlist', []);
            updatePlaylistDisplay();
            scheduleApi2StatsRefresh({ forceFetch: true });
        }
    });
    console.log('👁️  页面可见性监听器添加完成');
    
    await consumePlayNowRequest({ reason: 'init' });
    
    // 更新当前音乐源显示
    updateMusicSourceDisplay();
    console.log('🖥️  音乐源显示更新完成');
    
    // 设置音乐源显示框点击切换功能
    setupMusicSourceSwitcher();
    console.log('🔄 音乐源切换功能设置完成');
    
    // 初始化主题切换按钮
    initThemeToggle();
    console.log('🎨 主题切换按钮初始化完成');
    
    // 初始化音质切换按钮
    updateQualitySwitchBtnVisibility();
    console.log('🎚️ 音质切换按钮初始化完成');

    // API2+QQ 音乐：进入主页/刷新时刷新一次“今日已解析歌曲数”
    scheduleApi2StatsRefresh({ forceFetch: true });
    
    console.log('%c✅ HJWJB音乐播放器初始化完成', 'color: #2ecc71; font-weight: bold');
}

// 加载保存的音乐源选择
// 直接使用 localStorage 确保与 search.html 保持一致
function loadSavedMusicSource() {
    const savedSource = localStorage.getItem('hjwjb_current_music_source');
    if (savedSource) currentMusicSource = savedSource;
    
    const savedApi = localStorage.getItem('hjwjb_current_api');
    if (savedApi) {
        const normalizedApi = savedApi === 'api15' ? 'api10' : savedApi;
        const allowedApis = ['api3', 'api4', 'api7', 'api8', 'api9', 'api10'];
        const fallbackApi = (() => {
            const source = String(savedSource || currentMusicSource || '').trim();
            return source === '酷我音乐' ? 'api4' : 'api10';
        })();

        const finalApi = allowedApis.includes(normalizedApi) ? normalizedApi : fallbackApi;
        currentApi = finalApi;
        if (finalApi !== savedApi) localStorage.setItem('hjwjb_current_api', finalApi);
        updateApiSources();
        if (apiSelect) apiSelect.value = currentApi;
        console.log('✅ 已加载保存的API设置:', currentApi);
    } else {
        console.log('ℹ️  没有保存的API设置，使用默认: api10');
    }

    const savedQuality = localStorage.getItem('hjwjb_current_quality');
    if (savedQuality) {
        if (currentApi === 'api4') {
            const normalized = normalizeBrQuality(savedQuality);
            currentQuality = normalized;
            if (normalized !== savedQuality) localStorage.setItem('hjwjb_current_quality', normalized);
        } else if (currentApi === 'api7') {
            const normalized = normalizeApi7Br(savedQuality);
            currentQuality = normalized;
            if (normalized !== String(savedQuality)) {
                localStorage.setItem('hjwjb_current_quality', normalized);
            }
        } else if (currentApi === 'api8') {
            const normalized = normalizeApi8Level(savedQuality);
            currentQuality = normalized;
            if (normalized !== savedQuality) {
                localStorage.setItem('hjwjb_current_quality', normalized);
            }
        } else {
            currentQuality = savedQuality;
        }
    } else if (currentApi === 'api4') {
        currentQuality = BR_QUALITY_DEFAULT;
    } else if (currentApi === 'api7') {
        currentQuality = '4';
    } else if (currentApi === 'api8') {
        currentQuality = API8_LEVEL_DEFAULT;
    }

    updateQualitySelectorVisibility();
    updateQualitySwitchBtnVisibility();
    if (qualitySelect) qualitySelect.value = currentQuality;
}

// 加载主题设置
// 直接使用 localStorage 确保与 search.html 保持一致
function loadThemeSettings() {
    const savedTheme = localStorage.getItem('hjwjb_theme');
    if (savedTheme) {
        currentTheme = savedTheme;
    } else {
        const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        currentTheme = isSystemDark ? 'dark' : 'light';
    }
    applyTheme();
    console.log('🎨 主题加载完成:', currentTheme);
}

// 保存主题设置
function saveThemeSettings() {
    localStorage.setItem('hjwjb_theme', currentTheme);
}

// 应用主题
function applyTheme() {
    // 移除所有主题类
    document.body.classList.remove('light-theme', 'dark-theme');
    
    // 添加当前主题类
    if (currentTheme === 'light') {
        document.body.classList.add('light-theme');
    } else if (currentTheme === 'dark') {
        document.body.classList.add('dark-theme');
    }
    // 中性主题不需要添加类
}

// 初始化主题切换按钮
function initThemeToggle() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        updateThemeToggleBtn();
    }
}

// 更新主题切换按钮显示
function updateThemeToggleBtn() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        const themeDisplayNames = {
            'neutral': '中性主题',
            'light': '浅色主题',
            'dark': '深色主题'
        };
        const themeIcons = {
            'neutral': 'fas fa-palette',
            'light': 'fas fa-sun',
            'dark': 'fas fa-moon'
        };

        themeToggleBtn.title = '点击切换主题';
        themeToggleBtn.innerHTML = `<i class="${themeIcons[currentTheme] || 'fas fa-palette'}"></i> 主题：${themeDisplayNames[currentTheme] || '中性主题'}`;
    }
}

// 切换主题
function toggleTheme() {
    // 主题切换顺序：neutral → light → dark → neutral
    const themeOrder = ['neutral', 'light', 'dark'];
    const currentIndex = themeOrder.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    const nextTheme = themeOrder[nextIndex];

    // 关闭动效时：不做过渡动画，直接切换
    if (!isMotionEnabled) {
        currentTheme = nextTheme;
        applyTheme();
        updateThemeToggleBtn();
        saveThemeSettings();
        return;
    }
    
    // 添加主题切换动画
    document.body.classList.add('theme-transition');
    
    // 延迟切换主题，等待动画开始
    setTimeout(() => {
        currentTheme = nextTheme;
        applyTheme();
        updateThemeToggleBtn();
        saveThemeSettings();
        
        // 获取主题名称
        const themeDisplayNames = {
            'neutral': '中性主题',
            'light': '浅色主题',
            'dark': '深色主题'
        };
        
        createDanmaku(`已切换到${themeDisplayNames[currentTheme]}`);
        console.log(`🎨 主题已切换为: ${currentTheme} (${themeDisplayNames[currentTheme]})`);
        
        // 动画结束后移除过渡类
        setTimeout(() => {
            document.body.classList.remove('theme-transition');
        }, 500);
    }, 100);
}

// 切换音质模式（最高/最低）
function toggleQualityMode() {
    isHighestQualityMode = !isHighestQualityMode;
    
    if (isHighestQualityMode) {
        qualitySwitchBtn.innerHTML = '<i class="fas fa-sort"></i> 最高音质';
        createDanmaku('已切换为最高音质模式');
    } else {
        qualitySwitchBtn.innerHTML = '<i class="fas fa-sort"></i> 最低音质';
        createDanmaku('已切换为最低音质模式');
    }
    
    console.log(`🎚️  音质模式已切换为：${isHighestQualityMode ? '最高音质' : '最低音质'}`);
}

// 更新音质切换按钮的可见性
function updateQualitySwitchBtnVisibility() {
    if (qualitySwitchBtn) {
        if (isMetingApi(currentApi)) {
            qualitySwitchBtn.style.display = 'inline-block';
        } else {
            qualitySwitchBtn.style.display = 'none';
        }
    }
}

// 绑定事件监听器
function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    // 播放控制按钮
    prevBtn.addEventListener('click', playPrevious);
    playPauseBtn.addEventListener('click', togglePlayPause);
    nextBtn.addEventListener('click', playNext);
    
    // 音频播放器事件
    audioPlayer.addEventListener('timeupdate', updateProgress);
    audioPlayer.addEventListener('loadedmetadata', updateDuration);
    audioPlayer.addEventListener('ended', playNext);
    audioPlayer.addEventListener('error', handleAudioError);
    audioPlayer.addEventListener('playing', () => {
        try { playIcon.className = 'fas fa-pause'; } catch {}
        updateMediaSessionPlaybackState();
    });
    
    // 添加音频暂停事件监听：只在“应该继续播放”的情况下 best-effort 恢复一次
    // 避免按下暂停/切歌等场景被强行复活，导致网络“一直请求”
    audioPlayer.addEventListener('pause', () => {
        if (!isPlaying || playlist.length === 0) return;
        if (audioErrorRecoveryPromise) return;

        console.log('⏸️  音频被暂停，best-effort 尝试恢复播放');
        try { playIcon.className = 'fas fa-play'; } catch {}
        updateMediaSessionPlaybackState();
        scheduleAutoResumePlayback('pause', { delayMs: 1000 });
    });
    
    // 进度条点击和触摸
    progressBar.addEventListener('click', setProgress);
    // We call `preventDefault()` inside `setProgress()` for touch events; must be non-passive.
    progressBar.addEventListener('touchstart', setProgress, { passive: false });
    progressBar.addEventListener('touchmove', setProgress, { passive: false });
    
    // 播放列表操作
    deleteAllBtn.addEventListener('click', deleteAllSongs);
    surpriseBtn.addEventListener('click', surpriseFunction);
    importBtn.addEventListener('click', importPlaylist);
    exportBtn.addEventListener('click', exportPlaylist);
    
    // API选择器事件
    if (apiSelect) {
        apiSelect.addEventListener('change', (e) => {
            selectApi(e.target.value);
            // 更新音质切换按钮的可见性
            updateQualitySwitchBtnVisibility();
        });
    }
    
    // 音质切换按钮事件
    if (qualitySwitchBtn) {
        qualitySwitchBtn.addEventListener('click', toggleQualityMode);
    }
    
    // 音质选择器事件
    if (qualitySelect) {
        qualitySelect.addEventListener('change', (e) => {
            selectQuality(e.target.value);
        });
    }
    
    // 歌词容器触摸和滚动事件
    if (lyricsContainer) {
        // 添加点击事件反馈
        lyricsContainer.addEventListener('click', (e) => {
            const targetLine = e.target.classList.contains('lyric-line')
                ? e.target
                : (e.target.classList.contains('lyric-word') ? e.target.closest('.lyric-line') : null);
            if (!targetLine) {
                // Compact layout: clicking blank area toggles lyrics collapse/expand.
                if (isCompactLayout()) toggleLyricsCollapsed();
                return;
            }
            if (targetLine) {
                // Tap feedback without scaling (scaling can overlap/cover adjacent lyric lines).
                try {
                    targetLine.classList.add('lyric-tap');
                    setTimeout(() => targetLine.classList.remove('lyric-tap'), 180);
                } catch (e) {
                    // ignore
                }
                
                // 点击歌词跳转到对应时间
                const lineTime = parseFloat(targetLine.dataset.time);
                if (!isNaN(lineTime)) {
                    // 点击跳转后立即恢复自动滚动（避免被 touchstart/scroll 误判卡住）
                    isManualScrolling = false;
                    clearTimeout(scrollTimeout);
                    audioPlayer.currentTime = Math.max(0, lineTime - lyricsOffsetSeconds);
                    updateLyrics(lineTime);
                }
            }
        });
        
        // 触摸开始事件
        lyricsContainer.addEventListener('touchstart', () => {
            markLyricsManualScroll();
        }, { passive: true });
        
        // 滚动事件
        lyricsContainer.addEventListener('scroll', () => {
            if (isAutoScrollingLyrics) return;
            markLyricsManualScroll();
        });
        
        // 触摸结束事件 - 添加惯性滚动效果
        lyricsContainer.addEventListener('touchend', () => {
            // 可以在这里添加惯性滚动的实现
        }, { passive: true });
        
        // 添加鼠标滚轮事件优化
        lyricsContainer.addEventListener('wheel', (e) => {
            markLyricsManualScroll();
        }, { passive: true });
    }
    
    // 页面可见性变化事件：仅在“本来就应该播放”的情况下尝试恢复（避免用户手动暂停后被强行播放）
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) scheduleAutoResumePlayback('visibilitychange', { delayMs: 180 });
        console.log(`📱 页面可见性变化: ${document.hidden ? '隐藏' : '可见'}，播放状态保持: ${isPlaying}`);
    });
    
    // 添加页面隐藏事件的替代方案（针对不同浏览器）
    document.addEventListener('webkitvisibilitychange', () => {
        if (!document.webkitHidden) scheduleAutoResumePlayback('webkitvisibilitychange', { delayMs: 180 });
    });
    
    // 添加页面冻结事件监听（针对现代浏览器）
    document.addEventListener('freeze', () => {
        // 页面冻结时，不暂停播放，让音频继续播放
        console.log('📱 页面被冻结，播放状态保持:', isPlaying);
    });
    
    document.addEventListener('resume', () => {
        scheduleAutoResumePlayback('resume', { delayMs: 180 });
    });

    // 用户切回本页时，优先把本页提升为“主播放器”
    window.addEventListener('focus', () => {
        try { claimPlayerLeader('focus', { force: true }); } catch {}
    });
    
    // 初始化按钮状态
    updateBarrageButton();
    updateStreamLightButton();
    updateLyricsOffsetButton();
    setupSettingsMenu();
    setupLyricsCollapseToggle();
}



// 更新当前音乐源显示
function updateMusicSourceDisplay() {
    const display = document.getElementById('current-music-source');
    if (display) {
        const safe = String(currentMusicSource || '').replace(/[<>&]/g, '');
        display.innerHTML = `<i class="fas fa-music"></i> 当前音乐源：${safe}`;
    }
}

let api2StatsLastFetchedAt = 0;
let api2StatsLoading = null;
let api2StatsRefreshTimer = 0;
let api2StatsLastMode = '';

function getApi2StatsMode() {
    if (currentApi !== 'api2') return '';
    if (currentMusicSource === 'QQ音乐') return 'qq';
    if (currentMusicSource === '酷狗音乐') return 'kugou';
    return '';
}

function shouldShowApi2StatsPanel() {
    return !!getApi2StatsMode();
}

async function refreshApi2Stats({ force = false } = {}) {
    if (!api2StatsPanel || !api2StatsCountEl) return null;
    const mode = getApi2StatsMode();
    if (!mode) return null;

    if (mode !== api2StatsLastMode) {
        api2StatsLastMode = mode;
        force = true;
        try {
            api2StatsCountEl.textContent = '--';
        } catch (e) {
            // ignore
        }
    }
    try {
        if (api2StatsDescEl) {
            api2StatsDescEl.textContent = mode === 'kugou' ? '今日歌曲解析次数' : '今日已解析歌曲数';
        }
    } catch (e) {
        // ignore
    }

    const now = Date.now();
    if (!force && now - api2StatsLastFetchedAt < 15000) return null;
    if (api2StatsLoading) return api2StatsLoading;

    api2StatsLoading = (async () => {
        try {
            let data = null;
            if (mode === 'kugou') {
                const url = buildApi2KugouUrl('/stats/parse/today', {});
                if (!url) throw new Error('Missing stats url');
                const resp = await fetch(url, { method: 'GET', cache: 'no-store' });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                data = await resp.json();
            } else {
                const candidateUrls = [];
                try {
                    // Prefer API2 QQ backend direct stats: https://<API2_BASE>/api/stats
                    const direct = buildApi2Url('/api/stats');
                    if (direct) candidateUrls.push(direct);
                } catch (e) {
                    // ignore
                }
                // Keep same-origin /api/stats as fallback (e.g. local dev server).
                // Note: when opened via file://, "/api/stats" becomes "file:///api/stats" and will always fail.
                try {
                    const proto = window.location && window.location.protocol ? String(window.location.protocol) : '';
                    if (proto === 'http:' || proto === 'https:') candidateUrls.push('/api/stats');
                } catch (e) {
                    // ignore
                }

                const uniqueUrls = Array.from(new Set(candidateUrls.filter(Boolean)));
                let lastError = null;
                for (const url of uniqueUrls) {
                    try {
                        const resp = await fetch(url, { method: 'GET', cache: 'no-store' });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        data = await resp.json();
                        break;
                    } catch (e) {
                        lastError = e;
                    }
                }
                if (!data && lastError) throw lastError;
            }

            const rawCount = mode === 'kugou'
                ? (data && data.data && data.data.count != null ? data.data.count : null)
                : (data && data.song_url && data.song_url.parsed != null ? data.song_url.parsed : null) ??
                  (data && data.resolvedMidCount != null ? data.resolvedMidCount : null);
            const count = rawCount == null ? null : Number(rawCount);
            api2StatsCountEl.textContent = Number.isFinite(count) ? String(count) : '--';
            api2StatsLastFetchedAt = Date.now();
            return data;
        } catch (e) {
            api2StatsLastFetchedAt = Date.now();
            api2StatsCountEl.textContent = '--';
            return null;
        } finally {
            api2StatsLoading = null;
        }
    })();

    return api2StatsLoading;
}

function updateApi2StatsPanel({ forceFetch = false } = {}) {
    if (!api2StatsPanel) return;
    const show = shouldShowApi2StatsPanel();
    api2StatsPanel.hidden = !show;
    if (!show) return;
    try {
        refreshApi2Stats({ force: forceFetch });
    } catch (e) {
        // ignore
    }
}

function scheduleApi2StatsRefresh({ forceFetch = true } = {}) {
    if (!api2StatsPanel || !api2StatsCountEl) return;
    if (!shouldShowApi2StatsPanel()) return;
    if (api2StatsRefreshTimer) window.clearTimeout(api2StatsRefreshTimer);
    api2StatsRefreshTimer = window.setTimeout(() => {
        api2StatsRefreshTimer = 0;
        updateApi2StatsPanel({ forceFetch });
    }, 120);
}

// 更新当前API可用的音乐源列表
function updateApiSources() {
    console.log('%c🔄 开始更新API可用音乐源列表', 'color: #9b59b6; font-weight: bold');
    
    // 根据当前API更新可用的音乐源选项
    let availableSources;
    if (currentApi === 'api3') {
        // API3只支持网易云音乐
        availableSources = api3Sources;
    } else if (currentApi === 'api4') {
        // API4 只支持酷我音乐（kw-api.cenguigui.cn）
        availableSources = api4Sources;
    } else if (currentApi === 'api7') {
        // API7只支持QQ音乐
        availableSources = api7Sources;
    } else if (currentApi === 'api8') {
        // API8只支持网易云音乐
        availableSources = api8Sources;
    } else if (currentApi === 'api9') {
        availableSources = api9Sources;
    } else if (currentApi === 'api10') {
        availableSources = api10Sources;
    } else {
        // 未知API：回退到 API10 的可用列表
        availableSources = api10Sources;
    }
    
    apiSources = availableSources;
    console.log('📋 当前API可用音乐源:', apiSources);
    
    // 如果当前选择的音乐源不在当前API的可用列表中，切换到第一个可用源
    if (!apiSources.includes(currentMusicSource)) {
        console.log(`⚠️ 当前音乐源 ${currentMusicSource} 不在新API的可用列表中，自动切换到: ${apiSources[0]}`);
        currentMusicSource = apiSources[0];
        updateMusicSourceDisplay();
        try {
            localStorage.setItem('hjwjb_current_music_source', currentMusicSource);
        } catch (e) {
            // ignore
        }
    }

    updateApi2StatsPanel({ forceFetch: true });
    
    console.log('✅ API可用音乐源列表更新完成');
}

// 更新音质选择器的可见性
function updateQualitySelectorVisibility() {
    console.log('%c👁️ 更新音质选择器可见性', 'color: #3498db; font-weight: bold');
    console.log(`🔌 当前API: ${currentApi}`);
    
    if (qualitySelect) {
        const qualitySelectContainer = qualitySelect.closest('.api-switch-container');
        if (qualitySelectContainer) {
            if (currentApi === 'api4' || currentApi === 'api3') {
                qualitySelectContainer.style.display = 'block';
                const normalized = normalizeBrQuality(currentQuality);
                if (normalized !== currentQuality) {
                    currentQuality = normalized;
                    localStorage.setItem('hjwjb_current_quality', normalized);
                }
                qualitySelect.innerHTML = `
                    <option value="999">无损 (999) - 默认</option>
                    <option value="740">无损 (740)</option>
                    <option value="320">320K</option>
                    <option value="192">192K</option>
                    <option value="128">128K</option>
                `;
                qualitySelect.value = currentQuality;
                console.log(`✅ ${currentApi.toUpperCase()} - 显示音质选择器`);
            } else if (currentApi === 'api7') {
                qualitySelectContainer.style.display = 'block';
                const normalized = normalizeApi7Br(currentQuality);
                if (normalized !== currentQuality) {
                    currentQuality = normalized;
                    localStorage.setItem('hjwjb_current_quality', normalized);
                }
                qualitySelect.innerHTML = `
                    <option value="4">无损 (FLAC)</option>
                    <option value="3">320K</option>
                    <option value="2">192K</option>
                    <option value="1">128K</option>
                `;
                qualitySelect.value = currentQuality || '4';
                console.log('✅ API7 - 显示音质选择器');
            } else if (currentApi === 'api8') {
                qualitySelectContainer.style.display = 'block';
                const normalized = normalizeApi8Level(currentQuality);
                if (normalized !== currentQuality) {
                    currentQuality = normalized;
                    localStorage.setItem('hjwjb_current_quality', normalized);
                }
                qualitySelect.innerHTML = `
                    <option value="standard">标准</option>
                    <option value="higher">较高</option>
                    <option value="exhigh">极高</option>
                    <option value="lossless">无损</option>
                    <option value="hire">高清</option>
                `;
                qualitySelect.value = currentQuality || API8_LEVEL_DEFAULT;
                console.log('✅ API8 - 显示音质选择器');
            } else {
                qualitySelectContainer.style.display = 'none';
                console.log('✅ 当前API不支持音质下拉 - 已隐藏音质选择器');
            }
        }
    }
}

// 点击音乐源显示框切换音乐源
function setupMusicSourceSwitcher() {
    console.log('%c🔄 开始设置音乐源切换器', 'color: #f39c12; font-weight: bold');
    const display = document.querySelector('.music-source-display');
    if (display) {
        display.style.cursor = 'pointer';
        display.addEventListener('click', () => {
            // 找到当前音乐源的索引
            const currentIndex = apiSources.indexOf(currentMusicSource);
            // 切换到下一个音乐源
            const nextIndex = (currentIndex + 1) % apiSources.length;
            const nextSource = apiSources[nextIndex];
            console.log('🔄 音乐源点击切换:', currentMusicSource, '→', nextSource);
            // 选择新的音乐源
            selectMusicSource(nextSource);
        });
        console.log('✅ 音乐源切换器设置完成');
    } else {
        console.warn('⚠️ 未找到音乐源显示元素，无法设置切换器');
    }
}

// 选择音乐源
function selectMusicSource(sourceName) {
    console.log(`%c🎵 开始切换音乐源: ${currentMusicSource} → ${sourceName}`, 'color: #f39c12; font-weight: bold');
    currentMusicSource = sourceName;
    updateMusicSourceDisplay();
    updateApi2StatsPanel({ forceFetch: true });
    updateQualitySelectorVisibility();
    createDanmaku(`已选择：${sourceName}`);
    localStorage.setItem('hjwjb_current_music_source', sourceName);
    console.log('✅ 音乐源切换完成，已保存到本地存储');
}

// 选择API
function selectApi(apiName) {
    const requestedApi = String(apiName || '').trim();
    const allowedApis = ['api3', 'api4', 'api7', 'api8', 'api9', 'api10'];
    const fallbackApi = String(currentMusicSource || '').trim() === '酷我音乐' ? 'api4' : 'api10';
    const nextApi = allowedApis.includes(requestedApi) ? requestedApi : fallbackApi;

    console.log(`%c🔌 开始切换API: ${currentApi} → ${nextApi}`, 'color: #9b59b6; font-weight: bold');
    currentApi = nextApi;
    updateApiSources();
    localStorage.setItem('hjwjb_current_api', currentApi);
    updateQualitySelectorVisibility();
    updateQualitySwitchBtnVisibility();
    if (apiSelect) apiSelect.value = currentApi;
    
    // 显示API切换提示
    let apiDisplay;
    switch(nextApi) {
    case 'api3':
        apiDisplay = 'API 3';
        break;
    case 'api4':
        apiDisplay = 'API 4';
        break;
    case 'api7':
        apiDisplay = 'API 7';
        break;
    case 'api8':
        apiDisplay = 'API 8';
        break;
    case 'api9':
        apiDisplay = 'API 9';
        break;
    case 'api10':
        apiDisplay = 'API 10';
        break;
    default:
        apiDisplay = '未知API';
    }
    createDanmaku(`API已切换为${apiDisplay}`);
    console.log('✅ API切换完成，可用音乐源已更新为:', apiSources);
}

// 选择音质
async function selectQuality(qualityName) {
    console.log(`%c🎧 开始切换音质: ${currentQuality} → ${qualityName}`, 'color: #e74c3c; font-weight: bold');
    if (currentApi === 'api7') {
        currentQuality = normalizeApi7Br(qualityName);
    } else if (currentApi === 'api4') {
        currentQuality = normalizeBrQuality(qualityName);
    } else if (currentApi === 'api8') {
        currentQuality = normalizeApi8Level(qualityName);
    } else {
        currentQuality = qualityName;
    }
    localStorage.setItem('hjwjb_current_quality', currentQuality);
    if (qualitySelect) qualitySelect.value = currentQuality;
    
    let qualityDisplay = '';
    if (currentApi === 'api7') {
        const map = { '4': '无损 (FLAC)', '3': '320K', '2': '192K', '1': '128K' };
        qualityDisplay = map[String(currentQuality)] || String(currentQuality);
    } else if (currentApi === 'api4') {
        qualityDisplay = getBrQualityDisplayName(currentQuality);
    } else if (currentApi === 'api8') {
        qualityDisplay = getApi8LevelDisplayName(currentQuality);
    } else {
        const qualityDisplayNames = {
            'flac24bit': 'Hi-Res (flac24bit)',
            'flac': '无损 (flac)',
            '320k': '高品质 (320k)',
            '128k': '标准 (128k)'
        };
        qualityDisplay = qualityDisplayNames[currentQuality] || currentQuality;
    }
    
    createDanmaku(`音质已切换为${qualityDisplay}`);
    
    // 如果有正在播放的歌曲，更新其URL以使用新的音质
    if (currentSongIndex >= 0 && playlist[currentSongIndex]) {
        console.log('🔄 更新当前播放歌曲的URL以使用新音质');
        const song = playlist[currentSongIndex];
        
        // 根据当前API和音乐源获取对应的平台标识
        const source = currentApi === 'api8' ? 'netease' : getSourceForApi(currentMusicSource);
        
        try {
            // 使用新的音质获取歌曲URL
            const newUrl = await getSongUrlWithFallback(song.id, source, currentApi, currentQuality);
            if (newUrl) {
                console.log('✅ 当前播放歌曲URL更新成功');
                song.url = newUrl;
                
                // 如果正在播放，更新音频源并继续播放
                if (isPlaying) {
                    console.log('🔊 更新音频源以使用新音质');
                    const resumeTime = audioPlayer.currentTime;
                    audioPlayer.src = processAudioUrl(newUrl);
                    try {
                        audioPlayer.currentTime = resumeTime;
                    } catch (e) {
                        // ignore
                    }
                    audioPlayer.play();
                }
            }
        } catch (error) {
            console.error('❌ 更新当前播放歌曲URL失败:', error);
        }
    }
    
    console.log('✅ 音质切换完成');
}

// 高亮显示当前音乐源
function highlightCurrentMusicSource() {
    console.log('%c🎨 高亮显示当前音乐源', 'color: #3498db; font-weight: bold');
    console.log(`🎵 当前音乐源: ${currentMusicSource}`);
    // 这个函数用于在UI上高亮显示当前选择的音乐源
    // 实际实现需要根据具体的UI结构来调整
}

// 更新播放进度
function updateProgress() {
    const { currentTime, duration } = audioPlayer;
    
    if (!Number.isFinite(duration) || duration <= 0) {
        progress.style.width = '0%';
    } else {
        progress.style.width = `${(currentTime / duration) * 100}%`;
    }
    
    // 更新时间显示
    currentTimeEl.textContent = formatTime(currentTime);
    
    // 更新歌词
    updateLyrics(currentTime + lyricsOffsetSeconds);
    
    // 更新Media Session播放状态和进度
    updateMediaSessionPlaybackState();
    touchPlayerLeaderHeartbeat();
}

// 更新总时长
function updateDuration() {
    totalTimeEl.textContent = formatTime(audioPlayer.duration);
}

// 处理音频错误
function handleAudioError(event) {
    const error = event && event.target ? event.target.error : null;
    const code = error && typeof error.code === 'number' ? error.code : 0;
    const currentSrc = audioPlayer.currentSrc || audioPlayer.src || '';

    console.error('%c❌ 音频播放错误', 'color: #e74c3c; font-weight: bold');
    console.error('🔍 错误类型:', code);
    console.error('📝 错误信息:', (error && error.message) ? error.message : '无错误信息');
    console.error('🔗 音频URL:', currentSrc);

    const now = Date.now();
    if (handlePlaybackInProgress || now < suppressAudioErrorsUntil) {
        console.warn('ℹ️ 错误发生在播放初始化阶段，交由上层重试/切换逻辑处理');
        return;
    }
    if (audioErrorRecoveryPromise) {
        console.warn('ℹ️ 已在执行错误恢复，忽略重复错误');
        return;
    }

    // Update UI to "paused" immediately (actual state).
    try { playIcon.className = 'fas fa-play'; } catch (e) { /* ignore */ }
    updateMediaSessionPlaybackState();

    // 根据错误类型显示不同的提示
    let errorMessage = '音频播放失败';
    switch (code) {
    case 1: // MEDIA_ERR_ABORTED
        errorMessage = '音频加载被中止';
        break;
    case 2: // MEDIA_ERR_NETWORK
        errorMessage = '网络错误导致音频加载失败';
        break;
    case 3: // MEDIA_ERR_DECODE
        errorMessage = '音频解码失败，可能是格式不支持';
        break;
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
        errorMessage = '不支持的音频源或格式';
        break;
    default:
        errorMessage = `未知错误导致音频播放失败 (错误码: ${code})`;
    }

    const idx = Number.isInteger(currentSongIndex) ? currentSongIndex : -1;
    if (!(idx >= 0 && idx < playlist.length)) {
        isPlaying = false;
        createDanmaku(errorMessage);
        return;
    }

    // If user already paused, don't auto-recover.
    if (!isPlaying) {
        createDanmaku(errorMessage);
        return;
    }

    // Auto-recover for network-like errors (signed URL expired, temporary network issue, etc.).
    const recoverable = code === 2 || code === 4;
    if (!recoverable) {
        isPlaying = false;
        try { recordPlaybackFailure('audioError', { code, message: errorMessage }); } catch {}
        createDanmaku(errorMessage);
        return;
    }

    if (isPlaybackCircuitOpen()) {
        isPlaying = false;
        createDanmaku(`${errorMessage}（网络不稳定，已暂停自动重试）`);
        return;
    }

    const tokenAtError = playSongToken;
    const indexAtError = idx;
    const resumeTime = Number.isFinite(audioPlayer.currentTime) && audioPlayer.currentTime > 0 ? audioPlayer.currentTime : 0;

    if (now - lastAudioErrorRecoveryAt < 2500) {
        console.warn('⏳ 错误恢复触发过于频繁，跳过本次自动恢复');
        isPlaying = false;
        try { recordPlaybackFailure('audioError:tooFrequent', { code, message: errorMessage }); } catch {}
        createDanmaku(errorMessage);
        return;
    }
    lastAudioErrorRecoveryAt = now;

    audioErrorRecoveryPromise = (async () => {
        try {
            console.warn('🔄 检测到播放错误，尝试刷新链接并续播...');
            suppressAudioErrorsUntil = Date.now() + 1200;

            const song = playlist[indexAtError];
            const refreshed = await refreshSongUrlForPlayback(indexAtError, song, { reason: 'audioError' });
            if (tokenAtError !== playSongToken || indexAtError !== currentSongIndex) return false;
            if (!refreshed || !refreshed.success || !refreshed.url) return false;

            const ok = await handlePlayback(refreshed.url, song, { suppressErrorDanmaku: true, resumeTime });
            if (tokenAtError !== playSongToken || indexAtError !== currentSongIndex) return false;
            if (!ok) return false;

            try { updateMediaSessionMetadata(song); } catch {}
            updateMediaSessionPlaybackState();
            console.log('✅ 已自动刷新并恢复播放');
            return true;
        } catch (e) {
            return false;
        }
    })();

    audioErrorRecoveryPromise
        .then((ok) => {
            if (ok) return;
            if (tokenAtError !== playSongToken || indexAtError !== currentSongIndex) return;
            isPlaying = false;
            try { playIcon.className = 'fas fa-play'; } catch {}
            updateMediaSessionPlaybackState();
            try { recordPlaybackFailure('audioError:recoverFailed', { code, message: errorMessage }); } catch {}
            createDanmaku(errorMessage);
        })
        .catch(() => {
            if (tokenAtError !== playSongToken || indexAtError !== currentSongIndex) return;
            isPlaying = false;
            try { playIcon.className = 'fas fa-play'; } catch {}
            updateMediaSessionPlaybackState();
            try { recordPlaybackFailure('audioError:recoverFailed', { code, message: errorMessage }); } catch {}
            createDanmaku(errorMessage);
        })
        .finally(() => {
            audioErrorRecoveryPromise = null;
        });
}

// 设置播放进度
function setProgress(e) {
    console.log('%c🎯 设置播放进度', 'color: #e67e22; font-weight: bold');
    const width = this.clientWidth;
    let clickX;
    
    // 处理触摸事件
    if (e.touches) {
        // 阻止默认行为，防止页面滚动
        e.preventDefault();
        clickX = e.touches[0].clientX - this.getBoundingClientRect().left;
        console.log(`📱 触摸事件，点击位置: ${clickX}px`);
    } else {
        // 处理鼠标点击事件
        clickX = e.offsetX;
        console.log(`🖱️  鼠标事件，点击位置: ${clickX}px`);
    }
    
    const duration = audioPlayer.duration;
    if (isNaN(duration)) {
        console.warn('⚠️  音频时长未就绪，无法设置进度');
        return;
    }
    
    const progressPercent = (clickX / width) * 100;
    const newTime = (clickX / width) * duration;
    console.log(`📊 设置新进度: ${formatTime(newTime)} (${progressPercent.toFixed(1)}%)`);
    audioPlayer.currentTime = newTime;
}

// 格式化时间
function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 切换播放/暂停
function togglePlayPause() {
    console.log(`%c⏯️  切换播放/暂停状态，当前状态: ${isPlaying ? '播放中' : '已暂停'}`, 'color: #e74c3c; font-weight: bold');

    const now = Date.now();
    if (playPauseActionInFlight) {
        console.log('⏳ 播放/暂停操作进行中，忽略连点');
        return;
    }
    if (now - playPauseLastActionAt < 220) {
        console.log('⏳ 播放/暂停点击过快，忽略');
        return;
    }
    playPauseLastActionAt = now;
    try { claimPlayerLeader('togglePlayPause', { force: true }); } catch {}
    
    if (currentSongIndex === -1 || playlist.length === 0) {
        console.log('⚠️  播放列表为空或无当前歌曲');
        // 如果没有歌曲，播放第一首
        if (playlist.length > 0) {
            console.log('🎶 开始播放第一首歌曲');
            requestPlaySong(0, { debounceMs: 0, reason: 'togglePlayPause:play-first' });
        }
        return;
    }

    const actuallyPaused = !!audioPlayer.paused || !(audioPlayer.currentSrc || audioPlayer.src);
    if (!actuallyPaused) {
        console.log('⏸️  暂停当前歌曲');
        pauseSong();
        return;
    }

    console.log('▶️  继续播放当前歌曲');

    // If we don't have a usable src (e.g. previous failure removed it), re-init via playSong.
    if (!(audioPlayer.currentSrc || audioPlayer.src)) {
        requestPlaySong(currentSongIndex, { debounceMs: 0, reason: 'togglePlayPause:resume-reinit' });
        return;
    }

    playPauseActionInFlight = true;
    audioPlayer.play()
        .then(() => {
            isPlaying = true;
            playIcon.className = 'fas fa-pause';
            console.log('✅ 播放状态更新完成');
            touchPlayerLeaderHeartbeat();
            broadcastPlaybackClaim();
            updateMediaSessionPlaybackState();
        })
        .catch(error => {
            if (error && error.name === 'AbortError') {
                console.log('ℹ️ 继续播放被中断（快速暂停/切歌）');
                return;
            }
            console.error('❌ 继续播放失败:', error);
        })
        .finally(() => {
            playPauseActionInFlight = false;
        });
}

// 查找播放列表中第一个有封面的歌曲
function findFirstSongWithCover() {
    console.log('🔍 查找播放列表中第一个有封面的歌曲');
    for (let i = 0; i < playlist.length; i++) {
        const cover = playlist[i] && typeof playlist[i].cover === 'string' ? playlist[i].cover.trim() : '';
        if (!cover) continue;
        // Blob URL 刷新后会失效，避免保存/回放时出现 ERR_FILE_NOT_FOUND
        if (cover.startsWith('blob:')) continue;
        console.log('✅ 找到封面，歌曲索引:', i, '歌曲名:', playlist[i].title);
        return cover;
    }
    console.warn('❌ 未找到任何有封面的歌曲或所有封面都无效');
    return null;
}

// 暂停歌曲
function pauseSong() {
    console.log('%c⏸️  开始暂停当前歌曲', 'color: #e74c3c; font-weight: bold');
    isPlaying = false;
    playIcon.className = 'fas fa-play';
    audioAutoResumeToken += 1;
    audioPlayer.pause();
    
    // 更新Media Session播放状态
    updateMediaSessionPlaybackState();
    
    console.log('✅ 歌曲暂停完成');
}

// 播放上一首
function playPrevious() {
    console.log(`%c⏮️  播放上一首歌曲，当前索引: ${currentSongIndex}`, 'color: #3498db; font-weight: bold');
    
    if (playlist.length === 0) {
        console.log('⚠️  播放列表为空，无法播放上一首');
        return;
    }

    const baseIndex = Number.isInteger(pendingPlaySongIndex) ? pendingPlaySongIndex : currentSongIndex;
    const from = Number.isInteger(baseIndex) && baseIndex >= 0 ? baseIndex : 0;
    const nextIndex = (from - 1 + playlist.length) % playlist.length;
    console.log('🎯 切换到索引:', nextIndex);
    requestPlaySong(nextIndex, { reason: 'playPrevious', debounceMs: 80 });
}

// 播放下一首
function playNext() {
    console.log(`%c⏭️  播放下一首歌曲，当前索引: ${currentSongIndex}`, 'color: #3498db; font-weight: bold');
    
    if (playlist.length === 0) {
        console.log('⚠️  播放列表为空，无法播放下一首');
        return;
    }

    const baseIndex = Number.isInteger(pendingPlaySongIndex) ? pendingPlaySongIndex : currentSongIndex;
    const from = Number.isInteger(baseIndex) && baseIndex >= 0 ? baseIndex : 0;
    const nextIndex = (from + 1) % playlist.length;
    console.log('🎯 切换到索引:', nextIndex);
    requestPlaySong(nextIndex, { reason: 'playNext', debounceMs: 80 });
}

// 更新歌词 - 优化版本，使用requestAnimationFrame确保60fps
function updateLyrics(currentTime) {
    const lyricLines = document.querySelectorAll('.lyric-line');
    if (lyricLines.length === 0) {
        return;
    }
    
    let activeIndex = -1;
    
    // 找到当前时间对应的歌词
    for (let i = 0; i < lyricLines.length; i++) {
        const lineTime = parseFloat(lyricLines[i].dataset.time);
        if (currentTime >= lineTime) {
            activeIndex = i;
        } else {
            break;
        }
    }

    // 收起歌词时：保证始终有一行可见（没有命中时使用第一行）
    if (activeIndex < 0 && isLyricsCollapsed) {
        activeIndex = 0;
    }
    
    // 移除所有激活状态
    lyricLines.forEach((line, idx) => {
        line.classList.remove('active', 'past', 'future');

        if (activeIndex >= 0) {
            if (idx < activeIndex) line.classList.add('past');
            else if (idx > activeIndex) line.classList.add('future');
        } else {
            line.classList.add('future');
        }

        const words = line.querySelectorAll('.lyric-word');
        if (words.length) {
            words.forEach((word) => word.classList.remove('word-active', 'word-past'));
        }
    });
    
    // 设置当前激活的歌词
    if (activeIndex >= 0) {
        const activeLine = lyricLines[activeIndex];
        activeLine.classList.add('active');

        const wordSpans = activeLine.querySelectorAll('.lyric-word');
        if (wordSpans.length) {
            let activeWordIndex = -1;
            for (let i = 0; i < wordSpans.length; i++) {
                const wordTime = parseFloat(wordSpans[i].dataset.time);
                if (currentTime >= wordTime) {
                    activeWordIndex = i;
                } else {
                    break;
                }
            }
            wordSpans.forEach((word, idx) => {
                word.classList.remove('word-active', 'word-past');
                if (activeWordIndex >= 0 && idx < activeWordIndex) word.classList.add('word-past');
            });

            if (activeWordIndex >= 0 && wordSpans[activeWordIndex]) {
                wordSpans[activeWordIndex].classList.add('word-active');
            }
        }
        
        // 滚动到当前歌词（仅当不是手动滚动时）
        if (!isManualScrolling) {
            requestAnimationFrame(() => {
                const containerHeight = lyricsContainer.clientHeight;
                const lineHeight = activeLine.offsetHeight;
                const ratio =
                    typeof LYRICS_ACTIVE_LINE_TARGET_RATIO === 'number' && Number.isFinite(LYRICS_ACTIVE_LINE_TARGET_RATIO)
                        ? Math.max(0.2, Math.min(0.8, LYRICS_ACTIVE_LINE_TARGET_RATIO))
                        : 0.42;
                const scrollPosition = activeLine.offsetTop - containerHeight * ratio + lineHeight / 2;
                const maxScroll = Math.max(0, lyricsContainer.scrollHeight - containerHeight);
                const clamped = Math.max(0, Math.min(maxScroll, scrollPosition));
                
                // 使用requestAnimationFrame和transform实现更流畅的滚动
                smoothScrollTo(lyricsContainer, clamped, 300);
            });
        }
    }
}

// 平滑滚动函数 - 使用requestAnimationFrame优化
function smoothScrollTo(element, targetPosition, duration) {
    if (!element) return;
    const startPosition = element.scrollTop;
    const distance = targetPosition - startPosition;
    let startTime = null;
    const isLyricsScroll = element === lyricsContainer;
    const token = isLyricsScroll ? ++lyricsAutoScrollToken : 0;
    if (isLyricsScroll) bumpLyricsAutoScrollGuard(token);

    // 关闭动效时：立即滚动到目标位置
    if (!isMotionEnabled || !duration || duration <= 0 || Math.abs(distance) < 1) {
        element.scrollTop = targetPosition;
        if (isLyricsScroll) bumpLyricsAutoScrollGuard(token);
        return;
    }
    
    function animation(currentTime) {
        // Cancel older lyric scroll animations when a newer one starts.
        if (isLyricsScroll && token !== lyricsAutoScrollToken) return;
        if (startTime === null) startTime = currentTime;
        const timeElapsed = currentTime - startTime;
        const run = easeInOutQuad(timeElapsed, startPosition, distance, duration);
        element.scrollTop = run;
        if (isLyricsScroll) bumpLyricsAutoScrollGuard(token);
        if (timeElapsed < duration) {
            requestAnimationFrame(animation);
        } else if (isLyricsScroll) {
            // 最后一帧确保到位，并延迟关闭 guard
            element.scrollTop = targetPosition;
            bumpLyricsAutoScrollGuard(token);
        }
    }
    
    // 缓动函数 - 实现平滑的加速减速效果
    function easeInOutQuad(t, b, c, d) {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t + b;
        t--;
        return -c / 2 * (t * (t - 2) - 1) + b;
    }
    
    requestAnimationFrame(animation);
}

function loadDownloadCapabilities() {
    try {
        const raw = localStorage.getItem(DOWNLOAD_CAPABILITIES_STORAGE_KEY);
        if (!raw) return { version: 1, sources: {}, songs: {} };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { version: 1, sources: {}, songs: {} };
        const sources = parsed.sources && typeof parsed.sources === 'object' ? parsed.sources : {};
        const songs = parsed.songs && typeof parsed.songs === 'object' ? parsed.songs : {};
        return { version: 1, sources, songs };
    } catch (e) {
        return { version: 1, sources: {}, songs: {} };
    }
}

function saveDownloadCapabilities(caps) {
    try {
        localStorage.setItem(DOWNLOAD_CAPABILITIES_STORAGE_KEY, JSON.stringify(caps));
    } catch (e) {
        // ignore
    }
}

function normalizeDownloadSourceName(name) {
    const v = (name == null ? '' : String(name)).trim();
    return v || '未知音乐源';
}

function getHostnameFromUrl(url) {
    try {
        const base = (window.location && window.location.origin) || 'http://localhost';
        const u = new URL(url, base);
        return (u.hostname || '').toLowerCase();
    } catch (e) {
        return '';
    }
}

function makeDownloadSongKey(song, apiFallback) {
    const api = (song && song.api ? String(song.api) : String(apiFallback || 'unknown')) || 'unknown';
    const id = song && song.id != null ? String(song.id) : '';
    if (id) return `${api}:${id}`;
    const title = song && song.title ? String(song.title) : '';
    const artist = song && song.artist ? String(song.artist) : '';
    const url = song && song.url ? String(song.url) : '';
    return `${api}:${title}|${artist}|${url}`.slice(0, 220);
}

function updateDownloadCapabilities(caps, { sourceName, songKey, host, method, ok, status }) {
    const now = Date.now();
    if (!caps || typeof caps !== 'object') return;
    if (!caps.sources || typeof caps.sources !== 'object') caps.sources = {};
    if (!caps.songs || typeof caps.songs !== 'object') caps.songs = {};

    const src =
        caps.sources[sourceName] && typeof caps.sources[sourceName] === 'object'
            ? caps.sources[sourceName]
            : {
                blobSuccess: 0,
                blobFail: 0,
                directUsed: 0,
                lastBlobOkAt: 0,
                lastBlobFailAt: 0,
                lastDirectAt: 0,
                lastStatus: 0
            };
    caps.sources[sourceName] = src;

    const song =
        caps.songs[songKey] && typeof caps.songs[songKey] === 'object'
            ? caps.songs[songKey]
            : {
                source: sourceName,
                host: host || '',
                blobSuccess: 0,
                blobFail: 0,
                directUsed: 0,
                lastBlobOkAt: 0,
                lastBlobFailAt: 0,
                lastDirectAt: 0,
                lastStatus: 0,
                lastUpdatedAt: 0
            };
    song.source = sourceName;
    if (host) song.host = host;
    caps.songs[songKey] = song;

    const s = typeof status === 'number' && Number.isFinite(status) ? status : 0;

    if (method === 'blob') {
        if (ok) {
            src.blobSuccess = (src.blobSuccess || 0) + 1;
            src.lastBlobOkAt = now;
            song.blobSuccess = (song.blobSuccess || 0) + 1;
            song.lastBlobOkAt = now;
        } else {
            src.blobFail = (src.blobFail || 0) + 1;
            src.lastBlobFailAt = now;
            song.blobFail = (song.blobFail || 0) + 1;
            song.lastBlobFailAt = now;
        }
        src.lastStatus = s;
        song.lastStatus = s;
    } else if (method === 'direct') {
        src.directUsed = (src.directUsed || 0) + 1;
        src.lastDirectAt = now;
        song.directUsed = (song.directUsed || 0) + 1;
        song.lastDirectAt = now;
    }

    song.lastUpdatedAt = now;

    try {
        const keys = Object.keys(caps.songs);
        if (keys.length > DOWNLOAD_CAPABILITIES_MAX_SONGS) {
            keys.sort((a, b) => {
                const av = caps.songs[a] && typeof caps.songs[a].lastUpdatedAt === 'number' ? caps.songs[a].lastUpdatedAt : 0;
                const bv = caps.songs[b] && typeof caps.songs[b].lastUpdatedAt === 'number' ? caps.songs[b].lastUpdatedAt : 0;
                return av - bv;
            });
            const removeCount = keys.length - DOWNLOAD_CAPABILITIES_MAX_SONGS;
            for (let i = 0; i < removeCount; i++) delete caps.songs[keys[i]];
        }
    } catch (e) {
        // ignore
    }

    saveDownloadCapabilities(caps);
}

function formatDownloadCapabilitiesReport(caps) {
    try {
        const sources = caps && caps.sources && typeof caps.sources === 'object' ? caps.sources : {};
        const entries = Object.entries(sources);
        entries.sort((a, b) => {
            const aa = a[1] && typeof a[1] === 'object' ? a[1] : {};
            const bb = b[1] && typeof b[1] === 'object' ? b[1] : {};
            const aScore = (aa.blobSuccess || 0) - (aa.blobFail || 0);
            const bScore = (bb.blobSuccess || 0) - (bb.blobFail || 0);
            return bScore - aScore;
        });

        const lines = [];
        lines.push(`版本: ${caps && caps.version ? caps.version : 1}`);
        lines.push(`更新时间: ${new Date().toLocaleString()}`);
        lines.push('');
        lines.push('【按音乐源统计】');
        if (!entries.length) {
            lines.push('（暂无记录：请先下载一次歌曲）');
            return lines.join('\n');
        }
        for (const [name, stat] of entries) {
            const s = stat && typeof stat === 'object' ? stat : {};
            const ok = s.blobSuccess || 0;
            const fail = s.blobFail || 0;
            const direct = s.directUsed || 0;
            const lastOk = s.lastBlobOkAt ? new Date(s.lastBlobOkAt).toLocaleString() : '-';
            const lastFail = s.lastBlobFailAt ? new Date(s.lastBlobFailAt).toLocaleString() : '-';
            lines.push(`${name}: Blob✅${ok} / Blob❌${fail} / 直链${direct}（最近✅: ${lastOk}｜最近❌: ${lastFail}）`);
        }
        lines.push('');
        lines.push('提示：下载时会优先 Blob；失败则自动改用直链下载。');
        return lines.join('\n');
    } catch (e) {
        return '（读取失败）';
    }
}

function openDownloadCapabilitiesReport() {
    closeSettingsMenu();
    const caps = loadDownloadCapabilities();
    openCopyTextModal({
        title: '下载能力统计',
        message: '本机记录的 Blob/直链 下载结果（localStorage）：',
        text: formatDownloadCapabilitiesReport(caps),
        autoCopy: false,
        returnFocusTo: document.getElementById('settings-btn')
    });
}

function clearDownloadCapabilitiesMemory() {
    closeSettingsMenu();
    Modal.confirm('确定要清除“下载能力记忆”吗？（会影响Blob/直链统计）', () => {
        try {
            localStorage.removeItem(DOWNLOAD_CAPABILITIES_STORAGE_KEY);
        } catch (e) {
            // ignore
        }
        createDanmaku('已清除下载能力记忆');
    });
}

function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    const decimals = unitIndex === 0 ? 0 : size < 10 ? 2 : size < 100 ? 1 : 0;
    return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

function removeDownloadProgressToast() {
    try {
        const existing = document.getElementById('hjwjb-download-progress-toast');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    } catch (e) {
        // ignore
    }
}

function createDownloadProgressToast({ titleText = '正在下载', filenameText = '' } = {}) {
    removeDownloadProgressToast();
    if (document.hidden) return null;

    try {
        const toast = document.createElement('div');
        toast.id = 'hjwjb-download-progress-toast';
        toast.className = 'download-progress-toast is-indeterminate';

        const header = document.createElement('div');
        header.className = 'download-progress-header';

        const title = document.createElement('div');
        title.className = 'download-progress-title';
        title.innerHTML = `<i class="fas fa-download"></i> ${titleText}`;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'download-progress-close';
        closeBtn.setAttribute('aria-label', '关闭下载提示');
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';

        header.appendChild(title);
        header.appendChild(closeBtn);

        const filename = document.createElement('div');
        filename.className = 'download-progress-filename';
        filename.textContent = filenameText || '';

        const bar = document.createElement('div');
        bar.className = 'download-progress-bar';

        const fill = document.createElement('div');
        fill.className = 'download-progress-fill';
        bar.appendChild(fill);

        const meta = document.createElement('div');
        meta.className = 'download-progress-meta';
        meta.textContent = '准备中...';

        toast.appendChild(header);
        toast.appendChild(filename);
        toast.appendChild(bar);
        toast.appendChild(meta);

        const ui = { toast, title, filename, fill, meta, closed: false };
        closeBtn.addEventListener('click', () => {
            ui.closed = true;
            removeDownloadProgressToast();
        });

        document.body.appendChild(toast);
        return ui;
    } catch (e) {
        return null;
    }
}

function updateDownloadProgressToast(ui, { receivedBytes = 0, totalBytes = 0, metaText = '' } = {}) {
    if (!ui || ui.closed) return;
    if (!ui.toast || !ui.toast.isConnected) return;

    try {
        const total = Number(totalBytes);
        const received = Number(receivedBytes);
        const hasTotal = Number.isFinite(total) && total > 0;

        if (hasTotal) {
            ui.toast.classList.remove('is-indeterminate');
            const percent = Math.min(100, Math.max(0, Math.round((received / total) * 100)));
            ui.fill.style.width = `${percent}%`;
            ui.meta.textContent =
                metaText || `${formatBytes(received)} / ${formatBytes(total)}（${percent}%）`;
            return;
        }

        ui.toast.classList.add('is-indeterminate');
        ui.fill.style.width = '';
        if (metaText) {
            ui.meta.textContent = metaText;
        } else if (Number.isFinite(received) && received > 0) {
            ui.meta.textContent = `已接收 ${formatBytes(received)}（大小未知）`;
        } else {
            ui.meta.textContent = '连接中...';
        }
    } catch (e) {
        // ignore
    }
}

function finishDownloadProgressToast(ui, { success = true, message = '', autoHideMs = 1200 } = {}) {
    if (!ui || ui.closed) return;
    if (!ui.toast || !ui.toast.isConnected) return;

    try {
        ui.toast.classList.remove('is-indeterminate');
        ui.fill.style.width = '100%';
        ui.meta.textContent = message || (success ? '下载已开始，请查看浏览器下载列表' : '下载失败');
    } catch (e) {
        // ignore
    }

    const delay = Number.isFinite(autoHideMs) ? Math.max(0, autoHideMs) : 1200;
    if (delay <= 0) return;
    setTimeout(() => {
        try {
            if (!ui.closed) removeDownloadProgressToast();
        } catch (e) {
            // ignore
        }
    }, delay);
}

// 下载歌曲
async function downloadSong(index) {
    console.log(`%c⬇️  开始下载歌曲，索引: ${index}`, 'color: #1abc9c; font-weight: bold');
    const song = playlist[index];
    if (!song) {
        console.error('❌ 下载失败：歌曲不存在', { index, song });
        createDanmaku('下载失败：歌曲不存在');
        return;
    }
    
    console.log('🎵 下载歌曲信息:', { title: song.title, artist: song.artist, url: song.url, source: song.source, api: song.api });
    console.log('🎚️  当前音质模式:', isHighestQualityMode ? '最高音质' : '最低音质');
    console.log('🔌 当前API:', currentApi);
    
    let downloadToastUi = null;
    try {
        // 显示下载开始提示
        createDanmaku(`开始下载：${song.title} - ${song.artist}`);
        downloadToastUi = createDownloadProgressToast({
            titleText: '正在下载',
            filenameText: `${song.artist} - ${song.title}`
        });
        updateDownloadProgressToast(downloadToastUi, { metaText: '连接中...' });
        
        // 处理下载链接
        let downloadUrl = song.url;
        const apiForSong = song && song.api ? String(song.api) : String(currentApi || '');
        // Download strategy:
        // - try 2x direct (no proxy) first
        // - if still fails, try proxy once (using the active proxy base, with optional failover)
        const allowProxyForSong = !isProxyDisabled();

        // 对于部分来源（例如 API7/QQ），列表里可能没有提前填充 url：这里做下载专用兜底
        if (!downloadUrl) {
            if (apiForSong === 'api7' && song.id) {
                downloadUrl = await fetchApi7SongAudioUrlWithFallback(song, { br: getApi7BrSetting() });
                console.warn('⚠️ 歌曲缺少直链URL，已临时请求API7直链用于下载:', downloadUrl);
            } else if (apiForSong === 'api4' && song.id) {
                const updated = await fetchApi4SongInfoWithFallback(song, { force: true, quality: currentQuality });
                downloadUrl = updated && updated.url ? String(updated.url).trim() : '';
                if (downloadUrl) {
                    playlist[index] = updated;
                    savePlaylist();
                }
                console.warn('⚠️ 歌曲缺少直链URL，已临时请求API4直链用于下载:', downloadUrl);
            } else if (apiForSong === 'api8' && song.id) {
                const normalizedId = normalizeMusicIdForSource('netease', song.id);
                const level = normalizeApi8Level(currentQuality);
                downloadUrl = buildApi8RequestUrl(normalizedId, level);
                console.warn('⚠️ 歌曲缺少直链URL，已临时构建API8下载链接:', downloadUrl);
            } else if (isMetingApi(apiForSong) && song.id) {
                const source = getSourceForApi(song.source || currentMusicSource);
                const normalizedId = normalizeMusicIdForSource(source, song.id);
                const serverParam = mapMetingServerParam(source);
                const brParam = getMetingBrParam();
                const requestUrl =
                    getMetingRequestUrls(apiForSong, {
                        server: serverParam,
                        type: 'url',
                        id: normalizedId,
                        br: brParam
                    })[0] || '';
                downloadUrl = (await fetchMetingSongUrlWithFallback(apiForSong, serverParam, normalizedId, brParam)) || requestUrl;
                console.warn('⚠️ 歌曲缺少直链URL，已临时构建Meting下载链接:', downloadUrl);
            }
        }

        if (!downloadUrl) {
            console.error('❌ 下载失败：歌曲URL为空且无法构建下载链接', { index, song });
            createDanmaku('下载失败：歌曲URL为空（可先播放一次再下载）');
            return;
        }
        
        if (apiForSong === 'api8') {
            const normalizedId = normalizeMusicIdForSource('netease', song.id);
            if (!normalizedId) {
                console.warn('⚠️ API8下载重建跳过：歌曲缺少可用ID，继续使用现有URL');
            } else {
                const level = normalizeApi8Level(currentQuality);
                downloadUrl = buildApi8RequestUrl(normalizedId, level);
                console.log(`✅ 构建API8下载链接: ${downloadUrl}`);
                console.log(`🎚️  使用音质参数: ${level}`);
            }
        } else if (isMetingApi(apiForSong)) {
            const source = getSourceForApi(song.source || currentMusicSource);
            const normalizedId = normalizeMusicIdForSource(source, song.id);
            if (!normalizedId) {
                console.warn('⚠️ Meting下载重建跳过：歌曲缺少可用ID，继续使用现有URL');
            } else {
                const serverParam = mapMetingServerParam(source);
                const brParam = getMetingBrParam();
                const requestUrl =
                    getMetingRequestUrls(apiForSong, {
                        server: serverParam,
                        type: 'url',
                        id: normalizedId,
                        br: brParam
                    })[0] || '';
                downloadUrl = (await fetchMetingSongUrlWithFallback(apiForSong, serverParam, normalizedId, brParam)) || requestUrl;
                console.log(`✅ 构建Meting下载链接: ${downloadUrl}`);
                console.log(`🎚️  使用音质参数: ${brParam}`);
            }
        }
        
        // 添加时间戳参数避免缓存问题（仅对 http/https 生效；blob/data/file 不应拼 query，否则 URL 会失效）
        const shouldAddCacheBuster = (() => {
            try {
                const u = new URL(downloadUrl, window.location.href);
                return u.protocol === 'http:' || u.protocol === 'https:';
            } catch (e) {
                return false;
            }
        })();
        if (shouldAddCacheBuster) {
            if (downloadUrl.indexOf('?') === -1) {
                downloadUrl += '?t=' + new Date().getTime();
            } else {
                downloadUrl += '&t=' + new Date().getTime();
            }
        }
        
        console.log('📥 Blob优先下载（必要时自动走代理）:', downloadUrl);

        const caps = loadDownloadCapabilities();
        const normalizedSourceName = normalizeDownloadSourceName(song.source || currentMusicSource);
        const songCapsKey = makeDownloadSongKey(song, apiForSong);
        const urlHost = getHostnameFromUrl(downloadUrl);

        // 尝试Blob下载：先直连（能成功就不走代理），失败再走代理（解决 CORS / HTTP-only / 302 跳转等问题）
        try {
            console.log('🔗 尝试使用Blob下载');
            updateDownloadProgressToast(downloadToastUi, {
                metaText: allowProxyForSong ? '获取音频中（直连×2，失败走代理）...' : '获取音频中（直连×2）...'
            });

            let proxySwapsLeft = 0;
            try {
                proxySwapsLeft = Math.max(0, getProxyBaseUrlListSetting().length - 1);
            } catch (e) {
                proxySwapsLeft = 0;
            }

            let response = null;
            let blobAttemptStatus = 0;
            const pageIsSecureLike = (() => {
                try {
                    const proto = String(window.location && window.location.protocol ? window.location.protocol : '');
                    return proto === 'https:' || proto === 'file:';
                } catch (e) {
                    return true;
                }
            })();

            const directCandidateUrl = processAudioUrl(downloadUrl, { disableProxy: true });
            const shouldTryDirectFirst = (() => {
                try {
                    const u = new URL(directCandidateUrl, window.location.href);
                    const proto = String(u.protocol || '').toLowerCase();
                    if (proto === 'blob:' || proto === 'data:' || proto === 'file:') return true;
                    if (proto !== 'http:' && proto !== 'https:') return false;
                    if (pageIsSecureLike && proto === 'http:') return false;

                    const host = String(u.hostname || '').toLowerCase();
                    const pathname = String(u.pathname || '').toLowerCase();

                    if (host.endsWith('.sayqz.com')) {
                        const type = String(u.searchParams.get('type') || '').trim().toLowerCase();
                        if (type === 'url' || type === 'pic') return false;
                    }

                    // 仅对“看起来是直链音频文件”的 URL 做直连 Blob（否则很可能是 JSON/跳转接口，应该交给代理解析）
                    const pathnameRaw = String(u.pathname || '');
                    const isDirectAudioFile = /\.(mp3|flac|wav|aac|ogg|m4a|webm|mp4)$/i.test(pathnameRaw);
                    return isDirectAudioFile;
                } catch (e) {
                    return false;
                }
            })();

            if (shouldTryDirectFirst) {
                for (let attempt = 1; attempt <= 2; attempt += 1) {
                    try {
                        console.log(`🔗 Blob下载：直连尝试（${attempt}/2）`);
                        response = await fetch(directCandidateUrl, {
                            method: 'GET',
                            mode: 'cors',
                            headers: { 'Accept': '*/*' }
                        });
                        blobAttemptStatus = response.status;
                        if (!response.ok) throw new Error(`HTTP错误! 状态码: ${blobAttemptStatus || 0}`);

                        const ctRaw = String(response.headers.get('content-type') || '');
                        const ct = ctRaw.toLowerCase();
                        if (ct && (ct.includes('application/json') || ct.startsWith('text/'))) {
                            throw new Error(`非音频响应（直连）：${ctRaw || 'unknown'}`);
                        }

                        console.log('✅ Blob直连下载可用，跳过代理');
                        break;
                    } catch (directError) {
                        response = null;
                        blobAttemptStatus = 0;
                        if (attempt < 2) {
                            console.warn(`⚠️ Blob直连失败（${attempt}/2），稍后重试:`, directError);
                            await new Promise(resolve => setTimeout(resolve, 260));
                        } else if (allowProxyForSong) {
                            console.warn('⚠️ Blob直连失败（2/2），准备切换到代理:', directError);
                        } else {
                            console.warn('⚠️ Blob直连失败（2/2，代理已禁用）:', directError);
                        }
                    }
                }
            }

            if (!response) {
                if (!allowProxyForSong) {
                    throw new Error('Blob直连下载失败（代理已禁用）');
                }
                while (true) {
                    const fetchUrl = processAudioUrl(downloadUrl, { forceProxy: true });
                    try {
                        updateDownloadProgressToast(downloadToastUi, { metaText: '通过代理下载中...' });
                        response = await fetch(fetchUrl, {
                            method: 'GET',
                            mode: 'cors',
                            headers: { 'Accept': '*/*' }
                        });
                        blobAttemptStatus = response.status;
                    } catch (e) {
                        if (proxySwapsLeft > 0) {
                            const next = switchToNextProxyBaseUrl();
                            if (next) {
                                proxySwapsLeft -= 1;
                                console.warn(`🔁 Blob下载代理不可用，切换到: ${next}`);
                                await new Promise(resolve => setTimeout(resolve, 200));
                                continue;
                            }
                        }
                        throw e;
                    }

                    if (!response || !response.ok) {
                        if (proxySwapsLeft > 0 && blobAttemptStatus >= 500) {
                            const next = switchToNextProxyBaseUrl();
                            if (next) {
                                proxySwapsLeft -= 1;
                                console.warn(`🔁 Blob下载代理返回 ${blobAttemptStatus}，切换到: ${next}`);
                                await new Promise(resolve => setTimeout(resolve, 200));
                                continue;
                            }
                        }
                        throw new Error(`HTTP错误! 状态码: ${blobAttemptStatus || 0}`);
                    }

                    break;
                }
            }
            
            // 获取内容类型，确定文件扩展名
            const contentType = response.headers.get('content-type') || 'audio/mpeg';
            let fileExtension = 'mp3';
            if (contentType.includes('flac')) {
                fileExtension = 'flac';
            } else if (contentType.includes('wav')) {
                fileExtension = 'wav';
            } else if (contentType.includes('aac')) {
                fileExtension = 'aac';
            } else if (contentType.includes('ogg')) {
                fileExtension = 'ogg';
            } else if (contentType.includes('mp4')) {
                fileExtension = 'm4a';
            }
            
            console.log('📄 内容类型:', contentType, '文件扩展名:', fileExtension);
            
            // 获取文件大小
            const contentLength = response.headers.get('content-length');
            const totalSize = contentLength ? parseInt(contentLength) : 0;
            console.log('📊 文件大小:', totalSize, 'bytes');
            
            // 创建可写流并监控下载进度
            updateDownloadProgressToast(downloadToastUi, { receivedBytes: 0, totalBytes: totalSize, metaText: '开始接收数据...' });

            if (!response.body || typeof response.body.getReader !== 'function') {
                throw new Error('浏览器不支持流式读取（无法Blob下载）');
            }

            const reader = response.body.getReader();
            const chunks = [];
            let done = false;
            let receivedSize = 0;
            let lastUiUpdateAt = 0;
            let lastUiPercent = -1;
            
            while (!done) {
                const result = await reader.read();
                done = result.done;
                if (!done) {
                    chunks.push(result.value);
                    receivedSize += result.value && result.value.byteLength ? result.value.byteLength : 0;
                    const now = Date.now();
                    if (totalSize > 0) {
                        const percent = Math.min(100, Math.max(0, Math.floor((receivedSize / totalSize) * 100)));
                        if (percent !== lastUiPercent && now - lastUiUpdateAt >= 80) {
                            lastUiPercent = percent;
                            lastUiUpdateAt = now;
                            updateDownloadProgressToast(downloadToastUi, { receivedBytes: receivedSize, totalBytes: totalSize });
                        }
                    } else if (now - lastUiUpdateAt >= 220) {
                        lastUiUpdateAt = now;
                        updateDownloadProgressToast(downloadToastUi, { receivedBytes: receivedSize, totalBytes: 0 });
                    }
                }
            }
            
            // 合并所有chunk并创建Blob
            updateDownloadProgressToast(downloadToastUi, { receivedBytes: receivedSize, totalBytes: totalSize, metaText: '正在合并数据...' });
            const blob = new Blob(chunks, { type: contentType });
            console.log('✅ Blob创建完成，大小:', blob.size, 'bytes');
            
            // 创建下载链接
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            
            // 统一使用"作者 - 歌名.扩展名"格式
            const filename = `${song.artist} - ${song.title}.${fileExtension}`;
            link.download = filename;
            
            console.log('📁 下载文件名:', filename);
            
            document.body.appendChild(link);
            link.click();
            finishDownloadProgressToast(downloadToastUi, {
                success: true,
                message: `下载已开始：${filename}`,
                autoHideMs: 1500
            });
            
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(blobUrl);
                console.log('🧹 清理下载资源');
            }, 100);
            
            updateDownloadCapabilities(caps, {
                sourceName: normalizedSourceName,
                songKey: songCapsKey,
                host: urlHost,
                method: 'blob',
                ok: true,
                status: blobAttemptStatus
            });

            StorageManager.setItem('hjwjb_blob_download_supported', 'true');
            console.log('✅ Blob下载成功，已保存偏好');
        } catch (blobError) {
            console.warn('⚠️  Blob下载失败，切换到直接链接下载:', blobError);
            createDanmaku('Blob下载失败，使用直接下载');
            updateDownloadProgressToast(downloadToastUi, { metaText: 'Blob失败，切换直链下载...' });
            
            const msg = blobError && blobError.message ? String(blobError.message) : '';
            const match = /状态码:\s*(\d+)/.exec(msg);
            const statusFromMsg = match ? parseInt(match[1], 10) : 0;
            const status = Number.isFinite(statusFromMsg) ? statusFromMsg : 0;

            updateDownloadCapabilities(caps, {
                sourceName: normalizedSourceName,
                songKey: songCapsKey,
                host: urlHost,
                method: 'blob',
                ok: false,
                status
            });

            StorageManager.setItem('hjwjb_blob_download_supported', 'false');

            updateDownloadCapabilities(caps, {
                sourceName: normalizedSourceName,
                songKey: songCapsKey,
                host: urlHost,
                method: 'direct',
                ok: true,
                status: 0
            });

            const directDownloadUrl = processAudioUrl(downloadUrl, { disableProxy: true });
            const proxiedDownloadUrl = allowProxyForSong ? processAudioUrl(downloadUrl, { forceProxy: true }) : '';
            const finalDownloadUrl = (() => {
                if (!proxiedDownloadUrl) return directDownloadUrl;
                try {
                    const proto = String(window.location && window.location.protocol ? window.location.protocol : '');
                    const pageIsSecureLike = proto === 'https:' || proto === 'file:';
                    const u = new URL(directDownloadUrl, window.location.href);
                    if (pageIsSecureLike && String(u.protocol || '').toLowerCase() === 'http:') {
                        return proxiedDownloadUrl;
                    }
                } catch (e) {
                    // ignore
                }
                return directDownloadUrl;
            })();
            
            console.log('🔗 使用下载链接:', finalDownloadUrl);
            const link = document.createElement('a');
            link.href = finalDownloadUrl;
            
            // 根据URL判断文件扩展名
            let fileExtension = 'mp3';
            if (downloadUrl.includes('.flac')) {
                fileExtension = 'flac';
            } else if (downloadUrl.includes('.wav')) {
                fileExtension = 'wav';
            } else if (downloadUrl.includes('.aac')) {
                fileExtension = 'aac';
            } else if (downloadUrl.includes('.ogg')) {
                fileExtension = 'ogg';
            } else if (downloadUrl.includes('.m4a') || downloadUrl.includes('.mp4')) {
                fileExtension = 'm4a';
            }
            
            const filename = `${song.artist} - ${song.title}.${fileExtension}`;
            link.download = filename;
            
            console.log('📁 下载文件名:', filename);
            
            // 添加到页面并触发下载
            document.body.appendChild(link);
            link.click();
            finishDownloadProgressToast(downloadToastUi, {
                success: true,
                message: `已触发下载：${filename}`,
                autoHideMs: 1800
            });
            
            // 清理
            setTimeout(() => {
                document.body.removeChild(link);
                console.log('🧹 清理下载资源');
            }, 100);
        }
        
        // 显示下载完成提示
        createDanmaku(`下载完成：${song.title} - ${song.artist}`);
        console.log('✅ 下载操作完成');
        
    } catch (error) {
        console.error('❌ 下载过程中发生错误:', error);
        createDanmaku('下载失败：' + error.message);
        finishDownloadProgressToast(downloadToastUi, {
            success: false,
            message: `下载失败：${error && error.message ? String(error.message) : '未知错误'}`,
            autoHideMs: 2200
        });
    }
}

// 惊喜按钮功能
async function surpriseFunction() {
    console.log('%c🎁 触发惊喜功能', 'color: #e91e63; font-weight: bold');
    
    // 随机决定是掉落随机玩意（50%）还是获取随机一言（50%）
    const isDropToys = Math.random() < 0.5;
    
    if (isDropToys) {
        console.log('🎲 随机选择：掉落随机玩意');
        
        // 生成掉落元素
        console.log('🎈 创建掉落元素');
        createFallingElements();
        
        // 显示提示
        console.log('💬 创建惊喜弹幕提示');
        createDanmaku('惊喜！掉落各种小玩具！🎁');
    } else {
        console.log('🎲 随机选择：获取随机一言');

        await refreshDailyQuote({ reason: 'surprise' });
    }
    
    console.log('✅ 惊喜功能执行完成');
}

// 创建掉落元素
function createFallingElements() {
    console.log('%c🎈 创建掉落元素', 'color: #ff9800; font-weight: bold');
    const elements = [
        // 小球类
        '⚽', '🏀', '🏐', '🏈', '🎾', '🎱', '🏓', '🏸', '🥎', '🎳',
        // 玩具类
        '🎈', '🎁', '🎀', '🧸', '🦄', '🐻', '🐱', '🐶', '🐭', '🐰',
        // 其他小元素
        '⭐', '✨', '🌟', '💫', '🌈', '💖', '🎊', '🎉', '🎏', '🎐'
    ];
    
    const types = ['ball', 'toy', 'star'];
    console.log(`📋 可用元素: ${elements.length}种，元素类型: ${types.length}种`);
    
    // 生成30个掉落元素
    console.log('🚀 开始生成30个掉落元素');
    for (let i = 0; i < 30; i++) {
        const element = document.createElement('div');
        const type = types[Math.floor(Math.random() * types.length)];
        element.className = `surprise-element ${type}`;
        
        // 随机选择元素
        const emoji = elements[Math.floor(Math.random() * elements.length)];
        element.textContent = emoji;
        
        // 随机水平位置
        const left = `${Math.random() * 100}vw`;
        element.style.left = left;
        
        // 随机动画延迟
        const delay = `${Math.random() * 1}s`;
        element.style.animationDelay = delay;
        
        // 随机动画持续时间
        const duration = `${2 + Math.random() * 3}s`;
        element.style.animationDuration = duration;
        
        // 随机大小
        const size = 24 + Math.random() * 32;
        element.style.fontSize = `${size}px`;
        
        // 添加到页面
        document.body.appendChild(element);
        
        // 动画结束后移除元素
        setTimeout(() => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
        }, 5000);
    }
    console.log('✅ 掉落元素生成完成');
}

// 导入播放列表
function importPlaylist() {
    console.log('%c📥 开始导入播放列表', 'color: #3498db; font-weight: bold');
    importPlaylistFromLocal();
}

// 从文件导入播放列表
function importPlaylistFromFile() {
    console.log('📁 使用文件导入方式');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            console.log('📁 选择的文件:', { name: file.name, size: file.size });
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    console.log('📝 开始解析导入的播放列表数据');
                    const importedPlaylist = JSON.parse(e.target.result);
                    if (Array.isArray(importedPlaylist)) {
                        console.log('✅ 解析成功，共导入', importedPlaylist.length, '首歌曲');
                        playlist = importedPlaylist;
                        updatePlaylistDisplay();
                        savePlaylist();
                        createDanmaku('播放列表导入成功！');
                        console.log('✅ 播放列表导入完成并保存');
                    } else {
                        console.error('❌ 导入失败：文件格式不正确，不是数组');
                        createDanmaku('导入的文件格式不正确');
                    }
                } catch (error) {
                    console.error('❌ 导入失败：解析错误', error);
                    createDanmaku('导入失败：' + error.message);
                }
            };
            reader.readAsText(file);
        } else {
            console.log('⚠️  用户取消了文件选择');
        }
    };
    
    input.click();
}

// 本地文件导入
async function importPlaylistFromLocal() {
    console.log('📁 本地文件导入');
    
    // 关闭选择模态框
    const existingModal = document.querySelector('.playlist-modal');
    if (existingModal) existingModal.remove();
    
    // 创建本地导入选择模态框
    const modal = document.createElement('div');
    modal.className = 'playlist-modal';
    modal.innerHTML = `
        <div class="playlist-modal-content playlist-modal-content--medium">
            <div class="playlist-modal-header">
                <h3>导入</h3>
                <button class="close-btn" onclick="this.closest('.playlist-modal').remove()">×</button>
            </div>
            <div class="playlist-modal-body">
                <div class="import-options">
                    <div class="import-option" onclick="importApi9NeteasePlaylist()">
                        <div class="option-icon">🎼</div>
                        <div class="option-content">
                            <h4>导入网易云歌单（API9/10）</h4>
                            <p>输入歌单ID或分享链接，优先API9，失败自动切API10</p>
                        </div>
                    </div>
                    <div class="import-option" onclick="importApi7QqPlaylist()">
                        <div class="option-icon">🎧</div>
                        <div class="option-content">
                            <h4>导入QQ音乐歌单（API7）</h4>
                            <p>输入歌单ID或分享链接，默认使用 API7</p>
                        </div>
                    </div>
                    <div class="import-option" onclick="importPlaylistFromJsonFile()">
                        <div class="option-icon">📋</div>
                        <div class="option-content">
                            <h4>导入播放列表文件</h4>
                            <p>选择JSON格式的播放列表文件进行导入</p>
                        </div>
                    </div>
                    <div class="import-option" onclick="importAudioFiles()">
                        <div class="option-icon">🎵</div>
                        <div class="option-content">
                            <h4>导入音频文件</h4>
                            <p>直接选择本地音频文件（MP3、WAV、FLAC等）</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function extractQqPlaylistId(value) {
    const raw = value == null ? '' : String(value);
    const text = raw.trim();
    if (!text) return '';
    // Allow user to paste either the numeric ID or a full share URL.
    const matches = text.match(/(\d{5,})/g);
    if (matches && matches.length) return String(matches[matches.length - 1]);
    return '';
}

function extractNeteasePlaylistId(value) {
    const raw = value == null ? '' : String(value);
    const text = raw.trim();
    if (!text) return '';
    // Allow: numeric ID or share URL (music.163.com playlist?id=xxxx).
    const matches = text.match(/(\d{5,})/g);
    if (matches && matches.length) return String(matches[matches.length - 1]);
    return '';
}

function normalizeHttpToHttps(url) {
    const raw = url == null ? '' : String(url).trim();
    if (!raw) return '';
    return raw.replace(/^http:\/\//i, 'https://');
}

function loadSavedApi7Playlists() {
    try {
        const raw = localStorage.getItem(API7_SAVED_PLAYLISTS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((item) => item && item.id != null)
            .map((item) => {
                const id = String(item.id).trim();
                if (!id) return null;
                return {
                    id,
                    title: item.title != null ? String(item.title) : '',
                    cover: item.cover != null ? String(item.cover) : '',
                    authorNick: item.authorNick != null ? String(item.authorNick) : '',
                    authorHeadurl: item.authorHeadurl != null ? String(item.authorHeadurl) : '',
                    songNum: item.songNum != null ? Number(item.songNum) : null,
                    addedAt: item.addedAt != null ? Number(item.addedAt) : null,
                    updatedAt: item.updatedAt != null ? Number(item.updatedAt) : null,
                };
            })
            .filter(Boolean);
    } catch (e) {
        return [];
    }
}

function saveSavedApi7Playlists(list) {
    const safe = Array.isArray(list) ? list : [];
    try {
        localStorage.setItem(API7_SAVED_PLAYLISTS_STORAGE_KEY, JSON.stringify(safe));
    } catch (e) {
        // ignore
    }
}

function upsertSavedApi7PlaylistMeta(meta) {
    if (!meta || typeof meta !== 'object') return;
    const id = meta.id != null ? String(meta.id).trim() : '';
    if (!id) return;

    const title = meta.title != null ? String(meta.title).trim() : '';
    const cover = normalizeHttpToHttps(meta.cover);
    const authorNick = meta.authorNick != null ? String(meta.authorNick).trim() : '';
    const authorHeadurl = normalizeHttpToHttps(meta.authorHeadurl);
    const songNum = meta.songNum != null && Number.isFinite(Number(meta.songNum)) ? Number(meta.songNum) : null;

    const now = Date.now();
    const list = loadSavedApi7Playlists();
    const idx = list.findIndex((p) => String(p.id) === id);

    const merged = {
        id,
        title,
        cover,
        authorNick,
        authorHeadurl,
        songNum,
        updatedAt: now,
        addedAt: now
    };

    if (idx >= 0) {
        const prev = list[idx] || {};
        list[idx] = {
            ...prev,
            ...merged,
            addedAt: prev.addedAt != null ? prev.addedAt : now
        };
    } else {
        list.unshift(merged);
    }

    // Prevent unlimited growth.
    saveSavedApi7Playlists(list.slice(0, 50));
}

function removeSavedApi7Playlist(id) {
    const pid = id == null ? '' : String(id).trim();
    if (!pid) return;
    const list = loadSavedApi7Playlists().filter((p) => p && String(p.id) !== pid);
    saveSavedApi7Playlists(list);
}

function renderSavedApi7Playlists() {
    const container = document.getElementById('saved-playlists-container');
    if (!container) return;

    const list = loadSavedApi7Playlists();
    container.innerHTML = '';

    if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'saved-playlists-empty';
        empty.textContent = '暂无已添加的歌单';
        container.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();

    list.forEach((pl) => {
        const row = document.createElement('div');
        row.className = 'saved-playlist-item';
        row.dataset.playlistId = String(pl.id);

        const avatar = document.createElement('img');
        avatar.className = 'saved-playlist-avatar';
        avatar.loading = 'lazy';
        avatar.referrerPolicy = 'no-referrer';
        avatar.src = pl.authorHeadurl || 'IMG_20251115_090141.png';
        avatar.alt = pl.authorNick || '作者';
        avatar.addEventListener('error', () => {
            avatar.src = 'IMG_20251115_090141.png';
        });

        const meta = document.createElement('div');
        meta.className = 'saved-playlist-meta';

        const title = document.createElement('div');
        title.className = 'saved-playlist-title';
        title.textContent = pl.title || `歌单 ${pl.id}`;

        const author = document.createElement('div');
        author.className = 'saved-playlist-author';
        const parts = [];
        if (pl.authorNick) parts.push(pl.authorNick);
        if (Number.isFinite(pl.songNum) && pl.songNum > 0) parts.push(`${pl.songNum}首`);
        parts.push(`ID:${pl.id}`);
        author.textContent = parts.join(' · ');

        meta.appendChild(title);
        meta.appendChild(author);

        const actions = document.createElement('div');
        actions.className = 'saved-playlist-actions';

        const importBtnEl = document.createElement('button');
        importBtnEl.type = 'button';
        importBtnEl.className = 'btn settings-mini-btn';
        importBtnEl.innerHTML = '<i class="fas fa-plus"></i>';
        importBtnEl.title = '导入到播放列表';
        importBtnEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeSettingsMenu();
            importApi7QqPlaylistById(pl.id).catch((err) => {
                console.error('❌ 导入QQ歌单失败:', err);
                createDanmaku(`❌ 导入失败：${err && err.message ? String(err.message) : '未知错误'}`);
            });
        });

        const deleteBtnEl = document.createElement('button');
        deleteBtnEl.type = 'button';
        deleteBtnEl.className = 'btn settings-mini-btn delete';
        deleteBtnEl.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtnEl.title = '删除已添加的歌单';
        deleteBtnEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            Modal.confirm(`确定删除歌单“${pl.title || pl.id}”吗？`, () => {
                removeSavedApi7Playlist(pl.id);
                renderSavedApi7Playlists();
                createDanmaku('已删除歌单记录');
            });
        });

        actions.appendChild(importBtnEl);
        actions.appendChild(deleteBtnEl);

        row.appendChild(avatar);
        row.appendChild(meta);
        row.appendChild(actions);

        row.addEventListener('click', () => {
            closeSettingsMenu();
            importApi7QqPlaylistById(pl.id).catch((err) => {
                console.error('❌ 导入QQ歌单失败:', err);
                createDanmaku(`❌ 导入失败：${err && err.message ? String(err.message) : '未知错误'}`);
            });
        });

        fragment.appendChild(row);
    });

    container.appendChild(fragment);
}

function importApi7QqPlaylist() {
    console.log('🎧 开始导入QQ音乐歌单（API7）');

    // 关闭选择模态框
    {
        const modal = document.querySelector('.playlist-modal');
        if (modal) modal.remove();
    }

    Modal.prompt({
        title: '导入QQ音乐歌单（API7）',
        message: '请输入歌单ID或分享链接：',
        placeholder: '例如：https://y.qq.com/n/ryqq/playlist/4100249474 或 4100249474',
        inputType: 'text',
        inputMode: 'url',
        returnFocusTo: importBtn,
        onConfirm: (value, setError) => {
            const id = extractQqPlaylistId(value);
            if (!id) {
                setError('请输入正确的歌单ID或分享链接（需要包含数字ID）');
                return false;
            }
            importApi7QqPlaylistById(id).catch((e) => {
                console.error('❌ 导入QQ歌单失败:', e);
                createDanmaku(`❌ 导入失败：${e && e.message ? String(e.message) : '未知错误'}`);
            });
            return true;
        }
    });
}

function importApi9NeteasePlaylist() {
    console.log('🎼 开始导入网易云歌单（API9/10）');

    // 关闭选择模态框
    {
        const modal = document.querySelector('.playlist-modal');
        if (modal) modal.remove();
    }

    Modal.prompt({
        title: '导入网易云歌单（API9/10）',
        message: '请输入网易云歌单ID或分享链接：',
        placeholder: '例如：https://music.163.com/#/playlist?id=8900628861 或 8900628861',
        inputType: 'text',
        inputMode: 'url',
        returnFocusTo: importBtn,
        onConfirm: (value, setError) => {
            const id = extractNeteasePlaylistId(value);
            if (!id) {
                setError('请输入正确的歌单ID或分享链接（需要包含数字ID）');
                return false;
            }
            importApi9NeteasePlaylistById(id).catch((e) => {
                console.error('❌ 导入网易云歌单失败:', e);
                createDanmaku(`❌ 导入失败：${e && e.message ? String(e.message) : '未知错误'}`);
            });
            return true;
        }
    });
}

async function fetchMetingPlaylistItemsWithFailover(playlistId) {
    const id = String(playlistId == null ? '' : playlistId).trim();
    if (!id) return { ok: false, api: '', list: [], message: '' };

    const params = {
        server: 'netease',
        type: 'playlist',
        id,
        yrc: 'false',
        handsome: 'false',
        img_redirect: 'false',
        stream: 'false'
    };

    const tryFetch = async (apiName) => {
        const api = String(apiName || '').trim();
        if (!api) return null;

        let baseUrls = getMetingBaseUrls(api, params.server);
        // Prefer baka.plus for playlist import (matches the provided example).
        if (api === 'api9' && Array.isArray(baseUrls) && baseUrls.length > 1) {
            const preferred = [];
            baseUrls.forEach((u) => { if (String(u).includes('api.baka.plus')) preferred.push(u); });
            baseUrls.forEach((u) => { if (!String(u).includes('api.baka.plus')) preferred.push(u); });
            baseUrls = preferred;
        }

        const requestUrls = (Array.isArray(baseUrls) ? baseUrls : [])
            .map((base) => buildMetingUrl(base, params))
            .filter(Boolean);

        for (const url of requestUrls) {
            let data = await fetchJsonWithOptionalProxy(url, { useProxy: false });
            if (!data) data = await fetchJsonWithOptionalProxy(url, { useProxy: true });
            if (!data) continue;

            const list = Array.isArray(data)
                ? data
                : (data && Array.isArray(data.data) ? data.data : []);
            if (list && list.length) return { api, list };
        }

        return null;
    };

    const first = await tryFetch('api9');
    if (first) return { ok: true, api: first.api, list: first.list, message: '' };

    const second = await tryFetch('api10');
    if (second) return { ok: true, api: second.api, list: second.list, message: '' };

    return { ok: false, api: '', list: [], message: '接口不可用或歌单为空' };
}

function extractMetingSongIdFromItem(item) {
    if (!item || typeof item !== 'object') return '';

    const candidates = [item.id, item.songid, item.songId, item.url, item.lrc, item.pic];
    for (const c of candidates) {
        const raw = c == null ? '' : String(c).trim();
        if (!raw) continue;
        const match = raw.match(/[?&]id=(\d{4,})/);
        if (match && match[1]) return String(match[1]);
        const digits = raw.match(/(\d{4,})/g);
        if (digits && digits.length) return String(digits[digits.length - 1]);
    }
    return '';
}

async function importApi9NeteasePlaylistById(playlistId) {
    const id = String(playlistId == null ? '' : playlistId).trim();
    if (!id) return;

    createDanmaku(`🔄 正在导入网易云歌单：${id}`);

    const { ok, api, list, message } = await fetchMetingPlaylistItemsWithFailover(id);
    if (!ok || !list.length) {
        createDanmaku(`❌ 导入失败：${message || '接口返回错误'}`);
        return;
    }

    const usedApi = api || 'api9';
    let importedCount = 0;
    let skippedCount = 0;

    for (const item of list) {
        const songId = extractMetingSongIdFromItem(item);
        if (!songId) continue;

        const alreadyExists = playlist.some((s) => s && String(s.api || '') === usedApi && String(s.id || '') === String(songId));
        if (alreadyExists) {
            skippedCount += 1;
            continue;
        }

        const title = item && item.name != null ? String(item.name).trim() : '';
        const artist = item && item.artist != null ? String(item.artist).trim() : '';
        const album = item && item.album != null ? String(item.album).trim() : '';
        const cover = item && item.pic != null ? String(item.pic).trim() : '';

        const brParam = getMetingBrParam();
        let requestUrl = '';

        // Prefer the upstream URL returned by the playlist endpoint (keeps the same meting base),
        // but override/add the br param for quality control.
        const itemUrlRaw = item && item.url != null ? String(item.url).trim() : '';
        if (itemUrlRaw) {
            try {
                const u = new URL(itemUrlRaw, window.location.href);
                if (u.protocol === 'http:' || u.protocol === 'https:') {
                    u.searchParams.set('br', String(brParam));
                    requestUrl = u.toString();
                }
            } catch (e) {
                requestUrl = '';
            }
        }

        if (!requestUrl) {
            requestUrl =
                getMetingRequestUrls(usedApi, {
                    server: 'netease',
                    type: 'url',
                    id: songId,
                    br: brParam
                })[0] || '';
        }

        playlist.push({
            id: String(songId),
            title: title || '未知标题',
            artist: artist || '未知艺术家',
            album: album || '',
            cover: cover || 'IMG_20251115_090141.png',
            url: requestUrl,
            source: '网易云音乐',
            api: usedApi,
            lyrics: []
        });

        importedCount += 1;
    }

    if (importedCount <= 0) {
        createDanmaku(`⚠️ 没有可导入的歌曲（可能都重复了）：${id}`);
        return;
    }

    savePlaylist();
    updatePlaylistDisplay();

    createDanmaku(`✅ 已导入网易云歌单（${usedApi.toUpperCase()}）：${importedCount}首${skippedCount ? `，跳过${skippedCount}首重复` : ''}`);

    // 自动播放第一首导入的歌曲
    try {
        const firstSongIndex = playlist.length - importedCount;
        if (firstSongIndex >= 0) await playSong(firstSongIndex);
    } catch (e) {
        // ignore
    }
}

async function importApi7QqPlaylistById(playlistId) {
    const id = String(playlistId == null ? '' : playlistId).trim();
    if (!id) return;

    createDanmaku(`🔄 正在导入QQ歌单：${id}`);

    const apiUrl = `https://oiapi.net/api/QQMusicPlayerListInfo?id=${encodeURIComponent(id)}`;
    let data = await fetchJsonWithOptionalProxy(apiUrl, { useProxy: false });
    if (!data) data = await fetchJsonWithOptionalProxy(apiUrl, { useProxy: true });

    if (!data) {
        createDanmaku('❌ 导入失败：网络错误（无法获取歌单信息）');
        return;
    }

    const ok = !!(data && (data.code === 1 || data.code === '1'));
    const message = data && data.message ? String(data.message) : '';
    if (!ok) {
        createDanmaku(`❌ 导入失败：${message || '接口返回错误'}`);
        return;
    }

    const info = data && data.data && typeof data.data === 'object' ? data.data : null;
    const title = info && info.title ? String(info.title) : '';
    const cover = info && info.cover ? String(info.cover) : '';
    const authorNick = info && info.author && info.author.nick != null ? String(info.author.nick) : '';
    const authorHeadurl = info && info.author && info.author.headurl != null ? String(info.author.headurl) : '';
    const songNum = info && info.songNum != null ? info.songNum : null;
    const list = info && Array.isArray(info.list) ? info.list : [];

    // 记录到“已添加的歌单”
    upsertSavedApi7PlaylistMeta({
        id,
        title,
        cover,
        authorNick,
        authorHeadurl,
        songNum
    });

    if (!list.length) {
        createDanmaku(`⚠️ 歌单为空或不可见：${title || id}`);
        try { renderSavedApi7Playlists(); } catch (e) { /* ignore */ }
        return;
    }

    let importedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < list.length; i += 1) {
        const item = list[i];
        if (!item || typeof item !== 'object') continue;

        const songIdRaw = item.id;
        const songId = songIdRaw == null ? '' : String(songIdRaw).trim();
        if (!songId) continue;

        const alreadyExists = playlist.some((s) => s && String(s.api || '') === 'api7' && String(s.id || '') === songId);
        if (alreadyExists) {
            skippedCount += 1;
            continue;
        }

        const singerArr = Array.isArray(item.singer) ? item.singer : [];
        const artist = singerArr
            .map((s) => {
                if (!s || typeof s !== 'object') return '';
                const name = s.name != null ? String(s.name).trim() : '';
                const titleName = s.title != null ? String(s.title).trim() : '';
                return name || titleName;
            })
            .filter(Boolean)
            .join('/');

        const albumName = item.album && typeof item.album === 'object' && item.album.name != null ? String(item.album.name).trim() : '';

        const song = {
            id: songId,
            songid: songId,
            title: item.song != null ? String(item.song).trim() : (item.name != null ? String(item.name).trim() : '未知标题'),
            artist: artist || '未知艺术家',
            album: albumName,
            cover: cover || 'IMG_20251115_090141.png',
            url: null,
            source: 'QQ音乐',
            api: 'api7',
            lyrics: []
        };

        playlist.push(song);
        importedCount += 1;
    }

    if (importedCount <= 0) {
        createDanmaku(`⚠️ 没有可导入的歌曲（可能都重复了）：${title || id}`);
        try { renderSavedApi7Playlists(); } catch (e) { /* ignore */ }
        return;
    }

    savePlaylist();
    updatePlaylistDisplay();
    try { renderSavedApi7Playlists(); } catch (e) { /* ignore */ }

    createDanmaku(`✅ 已导入QQ歌单：${title || id}（${importedCount}首${skippedCount ? `，跳过${skippedCount}首重复` : ''}）`);

    // 自动播放第一首导入的歌曲
    try {
        const firstSongIndex = playlist.length - importedCount;
        if (firstSongIndex >= 0) await playSong(firstSongIndex);
    } catch (e) {
        // ignore
    }
}

// 本地音频文件导入
async function importAudioFiles() {
    console.log('🎵 开始导入本地音频文件');
    
    // 关闭选择模态框
    {
        const modal = document.querySelector('.playlist-modal');
        if (modal) modal.remove();
    }
    
    // 创建文件选择器
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg';
    fileInput.style.display = 'none';
    
    // 文件选择事件
    fileInput.addEventListener('change', async (event) => {
        const files = Array.from(event.target.files);
        console.log(`📁 选择了${files.length}个文件`);
        
        if (files.length === 0) {
            console.log('⚠️ 用户没有选择文件');
            return;
        }
        
        const importedSongs = [];
        let processedCount = 0;
        
        // 显示处理进度
        createDanmaku(`🔄 正在处理${files.length}个音频文件...`);
        
        for (const file of files) {
            try {
                console.log(`🎵 处理文件: ${file.name}`);
                
                // 创建音频对象来获取元数据
                const audio = new Audio();
                
                // 验证文件是否有效
                if (!file || file.size === 0) {
                    console.warn(`⚠️ 无效文件: ${file.name}`);
                    processedCount++;
                    continue;
                }
                
                let fileURL;
                try {
                    fileURL = URL.createObjectURL(file);
                } catch (error) {
                    console.error(`❌ 无法为文件创建URL: ${file.name}`, error);
                    processedCount++;
                    continue;
                }
                
                audio.src = fileURL;
                
                // 等待音频加载
                await new Promise((resolve, reject) => {
                    audio.addEventListener('loadedmetadata', resolve);
                    audio.addEventListener('error', reject);
                    audio.load();
                });
                
                // 提取文件信息
                const songTitle = file.name.replace(/\.[^/.]+$/, ''); // 移除文件扩展名
                const duration = audio.duration || 0;
                const minutes = Math.floor(duration / 60);
                const seconds = Math.floor(duration % 60);
                const durationText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                
                // 创建歌曲对象
                const song = {
                    id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    title: songTitle,
                    artist: '本地文件',
                    album: '本地音乐',
                    source: 'local',
                    api: 'local',
                    url: fileURL,
                    cover: '', // 本地文件暂时没有封面
                    duration: durationText,
                    file // 保存文件对象用于后续处理
                };
                
                importedSongs.push(song);
                processedCount++;
                console.log(`✅ 成功处理: ${file.name} (${durationText})`);
                
            } catch (error) {
                console.error(`❌ 处理文件失败: ${file.name}`, error);
            }
        }
        
        // 将导入的歌曲添加到播放列表
        if (importedSongs.length > 0) {
            playlist = [...playlist, ...importedSongs];
            updatePlaylistDisplay();
            savePlaylist();
            
            console.log(`✅ 成功导入${importedSongs.length}首本地歌曲`);
            createDanmaku(`✅ 成功导入${importedSongs.length}首本地歌曲！`);
            
            // 自动播放第一首导入的歌曲
            if (importedSongs.length > 0) {
                const firstSongIndex = playlist.length - importedSongs.length;
                console.log('🎵 自动播放第一首导入的本地歌曲');
                await playSong(firstSongIndex);
            }
        } else {
            console.log('⚠️ 没有成功导入任何歌曲');
            createDanmaku('⚠️ 没有成功导入任何音频文件');
        }
        
        // 清理临时元素
        fileInput.remove();
    });
    
    // 添加到页面并触发选择
    document.body.appendChild(fileInput);
    fileInput.click();
}

// JSON播放列表文件导入
async function importPlaylistFromJsonFile() {
    console.log('📋 开始导入JSON播放列表文件');
    
    // 关闭选择模态框
    {
        const modal = document.querySelector('.playlist-modal');
        if (modal) modal.remove();
    }
    
    // 创建文件选择器
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    
    // 文件选择事件
    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        
        if (!file) {
            console.log('⚠️ 用户没有选择文件');
            return;
        }
        
        console.log(`📁 选择的JSON文件: ${file.name}`);
        
        try {
            // 读取文件内容
            const fileContent = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsText(file);
            });
            
            console.log('📖 文件内容读取完成，开始解析JSON');
            
            // 解析JSON
            let jsonData;
            try {
                jsonData = JSON.parse(fileContent);
            } catch (parseError) {
                throw new Error('JSON格式无效: ' + parseError.message);
            }
            
            console.log('📋 JSON解析成功，验证数据结构');
            
            // 验证并处理JSON数据
            const importedSongs = [];
            let songsArray = [];
            
            // 尝试不同的JSON格式
            if (Array.isArray(jsonData)) {
                // 直接是歌曲数组
                songsArray = jsonData;
            } else if (jsonData.songs && Array.isArray(jsonData.songs)) {
                // {songs: [...]}
                songsArray = jsonData.songs;
            } else if (jsonData.playlist && Array.isArray(jsonData.playlist)) {
                // {playlist: [...]}
                songsArray = jsonData.playlist;
            } else if (jsonData.data && Array.isArray(jsonData.data)) {
                // {data: [...]}
                songsArray = jsonData.data;
            } else {
                throw new Error('JSON格式不支持，请确保文件包含歌曲数组或使用标准的播放列表格式');
            }
            
            console.log(`📊 找到${songsArray.length}首歌曲`);
            
            // 处理每首歌曲
            for (let i = 0; i < songsArray.length; i++) {
                const songData = songsArray[i];
                
                try {
                    // 标准化歌曲数据格式
                    const song = {
                        id: songData.id || `json_${Date.now()}_${i}`,
                        title: songData.title || songData.name || songData.song || '未知标题',
                        artist: songData.artist || songData.singer || songData.artistName || '未知艺术家',
                        album: songData.album || songData.albumName || '',
                        source: songData.source || 'json',
                        api: songData.api || 'json',
                        url: songData.url || songData.audio || songData.src || '',
                        cover: songData.cover || songData.pic || songData.image || '',
                        duration: songData.duration || songData.time || '',
                        types: songData.types || []
                    };
                    
                    // 封面图片：保持原始 URL（不要 fetch 转 blob，避免 CORS + 刷新后 blob 失效）
                    {
                        const coverRaw = typeof song.cover === 'string' ? song.cover.trim() : '';
                        if (coverRaw.startsWith('blob:')) {
                            song.cover = 'IMG_20251115_090141.png';
                        } else if (/^http:\/\//i.test(coverRaw)) {
                            song.cover = coverRaw.replace(/^http:\/\//i, 'https://');
                        } else {
                            song.cover = coverRaw;
                        }
                    }
                    
                    importedSongs.push(song);
                    console.log(`✅ 处理歌曲: ${song.title} - ${song.artist}`);
                    
                } catch (songError) {
                    console.warn('⚠️ 处理歌曲数据失败:', songData, songError);
                }
            }
            
            // 将导入的歌曲添加到播放列表
            if (importedSongs.length > 0) {
                playlist = [...playlist, ...importedSongs];
                updatePlaylistDisplay();
                savePlaylist();
                
                console.log(`✅ 成功导入${importedSongs.length}首来自JSON的歌曲`);
                createDanmaku(`✅ 成功导入${importedSongs.length}首播放列表歌曲！`);
                
                // 自动播放第一首导入的歌曲
                if (importedSongs.length > 0) {
                    const firstSongIndex = playlist.length - importedSongs.length;
                    console.log('🎵 自动播放第一首导入的JSON歌曲');
                    await playSong(firstSongIndex);
                }
            } else {
                console.log('⚠️ 没有成功导入任何歌曲');
                createDanmaku('⚠️ JSON文件中没有有效的歌曲数据');
            }
            
        } catch (error) {
            console.error('❌ 导入JSON播放列表失败:', error);
            createDanmaku(`❌ 导入失败: ${error.message}`);
        }
        
        // 清理临时元素
        fileInput.remove();
    });
    
    // 添加到页面并触发选择
    document.body.appendChild(fileInput);
    fileInput.click();
}

// 获取API对应的source参数
function getSourceForApi(musicSource) {
    const raw = String(musicSource || '').trim();
    const normalized = raw.toLowerCase();
    const known = new Set(['qq', 'netease', 'kuwo', 'kugou', 'joox']);
    if (known.has(normalized)) return normalized;
    const sourceMap = {
        'QQ音乐': 'qq',
        '网易云音乐': 'netease',
        '酷我音乐': 'kuwo',
        '酷狗音乐': 'kugou',
        'JOOX音乐': 'joox',
        'joox音乐': 'joox'
    };
    return sourceMap[musicSource] || 'qq';
}

// 获取平台显示名称
function getSourceDisplayName(musicSource) {
    const displayNameMap = {
        'qq': 'QQ音乐',
        'netease': '网易云音乐',
        'kuwo': '酷我音乐',
        'kugou': '酷狗音乐',
        'joox': 'JOOX音乐'
    };
    
    return displayNameMap[musicSource] || musicSource;
}

// 导出播放列表
function exportPlaylist() {
    console.log('%c📤 开始导出播放列表', 'color: #3498db; font-weight: bold');
    if (playlist.length === 0) {
        console.log('⚠️  导出失败：播放列表为空');
        createDanmaku('播放列表为空，无法导出');
        return;
    }
    
    console.log('📋 导出播放列表，共', playlist.length, '首歌曲');
    const dataStr = JSON.stringify(playlist, null, 2);
    
    try {
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        // 检查Blob是否有效
        if (!dataBlob || dataBlob.size === 0) {
            throw new Error('Failed to create valid blob');
        }
        
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        const fileName = `HJWJB音乐播放列表_${new Date().toISOString().slice(0, 10)}.json`;
        link.href = url;
        link.download = fileName;
        link.click();
        
        URL.revokeObjectURL(url);
        console.log('✅ 播放列表导出完成，文件名:', fileName);
    } catch (error) {
        console.error('❌ 导出播放列表失败:', error);
        createDanmaku('导出播放列表失败，请重试');
    }
}

// 加载播放列表从本地存储
function loadPlaylist() {
    console.log('📂 从本地存储加载播放列表...');
    console.log('🔍 StorageManager 存在:', typeof StorageManager !== 'undefined');
    console.log('🔍 StorageManager.getItem 存在:', typeof StorageManager?.getItem === 'function');
    
    try {
        // 双重检查：直接用 localStorage 和用 StorageManager
        const rawLocalStorage = localStorage.getItem('hjwjb_playlist');
        console.log('🔍 直接 localStorage.getItem 结果:', rawLocalStorage ? '有数据 (' + rawLocalStorage.length + ' 字符)' : 'null');
        
        // 使用 StorageManager（带默认值，防止本地 JSON 损坏导致返回字符串/抛错）
        const savedPlaylist = StorageManager.getItem('hjwjb_playlist', []);
        const savedList = Array.isArray(savedPlaylist) ? savedPlaylist : [];
        console.log('🔍 StorageManager.getItem 结果:', savedList.length ? savedList.length + ' 首歌曲' : '0 首歌曲');
        
        if (savedList.length > 0) {
            playlist = savedList;
            console.log('✅ 成功加载播放列表，共', playlist.length, '首歌曲');
            
                if (playlist.length > 0) {
                    let needsSave = false;

                    playlist.forEach((song, index) => {
                        if (song && song.api === 'api15') {
                            playlist[index].api = 'api10';
                            needsSave = true;
                        }
                        if (song && song.api) {
                            const allowedApis = ['api3', 'api4', 'api7', 'api8', 'api9', 'api10'];
                            const sourceName = String(song.source || '').trim();
                            const fallbackApi = sourceName === '酷我音乐' ? 'api4' : 'api10';
                            const normalizedApi = allowedApis.includes(song.api) ? song.api : fallbackApi;

                            if (normalizedApi !== song.api) {
                                playlist[index].api = normalizedApi;
                                needsSave = true;
                            }
                        }

                        const cover = song && typeof song.cover === 'string' ? song.cover.trim() : '';
                        if (cover && cover.startsWith('blob:')) {
                            console.warn(`⚠️ 移除不可持久化的封面Blob URL: ${cover}`);
                            playlist[index].cover = 'IMG_20251115_090141.png';
                            needsSave = true;
                        }
                    });
                
                console.log('📋 播放列表详情:', playlist.map((song, index) => 
                    `${index + 1}. ${song.title} - ${song.artist}`
                ).join('\n'));

                if (needsSave) {
                    setTimeout(() => {
                        savePlaylist();
                    }, 0);
                }
            }
        } else {
            playlist = [];
            console.log('⚠️  本地存储中没有播放列表，创建空播放列表');
        }
    } catch (error) {
        console.error('❌ 加载播放列表失败:', error);
        playlist = [];
    }
}

// 获取歌曲歌词
async function fetchLyricsForSong(song, index, { force = false } = {}) {
    try {
        console.log(`📝 为歌曲 "${song.title}" 获取歌词...`);
        if (!force && song && Array.isArray(song.lyrics) && song.lyrics.length > 0 && !lyricsLooksUnparsed(song.lyrics)) {
            // 已有歌词则不重复请求
            if (Number.isInteger(currentSongIndex) && currentSongIndex === index) {
                loadLyrics(song.lyrics);
            }
            return;
        }
        const apiForSong = song && song.api ? String(song.api) : String(currentApi || '');
        const lyricId = song && (song.id ?? song.rid ?? song.musicId ?? song.songid);
        if (!lyricId) {
            console.warn('⚠️ 歌词获取失败：歌曲ID为空');
            return;
        }

        const source = getSourceForApi(song.source || currentMusicSource);
        const normalizedId = normalizeMusicIdForSource(source, lyricId);
        if (!normalizedId) {
            console.warn('⚠️ 歌词获取失败：歌曲ID无效');
            return;
        }

        // API4 (Kuwo): default lyric endpoint returns JSON lineLyric list (no word timing).
        // When "逐字歌词" is enabled, prefer LRCX word-timing lyrics if available, then fallback to lineLyric.
        if (apiForSong === 'api4') {
            let parsed = [];

            if (isWordLyricsEnabled) {
                try {
                    const raw = await fetchApi4WordLyricsRawWithFallback(normalizedId);
                    if (raw && String(raw).trim()) {
                        const candidate = parseLRC(raw);
                        const hasWords = Array.isArray(candidate) && candidate.some((l) => Array.isArray(l && l.words) && l.words.length);
                        if (hasWords) parsed = candidate;
                    }
                } catch (e) {
                    // ignore and fallback
                }
            }

            if (!parsed.length) {
                const lyrics = await fetchApi4LyricsWithFallback(normalizedId);
                parsed = Array.isArray(lyrics) ? lyrics : [];
            }

            try {
                song.lyrics = parsed;
            } catch (e) {
                // ignore
            }

            if (Number.isInteger(index) && Array.isArray(playlist) && playlist[index]) {
                playlist[index].lyrics = parsed;
                savePlaylist();
                if (currentSongIndex === index) loadLyrics(parsed);
            } else if (currentSongIndex === index) {
                loadLyrics(parsed);
            }
            return;
        }

        const fetchLyricTextWithRetry = async (url, { attempts = 2, timeoutMs = 8000, retryDelayMs = 260 } = {}) => {
            let lastError = null;
            for (let attempt = 1; attempt <= attempts; attempt += 1) {
                let timer = null;
                let controller = null;
                try {
                    if (typeof AbortController !== 'undefined') {
                        controller = new AbortController();
                        timer = setTimeout(() => controller.abort(), timeoutMs);
                    }
                    console.log(`📝 歌词请求（${attempt}/${attempts}）: ${url}`);
                    const response = await fetch(url, {
                        method: 'GET',
                        mode: 'cors',
                        headers: { 'Accept': 'text/plain,*/*' },
                        signal: controller ? controller.signal : undefined
                    });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
                    const text = await response.text();
                    if (contentType.includes('text/html') && /<html|<!doctype/i.test(text)) {
                        throw new Error('HTML响应（疑似错误页）');
                    }
                    if (!text || !text.trim()) throw new Error('空歌词');
                    return text;
                } catch (e) {
                    lastError = e;
                    console.warn(`⚠️ 歌词请求失败（${attempt}/${attempts}）:`, e);
                    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                } finally {
                    if (timer) clearTimeout(timer);
                }
            }
            throw lastError || new Error('歌词请求失败');
        };

        const encodedId = encodeURIComponent(String(normalizedId));
        const candidateUrls = [];

        // 逐字歌词（yrc）优先：仅支持 QQ / 网易云
        if (isWordLyricsEnabled && (source === 'qq' || source === 'netease')) {
            const serverParam = source === 'qq' ? 'tencent' : 'netease';

            const wordIds = [];
            if (source === 'qq') {
                const mid = song && (song.mid ?? song.songmid);
                if (mid) wordIds.push(String(mid));

                // QQ 歌单导入场景可能只有 songId（数字），而 meting 的 tencent yrc 更常用 mid。
                if (!wordIds.length && apiForSong === 'api7' && /^\d+$/.test(String(normalizedId || ''))) {
                    const resolved = await fetchApi7SongInfoWithFallback(song, { br: getApi7BrSetting() });
                    if (resolved && resolved.info && resolved.info.mid) {
                        try {
                            song.mid = resolved.info.mid;
                            song.songid = resolved.info.songid;
                            if (Number.isInteger(index) && playlist[index] && String(playlist[index].id) === String(song.id)) {
                                playlist[index] = song;
                                savePlaylist();
                            }
                        } catch (e) {
                            // ignore
                        }
                        wordIds.push(String(resolved.info.mid));
                    }
                }
            }
            // Always try the original id as fallback (works for netease yrc and some QQ sources).
            wordIds.push(String(normalizedId));

            const seen = new Set();
            for (const wid of wordIds) {
                const trimmed = String(wid || '').trim();
                if (!trimmed || seen.has(trimmed)) continue;
                seen.add(trimmed);
                const upstreamUrl = `${BAKA_METING_LRC_ENDPOINT}?server=${encodeURIComponent(serverParam)}&type=lrc&id=${encodeURIComponent(
                    trimmed
                )}&yrc=true`;
                candidateUrls.push(upstreamUrl);
                const proxyUrl = buildProxyEndpointUrl('text-proxy', upstreamUrl);
                if (proxyUrl) candidateUrls.push(proxyUrl);
            }
        }

        if (isMetingApi(apiForSong)) {
            const serverParam = mapMetingServerParam(source);

            // chuyel (musicapi.chuyel.top/api) requires auth for lrc/pic/url. Only use it for QQ (tencent).
            if (apiForSong === 'api10' && serverParam === 'tencent') {
                try {
                    const meta = await fetchChuyelMetingSongMeta(serverParam, normalizedId);
                    if (meta && meta.lrc) {
                        candidateUrls.push(meta.lrc);
                        const proxyUrl = buildProxyEndpointUrl('text-proxy', meta.lrc);
                        if (proxyUrl) candidateUrls.push(proxyUrl);
                    }

                    // Best-effort: if cover is empty/default, hydrate it from chuyel so image can load via 302.
                    try {
                        const defaultCover = 'IMG_20251115_090141.png';
                        const currentCoverRaw = song && song.cover != null ? String(song.cover).trim() : '';
                        const isDefaultCover =
                            !currentCoverRaw ||
                            currentCoverRaw === defaultCover ||
                            currentCoverRaw.endsWith('/' + defaultCover);
                        if (meta && meta.pic && isDefaultCover) {
                            song.cover = meta.pic;
                            if (Number.isInteger(index) && Array.isArray(playlist) && playlist[index]) {
                                playlist[index].cover = meta.pic;
                                savePlaylist();
                                if (currentSongIndex === index) {
                                    currentCover.src = processAudioUrl(meta.pic) || defaultCover;
                                    updateMediaSessionMetadata(song);
                                }
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                } catch (e) {
                    // ignore and fallback to normal meting lrc
                }
            }

            const urls = getMetingRequestUrls(apiForSong, {
                server: serverParam,
                type: 'lrc',
                id: normalizedId,
                yrc: 'true',
                lrctype: '1'
            });
            urls.forEach((url) => {
                const proxyUrl = buildProxyEndpointUrl('text-proxy', url);
                if (proxyUrl) {
                    candidateUrls.push(proxyUrl);
                } else {
                    candidateUrls.push(url);
                }
            });
        } else if (apiForSong === 'api7') {
            const upstreamUrl = `https://oiapi.net/api/QQMusicLyric?id=${encodedId}&format=lrc&type=text`;
            candidateUrls.push(upstreamUrl);
            const proxyUrl = buildProxyEndpointUrl('text-proxy', upstreamUrl);
            if (proxyUrl) candidateUrls.push(proxyUrl);
        } else if (apiForSong === 'api3') {
            const level = normalizeApi3Level(currentQuality);
            const textUrl = buildApi3Url({ ids: normalizedId, type: 'text', level });
            const jsonUrl = buildApi3Url({ ids: normalizedId, type: 'json', level });

            if (textUrl) {
                candidateUrls.push(textUrl);
                const proxyUrl = buildProxyEndpointUrl('text-proxy', textUrl);
                if (proxyUrl) candidateUrls.push(proxyUrl);
            }

            if (jsonUrl) {
                candidateUrls.push(jsonUrl);
                const proxyUrl = buildProxyEndpointUrl('text-proxy', jsonUrl);
                if (proxyUrl) candidateUrls.push(proxyUrl);
            }
        } else {
            const upstreamUrl = `https://music-dl.sayqz.com/api/?source=${encodeURIComponent(source)}&id=${encodedId}&type=lrc`;
            candidateUrls.push(upstreamUrl);
            const proxyUrl = buildProxyEndpointUrl('text-proxy', upstreamUrl);
            if (proxyUrl) candidateUrls.push(proxyUrl);
        }

        let lastOkText = '';
        let lastParsed = [];

        for (const url of candidateUrls) {
            try {
                const isProxyUrl = String(url || '').includes('text-proxy?url=');
                const lyricText = await fetchLyricTextWithRetry(url, { attempts: isProxyUrl ? 1 : 2 });
                lastOkText = lyricText;
                console.log('📝 原始歌词文本:', lyricText);

                console.log('📝 开始解析LRC歌词');
                const lyrics = parseLRC(lyricText);
                console.log(`✅ 歌词解析完成，共${lyrics.length}条歌词`);
                lastParsed = lyrics;

                // 成功解析出歌词则停止切换；否则继续尝试下一个接口
                if (lyrics && lyrics.length > 0 && !lyricsLooksUnparsed(lyrics)) break;
            } catch (e) {
                // 继续尝试下一个 URL
            }
        }

        if (lastOkText) {
            const resolvedIndex = (() => {
                const list = Array.isArray(playlist) ? playlist : [];
                const idx = Number.isInteger(index) ? index : parseInt(String(index || ''), 10);
                if (Number.isFinite(idx) && idx >= 0 && idx < list.length && list[idx]) return idx;

                const idStr = lyricId != null ? String(lyricId) : '';
                if (idStr) {
                    const foundById = list.findIndex((s) => {
                        if (!s) return false;
                        const sid = s.id ?? s.rid ?? s.musicId ?? s.songid;
                        return sid != null && String(sid) === idStr;
                    });
                    if (foundById >= 0) return foundById;
                }

                const title = song && song.title ? String(song.title) : '';
                const artist = song && song.artist ? String(song.artist) : '';
                if (title || artist) {
                    const foundByMeta = list.findIndex((s) => {
                        if (!s) return false;
                        return String(s.title || '') === title && String(s.artist || '') === artist;
                    });
                    if (foundByMeta >= 0) return foundByMeta;
                }

                return -1;
            })();

            if (resolvedIndex >= 0 && Array.isArray(playlist) && playlist[resolvedIndex]) {
                playlist[resolvedIndex].lyrics = Array.isArray(lastParsed) ? lastParsed : [];
                savePlaylist();
                if (currentSongIndex === resolvedIndex || currentSongIndex === index) {
                    loadLyrics(playlist[resolvedIndex].lyrics);
                }
            } else if (currentSongIndex === index) {
                loadLyrics(Array.isArray(lastParsed) ? lastParsed : []);
            }
            return;
        }

        console.warn('⚠️ 歌词获取失败：所有接口均不可用');
        if (currentSongIndex === index) loadLyrics([]);
    } catch (error) {
        console.warn(`❌ 获取歌词失败: ${error.message}`);
    }
}

function extractLyricText(rawText) {
    const text = rawText == null ? '' : String(rawText).trim();
    if (!text) return '';

    const extractQrcLyricContent = (xmlText) => {
        const xml = xmlText == null ? '' : String(xmlText).trim();
        if (!xml) return '';
        if (!/LyricContent\s*=/.test(xml)) return '';

        // When QRC XML is extracted from a raw JSON string, it may still contain JSON-style escapes
        // like "\\n" / "\\r\\n". Normalize them into real control characters for downstream parsing.
        const decodeJsonEscapes = (value) => {
            const input = String(value == null ? '' : value);
            if (!input) return '';
            // Fast path: nothing that looks like an escape sequence.
            if (!/\\[\\\"nrtu]/.test(input)) return input;

            // Minimal unescape (enough for lyrics): turn literal "\\n" into "\n", "\\uXXXX" into a char, etc.
            // This is intentionally conservative and doesn't try to implement a full JSON string parser.
            return input
                .replace(/\\r\\n/g, '\n')
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\n')
                .replace(/\\t/g, '\t')
                .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => {
                    try { return String.fromCharCode(parseInt(hex, 16)); } catch { return _m; }
                })
                .replace(/\\\"/g, '"')
                .replace(/\\\\/g, '\\');
        };

        const decodeXmlEntities = (value) => {
            const input = String(value || '');
            return input
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
                    try { return String.fromCharCode(parseInt(hex, 16)); } catch { return _; }
                })
                .replace(/&#(\d+);/g, (_, dec) => {
                    try { return String.fromCharCode(parseInt(dec, 10)); } catch { return _; }
                });
        };

        try {
            if (typeof DOMParser !== 'undefined') {
                const doc = new DOMParser().parseFromString(xml, 'text/xml');
                const nodes = doc.getElementsByTagName('Lyric_1');
                if (nodes && nodes.length) {
                    const value = nodes[0].getAttribute('LyricContent');
                    const decoded = decodeJsonEscapes(decodeXmlEntities(value));
                    if (decoded) return decoded;
                }

                // Fallback: any element with LyricContent attribute.
                const any = doc.querySelector && doc.querySelector('[LyricContent]');
                if (any) {
                    const value = any.getAttribute('LyricContent');
                    const decoded = decodeJsonEscapes(decodeXmlEntities(value));
                    if (decoded) return decoded;
                }
            }
        } catch (e) {
            // ignore and fallback to regex
        }

        // Regex fallback: prefer RegExp#exec (instead of String#match) to avoid edge cases with polyfills.
        // Some upstreams may double-escape quotes (e.g. `LyricContent=\\\"...\\\"`) or use single quotes.
        const patterns = [
            /LyricContent="([\s\S]*?)"/i,
            /LyricContent=\\"([\s\S]*?)\\"/i,
            /LyricContent='([\s\S]*?)'/i,
            /LyricContent=\\'([\s\S]*?)\\'/i
        ];
        for (const re of patterns) {
            const m = re.exec(xml);
            if (m && m[1]) return decodeJsonEscapes(decodeXmlEntities(m[1]));
        }
        return '';
    };

    const looksJson =
        (text.startsWith('{') && text.endsWith('}')) ||
        (text.startsWith('[') && text.endsWith(']'));

    if (looksJson) {
        try {
            const data = JSON.parse(text);
            const pick = (value) => {
                if (!value) return '';
                if (typeof value === 'string') return value;
                if (Array.isArray(value)) {
                    for (const item of value) {
                        const candidate = pick(item);
                        if (candidate) return candidate;
                    }
                    return '';
                }
                if (typeof value === 'object') {
                    const hasTimeTag = (input) => /\[\d+:\d+(?:\.\d+)?\]/.test(String(input || ''));
                    const hasWordTag = (input) =>
                        /<\d+:\d+(?:\.\d+)?>/.test(String(input || '')) ||
                        /\{\s*\d+\s*,\s*\d+\s*\}/.test(String(input || '')) ||
                        /\(\s*\d+\s*,\s*\d+\s*\)/.test(String(input || '')) ||
                        /\[\s*\d+\s*,\s*\d+\s*\]/.test(String(input || ''));
                    const getLyricString = (node) => {
                        if (!node) return '';
                        if (typeof node === 'string') return node;
                        if (typeof node === 'object' && typeof node.lyric === 'string') return node.lyric;
                        return '';
                    };

                    const yrcText = getLyricString(value.yrc);
                    const lrcText = getLyricString(value.lrc);
                    const lyricText = typeof value.lyric === 'string' ? value.lyric : '';
                    const tlyricText = getLyricString(value.tlyric);
                    const textText = typeof value.text === 'string' ? value.text : '';

                    // Some providers (API2 QQ) return QRC XML inside JSON. Extract LyricContent for parsing.
                    const qrcFromLyric = lyricText ? extractQrcLyricContent(lyricText) : '';
                    if (qrcFromLyric) return qrcFromLyric;

                    // Prefer word-level lyrics (yrc) when possible, but avoid breaking when yrc is empty/unsupported.
                    if (yrcText && (hasWordTag(yrcText) || hasTimeTag(yrcText))) return yrcText;
                    if (lrcText && hasTimeTag(lrcText)) return lrcText;
                    if (lyricText && hasTimeTag(lyricText)) return lyricText;
                    if (tlyricText && hasTimeTag(tlyricText)) return tlyricText;
                    if (textText && hasTimeTag(textText)) return textText;

                    if (value.data) {
                        const candidate = pick(value.data);
                        if (candidate) return candidate;
                    }

                    return yrcText || lrcText || lyricText || tlyricText || textText || '';
                }
                return '';
            };
            const extracted = pick(data);
            if (extracted) {
                const qrc = extractQrcLyricContent(extracted);
                return qrc || extracted;
            }
        } catch (e) {
            // ignore JSON parsing errors
        }
    }

    // Some upstreams return QRC as raw XML (not wrapped in JSON). Extract LyricContent for parsing.
    // Note: do this AFTER JSON parsing so we don't accidentally return a JSON-escaped string (e.g. contains `\\r\\n`).
    const qrcDirect = extractQrcLyricContent(text);
    if (qrcDirect) return qrcDirect;

    return text;
}

// 解析LRC格式歌词
function parseLRC(lrcText) {
    console.log('%c📝 开始解析LRC歌词', 'color: #4caf50; font-weight: bold');
    console.log('📄 LRC文本长度:', lrcText ? lrcText.length : 0, '字符');

    const lyrics = [];
    let extractedText = extractLyricText(lrcText);

    // Safety net: some upstream/proxy paths may still give us a single-line string containing literal "\\n".
    // If we don't normalize this, QRC lines won't start with "[startMs,duration]" and will be mis-parsed.
    try {
        if (typeof extractedText === 'string') {
            const hasRealNewline = extractedText.includes('\n') || extractedText.includes('\r');
            const hasEscapedNewline = /\\r\\n|\\n|\\r/.test(extractedText);
            if (!hasRealNewline && hasEscapedNewline) {
                extractedText = extractedText
                    .replace(/\\r\\n/g, '\n')
                    .replace(/\\n/g, '\n')
                    .replace(/\\r/g, '\n');
            }
        }
    } catch (e) {
        // ignore
    }
    if (!extractedText) {
        console.log('⚠️  LRC文本为空，返回空歌词数组');
        return lyrics;
    }

    const parseTimeToSeconds = (minutesStr, secondsStr, fractionStr) => {
        const minutes = parseInt(minutesStr, 10);
        const seconds = parseInt(secondsStr, 10);
        const m = Number.isFinite(minutes) ? minutes : 0;
        const s = Number.isFinite(seconds) ? seconds : 0;

        // 小数部分可能是 1/2/3 位：.3=.300s / .38=.380s / .381=.381s
        let fractionSeconds = 0;
        if (fractionStr) {
            const fraction = String(fractionStr).trim();
            const value = parseInt(fraction, 10);
            if (Number.isFinite(value)) {
                if (fraction.length === 1) fractionSeconds = value / 10;
                else if (fraction.length === 2) fractionSeconds = value / 100;
                else fractionSeconds = value / 1000;
            }
        }

        return Math.max(0, m * 60 + s + fractionSeconds);
    };

    const normalizeSPLText = (text) => {
        const raw = String(text || '').replace(/\r\n?/g, '\n');
        const lines = raw.split('\n');
        const out = [];
        const lineTimeTag = /\[(\d+):(\d+)(?:\.(\d+))?\]/;
        const wordTimeTag = /<(\d+):(\d+)(?:\.(\d+))?>/;

        for (const line of lines) {
            if (!line) {
                out.push(line);
                continue;
            }
            let current = line;
            const hasLineTime = lineTimeTag.test(current);
            const wordMatch = current.match(wordTimeTag);
            if (!hasLineTime && wordMatch) {
                const [_, mm, ss, ff] = wordMatch;
                const time = `[${mm}:${ss}${ff ? `.${ff}` : ''}]`;
                current = `${time}${current}`;
            }
            current = current
                .replace(/<\d+:\d+(?:\.\d+)?>/g, '')
                .replace(/\{\s*\d+\s*,\s*\d+\s*\}/g, '');
            out.push(current);
        }
        return out.join('\n');
    };

    const rawText = String(extractedText).replace(/\r\n?/g, '\n');
    const rawLines = rawText.split('\n');
    const normalizedText = normalizeSPLText(extractedText)
        .replace(/<[^>]+>/g, '')
        .replace(/\r\n?/g, '\n');
    const normalizedLines = normalizedText.split('\n');
    console.log('📋 共分割', normalizedLines.length, '行文本');

    // 支持同一行多个时间标签（含无换行的“长串 LRC”）
    const textRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/g;

    let validLines = 0;
    let invalidLines = 0;

    rawLines.forEach((rawLine, index) => {
        const line = String(rawLine || '').trim();
        if (!line) return;

        // QQMusic QRC/KSC format: [startMs,durationMs]字(ms,dur)字(ms,dur)...
        // Note the timing tag comes AFTER the word; parsing must use the text before each "(ms,dur)".
        const qrcHeaderMatch = line.match(/^\[(\d+)\s*,\s*(\d+)\s*\](.*)$/);
        if (qrcHeaderMatch && /\(\s*\d+\s*,\s*\d+\s*\)/.test(line)) {
            const lineStartMs = parseInt(qrcHeaderMatch[1], 10);
            const content = String(qrcHeaderMatch[3] || '');
            const pairRegex = /\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
            const matches = [...content.matchAll(pairRegex)];

            if (matches.length) {
                const firstMs = parseInt(matches[0][1], 10);
                const hasLineStartMs = Number.isFinite(lineStartMs);
                const treatRelative =
                    hasLineStartMs &&
                    lineStartMs > 0 &&
                    Number.isFinite(firstMs) &&
                    firstMs < lineStartMs / 2;

                const words = [];
                let prevEnd = 0;
                for (const m of matches) {
                    const segText = content.slice(prevEnd, m.index);
                    prevEnd = m.index + m[0].length;

                    if (!segText) continue;

                    // Preserve spaces: whitespace-only segments get merged into the previous word.
                    if (!segText.trim()) {
                        if (words.length) words[words.length - 1].text += segText;
                        continue;
                    }

                    const ms = parseInt(m[1], 10);
                    if (!Number.isFinite(ms)) continue;

                    const time = treatRelative && hasLineStartMs ? (lineStartMs + ms) / 1000 : ms / 1000;
                    words.push({ time: Math.max(0, time), text: segText });
                }

                const tail = content.slice(prevEnd);
                if (tail) {
                    if (!tail.trim()) {
                        if (words.length) words[words.length - 1].text += tail;
                    } else if (words.length) {
                        // Trailing text without timing: append so it remains visible.
                        words[words.length - 1].text += tail;
                    }
                }

                if (words.length) {
                    const time = hasLineStartMs ? Math.max(0, lineStartMs / 1000) : words[0].time;
                    const text = words.map((w) => w.text).join('');
                    lyrics.push({ time, text, words });
                    validLines += 1;
                    return;
                }
            }
        }

        if (/<\d+:\d+(?:\.\d+)?>/.test(line)) {
            const wordRegex = /<(\d+):(\d+)(?:\.(\d+))?>/g;
            const lineTimeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/g;
            const lineTimes = [...line.matchAll(lineTimeRegex)];
            const baseTime = lineTimes.length ? parseTimeToSeconds(lineTimes[0][1], lineTimes[0][2], lineTimes[0][3]) : null;
            const words = [];
            const wordMatches = [...line.matchAll(wordRegex)];
            for (let i = 0; i < wordMatches.length; i += 1) {
                const match = wordMatches[i];
                const start = match.index + match[0].length;
                const end = i + 1 < wordMatches.length ? wordMatches[i + 1].index : line.length;
                const rawWord = line.slice(start, end);
                const cleaned = rawWord.replace(lineTimeRegex, '');
                if (!cleaned) continue;
                // Preserve spaces for English lyrics: whitespace-only segments get merged into the previous word.
                if (!cleaned.trim()) {
                    if (words.length) words[words.length - 1].text += cleaned;
                    continue;
                }
                const time = parseTimeToSeconds(match[1], match[2], match[3]);
                words.push({ time, text: cleaned });
            }

            if (words.length) {
                const time = baseTime != null ? baseTime : words[0].time;
                const text = words.map((w) => w.text).join('');
                lyrics.push({ time, text, words });
                validLines += 1;
                return;
            }
        }

        // Some providers return word-timing with numeric pairs, e.g. "{123,456}词" or "(123,456)word".
        // We treat the first number as start time (ms), and infer whether it's absolute or relative to the line time.
        const parsePairTimedWords = (pairRegex) => {
            const lineTimeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/g;
            const lineTimes = [...line.matchAll(lineTimeRegex)];
            const baseTimeFromLrc =
                lineTimes.length
                    ? parseTimeToSeconds(lineTimes[0][1], lineTimes[0][2], lineTimes[0][3])
                    : null;

            // QRC/KRC header: [startMs,durationMs]...
            const qrcHeaderMatch = line.match(/^\[(\d+)\s*,\s*(\d+)\s*\]/);
            const lineStartMs = qrcHeaderMatch ? parseInt(qrcHeaderMatch[1], 10) : NaN;
            const baseTimeFromMs = Number.isFinite(lineStartMs) ? Math.max(0, lineStartMs / 1000) : null;
            const baseTime = baseTimeFromLrc != null ? baseTimeFromLrc : baseTimeFromMs;

            const matches = [...line.matchAll(pairRegex)];
            if (!matches.length) return null;

            const firstMs = parseInt(matches[0][1], 10);
            const firstSeconds = Number.isFinite(firstMs) ? firstMs / 1000 : NaN;
            const useAbsoluteMsFromLrc =
                baseTimeFromLrc != null &&
                Number.isFinite(firstSeconds) &&
                Math.abs(firstSeconds - baseTimeFromLrc) < 2 &&
                firstMs > 1000;
            const treatRelativeMsFromHeader =
                baseTimeFromMs != null &&
                Number.isFinite(lineStartMs) &&
                Number.isFinite(firstMs) &&
                lineStartMs > 0 &&
                firstMs < lineStartMs / 2;
            const useAbsoluteMs = !!useAbsoluteMsFromLrc && !treatRelativeMsFromHeader;

            const words = [];
            for (let i = 0; i < matches.length; i += 1) {
                const match = matches[i];
                const start = match.index + match[0].length;
                const end = i + 1 < matches.length ? matches[i + 1].index : line.length;
                const rawWord = line.slice(start, end);
                const cleaned = rawWord.replace(lineTimeRegex, '');
                if (!cleaned) continue;
                if (!cleaned.trim()) {
                    if (words.length) words[words.length - 1].text += cleaned;
                    continue;
                }

                const ms = parseInt(match[1], 10);
                if (!Number.isFinite(ms)) continue;

                let time;
                if (baseTimeFromMs != null && baseTimeFromLrc == null) {
                    // QRC/KRC header mode: decide if the per-word ms is relative to lineStartMs or absolute.
                    time = treatRelativeMsFromHeader ? Math.max(0, baseTimeFromMs + ms / 1000) : Math.max(0, ms / 1000);
                } else if (useAbsoluteMs || baseTime == null) {
                    time = Math.max(0, ms / 1000);
                } else {
                    time = Math.max(0, baseTime + ms / 1000);
                }
                words.push({ time, text: cleaned });
            }

            if (!words.length) return null;
            const time = baseTime != null ? baseTime : words[0].time;
            const text = words.map((w) => w.text).join('');
            return { time, text, words };
        };

        // Kugou KRC: "<startMs,durationMs,0>词" (usually startMs is relative to the line time tag).
        if (/<\s*\d+\s*,\s*\d+\s*,\s*\d+\s*>/.test(line)) {
            const parsed = parsePairTimedWords(/<\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*>/g);
            if (parsed) {
                lyrics.push(parsed);
                validLines += 1;
                return;
            }
        }

        if (/\{\s*\d+\s*,\s*\d+\s*\}/.test(line)) {
            const parsed = parsePairTimedWords(/\{\s*(\d+)\s*,\s*(\d+)\s*\}/g);
            if (parsed) {
                lyrics.push(parsed);
                validLines += 1;
                return;
            }
        }

        if (/\(\s*\d+\s*,\s*\d+\s*\)/.test(line)) {
            const parsed = parsePairTimedWords(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/g);
            if (parsed) {
                lyrics.push(parsed);
                validLines += 1;
                return;
            }
        }

        // LRC "inline word timing" format: [t]字[t]字[t]字...
        // The source provides a time tag before (almost) every character/word. We render it as a single line with many
        // spans, instead of splitting into many single-character lyric lines.
        const inlineTimeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/g;
        const inlineTags = [...line.matchAll(inlineTimeRegex)];
        if (inlineTags.length >= 2) {
            const segments = [];
            for (let i = 0; i < inlineTags.length; i += 1) {
                const tag = inlineTags[i];
                const start = tag.index + tag[0].length;
                const end = i + 1 < inlineTags.length ? inlineTags[i + 1].index : line.length;
                const text = line.slice(start, end);
                const time = parseTimeToSeconds(tag[1], tag[2], tag[3]);
                segments.push({ time, text });
            }

            // Require at least 2 non-empty segments, and some text between tags (avoid "[t][t]text" repetition tags).
            const nonEmptySegments = segments.filter((seg) => (seg.text || '').trim());
            const hasTextBetweenTags = segments.slice(0, -1).some((seg) => (seg.text || '').trim());

            if (hasTextBetweenTags && nonEmptySegments.length >= 2) {
                // Preserve spaces: keep raw segment text; whitespace-only segments get merged into the previous word.
                const stripInlineTagRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/g;
                const words = [];
                for (const seg of segments) {
                    const cleaned = String(seg.text || '').replace(stripInlineTagRegex, '');
                    if (!cleaned) continue;
                    if (!cleaned.trim()) {
                        if (words.length) words[words.length - 1].text += cleaned;
                        continue;
                    }
                    words.push({ time: seg.time, text: cleaned });
                }

                if (words.length) {
                    const time = words[0].time;
                    const text = words.map((w) => w.text).join('');
                    lyrics.push({ time, text, words });
                    validLines += 1;
                    return;
                }
            }
        }

        // KSC-like line timing: [startMs,durationMs]歌词...
        // Some sources pack many "[ms,dur]" tags into a single long line (sometimes preceded by a single "[00:00]" tag).
        // If we can split into multiple segments, prefer this parser to avoid caching a single giant lyric line.
        if (/\[\d+\s*,\s*\d+\s*\]/.test(line)) {
            const msTagRegex = /\[(\d+)\s*,\s*(\d+)\s*\]/g;
            const msTags = [];
            let m;
            while ((m = msTagRegex.exec(line)) !== null) {
                const ms = parseInt(m[1], 10);
                if (!Number.isFinite(ms)) continue;
                msTags.push({
                    time: Math.max(0, ms / 1000),
                    index: m.index,
                    end: msTagRegex.lastIndex
                });
            }

            if (msTags.length) {
                const hasClassicTimeTag = /\[\d+:\d+(?:\.\d+)?\]/.test(line);
                let added = 0;

                for (let i = 0; i < msTags.length; i += 1) {
                    const start = msTags[i].end;
                    const end = i + 1 < msTags.length ? msTags[i + 1].index : line.length;
                    const text = line.slice(start, end).trim();
                    if (!text) continue;
                    lyrics.push({ time: msTags[i].time, text });
                    validLines += 1;
                    added += 1;
                }

                // If we got any meaningful segment and it looks like the main format, stop processing this line.
                if (added > 0 && (added > 1 || !hasClassicTimeTag)) {
                    return;
                }
            }
        }

        const normalizedLine = String(normalizedLines[index] || '').trim();
        if (!normalizedLine) return;

        textRegex.lastIndex = 0;
        const tags = [];
        let match;
        while ((match = textRegex.exec(normalizedLine)) !== null) {
            tags.push({
                time: parseTimeToSeconds(match[1], match[2], match[3]),
                index: match.index,
                end: textRegex.lastIndex
            });
        }

        if (!tags.length) {
            invalidLines += 1;
            return;
        }

        const prefixText = normalizedLine.slice(0, tags[0].index).trim();
        let addedForLine = false;

        const pendingTimes = [];
        for (let i = 0; i < tags.length; i += 1) {
            const start = tags[i].end;
            const end = i + 1 < tags.length ? tags[i + 1].index : normalizedLine.length;
            const segmentText = normalizedLine.slice(start, end).trim();

            if (!segmentText) {
                pendingTimes.push(tags[i].time);
                continue;
            }

            const timesToApply = pendingTimes.length ? pendingTimes.concat(tags[i].time) : [tags[i].time];
            pendingTimes.length = 0;

            for (const time of timesToApply) {
                lyrics.push({ time, text: segmentText });
                validLines += 1;
                addedForLine = true;
            }
        }

        // 兜底：句尾时间标签（文本在前、时间在后）
        if (!addedForLine && prefixText) {
            tags.forEach((t) => {
                lyrics.push({ time: t.time, text: prefixText });
                validLines += 1;
            });
        }
    });

    console.log('📊 解析统计：有效歌词行', validLines, '，无效歌词行', invalidLines);

    // 确保歌词按时间排序
    const sortedLyrics = lyrics.sort((a, b) => a.time - b.time);

    // 合并同一时间点的多语歌词，避免“同秒多行”导致高亮/滚动不稳定
    const mergedLyrics = [];
    const sameTimeEpsilon = 0.0009;
    for (const item of sortedLyrics) {
        const last = mergedLyrics.length ? mergedLyrics[mergedLyrics.length - 1] : null;
        if (last && Math.abs(last.time - item.time) <= sameTimeEpsilon && !last.words && !item.words) {
            if (item.text && item.text !== last.text) {
                last.text = `${last.text} / ${item.text}`;
            }
        } else {
            mergedLyrics.push({ time: item.time, text: item.text });
            if (item.words) mergedLyrics[mergedLyrics.length - 1].words = item.words;
        }
    }

    console.log('✅ 歌词解析完成，共', mergedLyrics.length, '条有效歌词');
    return mergedLyrics;
}



// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 首屏入场动画：让 4 大板块从外向内飞入（并兼容 bfcache 恢复）
    let enterTimer = 0;
    const triggerPageEnterAnimation = () => {
        try {
            const body = document.body;
            if (!body) return;

            // Restart animation reliably even when the class already exists at initial HTML load.
            body.classList.remove('page-enter');
            // Force a reflow so the next add triggers a fresh animation.
            // eslint-disable-next-line no-unused-expressions
            body.offsetWidth;

            body.classList.add('page-enter');
            body.classList.remove('pre-enter');
        } catch (e) {
            // ignore
        }

        if (enterTimer) window.clearTimeout(enterTimer);
        enterTimer = window.setTimeout(() => {
            try {
                document.body.classList.remove('page-enter');
            } catch (e) {
                // ignore
            }
        }, 1500);
    };

    triggerPageEnterAnimation();
    window.addEventListener('pageshow', (event) => {
        if (event && event.persisted) triggerPageEnterAnimation();
    });

    // 先绘制一帧（让入场动画真的出现在屏幕上），再执行较重的初始化逻辑
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            init();
        });
    });
});

function startDanmaku() {
    console.log('%c💬 弹幕系统启动', 'color: #f39c12; font-weight: bold');
    console.log('📋 初始弹幕列表:', danmakuMessages);

    if (!isMotionEnabled) {
        console.log('⛔ 动画已关闭，跳过弹幕启动');
        return;
    }
    
    // 检查弹幕是否开启
    if (!isBarrageEnabled) {
        console.log('⛔ 弹幕已关闭，跳过启动');
        return;
    }
    
    // 停止之前的定时器（如果存在）
    if (window.barrageInterval) {
        clearInterval(window.barrageInterval);
        window.barrageInterval = null;
        console.log('⏹️  已停止之前的弹幕定时器');
    }
    
    console.log('🚀 开始发送初始弹幕，共', danmakuMessages.length, '条');
    
    // 初始化弹幕定时器数组
    window.barrageTimeouts = [];
    
    // 初始弹幕
    danmakuMessages.forEach((msg, index) => {
        const timeoutId = setTimeout(() => {
            console.log(`📨 发送初始弹幕 #${index + 1}: ${msg}`);
            createDanmaku(msg);
        }, index * 2000);
        window.barrageTimeouts.push(timeoutId);
    });
    
    // 循环发送弹幕
    console.log('🔄 设置循环发送弹幕，间隔3秒');
    window.barrageInterval = setInterval(() => {
        const randomIndex = Math.floor(Math.random() * danmakuMessages.length);
        const randomMsg = danmakuMessages[randomIndex];
        console.log(`🎲 随机发送弹幕: ${randomMsg}`);
        createDanmaku(randomMsg);
    }, 3000);
    
    console.log('✅ 弹幕系统启动完成');
}

function createDanmaku(message, isSpecial = false) {
    console.log('%c💬 创建单个弹幕', 'color: #ff9800; font-weight: bold');
    console.log('📝 弹幕内容:', message);
    console.log('🎨 是否为特殊弹幕:', isSpecial ? '是' : '否');
    console.log('📺 当前弹幕开关状态:', isBarrageEnabled ? '开启' : '关闭');

    if (!isMotionEnabled) {
        console.log('⛔ 动画已关闭，不创建弹幕:', message);
        return;
    }
    
    // 检查弹幕是否开启
    if (!isBarrageEnabled) {
        console.log('⛔ 弹幕已关闭，不创建弹幕:', message);
        return;
    }
    
    const container = document.getElementById('barrage-container');
    if (!container) {
        console.warn('⚠️  未找到弹幕容器，无法创建弹幕');
        return;
    }
    
    console.log('✅ 找到弹幕容器:', container.id);
    
    // 创建弹幕元素
    const danmaku = document.createElement('div');
    
    if (isSpecial) {
        // 特殊弹幕（随机一言）样式
        danmaku.className = 'barrage-item special-barrage';
        danmaku.textContent = message;
        
        // 居中显示
        danmaku.style.top = '50%';
        danmaku.style.left = '50%';
        danmaku.style.transform = 'translate(-50%, -50%)';
        
        // 固定颜色
        danmaku.style.color = '#ffffff';
        console.log('🎨 特殊弹幕颜色:', danmaku.style.color);
        
        // 固定动画时长
        danmaku.style.animationDuration = '10s';
        console.log('⏱️  特殊弹幕动画时长:', danmaku.style.animationDuration);
    } else {
        // 普通弹幕样式
        danmaku.className = 'barrage-item';
        danmaku.textContent = message;
        
        // 随机位置（高度）
        const randomTop = Math.random() * (window.innerHeight - 50);
        danmaku.style.top = `${randomTop}px`;
        console.log('📐 普通弹幕位置（顶部）:', randomTop.toFixed(2), 'px');
        
        // 随机速度（5-15秒）
        const randomDuration = Math.random() * 10 + 5;
        danmaku.style.animationDuration = `${randomDuration}s`;
        console.log('⏱️  普通弹幕动画时长:', randomDuration.toFixed(2), '秒');
        
        // 随机颜色
        const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff'];
        const randomIndex = Math.floor(Math.random() * colors.length);
        const randomColor = colors[randomIndex];
        danmaku.style.color = randomColor;
        console.log('🎨 普通弹幕颜色:', randomColor, '(索引', randomIndex, ')');
    }
    
    // 添加到容器
    container.appendChild(danmaku);
    console.log('✅ 弹幕已添加到容器');
    
    // 动画结束后移除元素
    danmaku.addEventListener('animationend', () => {
        console.log('🗑️  弹幕动画结束，移除弹幕:', message);
        danmaku.remove();
    });
}

// 获取歌曲URL（带音质自动降级）
async function getSongUrlWithFallback(songId, source, api, userQuality = null) {
    console.log('%c🔗 获取歌曲URL（带音质自动降级）', 'color: #9b59b6; font-weight: bold');
    console.log('🎵 歌曲ID:', songId);
    console.log('📡 音乐源:', source);
    console.log('🔌 API:', api);
    console.log('🎧 用户选择的音质:', userQuality);

    if (isMetingApi(api)) {
        const id = songId == null ? '' : String(songId).trim();
        if (!id) return '';
        const serverParam = mapMetingServerParam(source);
        const brParam = getMetingBrParam(userQuality);
        const url = await fetchMetingSongUrlWithFallback(api, serverParam, id, brParam);
        if (url) return url;
        if (isProxyDisabled()) {
            // When proxy is disabled, keep a last-resort fallback so <audio> can try to follow redirects itself.
            return (
                pickDirectPlayableMetingUpstream(getMetingRequestUrls(api, {
                    server: serverParam,
                    type: 'url',
                    id,
                    br: brParam
                })) || ''
            );
        }
        return '';
    }

    if (api === 'api4') {
        const id = songId == null ? '' : String(songId).trim();
        if (!id) return '';
        const tempSong = { api: 'api4', id };
        const url = await fetchApi4SongAudioUrlWithFallback(tempSong, { quality: userQuality != null ? userQuality : currentQuality });
        return url || '';
    }

    if (api === 'api8') {
        const id = songId == null ? '' : String(songId).trim();
        if (!id) return '';

        const wanted = normalizeApi8Level(userQuality != null ? userQuality : currentQuality);
        const levels = [wanted, ...API8_LEVELS_DESC.filter((level) => level !== wanted)];
        console.log('🎚️  API8 音质尝试列表:', levels);

        for (const level of levels) {
            try {
                const directUrl = await fetchApi8SongUrl(id, level);
                if (directUrl) {
                    console.log(`✅ ${level} 音质获取成功:`, directUrl);
                    return directUrl;
                }

                const proxyUrl = await fetchApi8SongUrl(id, level, { useProxy: true });
                if (proxyUrl) {
                    console.log(`✅ ${level} 音质获取成功（代理）:`, proxyUrl);
                    return proxyUrl;
                }
            } catch (e) {
                // ignore and try next
            }
        }

        return '';
    }

    if (api === 'api7') {
        const id = songId == null ? '' : String(songId).trim();
        if (!id) return '';

        const brParam = normalizeApi7Br(userQuality != null ? userQuality : String(getApi7BrSetting()));
        const tempSong = { id, api: 'api7' };
        const url = await fetchApi7SongAudioUrlWithFallback(tempSong, { br: brParam });
        return url || '';
    }

    if (api === 'api3') {
        const id = songId == null ? '' : String(songId).trim();
        if (!id) return '';
        const quality = userQuality != null ? userQuality : currentQuality;
        const url = buildApi3DownUrl(id, quality);
        return url || '';
    }

    return '';
}

// 全局动画开关（会影响：入场动画/滚动弹幕/流光/歌词滚动等）
function loadMotionSettings() {
    try {
        const raw = String(localStorage.getItem(MOTION_ENABLED_STORAGE_KEY) || '').trim().toLowerCase();
        if (raw === 'false') isMotionEnabled = false;
        if (raw === 'true') isMotionEnabled = true;
    } catch (e) {
        // ignore
    }

    applyMotionState();
    updateMotionButton();

    // Motion impacts other effect toggles
    try { updateBarrageButton(); } catch (e) {}
    try { updateStreamLightButton(); } catch (e) {}
    if (isBarrageEnabled && isMotionEnabled) startDanmaku();
    else clearAllBarrages();
}

function applyMotionState() {
    try {
        const off = !isMotionEnabled;
        document.documentElement.classList.toggle('motion-off', off);
        document.body.classList.toggle('motion-off', off);
    } catch (e) {
        // ignore
    }

    // Motion state affects stream light rendering
    try {
        applyStreamLightState();
    } catch (e) {
        // ignore
    }

    if (!isMotionEnabled) {
        try {
            clearAllBarrages();
        } catch (e) {
            // ignore
        }
    }
}

function toggleMotion() {
    isMotionEnabled = !isMotionEnabled;
    try {
        localStorage.setItem(MOTION_ENABLED_STORAGE_KEY, String(isMotionEnabled));
    } catch (e) {
        // ignore
    }

    applyMotionState();
    updateMotionButton();

    // 更新依赖动效的按钮状态，并按需启停弹幕
    try { updateBarrageButton(); } catch (e) {}
    try { updateStreamLightButton(); } catch (e) {}
    if (isBarrageEnabled && isMotionEnabled) startDanmaku();
    else clearAllBarrages();
}

function updateMotionButton() {
    const button = document.getElementById('motion-toggle-btn');
    if (!button) return;
    button.textContent = isMotionEnabled ? '🎞️ 动画开启' : '🎞️ 动画关闭';
    button.classList.toggle('active', isMotionEnabled);
}

// 加载弹幕设置
function loadBarrageSettings() {
    const savedSetting = StorageManager.getItem('hjwjb_barrage_enabled');
    if (savedSetting === null || savedSetting === undefined) {
        isBarrageEnabled = false;
    } else if (typeof savedSetting === 'boolean') {
        isBarrageEnabled = savedSetting;
    } else if (typeof savedSetting === 'string') {
        isBarrageEnabled = savedSetting.trim().toLowerCase() === 'true';
    } else {
        isBarrageEnabled = !!savedSetting;
    }
    console.log('📺 从本地存储加载弹幕设置:', isBarrageEnabled);
    updateBarrageButton();
    if (isBarrageEnabled && isMotionEnabled) startDanmaku();
    else clearAllBarrages();
}

// 保存弹幕设置
function saveBarrageSettings() {
    StorageManager.setItem('hjwjb_barrage_enabled', isBarrageEnabled);
    console.log('📺 保存弹幕设置到本地存储:', isBarrageEnabled);
}

function loadWordLyricsSettings() {
    try {
        const raw = localStorage.getItem(WORD_LYRICS_ENABLED_STORAGE_KEY);
        if (raw == null) {
            isWordLyricsEnabled = false;
        } else if (typeof raw === 'string') {
            isWordLyricsEnabled = raw.trim().toLowerCase() === 'true';
        } else {
            isWordLyricsEnabled = !!raw;
        }
    } catch (e) {
        isWordLyricsEnabled = false;
    }
    updateWordLyricsToggleButton();
}

function updateWordLyricsToggleButton() {
    const btn = document.getElementById('word-lyrics-toggle-btn');
    if (!btn) return;
    btn.innerHTML = isWordLyricsEnabled
        ? '<i class="fas fa-highlighter"></i> 逐字歌词：开启'
        : '<i class="fas fa-highlighter"></i> 逐字歌词：关闭';
}

function toggleWordLyrics() {
    isWordLyricsEnabled = !isWordLyricsEnabled;
    try {
        localStorage.setItem(WORD_LYRICS_ENABLED_STORAGE_KEY, isWordLyricsEnabled ? 'true' : 'false');
    } catch (e) {
        // ignore
    }

    updateWordLyricsToggleButton();

    if (isWordLyricsEnabled) {
        createDanmaku('逐字歌词已开启（支持QQ音乐/网易云音乐/酷我音乐API4/酷狗音乐KRC）');
    } else {
        createDanmaku('逐字歌词已关闭');
    }

    // 强制刷新当前歌曲歌词，让开关立即生效
    try {
        if (Number.isInteger(currentSongIndex) && currentSongIndex >= 0 && playlist[currentSongIndex]) {
            fetchLyricsForSong(playlist[currentSongIndex], currentSongIndex, { force: true });
        }
    } catch (e) {
        // ignore
    }
}

// 切换弹幕开关
function toggleBarrage() {
    isBarrageEnabled = !isBarrageEnabled;
    saveBarrageSettings();
    
    updateBarrageButton();
    
    if (isBarrageEnabled && isMotionEnabled) startDanmaku();
    else clearAllBarrages();
}

// 更新弹幕开关按钮
function updateBarrageButton() {
    const button = document.getElementById('barrage-toggle-btn');
    if (!button) return;

    const suffix = isMotionEnabled ? '' : '（动画关闭）';
    button.textContent = isBarrageEnabled ? `🎬 弹幕开启${suffix}` : `🎬 弹幕关闭${suffix}`;
    button.disabled = false;
    button.classList.toggle('active', isBarrageEnabled && isMotionEnabled);
}

// 清除所有弹幕
function clearAllBarrages() {
    const container = document.getElementById('barrage-container');
    if (container) {
        container.innerHTML = '';
        console.log('🗑️  所有弹幕已清除');
    }
    
    // 停止弹幕定时器
    if (window.barrageInterval) {
        clearInterval(window.barrageInterval);
        window.barrageInterval = null;
        console.log('⏹️  弹幕定时器已停止');
    }
    
    // 清除所有初始弹幕定时器
    if (window.barrageTimeouts) {
        window.barrageTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        window.barrageTimeouts = null;
        console.log('⏹️  所有初始弹幕定时器已停止');
    }
}

// 挂载 StorageManager 到 window 对象，确保模块文件和主脚本使用同一个实例
function ensureSettingsBackdrop() {
    try {
        let backdrop = document.getElementById('settings-backdrop');
        if (backdrop) return backdrop;

        backdrop = document.createElement('div');
        backdrop.id = 'settings-backdrop';
        backdrop.className = 'settings-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        backdrop.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeSettingsMenu();
        });

        document.body.appendChild(backdrop);
        return backdrop;
    } catch (e) {
        return null;
    }
}

function setSettingsOverlayOpen(open) {
    try {
        document.body.classList.toggle('settings-open', !!open);
    } catch (e) {
        // ignore
    }
    ensureSettingsBackdrop();
}

function setupSettingsMenu() {
    if (settingsMenuBound) return;
    const dropdown = document.getElementById('settings-dropdown');
    const button = document.getElementById('settings-btn');
    const panel = document.getElementById('settings-panel');
    if (!dropdown || !button || !panel) return;
    settingsMenuBound = true;

    closeSettingsMenu();
    ensureSettingsBackdrop();

    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSettingsMenu();
    });

    panel.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) closeSettingsMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSettingsMenu();
    });
}

function toggleSettingsMenu() {
    const dropdown = document.getElementById('settings-dropdown');
    if (!dropdown) return;
    if (dropdown.classList.contains('open')) closeSettingsMenu();
    else openSettingsMenu();
}

function openSettingsMenu() {
    const dropdown = document.getElementById('settings-dropdown');
    const button = document.getElementById('settings-btn');
    const panel = document.getElementById('settings-panel');
    if (!dropdown || !button || !panel) return;

    // Refresh "已添加的歌单" each time settings opens (in case another tab updated storage).
    try {
        renderSavedApi7Playlists();
    } catch (e) {
        // ignore
    }

    dropdown.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    panel.setAttribute('aria-hidden', 'false');
    try {
        if ('inert' in panel) panel.inert = false;
    } catch (e) {
        // ignore
    }
    setSettingsOverlayOpen(true);
}

function closeSettingsMenu() {
    const dropdown = document.getElementById('settings-dropdown');
    const button = document.getElementById('settings-btn');
    const panel = document.getElementById('settings-panel');
    if (!dropdown || !button || !panel) return;

    // Avoid "aria-hidden on focused element" warning: move focus out before hiding panel.
    try {
        const active = document.activeElement;
        if (active && panel.contains(active)) {
            if (button && typeof button.focus === 'function') {
                button.focus({ preventScroll: true });
            } else if (document.body && typeof document.body.focus === 'function') {
                document.body.focus({ preventScroll: true });
            }
        }
    } catch (e) {
        // ignore
    }

    dropdown.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    try {
        if ('inert' in panel) panel.inert = true;
    } catch (e) {
        // ignore
    }
    setSettingsOverlayOpen(false);
}

function loadStreamLightSettings() {
    try {
        const raw = String(localStorage.getItem(STREAM_LIGHT_ENABLED_STORAGE_KEY) || '').trim().toLowerCase();
        if (raw === 'false') isStreamLightEnabled = false;
        if (raw === 'true') isStreamLightEnabled = true;
    } catch (e) {
        // ignore
    }
    applyStreamLightState();
    updateStreamLightButton();
}

function applyStreamLightState() {
    try {
        document.body.classList.toggle('stream-light-off', !isMotionEnabled || !isStreamLightEnabled);
    } catch (e) {
        // ignore
    }
}

function toggleStreamLight() {
    isStreamLightEnabled = !isStreamLightEnabled;
    try {
        localStorage.setItem(STREAM_LIGHT_ENABLED_STORAGE_KEY, String(isStreamLightEnabled));
    } catch (e) {
        // ignore
    }
    applyStreamLightState();
    updateStreamLightButton();
    try {
        createDanmaku(isStreamLightEnabled ? '流光已开启' : '流光已关闭');
    } catch (e) {
        // ignore
    }
}

function updateStreamLightButton() {
    const button = document.getElementById('stream-light-toggle-btn');
    if (!button) return;
    const suffix = isMotionEnabled ? '' : '（动画关闭）';
    button.textContent = isStreamLightEnabled ? `⚡ 流光开启${suffix}` : `⚡ 流光关闭${suffix}`;
    button.disabled = false;
    button.classList.toggle('active', isStreamLightEnabled && isMotionEnabled);
}

function loadLyricsOffsetSettings() {
    let value = 0;
    try {
        const raw = String(localStorage.getItem(LYRICS_OFFSET_SECONDS_STORAGE_KEY) || '').trim();
        if (raw) {
            const n = Number(raw);
            if (Number.isFinite(n)) value = n;
        }
    } catch (e) {
        // ignore
    }
    lyricsOffsetSeconds = value;
    updateLyricsOffsetButton();
}

function updateLyricsOffsetButton() {
    const button = document.getElementById('lyrics-offset-btn');
    if (!button) return;
    const v = Number.isFinite(lyricsOffsetSeconds) ? lyricsOffsetSeconds : 0;
    const sign = v > 0 ? '+' : '';
    const display = v ? `${sign}${v.toFixed(2)}s` : '0s';
    button.textContent = `🕒 歌词对齐：${display}`;
    button.classList.toggle('active', !!v);
}

function openLyricsOffsetSettings() {
    closeSettingsMenu();

    const current = Number.isFinite(lyricsOffsetSeconds) ? lyricsOffsetSeconds : 0;
    Modal.prompt({
        title: '歌词对齐',
        message: '请输入歌词偏移秒数（正数=提前，负数=延后）。例如：0.5 或 -1.2；输入 0 重置：',
        defaultValue: String(current),
        placeholder: '例如：0.5 或 -1.2',
        inputType: 'text',
        inputMode: 'decimal',
        returnFocusTo: document.getElementById('settings-btn'),
        onConfirm: (value, setError) => {
            const raw = String(value || '').trim();
            let next = 0;

            if (!raw) {
                next = 0;
                try {
                    localStorage.removeItem(LYRICS_OFFSET_SECONDS_STORAGE_KEY);
                } catch (e) {
                    // ignore
                }
            } else {
                const n = Number(raw);
                if (!Number.isFinite(n)) {
                    setError('请输入有效数字，例如 0.5 或 -1.2');
                    return false;
                }
                next = Math.max(-30, Math.min(30, n));
                try {
                    if (next) localStorage.setItem(LYRICS_OFFSET_SECONDS_STORAGE_KEY, String(next));
                    else localStorage.removeItem(LYRICS_OFFSET_SECONDS_STORAGE_KEY);
                } catch (e) {
                    // ignore
                }
            }

            lyricsOffsetSeconds = next;
            updateLyricsOffsetButton();

            isManualScrolling = false;
            clearTimeout(scrollTimeout);
            try {
                const baseTime = audioPlayer && typeof audioPlayer.currentTime === 'number' ? audioPlayer.currentTime : 0;
                updateLyrics(baseTime + lyricsOffsetSeconds);
            } catch (e) {
                // ignore
            }

            try {
                const v = Number.isFinite(lyricsOffsetSeconds) ? lyricsOffsetSeconds : 0;
                const sign = v > 0 ? '+' : '';
                createDanmaku(`歌词对齐：${sign}${v.toFixed(2)}s`);
            } catch (e) {
                // ignore
            }

            return true;
        }
    });
}

function normalizeProxyBaseUrlInput(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    let normalized = raw;
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    try {
        const u = new URL(normalized);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        if (!u.pathname.endsWith('/')) u.pathname += '/';
        u.search = '';
        u.hash = '';
        return u.toString();
    } catch (e) {
        return '';
    }
}

function parseProxyBaseUrlListInput(input) {
    const raw = String(input || '').trim();
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const out = [];
            for (const value of parsed) {
                const normalized = normalizeProxyBaseUrlInput(value);
                if (normalized && !out.includes(normalized)) out.push(normalized);
            }
            return out;
        }
    } catch (e) {
        // ignore
    }

    const parts = raw.split(/[\s,;]+/g).filter(Boolean);
    const out = [];
    for (const part of parts) {
        const normalized = normalizeProxyBaseUrlInput(part);
        if (normalized && !out.includes(normalized)) out.push(normalized);
    }
    return out;
}

function getDefaultProxyBaseUrlList() {
    const list = DEFAULT_PROXY_BASE_URLS.slice();
    try {
        const origin = window.location && window.location.origin ? String(window.location.origin) : '';
        if (!origin || origin === 'null' || !/^https?:\/\//i.test(origin)) return list;

        // Cloudflare Pages *.pages.dev cannot bind a Worker route on the same host; avoid wasting a try.
        const host = new URL(origin).hostname.toLowerCase();
        if (host.endsWith('.pages.dev')) return list;

        const normalized = normalizeProxyBaseUrlInput(origin);
        if (normalized && !list.includes(normalized)) list.unshift(normalized);
    } catch (e) {
        // ignore
    }
    return list;
}

function getProxyBaseUrlListSetting() {
    try {
        const raw = localStorage.getItem(PROXY_BASE_URL_STORAGE_KEY);
        const listRaw = parseProxyBaseUrlListInput(raw);
        const list = listRaw.filter((base) => {
            try {
                const host = new URL(base).hostname.toLowerCase();
                // Common misconfiguration: users paste the API2 backend as proxy base.
                if (host === '') return false;
                return true;
            } catch (e) {
                return true;
            }
        });
        if (list.length) return list;
    } catch (e) {
        // ignore
    }
    return getDefaultProxyBaseUrlList();
}

function getProxyBaseUrlSetting() {
    const list = getProxyBaseUrlListSetting();
    if (!list.length) return '';

    try {
        const active = normalizeProxyBaseUrlInput(localStorage.getItem(PROXY_ACTIVE_BASE_URL_STORAGE_KEY));
        if (active && list.includes(active)) return active;
    } catch (e) {
        // ignore
    }

    const fallback = list[0] || '';
    if (fallback) {
        try {
            localStorage.setItem(PROXY_ACTIVE_BASE_URL_STORAGE_KEY, fallback);
        } catch (e) {
            // ignore
        }
    }
    return fallback;
}

function switchToNextProxyBaseUrl() {
    const list = getProxyBaseUrlListSetting();
    if (list.length <= 1) return '';
    const current = getProxyBaseUrlSetting();
    const idx = list.indexOf(current);
    const next = list[(idx >= 0 ? idx + 1 : 0) % list.length];
    try {
        localStorage.setItem(PROXY_ACTIVE_BASE_URL_STORAGE_KEY, next);
    } catch (e) {
        // ignore
    }
    return next;
}

function openProxySettings() {
    closeSettingsMenu();

    let currentSaved = '';
    try {
        currentSaved = String(localStorage.getItem(PROXY_BASE_URL_STORAGE_KEY) || '').trim();
    } catch (e) {
        currentSaved = '';
    }
    const hintDefault = DEFAULT_PROXY_BASE_URLS.join('\n');
    const current = currentSaved || hintDefault;
    Modal.prompt({
        title: '代理服务器',
        message:
            '请输入代理服务的 base URL（可填多个，用逗号/空格/换行分隔，必须支持 /text-proxy 路由，例如：https:/// ）。留空可清除自定义并恢复默认代理：',
        defaultValue: current || '',
        placeholder: '',
        inputType: 'text',
        inputMode: 'url',
        returnFocusTo: document.getElementById('settings-btn'),
        onConfirm: (value, setError) => {
            const raw = String(value || '').trim();
            if (!raw) {
                try {
                    localStorage.removeItem(PROXY_BASE_URL_STORAGE_KEY);
                    localStorage.removeItem(PROXY_ACTIVE_BASE_URL_STORAGE_KEY);
                    localStorage.removeItem(PROXY_DISABLED_STORAGE_KEY);
                } catch (e) {
                    // ignore
                }
                try {
                    createDanmaku('已清除自定义代理（将使用默认代理）');
                } catch (e) {
                    // ignore
                }
                return true;
            }

            const list = parseProxyBaseUrlListInput(raw);
            if (!list.length) {
                setError('代理地址无效，请确认包含 https:// 且是完整域名。');
                return false;
            }

            try {
                localStorage.setItem(PROXY_BASE_URL_STORAGE_KEY, list.join('\n'));
                localStorage.setItem(PROXY_ACTIVE_BASE_URL_STORAGE_KEY, list[0]);
                localStorage.removeItem(PROXY_DISABLED_STORAGE_KEY);
            } catch (e) {
                // ignore
            }
            try {
                createDanmaku('代理设置已保存');
            } catch (e) {
                // ignore
            }

            return true;
        }
    });
}

function normalizeApi2KugouAuthKeyInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    // Accept full URL like: https:///register/dev?authKey=xxx
    try {
        const u = new URL(raw);
        const k = u.searchParams.get('authKey') || u.searchParams.get('authkey');
        if (k) return String(k).trim();
    } catch (e) {
        // ignore
    }

    const match = raw.match(/(?:\?|&)authKey=([^&\s]+)/i);
    if (match && match[1]) {
        try {
            return decodeURIComponent(match[1]).trim();
        } catch (e) {
            return String(match[1]).trim();
        }
    }

    return raw;
}

function openApi2KugouAuthKeySettings() {
    closeSettingsMenu();

    let current = '';
    try {
        current = String(localStorage.getItem(API2_KUGOU_AUTH_KEY_STORAGE_KEY) || '').trim();
    } catch (e) {
        current = '';
    }

    Modal.prompt({
        title: 'API2 酷狗 AuthKey',
        message:
            ' 的 /register/dev 现在需要 authKey（否则会 401）。请输入 authKey（也可直接粘贴包含 ?authKey= 的完整链接）；留空可清除：',
        defaultValue: current || '',
        placeholder: 'authKey 或 https:///register/dev?authKey=xxx',
        inputType: 'text',
        returnFocusTo: document.getElementById('settings-btn'),
        onConfirm: (value, setError) => {
            const key = normalizeApi2KugouAuthKeyInput(value);
            if (!key) {
                try {
                    localStorage.removeItem(API2_KUGOU_AUTH_KEY_STORAGE_KEY);
                } catch (e) {
                    // ignore
                }
                api2KugouDeviceReadyAt = 0;
                api2KugouDeviceAuthErrorUntil = 0;
                try {
                    createDanmaku('API2 酷狗 AuthKey 已清除');
                } catch (e) {
                    // ignore
                }
                return true;
            }

            if (key.length < 6) {
                setError('authKey 看起来不正确，请确认是否复制完整。');
                return false;
            }

            try {
                localStorage.setItem(API2_KUGOU_AUTH_KEY_STORAGE_KEY, key);
            } catch (e) {
                // ignore
            }

            api2KugouDeviceReadyAt = 0;
            api2KugouDeviceAuthErrorUntil = 0;
            try {
                createDanmaku('API2 酷狗 AuthKey 已保存');
            } catch (e) {
                // ignore
            }

            // Best-effort: immediately refresh device cookies in background.
            try {
                ensureApi2KugouDeviceCookiesReady({ force: true });
            } catch (e) {
                // ignore
            }

            return true;
        }
    });
}

function openApi7KeySettings() {
    closeSettingsMenu();

    let current = '';
    try {
        current = String(localStorage.getItem(API7_KEY_STORAGE_KEY) || '').trim();
    } catch (e) {
        current = '';
    }
    Modal.prompt({
        title: 'API7 Key',
        message: '请输入 API7 Key（可填多个，用逗号/空格/换行分隔；留空可清除并使用默认）：',
        defaultValue: current || '',
        placeholder: 'API7 Key',
        inputType: 'text',
        returnFocusTo: document.getElementById('settings-btn'),
        onConfirm: (value) => {
            const raw = String(value || '').trim();
            if (!raw) {
                try {
                    localStorage.removeItem(API7_KEY_STORAGE_KEY);
                } catch (e) {
                    // ignore
                }
                try {
                    createDanmaku('API7 Key 已清除（将使用默认）');
                } catch (e) {
                    // ignore
                }
                return true;
            }
            try {
                localStorage.setItem(API7_KEY_STORAGE_KEY, raw);
            } catch (e) {
                // ignore
            }
            try {
                createDanmaku('API7 Key 已保存');
            } catch (e) {
                // ignore
            }
            return true;
        }
    });
}

function fetchV50() {
    const candidates = [
        '疯狂星期四，v我50。',
        '今天疯狂星期四，谁请我吃？v我50！',
        '肯德基疯狂星期四，v我50，听我讲个故事……'
    ];
    const msg = candidates[Math.floor(Math.random() * candidates.length)];

    closeSettingsMenu();

    openCopyTextModal({
        title: '疯狂星期四',
        message: '复制下面文案：',
        text: msg,
        autoCopy: true,
        returnFocusTo: document.getElementById('settings-btn')
    });
}

window.StorageManager = StorageManager;

console.log('✅ HJWJB 音乐播放器所有功能初始化完成');
