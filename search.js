/* HJWJB Music - Search Page */

console.log('🔎 搜索页脚本已加载');

const BR_QUALITY_DEFAULT = '999';
const BR_QUALITIES = ['999', '740', '320', '192', '128'];
const API2_QUALITY_DEFAULT = '320';
// API2 (QQ backend): supported quality params for `/api/song/url`
const API2_QQ_QUALITIES = ['flac', '320', '128'];
// API2 (Kugou): supported quality params for `/song/url`
const API2_KUGOU_QUALITIES = ['high', 'viper_clear', 'viper_atmos', 'flac', '320', '128'];
const API8_LEVEL_DEFAULT = 'standard';
const API8_LEVELS = ['standard', 'higher', 'exhigh', 'lossless', 'hire'];
const API8_LEVELS_DESC = ['hire', 'lossless', 'exhigh', 'higher', 'standard'];
const METING_BR_DEFAULT = '128';
const METING_BR_HIGHEST = '400';
const METING_BR_LEVELS = ['128', '320', '380', '400'];

const METING_API_BASE_URLS = {
    api9: ['https://mapi-org.baka.plus/meting/', 'https://api.baka.plus/meting/', 'https://api.obdo.cc/meting/'],
    api10: [
        'https://musicapi.chuyel.top/api',
        'https://mapi-org.baka.plus/meting/',
        'https://api.baka.plus/meting/',
        'https://api.obdo.cc/meting/',
        'https://api.qijieya.cn/meting/'
    ]
};

const API2_BASE_URL_FALLBACK = 'https://';
const API2_BASE_URL_STORAGE_KEY = 'hjwjb_api2_base_url_v1';
const API2_KUGOU_BASE_URL_FALLBACK = 'https://';
const API2_KUGOU_BASE_URL_STORAGE_KEY = 'hjwjb_api2_kugou_base_url_v1';
const API2_KUGOU_AUTH_KEY_STORAGE_KEY = 'hjwjb_api2_kugou_auth_key_v1';

// API3 (NetEase / 163) - https://api.bugpk.com/api/163_music
const API3_BASE_URL = 'https://api.bugpk.com/api/163_music';
const API3_LEVEL_DEFAULT = 'standard';

// API4 (Kuwo) - https://kw-api.cenguigui.cn
const API4_BASE_URL = 'https://kw-api.cenguigui.cn';

const PROXY_BASE_URL_STORAGE_KEY = 'hjwjb_proxy_base_url_v1';
const PROXY_ACTIVE_BASE_URL_STORAGE_KEY = 'hjwjb_proxy_base_url_active_v1';
const PROXY_DISABLED_STORAGE_KEY = 'hjwjb_proxy_disabled_v1';
// Proxy base URLs must implement `/text-proxy`.
// NOTE: `0` is an API2 backend (QQ) and does NOT provide proxy routes.
const DEFAULT_PROXY_BASE_URLS = ['https:///'];
const HJWJB_PLAYER_CONTROL_CHANNEL = 'hjwjb_player_control_v1';

const API7_KEY_STORAGE_KEY = 'hjwjb_api7_key';
const API7_DEFAULT_KEYS = [
    'oiapi-5a9f214b-6523-9144-91a8-569ab3a41e36',
    'oiapi-148cca90-908f-51da-fe96-2349ac30051a'
];

const api2Sources = ['QQ音乐', '酷狗音乐'];
const api3Sources = ['网易云音乐'];
const api4Sources = ['酷我音乐'];
const api7Sources = ['QQ音乐'];
const api8Sources = ['网易云音乐'];
const api9Sources = ['网易云音乐', 'QQ音乐'];
const api10Sources = api9Sources.slice();

const DEFAULT_COVER = 'IMG_20251115_090141.png';
const SEARCH_MODE_STORAGE_KEY = 'hjwjb_search_mode_v1';
const SEARCH_CHART_STORAGE_KEY = 'hjwjb_search_chart_id_v1';

const NETEASE_CHARTS = [
    { id: '3778678', name: '网易云热歌榜' },
    { id: '3779629', name: '网易云新歌榜' },
    { id: '2884035', name: '网易云原创榜' },
    { id: '19723756', name: '网易云飙升榜' }
];

let api2TopChartsCache = null;
let api2TopChartsLoading = null;
let api2TopChartsLoadedAt = 0;
let api2KugouRankCache = null;
let api2KugouRankLoading = null;
let api2KugouRankLoadedAt = 0;

let searchInput;
let searchButton;
let searchResults;
let loadMoreContainer;
let loadMoreBtn;
let musicSourceSelect;
let apiSelect;
let qualitySelect;
let qualitySwitchBtn;
let searchModeSelect;
let chartGroup;
let chartSelect;

let currentMusicSource = api10Sources[0];
let currentApi = 'api10';
let currentQuality = BR_QUALITY_DEFAULT;
let currentApi7Br = 4;
let isHighestQualityMode = true;

let currentSearchMode = 'song';
let currentChartId = '';

let currentPage = 1;
let hasMoreResults = true;
let isLoadingMore = false;
let currentSearchKeyword = '';
let sharedSettingsSyncBound = false;

const StorageManager = (() => {
    // Prefer the shared StorageManager (index.html loads src/utils/storage.js) so same-tab listeners
    // can observe changes.
    if (window.StorageManager && typeof window.StorageManager.getItem === 'function') {
        return window.StorageManager;
    }

    const notifyWrite = (key, value) => {
        try {
            window.dispatchEvent(new CustomEvent('hjwjb-storage-write', { detail: { key, value } }));
        } catch (e) {
            // ignore
        }
    };

    return {
        getItem(key, defaultValue = null) {
            try {
                const value = localStorage.getItem(key);
                if (value == null) return defaultValue;
                // Compatibility: some settings are stored as raw strings (e.g. "api9") and are not valid JSON.
                try {
                    return JSON.parse(value);
                } catch (e) {
                    // If a default was explicitly provided, keep the old "fallback to default" behavior.
                    return arguments.length >= 2 ? defaultValue : value;
                }
            } catch (e) {
                return defaultValue;
            }
        },
        setItem(key, value) {
            try {
                const raw = typeof value === 'string' ? value : JSON.stringify(value);
                localStorage.setItem(key, raw);
                notifyWrite(key, raw);
            } catch (e) {
                // ignore
            }
        },
        removeItem(key) {
            try {
                localStorage.removeItem(key);
            } catch (e) {
                // ignore
            } finally {
                notifyWrite(key, null);
            }
        }
    };
})();

async function detectActivePlayerTab({ timeoutMs = 260 } = {}) {
    if (typeof BroadcastChannel === 'undefined') return false;
    try {
        const channel = new BroadcastChannel(HJWJB_PLAYER_CONTROL_CHANNEL);
        return await new Promise((resolve) => {
            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                try { channel.close(); } catch (e) { /* ignore */ }
                resolve(!!value);
            };

            const timer = setTimeout(() => finish(false), timeoutMs);
            channel.addEventListener('message', (event) => {
                const data = event && event.data ? event.data : null;
                if (data && typeof data === 'object' && data.type === 'PONG') {
                    clearTimeout(timer);
                    finish(true);
                }
            });

            try {
                channel.postMessage({ type: 'PING', at: Date.now() });
            } catch (e) {
                clearTimeout(timer);
                finish(false);
            }
        });
    } catch (e) {
        return false;
    }
}

function requestPlayerFocus() {
    try {
        if (window.opener && !window.opener.closed && typeof window.opener.focus === 'function') {
            window.opener.focus();
            return;
        }
    } catch (e) {
        // ignore
    }

    if (typeof BroadcastChannel === 'undefined') return;
    try {
        const channel = new BroadcastChannel(HJWJB_PLAYER_CONTROL_CHANNEL);
        channel.postMessage({ type: 'FOCUS', at: Date.now() });
        channel.close();
    } catch (e) {
        // ignore
    }
}

function initReturnToPlayerLinks() {
    const links = document.querySelectorAll('a[data-home-link="true"]');
    if (!links || !links.length) return;

    links.forEach((link) => {
        link.addEventListener('click', (event) => {
            if (event.defaultPrevented) return;
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            event.preventDefault();
            const href = link.getAttribute('href') || 'index.html';

            const hasOpener = (() => {
                try {
                    return !!(window.opener && !window.opener.closed);
                } catch (e) {
                    return false;
                }
            })();

            const goBack = () => {
                requestPlayerFocus();
                createDanmaku('正在返回播放器...');
                setTimeout(() => {
                    try { window.close(); } catch (e) { /* ignore */ }
                }, 80);
            };

            if (hasOpener) {
                goBack();
                return;
            }

            detectActivePlayerTab({ timeoutMs: 260 })
                .then((hasActivePlayer) => {
                    if (!hasActivePlayer) {
                        window.location.href = href;
                        return;
                    }
                    goBack();
                })
                .catch(() => {
                    window.location.href = href;
                });
        });
    });
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
        '128k': '128'
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

function getApi2QualitiesForSourceKey(sourceKey) {
    const key = String(sourceKey || '').trim().toLowerCase();
    if (key === 'kugou') return API2_KUGOU_QUALITIES;
    return API2_QQ_QUALITIES;
}

function normalizeApi2Quality(value, { sourceKey } = {}) {
    const raw = value == null ? '' : String(value);
    const text = raw.trim().toLowerCase();
    if (!text) return API2_QUALITY_DEFAULT;

    const resolvedSourceKey = (() => {
        const key = String(sourceKey || '').trim().toLowerCase();
        if (key) return key;
        try {
            return mapMusicSourceToApiSource(currentMusicSource);
        } catch (e) {
            return '';
        }
    })();
    const allowed = getApi2QualitiesForSourceKey(resolvedSourceKey);

    const aliasMap = {
        '128': '128',
        '128k': '128',
        '320': '320',
        '320k': '320',
        flac: 'flac',
        lossless: 'flac',
        high: 'high',
        viper_atmos: 'viper_atmos',
        viper_clear: 'viper_clear'
    };

    const mapped = aliasMap[text];
    if (mapped && allowed.includes(mapped)) return mapped;
    if (allowed.includes(text)) return text;
    return API2_QUALITY_DEFAULT;
}

function getApi2QualityDisplayName(value, { sourceKey } = {}) {
    const q = normalizeApi2Quality(value, { sourceKey });
    if (q === 'viper_clear') return '蝰蛇超清';
    if (q === 'viper_atmos') return '蝰蛇全景声';
    if (q === 'high') return '无损 ';
    if (q === 'flac') return '无损 (FLAC)';
    if (q === '320') return '320K';
    return '128K';
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
        hires: 'hire'
    };

    const mapped = aliasMap[text];
    if (mapped) return mapped;
    if (API8_LEVELS.includes(text)) return text;
    return API8_LEVEL_DEFAULT;
}

function getApi8LevelDisplayName(value) {
    const level = normalizeApi8Level(value);
    const nameMap = {
        standard: '标准',
        higher: '较高',
        exhigh: '极高',
        lossless: '无损',
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

function normalizeProxyBaseUrlInput(value) {
    const raw = String(value || '').trim();
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

function parseProxyBaseUrlListInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const out = [];
            for (const item of parsed) {
                const normalized = normalizeProxyBaseUrlInput(item);
                if (normalized && !out.includes(normalized)) out.push(normalized);
            }
            return out;
        }
    } catch (e) {
        // ignore
    }

    const parts = raw.split(/[\s,;]+/g).map((part) => part.trim()).filter(Boolean);
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
                if (host === '0') return false;
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

function openProxySettings() {
    const hint = DEFAULT_PROXY_BASE_URLS.join(' ');
    let current = '';
    try {
        current = String(localStorage.getItem(PROXY_BASE_URL_STORAGE_KEY) || '').trim();
    } catch (e) {
        current = '';
    }
    const input = window.prompt(
        '请输入代理服务 Base URL（可多个，用空格/逗号分隔，必须支持 /text-proxy）。留空恢复默认：',
        current || hint
    );
    if (input == null) return;
    const trimmed = String(input).trim();
    if (!trimmed) {
        try {
            localStorage.removeItem(PROXY_BASE_URL_STORAGE_KEY);
            localStorage.removeItem(PROXY_ACTIVE_BASE_URL_STORAGE_KEY);
            localStorage.removeItem(PROXY_DISABLED_STORAGE_KEY);
        } catch (e) {
            // ignore
        }
        createDanmaku('已恢复默认代理');
        return;
    }
    const list = parseProxyBaseUrlListInput(trimmed);
    if (!list.length) {
        createDanmaku('代理地址无效');
        return;
    }
    try {
        localStorage.setItem(PROXY_BASE_URL_STORAGE_KEY, list.join(' '));
        localStorage.setItem(PROXY_ACTIVE_BASE_URL_STORAGE_KEY, list[0]);
        localStorage.setItem(PROXY_DISABLED_STORAGE_KEY, 'false');
    } catch (e) {
        // ignore
    }
    createDanmaku('代理已更新');
}

function parseJsonText(text) {
    if (text == null) return null;
    const raw = String(text).trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

async function fetchTextWithProxyFallback(url, { accept = 'application/json', timeoutMs = 8000, useProxyFallback = true } = {}) {
    const attempt = async (requestUrl) => {
        let controller = null;
        let timer = null;
        try {
            if (typeof AbortController !== 'undefined') {
                controller = new AbortController();
                timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
            }

            const response = await fetch(requestUrl, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': accept },
                signal: controller ? controller.signal : undefined
            });
            if (!response.ok) return '';
            const contentType = String(response.headers.get('content-type') || '').toLowerCase();
            const text = await response.text();
            if (!text || !text.trim()) return '';
            if (contentType.includes('text/html') && /<html|<!doctype/i.test(text)) return '';
            return text;
        } catch (error) {
            return '';
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    for (let tryIndex = 1; tryIndex <= 2; tryIndex += 1) {
        const direct = await attempt(url);
        if (direct) return direct;
        if (tryIndex < 2) await new Promise((resolve) => setTimeout(resolve, 220));
    }

    if (!useProxyFallback) return '';
    if (isProxyDisabled()) return '';

    const endpoint = 'text-proxy';
    const name = String(endpoint).trim().replace(/^\/+/, '');
    const normalizedBase = normalizeProxyBaseUrlInput(getProxyBaseUrlSetting());
    if (!normalizedBase || !name) return '';
    const proxyUrl = `${normalizedBase}${name}?url=${encodeURIComponent(url)}`;
    const text = await attempt(proxyUrl);
    if (text) {
        try {
            localStorage.setItem(PROXY_ACTIVE_BASE_URL_STORAGE_KEY, normalizedBase);
        } catch (e) {
            // ignore
        }
    }
    return text || '';
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

function getApi4LevelCandidates(brValue) {
    const br = normalizeBrQuality(brValue);
    if (br === '999') return ['hires', 'lossless', 'exhigh', 'standard'];
    if (br === '740') return ['lossless', 'exhigh', 'standard'];
    if (br === '128') return ['standard'];
    return ['exhigh', 'standard'];
}

async function fetchApi8SongUrl(songId, level, { useProxy = false } = {}) {
    const targetUrl = buildApi8RequestUrl(songId, level);
    if (!targetUrl) return '';

    const requestUrl = useProxy ? buildProxyEndpointUrl('text-proxy', targetUrl) : targetUrl;
    if (useProxy && !requestUrl) return '';

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
                if (location) return location;
            }

            if (!response.ok) return '';

            const rawText = await response.text();
            const extracted = extractFirstHttpUrlFromText(rawText);
            return extracted;
        } catch (e) {
            return '';
        }
    };

    if (useProxy) return await fetchOnce();

    for (let tryIndex = 1; tryIndex <= 2; tryIndex += 1) {
        const url = await fetchOnce();
        if (url) return url;
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
    const text = await fetchTextWithProxyFallback(url, { accept: 'application/json,*/*' });
    return parseJsonText(text);
}

async function fetchApi2KugouJsonWithFallback(pathname, params) {
    const url = buildApi2KugouUrl(pathname, params);
    if (!url) return null;

    const isKugouSongUrlEndpoint = (() => {
        try {
            const p = String(pathname || '').replace(/\/+$/, '');
            return p === '/song/url';
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

    const accept = 'application/json,*/*';

    const fetchOnce = async (requestUrl, { credentials = undefined } = {}) => {
        try {
            const resp = await fetch(requestUrl, {
                method: 'GET',
                mode: 'cors',
                credentials,
                headers: { 'Accept': accept }
            });
            if (!resp || !resp.ok) return null;
            const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
            const text = await resp.text();
            if (!text || !text.trim()) return null;
            if (contentType.includes('text/html') && /<html|<!doctype/i.test(text)) return null;
            const parsed = parseJsonText(text);
            if (isKugouSongUrlEndpoint && isKugouVerificationError(parsed)) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    };

    for (let tryIndex = 1; tryIndex <= 2; tryIndex += 1) {
        const direct = await fetchOnce(url, { credentials: 'include' });
        if (direct) return direct;
        if (tryIndex < 2) await new Promise((resolve) => setTimeout(resolve, 220));
    }

    // Direct failed: try proxy once (proxy injects device cookies for Kugou song url when supported).
    const proxyUrl = buildProxyEndpointUrl('text-proxy', url);
    if (!proxyUrl) return null;
    return await fetchOnce(proxyUrl);
}

let api2KugouDeviceReadyPromise = null;
let api2KugouDeviceReadyAt = 0;
let api2KugouDeviceAuthErrorUntil = 0;
let api2KugouDeviceAuthPromptedAt = 0;

function normalizeApi2KugouAuthKeyInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

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

function openApi2KugouAuthKeyPrompt() {
    let current = '';
    try {
        current = getApi2KugouAuthKey();
    } catch (e) {
        current = '';
    }
    const input = window.prompt(
        'API2 酷狗 /register/dev 需要 AuthKey（否则会 401）。请输入 authKey（也可粘贴包含 ?authKey= 的完整链接）；留空清除：',
        current || ''
    );
    if (input == null) return;

    const key = normalizeApi2KugouAuthKeyInput(input);
    if (!key) {
        try {
            localStorage.removeItem(API2_KUGOU_AUTH_KEY_STORAGE_KEY);
        } catch (e) {
            // ignore
        }
        api2KugouDeviceReadyAt = 0;
        api2KugouDeviceAuthErrorUntil = 0;
        createDanmaku('API2 酷狗 AuthKey 已清除');
        return;
    }

    try {
        localStorage.setItem(API2_KUGOU_AUTH_KEY_STORAGE_KEY, key);
    } catch (e) {
        // ignore
    }
    api2KugouDeviceReadyAt = 0;
    api2KugouDeviceAuthErrorUntil = 0;
    createDanmaku('API2 酷狗 AuthKey 已保存');
}

async function ensureApi2KugouDeviceCookiesReady({ force = false } = {}) {
    const now = Date.now();
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
                    const promptNow = Date.now() - api2KugouDeviceAuthPromptedAt > 5 * 60 * 1000;
                    if (promptNow) api2KugouDeviceAuthPromptedAt = Date.now();

                    const hasKey = !!getApi2KugouAuthKey();
                    const hint = hasKey
                        ? 'API2 酷狗 AuthKey 无效/已失效，请重新设置。'
                        : 'API2 酷狗需要 AuthKey，请先设置后再播放。';
                    if (promptNow) {
                        createDanmaku(hint);
                        try {
                            if (window.confirm(`${hint}\n是否现在设置 AuthKey？`)) openApi2KugouAuthKeyPrompt();
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
        return [chuyelBase, ...cleaned.filter((u) => u !== chuyelBase && u !== qijieyaBase)];
    }

    // netease (default): do not use chuyel for API10 NetEase requests.
    return [qijieyaBase, ...cleaned.filter((u) => u !== qijieyaBase && u !== chuyelBase)];
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
    return getMetingBaseUrls(apiName, params && params.server).map((baseUrl) => buildMetingUrl(baseUrl, params)).filter(Boolean);
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

function getMetingSearchMode(apiName) {
    if (apiName === 'api9') return 'keyword';
    if (apiName === 'api10') return 'auto';
    return 'unsupported';
}

async function fetchMetingTextWithFallback(apiName, params, { accept = '*/*' } = {}) {
    const urls = getMetingRequestUrls(apiName, params);
    for (const url of urls) {
        const text = await fetchTextWithProxyFallback(url, { accept });
        if (text) return text;
    }
    return '';
}

async function fetchMetingSearchWithFallback(apiName, keyword, server) {
    const mode = getMetingSearchMode(apiName);
    if (mode === 'unsupported') {
        return { ok: false, list: [], message: '当前Meting接口不支持搜索', supported: false };
    }

    const baseParams = {
        server: mapMetingServerParam(server),
        type: 'search'
    };

    const tryParamsList = [];
    if (mode === 'keyword') {
        tryParamsList.push({ ...baseParams, keyword, id: '1' });
    } else if (mode === 'auto') {
        // Try the classic Meting form first: `id=<keyword>`.
        tryParamsList.push({ ...baseParams, id: keyword });
        // Some upstreams require `keyword=<kw>&id=1`.
        tryParamsList.push({ ...baseParams, keyword, id: '1' });
    } else {
        tryParamsList.push({ ...baseParams, id: keyword });
    }

    let lastMessage = '';
    for (const params of tryParamsList) {
        const text = await fetchMetingTextWithFallback(apiName, params, { accept: 'application/json' });
        const data = parseJsonText(text);
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
        lastMessage = data && (data.message || data.msg || data.error) ? String(data.message || data.msg || data.error) : lastMessage;
        if (Array.isArray(data) || list.length > 0) {
            return { ok: true, list, message: lastMessage, supported: true };
        }
    }

    // API10 上游（例如 qijieya）可能不支持 `type=search`，此时用 API9 的 Meting 搜索作为兜底，避免“API10 无法搜索”。
    if (apiName === 'api10') {
        try {
            const fallback = await fetchMetingSearchWithFallback('api9', keyword, server);
            if (fallback && fallback.supported && Array.isArray(fallback.list) && fallback.list.length) {
                return { ...fallback, message: fallback.message || lastMessage, supported: true };
            }
        } catch (e) {
            // ignore and return original failure
        }
    }

    return { ok: false, list: [], message: lastMessage, supported: true };
}

async function fetchMetingPlaylistWithFallback(apiName, playlistId, server) {
    const id = String(playlistId || '').trim();
    if (!id) return { ok: false, list: [], message: '' };

    const params = {
        server: mapMetingServerParam(server),
        type: 'playlist',
        id
    };

    const text = await fetchMetingTextWithFallback(apiName, params, { accept: 'application/json' });
    const data = parseJsonText(text);
    const list = Array.isArray(data)
        ? data
        : (data && Array.isArray(data.data) ? data.data : []);

    let message = '';
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        if (data.error != null) message = String(data.error);
        else if (data.message != null) message = String(data.message);
        else if (data.msg != null) message = String(data.msg);
    }

    return {
        ok: Array.isArray(data) ? data.length > 0 : list.length > 0,
        list,
        message
    };
}

function extractMetingIdFromItem(item) {
    if (!item || typeof item !== 'object') return '';
    const rawId = item.id ?? item.songid ?? item.songId ?? item.song_id;
    if (rawId != null && String(rawId).trim()) return String(rawId).trim();

    const candidates = [item.url, item.pic, item.lrc];
    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            const u = new URL(String(candidate), window.location.href);
            const id = u.searchParams.get('id');
            if (id) return String(id).trim();
        } catch (e) {
            const match = String(candidate).match(/[?&]id=([^&]+)/i);
            if (match && match[1]) return decodeURIComponent(match[1]);
        }
    }
    return '';
}

function normalizeMetingSearchItem(item) {
    if (!item || typeof item !== 'object') return null;
    const id = extractMetingIdFromItem(item);
    const titleRaw = item.name ?? item.title ?? item.songname;
    const title = titleRaw != null ? String(titleRaw).trim() : '';
    if (!id || !title) return null;

    const upgradeToHttps = (value) => {
        const raw = value == null ? '' : String(value).trim();
        if (!raw) return '';
        if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, 'https://');
        return raw;
    };

    return {
        id,
        title,
        artist: item.artist ? String(item.artist).trim() : (item.author ? String(item.author).trim() : (item.singer ? String(item.singer).trim() : '')),
        album: item.album ? String(item.album).trim() : '',
        cover: upgradeToHttps(item.pic),
        url: upgradeToHttps(item.url)
    };
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
        const apiUrl = buildMetingUrl('https://musicapi.chuyel.top/api', {
            server: mapMetingServerParam(server),
            type: 'song',
            id: songId
        });
        const text = apiUrl ? await fetchTextWithProxyFallback(apiUrl, { accept: 'application/json' }) : '';
        const data = parseJsonText(text);
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
        const first = list && list.length ? list[0] : null;
        const urlRaw = first && first.url != null ? String(first.url).trim() : '';
        return upgradeToHttps(urlRaw);
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

async function fetchApi4SearchWithFallback(keyword, page = 1, limit = 20) {
    const query = String(keyword || '').trim();
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Math.floor(Number(limit)))) : 20;
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page))) : 1;
    if (!query) return { ok: false, list: [], message: '' };

    const apiUrl = buildApi4Url({
        name: query,
        page: safePage,
        pagesize: safeLimit,
        limit: safeLimit,
        class: '单曲'
    });
    const text = apiUrl ? await fetchTextWithProxyFallback(apiUrl, { accept: 'application/json', useProxyFallback: false }) : '';
    const data = parseJsonText(text);
    const list = data && Array.isArray(data.data) ? data.data : [];
    const ok = !!(data && (data.code === 200 || data.code === '200')) || list.length > 0;
    const message = data && (data.msg || data.title) ? String(data.msg || data.title) : '';
    const total = data && data.total_all && data.total_all.total != null ? data.total_all.total : null;
    return { ok, list, message, total };
}

async function fetchApi4PlaylistWithFallback(playlistId, page = 1, limit = 30) {
    const id = String(playlistId || '').trim();
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(99, Math.floor(Number(limit)))) : 30;
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page))) : 1;
    if (!id) return { ok: false, list: [], message: '', meta: null };

    const apiUrl = buildApi4Url({ id, type: 'list', page: safePage, limit: safeLimit });
    const text = apiUrl ? await fetchTextWithProxyFallback(apiUrl, { accept: 'application/json', useProxyFallback: false }) : '';
    const data = parseJsonText(text);
    const payload = data && data.data && typeof data.data === 'object' ? data.data : null;
    const list = payload && Array.isArray(payload.musicList) ? payload.musicList : [];
    const ok = !!(data && (data.code === 200 || data.code === '200')) || list.length > 0;
    const message = data && (data.msg || data.title) ? String(data.msg || data.title) : '';
    const meta = payload
        ? {
            id: payload.id,
            name: payload.name,
            tag: payload.tag,
            desc: payload.desc,
            img: payload.img || payload.img700 || payload.img500 || payload.img300 || '',
            uname: payload.uname || payload.userName || ''
        }
        : null;
    return { ok, list, message, meta };
}

async function fetchApi4RankWithFallback(rankName, page = 1, limit = 99) {
    const name = String(rankName || '').trim();
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Math.floor(Number(limit)))) : 99;
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page))) : 1;
    if (!name) return { ok: false, list: [], message: '' };

    const apiUrl = buildApi4Url({ name, type: 'rank', page: safePage, limit: safeLimit });
    const text = apiUrl ? await fetchTextWithProxyFallback(apiUrl, { accept: 'application/json', useProxyFallback: false }) : '';
    const data = parseJsonText(text);

    // Some implementations return list directly in `data`, some wrap it.
    const list = data && Array.isArray(data.data) ? data.data : [];
    const ok = !!(data && (data.code === 200 || data.code === '200')) || list.length > 0;
    const message = data && (data.msg || data.title) ? String(data.msg || data.title) : '';
    return { ok, list, message };
}

async function fetchApi4SongUrlWithFallback(songId, brValue) {
    const id = songId == null ? '' : String(songId).trim();
    if (!id) return '';

    const levels = getApi4LevelCandidates(brValue);
    for (const level of levels) {
        const apiUrl = buildApi4Url({ id, type: 'song', level, format: 'json' });
        const text = apiUrl ? await fetchTextWithProxyFallback(apiUrl, { accept: 'application/json', useProxyFallback: false }) : '';
        const data = parseJsonText(text);
        const ok = data && (data.code === 200 || data.code === '200');
        const payload = ok && data.data && typeof data.data === 'object' ? data.data : null;
        const url = payload && payload.url != null ? String(payload.url).trim() : '';
        if (url && /^https?:\/\//i.test(url)) return url;
    }

    return '';
}

async function fetchApi3SongUrlWithFallback(songId, quality) {
    const id = songId == null ? '' : String(songId).trim();
    if (!id) return '';

    // Prefer the API endpoint that returns audio directly.
    const downUrl = buildApi3DownUrl(id, quality != null ? quality : currentQuality);
    if (downUrl) return downUrl;

    // Fallback: try JSON response and extract url.
    const level = normalizeApi3Level(quality != null ? quality : currentQuality);
    const apiUrl = buildApi3Url({ ids: id, type: 'json', level });
    if (!apiUrl) return '';
    const text = await fetchTextWithProxyFallback(apiUrl, { accept: 'application/json', useProxyFallback: false });
    const data = parseJsonText(text);
    const url = data && data.url != null ? String(data.url).trim() : '';
    if (url && /^https?:\/\//i.test(url)) return url;
    return '';
}

async function fetchApi2SearchWithFallback(keyword, page = 1, limit = 20, type = 'song') {
    const query = String(keyword || '').trim();
    const safeType = String(type || 'song').trim().toLowerCase() || 'song';
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Number(limit))) : 20;
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page))) : 1;
    if (!query) return { ok: false, list: [], message: '' };

    const data = await fetchApi2JsonWithFallback('/api/search', {
        keyword: query,
        type: safeType,
        num: safeLimit,
        page: safePage
    });

    const list = data && data.data && Array.isArray(data.data.list) ? data.data.list : [];
    const ok = !!(data && (data.code === 0 || data.code === '0')) || list.length > 0;
    const message = data && (data.message || data.msg) ? String(data.message || data.msg) : '';
    return { ok, list, message, total: data && data.data && data.data.total != null ? data.data.total : null };
}

async function fetchApi2PlaylistWithFallback(playlistId) {
    const id = String(playlistId || '').trim();
    if (!id) return { ok: false, list: [], message: '', meta: null };

    const data = await fetchApi2JsonWithFallback('/api/playlist', { id });
    const payload = data && data.data && typeof data.data === 'object' ? data.data : null;
    const list = payload && Array.isArray(payload.songlist) ? payload.songlist : [];
    const ok = !!(data && (data.code === 0 || data.code === '0')) || list.length > 0;
    const message = data && (data.message || data.msg) ? String(data.message || data.msg) : '';
    const meta = payload && payload.dirinfo && typeof payload.dirinfo === 'object' ? payload.dirinfo : null;
    return { ok, list, message, meta };
}

async function fetchApi2TopListWithFallback() {
    const data = await fetchApi2JsonWithFallback('/api/top', {});
    const payload = data && data.data && typeof data.data === 'object' ? data.data : null;
    const groups = payload && Array.isArray(payload.group) ? payload.group : [];
    const ok = !!(data && (data.code === 0 || data.code === '0')) || groups.length > 0;
    const message = data && (data.message || data.msg) ? String(data.message || data.msg) : '';
    return { ok, groups, message };
}

async function fetchApi2TopDetailWithFallback(topId, num = 50) {
    const id = String(topId || '').trim();
    const safeNum = Number.isFinite(Number(num)) ? Math.max(1, Math.min(200, Math.floor(Number(num)))) : 50;
    if (!id) return { ok: false, list: [], message: '' };

    const data = await fetchApi2JsonWithFallback('/api/top', { id, num: safeNum });
    const payload = data && data.data && typeof data.data === 'object' ? data.data : null;
    const list = payload && Array.isArray(payload.songInfoList) ? payload.songInfoList : [];
    const ok = !!(data && (data.code === 0 || data.code === '0')) || list.length > 0;
    const message = data && (data.message || data.msg) ? String(data.message || data.msg) : '';
    return { ok, list, message };
}

function normalizeKugouImageUrl(url, { size = 400 } = {}) {
    const raw = url == null ? '' : String(url).trim();
    if (!raw) return '';

    let finalUrl = raw.replace(/\{size\}/g, String(size));
    try {
        const u = new URL(finalUrl);
        if (u.protocol === 'http:' && String(u.hostname || '').toLowerCase().endsWith('.kugou.com')) {
            u.protocol = 'https:';
            finalUrl = u.toString();
        }
    } catch (e) {
        // ignore
    }

    return finalUrl;
}

async function fetchApi2KugouRankAudioWithFallback(rankId, page = 1, limit = 50) {
    const id = String(rankId || '').trim();
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Math.floor(Number(limit)))) : 50;
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page))) : 1;
    if (!id) return { ok: false, list: [], message: '', total: null };

    const data = await fetchApi2KugouJsonWithFallback('/rank/audio', { rankid: id, page: safePage, pagesize: safeLimit });
    const payload = data && data.data && typeof data.data === 'object' ? data.data : null;
    const list = payload && Array.isArray(payload.songlist) ? payload.songlist : [];
    const ok =
        (!!(data && (data.error_code === 0 || data.error_code === '0')) && !!(data && (data.status === 1 || data.status === '1'))) ||
        list.length > 0;
    const message = data && (data.errmsg || data.message || data.error_msg) ? String(data.errmsg || data.message || data.error_msg) : '';
    const total = payload && payload.total != null ? payload.total : data && data.total != null ? data.total : null;
    return { ok, list, message, total };
}

async function fetchApi2KugouPlaylistTrackAllWithFallback(playlistId, { maxPages = 6, pageSize = 100 } = {}) {
    const id = String(playlistId || '').trim();
    if (!id) return { ok: false, list: [], message: '', meta: null };

    const safePageSize = Number.isFinite(Number(pageSize)) ? Math.max(1, Math.min(200, Math.floor(Number(pageSize)))) : 100;
    const safeMaxPages = Number.isFinite(Number(maxPages)) ? Math.max(1, Math.min(20, Math.floor(Number(maxPages)))) : 6;

    const out = [];
    let meta = null;
    let total = null;

    for (let page = 1; page <= safeMaxPages; page += 1) {
        const data = await fetchApi2KugouJsonWithFallback('/playlist/track/all', {
            id,
            page: String(page),
            pagesize: String(safePageSize)
        });
        const payload = data && data.data && typeof data.data === 'object' ? data.data : null;
        const songs = payload && Array.isArray(payload.songs) ? payload.songs : [];
        if (!meta && payload && payload.list_info && typeof payload.list_info === 'object') meta = payload.list_info;
        if (total == null && payload && payload.count != null) total = payload.count;
        if (songs.length) out.push(...songs);
        if (songs.length < safePageSize) break;
        if (Number.isFinite(Number(total)) && out.length >= Number(total)) break;
    }

    const ok = out.length > 0;
    const message = ok ? '' : '歌单为空或加载失败';
    return { ok, list: out, message, meta };
}

async function fetchApi2KugouPrivilegeLiteWithFallback(hash) {
    const h = String(hash || '').trim();
    if (!h) return { ok: false, list: [], message: '' };

    const data = await fetchApi2KugouJsonWithFallback('/privilege/lite', { hash: h });
    const list = data && Array.isArray(data.data) ? data.data : [];
    const ok = (!!(data && (data.error_code === 0 || data.error_code === '0')) && list.length > 0) || list.length > 0;
    const message = data && (data.message || data.errmsg) ? String(data.message || data.errmsg) : '';
    return { ok, list, message };
}

async function fetchApi2KugouSongUrlWithFallback(hash, quality) {
    const h = String(hash || '').trim();
    if (!h) return '';

    let api2KugouDidForceRegister = false;
    try {
        await ensureApi2KugouDeviceCookiesReady({ force: false });
    } catch (e) {
        // ignore
    }
    if (api2KugouDeviceAuthErrorUntil && Date.now() < api2KugouDeviceAuthErrorUntil) {
        return '';
    }

    const wanted = normalizeApi2Quality(quality, { sourceKey: 'kugou' });
    const ordered = [wanted, ...API2_KUGOU_QUALITIES.filter((v) => v !== wanted)];
    const pickFirstUrl = (value) => {
        if (!value) return '';
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return /^https?:\/\//i.test(trimmed) ? trimmed : '';
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                const u =
                    item && typeof item === 'object' && item.url != null
                        ? String(item.url).trim()
                        : item != null
                            ? String(item).trim()
                            : '';
                if (u && /^https?:\/\//i.test(u)) return u;
            }
        }
        return '';
    };

    for (const q of ordered) {
        const attempt = async (freePart) => {
            const params = { hash: h, quality: q };
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
            return (
                pickFirstUrl(data.url) ||
                pickFirstUrl(data.backupUrl) ||
                (data.data && pickFirstUrl(data.data.url)) ||
                (data.data && pickFirstUrl(data.data.backupUrl)) ||
                ''
            );
        };

        let url = await attempt(false);
        if (!url) url = await attempt(true);
        if (url) return url;
    }

    return '';
}

async function fetchApi2KugouSearchWithFallback(keyword, page = 1, limit = 20, type = 'song') {
    const query = String(keyword || '').trim();
    const safeType = String(type || 'song').trim().toLowerCase() || 'song';
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Number(limit))) : 20;
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page))) : 1;
    if (!query) return { ok: false, list: [], message: '' };

    const request = async (t) =>
        await fetchApi2KugouJsonWithFallback('/search', {
            keywords: query,
            type: t,
            pagesize: safeLimit,
            page: safePage
        });

    //  当前 `type=song` 可能返回 152，但 `type=lyric` 可用且包含 FileHash。
    const data = await request(safeType);
    const errorCode = data && data.error_code != null ? Number(data.error_code) : NaN;
    const shouldFallbackToLyric = safeType === 'song' && (errorCode === 152 || !Number.isFinite(errorCode));
    const fallbackData = shouldFallbackToLyric ? await request('lyric') : null;
    const chosen = fallbackData || data;

    const payload = chosen && chosen.data && typeof chosen.data === 'object' ? chosen.data : null;
    const list = payload && Array.isArray(payload.lists) ? payload.lists : [];
    const ok = !!(chosen && (chosen.error_code === 0 || chosen.error_code === '0')) || list.length > 0;
    const message =
        chosen && (chosen.error_msg || chosen.errmsg || chosen.message)
            ? String(chosen.error_msg || chosen.errmsg || chosen.message)
            : '';
    return { ok, list, message, total: payload && payload.total != null ? payload.total : null };
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

async function fetchApi7SearchWithFallback(keyword, page = 1, limit = 20) {
    const keys = getApi7KeyCandidates();
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Number(limit))) : 20;
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page))) : 1;

    let lastMessage = '';
    for (const key of keys) {
        const apiUrl = `https://oiapi.net/api/QQ_Music/msg/${encodeURIComponent(String(keyword))}/key/${encodeURIComponent(String(key))}/limit/${encodeURIComponent(
            String(safeLimit)
        )}/page/${encodeURIComponent(String(safePage))}`;
        const text = await fetchTextWithProxyFallback(apiUrl);
        const data = parseJsonText(text);
        const list = data && Array.isArray(data.data) ? data.data : [];
        const ok = !!(data && (data.code === 1 || data.code === '1'));
        const message = data && data.message ? String(data.message) : '';
        if (ok) return { ok: true, list, message };
        if (message) lastMessage = message;
    }

    return { ok: false, list: [], message: lastMessage };
}

async function fetchApi7SongUrlWithFallback(songIdOrMid, br) {
    const id = String(songIdOrMid == null ? '' : songIdOrMid).trim();
    if (!id) return '';

    const brParam = normalizeApi7Br(br);
    const keys = getApi7KeyCandidates();
    const isNumeric = /^\d+$/.test(id);

    for (const key of keys) {
        const endpoint = isNumeric ? 'songId' : 'mid';
        const apiUrl = `https://oiapi.net/api/QQ_Music/${endpoint}/${encodeURIComponent(id)}/key/${encodeURIComponent(
            String(key)
        )}/br/${encodeURIComponent(brParam)}`;
        const text = await fetchTextWithProxyFallback(apiUrl);
        const data = parseJsonText(text);
        const ok = !!(data && (data.code === 1 || data.code === '1'));
        const url = data && data.data && (data.data.music || data.data.url);
        if (ok && typeof url === 'string' && /^https?:\/\//i.test(url.trim())) {
            return url.trim();
        }
    }

    return '';
}

const WY_SEARCH_API_ENDPOINT = 'https://api.manhuaidc.cn/API/wy.php';
const WY_SEARCH_OIAPI_ENDPOINT = 'https://oiapi.net/api/Music_163';

function normalizeWySearchItem(item) {
    if (!item || typeof item !== 'object') return null;
    const rawId = item.songid ?? item.songId ?? item.song_id ?? item.id;
    const rawTitle = item.title ?? item.songname ?? item.name;
    if (rawId == null || rawTitle == null) return null;
    const id = String(rawId).trim();
    const title = String(rawTitle).trim();
    if (!id || !title) return null;

    const singers = Array.isArray(item.singers) ? item.singers : [];
    const singersText = singers
        .map((s) => {
            if (!s || typeof s !== 'object') return '';
            return s.name != null ? String(s.name).trim() : '';
        })
        .filter(Boolean)
        .join('/');

    const artist = singersText || item.singer || item.artist || item.author || '';

    const rawCover = item.picurl ?? item.picUrl ?? item.pic ?? item.cover ?? '';
    let cover = rawCover != null ? String(rawCover).trim() : '';
    if (cover && cover.startsWith('http://')) cover = cover.replace(/^http:\/\//i, 'https://');

    return {
        id,
        title,
        artist: artist != null ? String(artist).trim() : '',
        cover
    };
}

async function fetchWySearchWithFallback(keyword) {
    const query = String(keyword || '').trim();
    if (!query) return { ok: false, list: [], message: '' };

    // 优先使用 oiapi 的网易云搜索接口；失败则回退到旧接口
    try {
        const isId = /^\d+$/.test(query);
        const apiUrl = isId
            ? `${WY_SEARCH_OIAPI_ENDPOINT}?id=${encodeURIComponent(query)}`
            : `${WY_SEARCH_OIAPI_ENDPOINT}?name=${encodeURIComponent(query)}`;

        const text = await fetchTextWithProxyFallback(apiUrl, { accept: '*/*' });
        const data = parseJsonText(text);
        const payload = data && data.data != null ? data.data : null;
        const list = Array.isArray(payload) ? payload : (payload && typeof payload === 'object' ? [payload] : []);
        const ok = !!(data && (data.code === 0 || data.code === '0')) || list.length > 0;
        const message = data && data.message ? String(data.message) : '';
        if (ok) return { ok: true, list, message };
    } catch (e) {
        // ignore and fallback
    }

    const fallbackUrl = `${WY_SEARCH_API_ENDPOINT}?msg=${encodeURIComponent(query)}`;
    const fallbackText = await fetchTextWithProxyFallback(fallbackUrl, { accept: '*/*' });
    const fallbackData = parseJsonText(fallbackText);
    const fallbackList = fallbackData && Array.isArray(fallbackData.data) ? fallbackData.data : [];
    const ok =
        !!(fallbackData && (fallbackData.code === 200 || fallbackData.code === '200')) ||
        fallbackList.length > 0;
    return {
        ok,
        list: fallbackList,
        message: fallbackData && fallbackData.msg ? String(fallbackData.msg) : ''
    };
}

function isPaginatedApi() {
    return currentApi === 'api4';
}

function mapMusicSourceToApiSource(sourceName) {
    const raw = String(sourceName || '').trim();
    const normalized = raw.toLowerCase();
    if (['qq', 'netease', 'kuwo', 'joox', 'kugou'].includes(normalized)) return normalized;
    const map = {
        'QQ音乐': 'qq',
        '网易云音乐': 'netease',
        '酷我音乐': 'kuwo',
        '酷狗音乐': 'kugou',
        'JOOX音乐': 'joox',
        'joox音乐': 'joox'
    };
    return map[raw] || 'netease';
}

function extractFirstLongNumber(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return '';

    const m = raw.match(/\d{5,}/);
    return m ? String(m[0]) : '';
}

function extractKugouPlaylistId(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return '';

    const pattern = /collection_\d+_\d+_\d+_\d+/i;
    const direct = raw.match(pattern);
    if (direct) return String(direct[0]);

    try {
        const u = new URL(raw);
        const idLike = u.searchParams.get('id') || u.searchParams.get('ids') || '';
        const hit = String(idLike).match(pattern);
        if (hit) return String(hit[0]);
    } catch (e) {
        // ignore
    }

    const loose = raw.match(pattern);
    return loose ? String(loose[0]) : '';
}
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
    apiSelect.value = currentApi;
}

function getAvailableSources(api) {
    if (api === 'api3') return api3Sources;
    if (api === 'api4') return api4Sources;
    if (api === 'api7') return api7Sources;
    if (api === 'api8') return api8Sources;
    if (api === 'api9') return api9Sources;
    if (api === 'api10') return api10Sources;
    return api10Sources;
}

function updateMusicSourceOptions() {
    if (!musicSourceSelect) return;
    const available = getAvailableSources(currentApi);
    if (!available.includes(currentMusicSource)) {
        currentMusicSource = available[0];
        StorageManager.setItem('hjwjb_current_music_source', currentMusicSource);
    }
    musicSourceSelect.innerHTML = '';
    available.forEach((source) => {
        const opt = document.createElement('option');
        opt.value = source;
        opt.textContent = source;
        musicSourceSelect.appendChild(opt);
    });
    musicSourceSelect.value = currentMusicSource;
}

function updateQualitySelectorVisibility() {
    if (!qualitySelect) return;
    const group = qualitySelect.closest('.search-option-group');
    const showSelect = (visible) => {
        if (group) group.style.display = visible ? '' : 'none';
    };

    if (currentApi === 'api4' || currentApi === 'api3') {
        showSelect(true);
        qualitySelect.innerHTML = `
            <option value="999">无损 (999) - 默认</option>
            <option value="740">无损 (740)</option>
            <option value="320">320K</option>
            <option value="192">192K</option>
            <option value="128">128K</option>
        `;
        currentQuality = normalizeBrQuality(currentQuality);
        qualitySelect.value = currentQuality;
    } else if (currentApi === 'api7') {
        showSelect(true);
        qualitySelect.innerHTML = `
            <option value="4">无损 (FLAC)</option>
            <option value="3">320K</option>
            <option value="2">192K</option>
            <option value="1">128K</option>
        `;
        currentApi7Br = normalizeApi7Br(currentApi7Br);
        qualitySelect.value = String(currentApi7Br);
    } else if (currentApi === 'api8') {
        showSelect(true);
        qualitySelect.innerHTML = API8_LEVELS_DESC
            .map((level) => `<option value="${level}">${getApi8LevelDisplayName(level)}</option>`)
            .join('');
        currentQuality = normalizeApi8Level(currentQuality);
        qualitySelect.value = currentQuality;
    } else {
        showSelect(false);
    }
}

function updateQualitySwitchBtn() {
    if (!qualitySwitchBtn) return;
    qualitySwitchBtn.innerHTML = isHighestQualityMode
        ? '<i class="fas fa-sort"></i> 最高音质'
        : '<i class="fas fa-sort"></i> 最低音质';
}

async function ensureApi2TopChartsLoaded() {
    const now = Date.now();
    if (Array.isArray(api2TopChartsCache) && api2TopChartsCache.length && now - api2TopChartsLoadedAt < 12 * 60 * 60 * 1000) {
        return api2TopChartsCache;
    }
    if (api2TopChartsLoading) return api2TopChartsLoading;

    api2TopChartsLoading = (async () => {
        const { groups, ok } = await fetchApi2TopListWithFallback();
        if (!ok) {
            api2TopChartsCache = [];
            api2TopChartsLoadedAt = Date.now();
            return api2TopChartsCache;
        }

        const seen = new Set();
        const charts = [];
        groups.forEach((group) => {
            const toplist = group && Array.isArray(group.toplist) ? group.toplist : [];
            toplist.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                const idRaw = item.topId ?? item.id;
                const titleRaw = item.title ?? item.name;
                const id = idRaw != null ? String(idRaw).trim() : '';
                const name = titleRaw != null ? String(titleRaw).trim() : '';
                if (!id || !name) return;
                if (seen.has(id)) return;
                seen.add(id);
                charts.push({ id, name });
            });
        });

        api2TopChartsCache = charts;
        api2TopChartsLoadedAt = Date.now();
        return charts;
    })().finally(() => {
        api2TopChartsLoading = null;
    });

    return api2TopChartsLoading;
}

async function ensureApi2KugouRankListLoaded() {
    const now = Date.now();
    if (Array.isArray(api2KugouRankCache) && api2KugouRankCache.length && now - api2KugouRankLoadedAt < 12 * 60 * 60 * 1000) {
        return api2KugouRankCache;
    }
    if (api2KugouRankLoading) return api2KugouRankLoading;

    api2KugouRankLoading = (async () => {
        const data = await fetchApi2KugouJsonWithFallback('/rank/list', {});
        const info = data && data.data && Array.isArray(data.data.info) ? data.data.info : [];
        const ok =
            !!(data && (data.error_code === 0 || data.error_code === '0' || data.errcode === 0 || data.errcode === '0')) ||
            info.length > 0;
        if (!ok) {
            api2KugouRankCache = [];
            api2KugouRankLoadedAt = Date.now();
            return api2KugouRankCache;
        }

        const seen = new Set();
        const charts = [];

        const walk = (items) => {
            const list = Array.isArray(items) ? items : [];
            list.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                const rankIdRaw = item.rankid ?? item.rankId ?? item.id;
                const nameRaw = item.rankname ?? item.rankName ?? item.name ?? item.title;
                const id = rankIdRaw != null ? String(rankIdRaw).trim() : '';
                const name = nameRaw != null ? String(nameRaw).trim() : '';
                if (id && name && !seen.has(id)) {
                    seen.add(id);
                    charts.push({ id, name });
                }

                const children = item.children;
                if (Array.isArray(children) && children.length) walk(children);
            });
        };

        walk(info);

        api2KugouRankCache = charts;
        api2KugouRankLoadedAt = Date.now();
        return charts;
    })().finally(() => {
        api2KugouRankLoading = null;
    });

    return api2KugouRankLoading;
}

function getChartsForSourceKey(sourceKey) {
    const key = String(sourceKey || '').trim().toLowerCase();
    if (key === 'netease') return NETEASE_CHARTS;
    if (key === 'qq' && currentApi === 'api2' && Array.isArray(api2TopChartsCache)) return api2TopChartsCache;
    if (key === 'kugou' && currentApi === 'api2' && Array.isArray(api2KugouRankCache)) return api2KugouRankCache;
    return [];
}

function renderChartOptions() {
    if (!chartSelect) return;

    const sourceKey = mapMusicSourceToApiSource(currentMusicSource);
    const charts = getChartsForSourceKey(sourceKey);

    chartSelect.innerHTML = '';

    if (!charts.length) {
        const opt = document.createElement('option');
        opt.value = '';
        if (sourceKey === 'qq' && currentApi === 'api2') {
            opt.textContent = '正在加载QQ榜单...';
            chartSelect.appendChild(opt);
            chartSelect.value = '';
            ensureApi2TopChartsLoaded()
                .then(() => {
                    // Only re-render if the UI is still on chart mode and API2/QQ.
                    if (currentSearchMode === 'chart' && currentApi === 'api2' && mapMusicSourceToApiSource(currentMusicSource) === 'qq') {
                        renderChartOptions();
                    }
                })
                .catch(() => {
                    // ignore
                });
            return;
        }
        if (sourceKey === 'kugou' && currentApi === 'api2') {
            opt.textContent = '正在加载酷狗榜单...';
            chartSelect.appendChild(opt);
            chartSelect.value = '';
            ensureApi2KugouRankListLoaded()
                .then(() => {
                    if (currentSearchMode === 'chart' && currentApi === 'api2' && mapMusicSourceToApiSource(currentMusicSource) === 'kugou') {
                        renderChartOptions();
                    }
                })
                .catch(() => {
                    // ignore
                });
            return;
        }

        opt.textContent = sourceKey === 'qq' ? 'QQ音乐暂无预设榜单' : '暂无预设榜单';
        chartSelect.appendChild(opt);
        chartSelect.value = '';
        return;
    }

    charts.forEach((chart) => {
        const opt = document.createElement('option');
        opt.value = String(chart.id);
        opt.textContent = String(chart.name);
        chartSelect.appendChild(opt);
    });

    const preferred = charts.some((c) => String(c.id) === String(currentChartId))
        ? String(currentChartId)
        : String(charts[0].id);

    currentChartId = preferred;
    chartSelect.value = preferred;
    StorageManager.setItem(SEARCH_CHART_STORAGE_KEY, preferred);
}

function updateSearchModeUI() {
    if (searchModeSelect) {
        searchModeSelect.value = currentSearchMode;
    }

    const isChart = currentSearchMode === 'chart';
    if (chartGroup) {
        chartGroup.style.display = isChart ? '' : 'none';
    }
    if (isChart) {
        renderChartOptions();
    }

    if (searchInput) {
        if (currentSearchMode === 'playlist') {
            searchInput.placeholder = '输入歌单ID（支持网易云/QQ 等）';
        } else if (currentSearchMode === 'chart') {
            searchInput.placeholder = currentApi === 'api4' ? '输入榜单名称（例如：热歌榜）' : '输入榜单ID（可选）或从下方选择榜单';
        } else {
            searchInput.placeholder = '搜索歌曲 / 歌手 / 专辑...';
        }
    }

    if (searchButton) {
        if (currentSearchMode === 'playlist') {
            searchButton.innerHTML = '<i class="fas fa-list"></i> 加载歌单';
        } else if (currentSearchMode === 'chart') {
            searchButton.innerHTML = '<i class="fas fa-chart-line"></i> 加载榜单';
        } else {
            searchButton.innerHTML = '<i class="fas fa-search"></i> 搜索';
        }
    }
}

function selectSearchMode(mode) {
    const next = String(mode || '').trim();
    if (!['song', 'playlist', 'chart'].includes(next)) return;
    currentSearchMode = next;
    StorageManager.setItem(SEARCH_MODE_STORAGE_KEY, next);

    currentPage = 1;
    hasMoreResults = true;
    isLoadingMore = false;
    currentSearchKeyword = '';
    currentResults = [];

    updateSearchModeUI();
    updateLoadMoreControls();
}

function selectApi(apiName) {
    const requestedApi = String(apiName || '').trim();
    if (!requestedApi) return;
    const allowedApis = ['api3', 'api4', 'api7', 'api8', 'api9', 'api10'];
    const fallbackApi = String(currentMusicSource || '').trim() === '酷我音乐' ? 'api4' : 'api10';
    const nextApi = allowedApis.includes(requestedApi) ? requestedApi : fallbackApi;
    currentApi = nextApi;
    StorageManager.setItem('hjwjb_current_api', currentApi);
    updateMusicSourceOptions();
    updateQualitySelectorVisibility();
    ensureApiSelectOptions();
    updateSearchModeUI();
    updateLoadMoreControls();
}

function selectMusicSource(sourceName) {
    if (!sourceName) return;
    currentMusicSource = sourceName;
    StorageManager.setItem('hjwjb_current_music_source', currentMusicSource);
    updateQualitySelectorVisibility();
    updateSearchModeUI();
    updateLoadMoreControls();
}

function selectQuality(qualityName) {
    if (currentApi === 'api7') {
        currentApi7Br = normalizeApi7Br(qualityName);
        StorageManager.setItem('hjwjb_current_quality', String(currentApi7Br));
        if (qualitySelect) qualitySelect.value = String(currentApi7Br);
        return;
    }
    if (currentApi === 'api4') {
        currentQuality = normalizeBrQuality(qualityName);
    } else if (currentApi === 'api8') {
        currentQuality = normalizeApi8Level(qualityName);
    } else {
        currentQuality = String(qualityName);
    }
    StorageManager.setItem('hjwjb_current_quality', currentQuality);
    if (qualitySelect) qualitySelect.value = currentQuality;
}

function toggleQualityMode() {
    isHighestQualityMode = !isHighestQualityMode;
    updateQualitySwitchBtn();
    createDanmaku(isHighestQualityMode ? '已切换为最高音质模式' : '已切换为最低音质模式');
}

function loadSavedSettings() {
    const savedSource = StorageManager.getItem('hjwjb_current_music_source');
    const savedApi = StorageManager.getItem('hjwjb_current_api');
    if (savedApi) {
        const normalizedApi = savedApi === 'api15' ? 'api10' : savedApi;
        const allowed = ['api3', 'api4', 'api7', 'api8', 'api9', 'api10'];
        const sourceName = String(savedSource || currentMusicSource || '').trim();
        const fallbackApi = sourceName === '酷我音乐' ? 'api4' : 'api10';
        const finalApi = allowed.includes(normalizedApi) ? normalizedApi : fallbackApi;
        currentApi = finalApi;
        if (finalApi !== savedApi) StorageManager.setItem('hjwjb_current_api', finalApi);
    }
    const available = getAvailableSources(currentApi);
    currentMusicSource = available.includes(savedSource) ? savedSource : available[0];

    const savedQuality = StorageManager.getItem('hjwjb_current_quality');
    if (savedQuality) {
        if (currentApi === 'api4') {
            currentQuality = normalizeBrQuality(savedQuality);
        } else if (currentApi === 'api8') {
            currentQuality = normalizeApi8Level(savedQuality);
        } else if (currentApi === 'api7') {
            const normalized = normalizeApi7Br(savedQuality);
            currentApi7Br = normalized;
            try {
                const savedText = String(savedQuality).trim();
                if (savedText && savedText !== String(normalized)) {
                    StorageManager.setItem('hjwjb_current_quality', String(normalized));
                }
            } catch (e) {
                // ignore
            }
        } else {
            currentQuality = String(savedQuality);
        }
    }

    const savedMode = StorageManager.getItem(SEARCH_MODE_STORAGE_KEY, 'song');
    if (savedMode && ['song', 'playlist', 'chart'].includes(String(savedMode))) {
        currentSearchMode = String(savedMode);
    }
    const savedChart = StorageManager.getItem(SEARCH_CHART_STORAGE_KEY, '');
    if (savedChart != null && String(savedChart).trim()) {
        currentChartId = String(savedChart).trim();
    }
}

function renderSearchStatus({ iconClass, text }) {
    if (!searchResults) return;
    searchResults.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'empty-playlist';
    const icon = document.createElement('i');
    icon.className = iconClass || '';
    const message = document.createElement('p');
    message.textContent = text || '';
    wrapper.appendChild(icon);
    wrapper.appendChild(message);
    searchResults.appendChild(wrapper);
    updateLoadMoreControls();
}

function buildSearchResultItem(song, index) {
    const item = document.createElement('div');
    item.className = 'search-result-item result-enter';
    item.dataset.index = String(index);
    try {
        const delay = Math.min(240, Math.max(0, (Number(index) || 0) % 10) * 30);
        item.style.setProperty('--enter-delay', `${delay}ms`);
    } catch (e) {
        // ignore
    }

    const cover = document.createElement('div');
    cover.className = 'result-cover';
    const img = document.createElement('img');
    img.src = song.cover || DEFAULT_COVER;
    img.alt = song.title || '';
    cover.appendChild(img);

    const info = document.createElement('div');
    info.className = 'result-info';

    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = song.title || '';

    const artist = document.createElement('div');
    artist.className = 'result-artist';
    artist.textContent = song.artist || '';

    const album = document.createElement('div');
    album.className = 'result-album';
    album.textContent = song.album || '';

    const source = document.createElement('div');
    source.className = 'result-source';
    source.textContent = song.source || '';

    info.appendChild(title);
    info.appendChild(artist);
    info.appendChild(album);
    info.appendChild(source);

    const actions = document.createElement('div');
    actions.className = 'result-actions';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'playlist-item-btn';
    playBtn.dataset.action = 'play';
    playBtn.title = '立即播放';
    playBtn.innerHTML = '<i class="fas fa-play"></i>';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'playlist-item-btn';
    addBtn.dataset.action = 'add';
    addBtn.title = '添加到播放列表';
    addBtn.innerHTML = '<i class="fas fa-plus"></i>';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'playlist-item-btn';
    downloadBtn.dataset.action = 'download';
    downloadBtn.title = '下载';
    downloadBtn.innerHTML = '<i class="fas fa-download"></i>';

    actions.appendChild(playBtn);
    actions.appendChild(addBtn);
    actions.appendChild(downloadBtn);

    item.appendChild(cover);
    item.appendChild(info);
    item.appendChild(actions);

    return item;
}

function displayResults(results, append = false, startIndex = 0) {
    if (!searchResults) return;
    if (!append) searchResults.innerHTML = '';

    if (!results.length) {
        renderSearchStatus({ iconClass: 'fas fa-times-circle', text: '暂无结果' });
        return;
    }

    const fragment = document.createDocumentFragment();
    results.forEach((song, idx) => {
        fragment.appendChild(buildSearchResultItem(song, startIndex + idx));
    });

    searchResults.appendChild(fragment);
    bindSearchResultsClick();
    updateLoadMoreControls();
}

function bindSearchResultsClick() {
    if (!searchResults) return;
    if (searchResults.dataset.bound === 'true') return;
    searchResults.dataset.bound = 'true';

    searchResults.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn || !searchResults.contains(btn)) return;
        const item = btn.closest('.search-result-item');
        if (!item) return;
        const index = Number(item.dataset.index);
        if (!Number.isFinite(index)) return;
        const song = currentResults[index];
        if (!song) return;

        if (btn.dataset.action === 'play') {
            playSongNow(song);
        } else if (btn.dataset.action === 'add') {
            addToPlaylist(song);
        } else if (btn.dataset.action === 'download') {
            downloadSong(song);
        }
    });
}

let currentResults = [];
function updateLoadMoreControls() {
    if (!loadMoreContainer || !loadMoreBtn) return;

    const mode = currentSearchMode || 'song';
    const hasResults = Array.isArray(currentResults) && currentResults.length > 0;
    const loading = !!isLoadingMore;
    const canLoadMore = !!hasMoreResults;
    const shouldShow = mode === 'song' && hasResults && (loading || canLoadMore);

    loadMoreContainer.style.display = shouldShow ? '' : 'none';
    if (!shouldShow) return;

    loadMoreBtn.disabled = !canLoadMore || loading;

    if (loading) {
        loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中...';
        return;
    }

    loadMoreBtn.innerHTML = '<i class="fas fa-angle-down"></i> 显示更多';
}

async function loadMoreResults() {
    if (isLoadingMore) return;
    if (!hasMoreResults) return;
    if ((currentSearchMode || 'song') !== 'song') return;

    const prevPage = currentPage;
    const prevCount = Array.isArray(currentResults) ? currentResults.length : 0;

    const safePrevPage = Number.isFinite(Number(prevPage)) ? Math.max(1, Math.floor(Number(prevPage))) : 1;
    currentPage = safePrevPage + 1;
    updateLoadMoreControls();

    await performSearch(true);

    const nextCount = Array.isArray(currentResults) ? currentResults.length : 0;
    if (nextCount === prevCount && hasMoreResults) {
        currentPage = safePrevPage;
    }
    updateLoadMoreControls();
}

async function performSearch(isAppend = false) {
    const rawInput = String((searchInput && searchInput.value) || '').trim();
    const mode = currentSearchMode || 'song';
    const chartId = String((chartSelect && chartSelect.value) || '').trim();
    const apiName = currentApi;
    const sourceKey = mapMusicSourceToApiSource(currentMusicSource);
    let keyword = mode === 'chart' ? (chartId || rawInput) : rawInput;
    if (!keyword) return;

    if (mode === 'playlist' || mode === 'chart') {
        if (mode === 'playlist' && apiName === 'api2' && sourceKey === 'kugou') {
            const extracted = extractKugouPlaylistId(keyword);
            if (extracted) keyword = extracted;
        } else {
            const extracted = extractFirstLongNumber(keyword);
            if (extracted) keyword = extracted;
        }
    }

    // 歌单/榜单模式不支持分页追加
    if (mode !== 'song') isAppend = false;

    if (!isAppend || keyword !== currentSearchKeyword) {
        currentSearchKeyword = keyword;
        currentPage = 1;
        currentResults = [];
        hasMoreResults = true;
    }

    isLoadingMore = mode === 'song' && !!isAppend;
    if (!isAppend) {
        const loadingText =
            mode === 'playlist' ? '正在加载歌单...' :
            mode === 'chart' ? '正在加载榜单...' :
            '正在搜索...';
        renderSearchStatus({ iconClass: 'fas fa-spinner fa-spin', text: loadingText });
    }

    updateLoadMoreControls();

    try {
        if (mode === 'playlist' || mode === 'chart') {
            if (apiName === 'api4') {
                if (mode === 'playlist') {
                    const { list, ok, message } = await fetchApi4PlaylistWithFallback(keyword, 1, 30);
                    if (list && list.length) {
                        const results = list.map((item) => normalizeApi4Item(item, apiName)).filter(Boolean);
                        currentResults = results;
                        hasMoreResults = false;
                        displayResults(currentResults, false);
                    } else {
                        renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `加载失败：${message || '歌单'}` });
                    }
                    return;
                }

                const { list, ok, message } = await fetchApi4RankWithFallback(keyword, 1, 99);
                if (list && list.length) {
                    const results = list.map((item) => normalizeApi4Item(item, apiName)).filter(Boolean);
                    currentResults = results;
                    hasMoreResults = false;
                    displayResults(currentResults, false);
                } else {
                    renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `加载失败：${message || '榜单'}` });
                }
                return;
            }

            if (apiName === 'api2') {
                if (sourceKey === 'kugou') {
                    if (mode === 'playlist') {
                        const { list, ok, message } = await fetchApi2KugouPlaylistTrackAllWithFallback(keyword);
                        if (list && list.length) {
                            const results = list.map((item) => normalizeApi2KugouItem(item, apiName)).filter(Boolean);
                            currentResults = results;
                            hasMoreResults = false;
                            displayResults(currentResults, false);
                        } else {
                            renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `加载失败：${message || '歌单'}` });
                        }
                        return;
                    }

                    const { list, ok, message } = await fetchApi2KugouRankAudioWithFallback(keyword, 1, 100);
                    if (list && list.length) {
                        const results = list.map((item) => normalizeApi2KugouItem(item, apiName)).filter(Boolean);
                        currentResults = results;
                        hasMoreResults = false;
                        displayResults(currentResults, false);
                    } else {
                        renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `加载失败：${message || '榜单'}` });
                    }
                    return;
                }

                if (mode === 'playlist') {
                    const { list, ok, message } = await fetchApi2PlaylistWithFallback(keyword);
                    if (list && list.length) {
                        const results = list.map((item) => normalizeApi2Item(item, apiName)).filter(Boolean);
                        currentResults = results;
                        hasMoreResults = false;
                        displayResults(currentResults, false);
                    } else {
                        renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `加载失败：${message || '歌单'}` });
                    }
                    return;
                }

                const { list, ok, message } = await fetchApi2TopDetailWithFallback(keyword, 50);
                if (list && list.length) {
                    const results = list.map((item) => normalizeApi2Item(item, apiName)).filter(Boolean);
                    currentResults = results;
                    hasMoreResults = false;
                    displayResults(currentResults, false);
                } else {
                    renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `加载失败：${message || '榜单'}` });
                }
                return;
            }

            if (!isMetingApi(apiName)) {
                renderSearchStatus({ iconClass: 'fas fa-times-circle', text: '歌单/排行榜仅支持 API9 / API10' });
                return;
            }

            const { list, ok, message } = await fetchMetingPlaylistWithFallback(apiName, keyword, sourceKey);
            if (list && list.length) {
                const results = list.map((item) => {
                    const normalized = normalizeMetingSearchItem(item);
                    if (!normalized) return null;
                    return {
                        id: normalized.id,
                        title: normalized.title,
                        artist: normalized.artist || '',
                        album: normalized.album || '',
                        cover: normalized.cover || DEFAULT_COVER,
                        // Meting 返回的 url 多数是“二次解析接口”，主播放器会在播放时再解析真实直链。
                        url: null,
                        source: currentMusicSource,
                        api: apiName,
                        lyrics: []
                    };
                }).filter(Boolean);
                currentResults = results;
                hasMoreResults = false;
                displayResults(currentResults, false);
            } else {
                renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `加载失败：${message || '歌单/榜单'}` });
            }
            return;
        }

        if (apiName === 'api4') {
            const limit = 30;
            const { list, ok, message, total } = await fetchApi4SearchWithFallback(keyword, currentPage, limit);
            if (list && list.length) {
                const offset = isAppend ? currentResults.length : 0;
                const results = list.map((item) => normalizeApi4Item(item, apiName)).filter(Boolean);
                currentResults = isAppend ? [...currentResults, ...results] : results;
                const totalNum = total == null ? NaN : Number(total);
                hasMoreResults = Number.isFinite(totalNum) ? currentPage * limit < totalNum : results.length > 0;
                displayResults(isAppend ? results : currentResults, isAppend, offset);
            } else {
                if (isAppend && Array.isArray(currentResults) && currentResults.length) {
                    if (ok) {
                        hasMoreResults = false;
                        createDanmaku('没有更多了');
                    } else {
                        createDanmaku(`加载更多失败：${message || 'API4'}`);
                    }
                    updateLoadMoreControls();
                } else {
                    renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `搜索失败：${message || 'API4'}` });
                }
            }
        } else if (apiName === 'api3' || apiName === 'api8') {
            const { list, ok, message } = await fetchWySearchWithFallback(keyword);
            if (list && list.length) {
                const results = list.map((item) => {
                    const normalized = normalizeWySearchItem(item);
                    if (!normalized) return null;
                    return {
                        id: normalized.id,
                        title: normalized.title,
                        artist: normalized.artist || '',
                        album: '',
                        cover: normalized.cover || DEFAULT_COVER,
                        url: null,
                        source: currentMusicSource,
                        api: apiName,
                        lyrics: []
                    };
                }).filter(Boolean);
                currentResults = results;
                hasMoreResults = false;
                displayResults(currentResults, false);
            } else {
                renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `搜索失败：${message || apiName}` });
            }
        } else if (apiName === 'api2') {
            const limit = 20;
            if (sourceKey === 'kugou') {
                const isHash = /^[0-9a-fA-F]{32}$/.test(keyword);
                if (isHash) {
                    const { list, ok, message } = await fetchApi2KugouPrivilegeLiteWithFallback(keyword);
                    if (list && list.length) {
                        const results = list.map((item) => normalizeApi2KugouItem(item, apiName)).filter(Boolean);
                        currentResults = results;
                        hasMoreResults = false;
                        displayResults(currentResults, false);
                    } else {
                        const fallbackMsg = '酷狗关键词搜索暂不可用（可用：排行榜/歌单/Hash）';
                        renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `搜索失败：${message || fallbackMsg}` });
                    }
                } else {
                    const { list, ok, message, total } = await fetchApi2KugouSearchWithFallback(keyword, currentPage, limit, 'song');
                    if (list && list.length) {
                        const offset = isAppend ? currentResults.length : 0;
                        const results = list.map((item) => normalizeApi2KugouItem(item, apiName)).filter(Boolean);
                        currentResults = isAppend ? [...currentResults, ...results] : results;
                        const totalNum = total == null ? NaN : Number(total);
                        hasMoreResults = Number.isFinite(totalNum) ? currentPage * limit < totalNum : results.length >= limit;
                        displayResults(isAppend ? results : currentResults, isAppend, offset);
                    } else {
                        const fallbackMsg = '酷狗关键词搜索暂不可用（可用：排行榜/歌单/Hash）';
                        if (isAppend && Array.isArray(currentResults) && currentResults.length) {
                            if (ok) {
                                hasMoreResults = false;
                                createDanmaku('没有更多了');
                            } else {
                                createDanmaku(`加载更多失败：${message || fallbackMsg}`);
                            }
                            updateLoadMoreControls();
                        } else {
                            renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `搜索失败：${message || fallbackMsg}` });
                        }
                    }
                }
            } else {
                const { list, ok, message, total } = await fetchApi2SearchWithFallback(keyword, currentPage, limit, 'song');
                if (list && list.length) {
                    const offset = isAppend ? currentResults.length : 0;
                    const results = list.map((item) => normalizeApi2Item(item, apiName)).filter(Boolean);
                    currentResults = isAppend ? [...currentResults, ...results] : results;
                    const totalNum = total == null ? NaN : Number(total);
                    hasMoreResults = Number.isFinite(totalNum) ? currentPage * limit < totalNum : results.length >= limit;
                    displayResults(isAppend ? results : currentResults, isAppend, offset);
                } else {
                    if (isAppend && Array.isArray(currentResults) && currentResults.length) {
                        if (ok) {
                            hasMoreResults = false;
                            createDanmaku('没有更多了');
                        } else {
                            createDanmaku(`加载更多失败：${message || 'API2'}`);
                        }
                        updateLoadMoreControls();
                    } else {
                        renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `搜索失败：${message || 'API2'}` });
                    }
                }
            }
        } else if (apiName === 'api7') {
            const { list, ok, message } = await fetchApi7SearchWithFallback(keyword);
            if (list && list.length) {
                const results = list.map((item) => normalizeApi7OiapiItem(item, apiName)).filter(Boolean);
                currentResults = results;
                hasMoreResults = false;
                displayResults(currentResults, false);
            } else {
                renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `搜索失败：${message || 'API7'}` });
            }
        } else if (isMetingApi(apiName)) {
            const { list, ok, message, supported } = await fetchMetingSearchWithFallback(apiName, keyword, sourceKey);
            if (!supported) {
                const fallback = await fetchWySearchWithFallback(keyword);
                if (fallback.list && fallback.list.length) {
                    const results = fallback.list.map((item) => {
                        const normalized = normalizeWySearchItem(item);
                        if (!normalized) return null;
                        return {
                            id: normalized.id,
                            title: normalized.title,
                            artist: normalized.artist || '',
                            album: '',
                            cover: normalized.cover || DEFAULT_COVER,
                            url: null,
                            source: currentMusicSource,
                            api: apiName,
                            lyrics: []
                        };
                    }).filter(Boolean);
                    currentResults = results;
                    hasMoreResults = false;
                    displayResults(currentResults, false);
                } else {
                    renderSearchStatus({ iconClass: 'fas fa-times-circle', text: fallback.ok ? '暂无结果' : `搜索失败：${fallback.message || message}` });
                }
            } else if (list && list.length) {
                const results = list.map((item) => {
                    const normalized = normalizeMetingSearchItem(item);
                    if (!normalized) return null;
                    return {
                        id: normalized.id,
                        title: normalized.title,
                        artist: normalized.artist || '',
                        album: normalized.album || '',
                        cover: normalized.cover || DEFAULT_COVER,
                        url: normalized.url || null,
                        source: currentMusicSource,
                        api: apiName,
                        lyrics: []
                    };
                }).filter(Boolean);
                currentResults = results;
                hasMoreResults = false;
                displayResults(currentResults, false);
            } else {
                renderSearchStatus({ iconClass: 'fas fa-times-circle', text: ok ? '暂无结果' : `搜索失败：${message || 'Meting'}` });
            }
        } else {
            renderSearchStatus({ iconClass: 'fas fa-times-circle', text: '暂不支持该API' });
        }
    } catch (error) {
        console.error('Search error:', error);
        if (!isAppend) {
            renderSearchStatus({ iconClass: 'fas fa-times-circle', text: '搜索失败：网络错误' });
        } else {
            createDanmaku('加载更多失败（网络错误）');
        }
    } finally {
        isLoadingMore = false;
        updateLoadMoreControls();
    }
}

function normalizeApi4Item(item, apiName) {
    if (!item || typeof item !== 'object') return null;
    const idRaw = item.rid ?? item.id;
    const titleRaw = item.name ?? item.title ?? item.songname ?? item.song;
    if (idRaw == null || titleRaw == null) return null;

    const id = String(idRaw).trim();
    const title = String(titleRaw).trim();
    if (!id || !title) return null;

    const artistRaw = item.artist ?? item.singer ?? item.author ?? '';
    const albumRaw = item.album ?? item.albumname ?? '';
    const coverRaw = item.pic ?? item.cover ?? item.img ?? '';

    return {
        id,
        title,
        artist: artistRaw != null ? String(artistRaw).trim() : '',
        album: albumRaw != null ? String(albumRaw).trim() : '',
        cover: coverRaw != null && String(coverRaw).trim() ? String(coverRaw).trim() : DEFAULT_COVER,
        // API4 returns a resolver endpoint in search results; let the main player resolve a direct URL on play.
        url: null,
        source: '酷我音乐',
        api: apiName,
        lyrics: []
    };
}

function normalizeApi7OiapiItem(item, apiName) {
    if (!item || typeof item !== 'object') return null;
    const midRaw = item.mid ?? item.id ?? item.songmid;
    const titleRaw = item.song ?? item.name ?? item.title ?? item.songname;
    if (midRaw == null || titleRaw == null) return null;
    const mid = String(midRaw).trim();
    const title = String(titleRaw).trim();
    if (!mid || !title) return null;

    const singerArr = Array.isArray(item.singer) ? item.singer : [];
    const artist = singerArr.filter(Boolean).map((s) => String(s).trim()).filter(Boolean).join('/');
    const cover = item.picture != null ? String(item.picture).trim() : DEFAULT_COVER;
    const songid = item.songid ?? item.songId ?? null;

    return {
        id: mid,
        mid,
        songid: songid != null ? songid : undefined,
        title,
        artist,
        album: item.album != null ? String(item.album).trim() : '',
        cover: cover || DEFAULT_COVER,
        url: null,
        source: currentMusicSource,
        api: apiName,
        lyrics: []
    };
}

function normalizeApi2Item(item, apiName) {
    if (!item || typeof item !== 'object') return null;
    const midRaw = item.mid ?? item.songmid ?? item.songMid;
    const titleRaw = item.name ?? item.songname ?? item.title;
    if (midRaw == null || titleRaw == null) return null;

    const mid = String(midRaw).trim();
    const title = String(titleRaw).trim();
    if (!mid || !title) return null;

    const singerArr = Array.isArray(item.singer) ? item.singer : (Array.isArray(item.singers) ? item.singers : []);
    const artist = singerArr
        .map((s) => {
            if (!s) return '';
            if (typeof s === 'string') return s.trim();
            if (typeof s === 'object' && s.name != null) return String(s.name).trim();
            return '';
        })
        .filter(Boolean)
        .join('/');

    const albumObj = item.album && typeof item.album === 'object' ? item.album : null;
    const albumNameRaw = albumObj ? (albumObj.name ?? albumObj.title) : (item.albumname ?? item.album);
    const album = albumNameRaw != null ? String(albumNameRaw).trim() : '';
    const albumMidRaw = albumObj ? albumObj.mid : (item.album_mid ?? item.albumMid);
    const albumMid = albumMidRaw != null ? String(albumMidRaw).trim() : '';

    const songidRaw = item.id ?? item.songid ?? item.songId;
    const songid = songidRaw != null ? String(songidRaw).trim() : '';

    const cover = albumMid
        ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
        : DEFAULT_COVER;

    return {
        id: mid,
        mid,
        songid: songid || undefined,
        title,
        artist,
        album,
        cover,
        url: null,
        source: currentMusicSource,
        api: apiName,
        lyrics: []
    };
}

function normalizeApi2KugouItem(item, apiName) {
    if (!item || typeof item !== 'object') return null;

    const audioInfo = item.audio_info && typeof item.audio_info === 'object' ? item.audio_info : null;
    const deprecated = item.deprecated && typeof item.deprecated === 'object' ? item.deprecated : null;

    const pickHash = () => {
        const direct = item.hash ?? item.Hash;
        if (direct != null && String(direct).trim()) return String(direct).trim();

        const candidates = [
            audioInfo && (audioInfo.hash_128 ?? audioInfo.hash_320 ?? audioInfo.hash_flac ?? audioInfo.hash_high),
            deprecated && deprecated.hash,
            item.ogg_hash,
            item.FileHash,
            item.filehash
        ];

        for (const cand of candidates) {
            const v = cand != null ? String(cand).trim() : '';
            if (v) return v;
        }
        return '';
    };

    const hash = pickHash();
    if (!hash) return null;

    const singerArr = Array.isArray(item.singerinfo) ? item.singerinfo : [];
    const authorsArr = Array.isArray(item.authors) ? item.authors : [];

    let artist =
        (item.author_name ?? item.author ?? item.singername ?? item.singerName ?? item.SingerName ?? item.singer) != null
            ? String(item.author_name ?? item.author ?? item.singername ?? item.singerName ?? item.SingerName ?? item.singer).trim()
            : '';

    if (!artist && singerArr.length) {
        artist = singerArr
            .map((s) => (s && (s.name ?? s.author_name ?? s.authorName) != null ? String(s.name ?? s.author_name ?? s.authorName).trim() : ''))
            .filter(Boolean)
            .join('/');
    }

    if (!artist && authorsArr.length) {
        artist = authorsArr
            .map((a) => (a && a.author_name != null ? String(a.author_name).trim() : a && a.authorName != null ? String(a.authorName).trim() : ''))
            .filter(Boolean)
            .join('/');
    }

    const albumInfo = item.album_info && typeof item.album_info === 'object' ? item.album_info : null;
    const albumInfo2 = item.albuminfo && typeof item.albuminfo === 'object' ? item.albuminfo : null;
    const albumNameRaw =
        (albumInfo && albumInfo.album_name) ??
        (albumInfo && albumInfo.albumName) ??
        (albumInfo2 && albumInfo2.name) ??
        item.albumname ??
        item.albumName ??
        item.AlbumName ??
        item.album;
    const album = albumNameRaw != null ? String(albumNameRaw).trim() : '';

    const coverRaw =
        (albumInfo && (albumInfo.sizable_cover ?? albumInfo.cover)) ??
        (item.trans_param && item.trans_param.union_cover) ??
        item.cover ??
        item.Image ??
        item.image ??
        (item.info && item.info.image) ??
        item.img;
    const cover = normalizeKugouImageUrl(coverRaw, { size: 400 }) || DEFAULT_COVER;

    const nameRaw = item.songname ?? item.name ?? item.SongName ?? item.songName ?? item.FileName ?? item.filename ?? item.title;
    let title = nameRaw != null ? String(nameRaw).trim() : '';

    // Many Kugou payloads use "Singer - Title" in a single field.
    if (title && title.includes(' - ') && !item.songname) {
        const parts = title.split(' - ');
        if (parts.length >= 2) {
            const left = parts[0] ? parts[0].trim() : '';
            const right = parts.slice(1).join(' - ').trim();
            if (!artist && left) artist = left;
            if (right) title = right;
        }
    }

    if (!title) return null;

    const normalizeKugouHash = (value) => {
        const v = value != null ? String(value).trim() : '';
        if (!v) return '';
        return /^[0-9a-fA-F]{32}$/.test(v) ? v.toUpperCase() : '';
    };

    let kugouHash128 = normalizeKugouHash(item.FileHash ?? item.filehash ?? (audioInfo && audioInfo.hash_128) ?? (deprecated && deprecated.hash));
    let kugouHash320 = normalizeKugouHash(
        item['320Hash'] ??
            item.hash_320 ??
            (item.HQ && item.HQ.Hash) ??
            (audioInfo && audioInfo.hash_320)
    );
    let kugouHashFlac = normalizeKugouHash(
        item.SQHash ??
            item.hash_flac ??
            (item.SQ && item.SQ.Hash) ??
            (item.Res && item.Res.Hash) ??
            (audioInfo && (audioInfo.hash_flac ?? audioInfo.hash_high))
    );

    // Some endpoints (e.g. /playlist/track/all) return `relate_goods` with bitrate->hash mapping.
    const relateGoods = Array.isArray(item.relate_goods) ? item.relate_goods : [];
    for (const g of relateGoods) {
        if (!g || typeof g !== 'object') continue;
        const h = normalizeKugouHash(g.hash);
        if (!h) continue;
        const bitrate = Number(g.bitrate ?? g.BitRate ?? g.bitRate);
        if (Number.isFinite(bitrate) && bitrate >= 700) {
            if (!kugouHashFlac) kugouHashFlac = h;
        } else if (Number.isFinite(bitrate) && bitrate >= 300) {
            if (!kugouHash320) kugouHash320 = h;
        } else {
            if (!kugouHash128) kugouHash128 = h;
        }
    }

    const transParam = item.trans_param && typeof item.trans_param === 'object' ? item.trans_param : null;
    const kugouOggHash128 = normalizeKugouHash(transParam && transParam.ogg_128_hash);
    const kugouOggHash320 = normalizeKugouHash(transParam && transParam.ogg_320_hash);

    const albumIdRaw = item.album_id ?? item.AlbumID ?? item.albumid ?? item.albumId;
    const albumAudioIdRaw =
        item.album_audio_id ??
        item.albumAudioId ??
        item.MixSongID ??
        item.mixSongId ??
        item.add_mixsongid ??
        item.addMixsongid;
    const kugouAlbumId = albumIdRaw != null ? String(albumIdRaw).trim() : '';
    const kugouAlbumAudioId = albumAudioIdRaw != null ? String(albumAudioIdRaw).trim() : '';

    return {
        id: hash,
        hash,
        title,
        artist,
        album,
        cover,
        url: null,
        source: currentMusicSource,
        api: apiName,
        kugou_album_id: /^\d+$/.test(kugouAlbumId) ? kugouAlbumId : undefined,
        kugou_album_audio_id: /^\d+$/.test(kugouAlbumAudioId) ? kugouAlbumAudioId : undefined,
        kugou_hash_128: kugouHash128 || undefined,
        kugou_hash_320: kugouHash320 || undefined,
        kugou_hash_flac: kugouHashFlac || undefined,
        kugou_hash_ogg_128: kugouOggHash128 || undefined,
        kugou_hash_ogg_320: kugouOggHash320 || undefined,
        lyrics: []
    };
}

async function resolveSongUrl(song) {
    if (!song || !song.id) return '';
    const existingUrlRaw = song && song.url != null ? String(song.url).trim() : '';
    if (existingUrlRaw && /^https?:\/\//i.test(existingUrlRaw)) {
        // Prefer the upstream URL already provided by the API (some providers require auth tokens in the URL).
        return /^http:\/\//i.test(existingUrlRaw) ? existingUrlRaw.replace(/^http:\/\//i, 'https://') : existingUrlRaw;
    }
    const api = song.api || currentApi;
    const source = mapMusicSourceToApiSource(song.source || currentMusicSource);
    const id = String(song.id).trim();

    if (api === 'api8') {
        let url = await fetchApi8SongUrl(id, currentQuality, { useProxy: false });
        if (!url) url = await fetchApi8SongUrl(id, currentQuality, { useProxy: true });
        return url;
    }

    if (api === 'api2') {
        const sourceKey = source;
        const quality = normalizeApi2Quality(currentQuality, { sourceKey });
        if (source === 'kugou') {
            return await fetchApi2KugouSongUrlWithFallback(id, quality);
        }

        const data = await fetchApi2JsonWithFallback('/api/song/url', { mid: id, quality });
        const url = data && data.data && typeof data.data === 'object' ? data.data[id] : '';
        if (typeof url === 'string' && /^https?:\/\//i.test(url.trim())) return url.trim();
        return '';
    }

    if (api === 'api7') {
        return await fetchApi7SongUrlWithFallback(id, currentApi7Br);
    }

    if (isMetingApi(api)) {
        const brParam = getMetingBrParam(currentQuality);
        const serverParam = mapMetingServerParam(source);
        return await fetchMetingSongUrlWithFallback(api, serverParam, id, brParam);
    }

    if (api === 'api4') {
        return await fetchApi4SongUrlWithFallback(id, currentQuality);
    }

    if (api === 'api3') {
        return await fetchApi3SongUrlWithFallback(id, currentQuality);
    }

    return '';
}

function sendPlayNow(song) {
    try {
        localStorage.setItem('hjwjb_current_song', JSON.stringify(song));
        localStorage.setItem('hjwjb_play_now', 'true');
    } catch (e) {
        // ignore
    }

    if (typeof BroadcastChannel !== 'undefined') {
        try {
            const channel = new BroadcastChannel(HJWJB_PLAYER_CONTROL_CHANNEL);
            channel.postMessage({ type: 'PLAY_NOW', song });
            channel.close();
        } catch (e) {
            // ignore
        }
    }
}

async function playSongNow(song) {
    if (!song) return;
    const payload = { ...song };
    if (payload.api === 'api15') payload.api = 'api10';
    sendPlayNow(payload);
    createDanmaku('已发送到播放器');
}

async function addToPlaylist(song) {
    if (!song) return;
    const payload = { ...song };
    if (payload.api === 'api15') payload.api = 'api10';
    let playlist = [];
    try {
        playlist = JSON.parse(localStorage.getItem('hjwjb_playlist') || '[]');
    } catch (e) {
        playlist = [];
    }
    if (!Array.isArray(playlist)) playlist = [];
    const exists = playlist.some((item) => item && String(item.id) === String(payload.id));
    if (!exists) {
        playlist.push(payload);
        try {
            localStorage.setItem('hjwjb_playlist', JSON.stringify(playlist));
        } catch (e) {
            // ignore
        }
        createDanmaku('已添加到播放列表');
    } else {
        createDanmaku('播放列表已存在');
    }
}

async function downloadSong(song) {
    if (!song) return;
    renderSearchStatus({ iconClass: 'fas fa-spinner fa-spin', text: '正在获取下载链接...' });
    const url = await resolveSongUrl(song);
    if (!url) {
        renderSearchStatus({ iconClass: 'fas fa-times-circle', text: '下载链接获取失败' });
        return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = `${song.title || 'song'}.mp3`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    renderSearchStatus({ iconClass: 'fas fa-check-circle', text: '已开始下载' });
}

const MOTION_ENABLED_STORAGE_KEY = 'hjwjb_motion_enabled_v1';
let isMotionEnabled = true;

function createDanmaku(message) {
    if (!isMotionEnabled) return;
    // 弹幕默认关闭：仅当用户在主页设置里显式开启（hjwjb_barrage_enabled=true）才显示
    try {
        const raw = String(localStorage.getItem('hjwjb_barrage_enabled') || '').trim().toLowerCase();
        if (raw !== 'true') return;
    } catch (e) {
        return;
    }
    const container = document.getElementById('barrage-container');
    if (!container) return;
    const danmaku = document.createElement('div');
    danmaku.className = 'barrage-item';
    danmaku.textContent = message;
    danmaku.style.top = `${Math.random() * (window.innerHeight - 50)}px`;
    danmaku.style.animationDuration = `${Math.random() * 10 + 5}s`;
    container.appendChild(danmaku);
    danmaku.addEventListener('animationend', () => danmaku.remove());
}

function loadMotionSettings() {
    try {
        const raw = String(localStorage.getItem(MOTION_ENABLED_STORAGE_KEY) || '').trim().toLowerCase();
        if (raw === 'false') isMotionEnabled = false;
        if (raw === 'true') isMotionEnabled = true;
    } catch (e) {
        // ignore
    }
    applyMotionState();
    updateMotionToggleBtn();
}

function applyMotionState() {
    try {
        const off = !isMotionEnabled;
        document.documentElement.classList.toggle('motion-off', off);
        document.body.classList.toggle('motion-off', off);
    } catch (e) {
        // ignore
    }
}

function updateMotionToggleBtn() {
    const button = document.getElementById('motion-toggle-btn');
    if (!button) return;
    button.textContent = isMotionEnabled ? '🎞️ 动画开启' : '🎞️ 动画关闭';
    button.classList.toggle('active', isMotionEnabled);
}

function toggleMotion() {
    isMotionEnabled = !isMotionEnabled;
    try {
        localStorage.setItem(MOTION_ENABLED_STORAGE_KEY, String(isMotionEnabled));
    } catch (e) {
        // ignore
    }
    applyMotionState();
    updateMotionToggleBtn();
}

let currentTheme = 'neutral';

function loadThemeSettings() {
    const savedTheme = localStorage.getItem('hjwjb_theme');
    if (savedTheme) {
        currentTheme = savedTheme;
    } else {
        const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        currentTheme = isSystemDark ? 'dark' : 'light';
    }
    applyTheme();
}

function applyTheme() {
    document.body.classList.remove('light-theme', 'dark-theme');
    if (currentTheme === 'light') {
        document.body.classList.add('light-theme');
    } else if (currentTheme === 'dark') {
        document.body.classList.add('dark-theme');
    }
}

function updateThemeToggleBtn() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (!themeToggleBtn) return;
    const themeNames = {
        neutral: '中性主题',
        light: '浅色主题',
        dark: '深色主题'
    };
    const themeIcons = {
        neutral: 'fas fa-palette',
        light: 'fas fa-sun',
        dark: 'fas fa-moon'
    };
    themeToggleBtn.innerHTML = `<i class="${themeIcons[currentTheme] || 'fas fa-palette'}"></i> 主题：${themeNames[currentTheme] || '中性主题'}`;
}

function toggleTheme() {
    const themeOrder = ['neutral', 'light', 'dark'];
    const currentIndex = themeOrder.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    currentTheme = themeOrder[nextIndex];
    applyTheme();
    updateThemeToggleBtn();
    localStorage.setItem('hjwjb_theme', currentTheme);
    createDanmaku(`已切换为：${themeNamesForDanmaku(currentTheme)}`);
}

function themeNamesForDanmaku(theme) {
    const map = { neutral: '中性主题', light: '浅色主题', dark: '深色主题' };
    return map[String(theme || '')] || '中性主题';
}

function bindEvents() {
    if (searchButton) searchButton.addEventListener('click', () => performSearch(false));
    if (searchInput) {
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                performSearch(false);
            }
        });
    }
    if (searchModeSelect) {
        searchModeSelect.addEventListener('change', (event) => {
            selectSearchMode(event.target.value);
        });
    }
    if (chartSelect) {
        chartSelect.addEventListener('change', (event) => {
            currentChartId = String(event.target.value || '').trim();
            StorageManager.setItem(SEARCH_CHART_STORAGE_KEY, currentChartId);
        });
    }
    if (musicSourceSelect) {
        musicSourceSelect.addEventListener('change', (event) => {
            selectMusicSource(event.target.value);
        });
    }
    if (apiSelect) {
        apiSelect.addEventListener('change', (event) => {
            selectApi(event.target.value);
        });
    }
    if (qualitySelect) {
        qualitySelect.addEventListener('change', (event) => {
            selectQuality(event.target.value);
        });
    }
    if (qualitySwitchBtn) {
        qualitySwitchBtn.addEventListener('click', () => toggleQualityMode());
    }
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    const motionBtn = document.getElementById('motion-toggle-btn');
    if (motionBtn) motionBtn.addEventListener('click', toggleMotion);
    const proxyBtn = document.getElementById('proxy-settings-btn');
    if (proxyBtn) proxyBtn.addEventListener('click', openProxySettings);
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMoreResults);
}

function bindSharedSettingsSync() {
    if (sharedSettingsSyncBound) return;
    sharedSettingsSyncBound = true;

    window.addEventListener('storage', (event) => {
        const key = event && event.key ? String(event.key) : '';
        if (!key) return;

        if (key === 'hjwjb_current_api' || key === 'hjwjb_current_quality' || key === 'hjwjb_current_music_source') {
            console.log('🔄 检测到播放器设置变化，搜索页自动同步');
            try {
                loadSavedSettings();
                ensureApiSelectOptions();
                updateMusicSourceOptions();
                updateQualitySelectorVisibility();
                updateQualitySwitchBtn();
                updateSearchModeUI();
                updateLoadMoreControls();
            } catch (e) {
                // ignore
            }
        }

        if (key === MOTION_ENABLED_STORAGE_KEY) {
            try { loadMotionSettings(); } catch (e) { /* ignore */ }
        }
    });
}

function init() {
    searchInput = document.getElementById('search-input');
    searchButton = document.querySelector('.search-button');
    searchResults = document.getElementById('search-results');
    loadMoreContainer = document.getElementById('load-more-container');
    loadMoreBtn = document.getElementById('load-more-btn');
    searchModeSelect = document.getElementById('search-mode');
    musicSourceSelect = document.getElementById('search-music-source');
    apiSelect = document.getElementById('search-api-select');
    qualitySelect = document.getElementById('search-quality-select');
    qualitySwitchBtn = document.getElementById('quality-switch-btn');
    chartGroup = document.getElementById('search-chart-group');
    chartSelect = document.getElementById('search-chart-select');

    loadSavedSettings();
    ensureApiSelectOptions();
    updateMusicSourceOptions();
    updateQualitySelectorVisibility();
    updateQualitySwitchBtn();
    updateSearchModeUI();
    updateLoadMoreControls();
    loadMotionSettings();
    loadThemeSettings();
    updateThemeToggleBtn();
    initReturnToPlayerLinks();
    bindEvents();
    bindSharedSettingsSync();
}

document.addEventListener('DOMContentLoaded', () => {
    // 入场动画：并兼容 bfcache 恢复
    let enterTimer = 0;
    const triggerPageEnterAnimation = () => {
        try {
            const body = document.body;
            if (!body) return;

            // Restart animation reliably even when the class already exists at initial HTML load.
            body.classList.remove('page-enter');
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

    // 先绘制一帧（让入场动画真的出现在屏幕上），再做初始化
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            init();
        });
    });
});
