#!/usr/bin/env node
/**
 * Meting upstream smoke test (QQ + NetEase).
 *
 * Usage:
 *   node scripts/test-meting.mjs
 *   node scripts/test-meting.mjs https://musicapi.chuyel.top/api https://api.qijieya.cn/meting/
 */

const DEFAULT_BASES = ['https://musicapi.chuyel.top/api', 'https://api.qijieya.cn/meting/'];

function parseArgs(argv) {
  const out = {
    bases: [],
    neteaseSong: '591321', // default sample id from qijieya docs
    tencentSong: '',
    neteasePlaylists: ['3778678', '630899583'],
    tencentPlaylists: [],
  };

  const args = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i] || '').trim();
    if (!a) continue;

    const eat = () => (i + 1 < args.length ? String(args[++i] || '').trim() : '');
    const kv = (prefix) => (a.startsWith(prefix) ? String(a.slice(prefix.length)).trim() : '');

    const vNeteaseSongEq = kv('--netease-song=');
    if (vNeteaseSongEq) {
      out.neteaseSong = vNeteaseSongEq;
      continue;
    }
    if (a === '--netease-song') {
      const v = eat();
      if (v) out.neteaseSong = v;
      continue;
    }

    const vTencentSongEq = kv('--tencent-song=');
    if (vTencentSongEq) {
      out.tencentSong = vTencentSongEq;
      continue;
    }
    if (a === '--tencent-song') {
      out.tencentSong = eat();
      continue;
    }

    const vNeteasePlEq = kv('--netease-playlist=');
    if (vNeteasePlEq) {
      out.neteasePlaylists = vNeteasePlEq.split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (a === '--netease-playlist') {
      const v = eat();
      if (v) out.neteasePlaylists = v.split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }

    const vTencentPlEq = kv('--tencent-playlist=');
    if (vTencentPlEq) {
      out.tencentPlaylists = vTencentPlEq.split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (a === '--tencent-playlist') {
      const v = eat();
      if (v) out.tencentPlaylists = v.split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }

    if (/^https?:\/\//i.test(a)) {
      out.bases.push(a);
      continue;
    }
  }

  if (!out.bases.length) out.bases = DEFAULT_BASES.slice();
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const BASE_URLS = ARGS.bases.map((u) => String(u).trim()).filter(Boolean);

const SEARCH_KEYWORDS = {
  netease: '海阔天空',
  tencent: '周杰伦',
};

const PLAYLIST_IDS = {
  netease: Array.isArray(ARGS.neteasePlaylists) ? ARGS.neteasePlaylists : [],
  tencent: Array.isArray(ARGS.tencentPlaylists) ? ARGS.tencentPlaylists : [],
};

function buildUrl(base, params) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function pretty(v) {
  return v == null ? '' : String(v);
}

function hasHttpUrl(text) {
  return /https?:\/\/[^\s"'<>]+/i.test(String(text || ''));
}

function looksLikeLrc(text) {
  return /\[\d+:\d+(?:\.\d+)?\]/.test(String(text || ''));
}

function looksLikeWordLyrics(text) {
  const t = String(text || '');
  return (
    /<\d+:\d+(?:\.\d+)?>/.test(t) ||
    /\{\s*\d+\s*,\s*\d+\s*\}/.test(t) ||
    /\(\s*\d+\s*,\s*\d+\s*\)/.test(t) ||
    /\[\s*\d+\s*,\s*\d+\s*\]/.test(t)
  );
}

function extractIdFromMetingItem(item) {
  if (!item || typeof item !== 'object') return '';
  const rawId = item.id ?? item.songid ?? item.songId ?? item.song_id;
  if (rawId != null && String(rawId).trim()) return String(rawId).trim();

  const candidates = [item.url, item.pic, item.lrc];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const u = new URL(String(candidate));
      const id = u.searchParams.get('id');
      if (id) return String(id).trim();
    } catch {
      const match = String(candidate).match(/[?&]id=([^&]+)/i);
      if (match && match[1]) return decodeURIComponent(match[1]);
    }
  }
  return '';
}

async function fetchWithTimeout(url, { timeoutMs = 12000, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, { accept = '*/*' } = {}) {
  const resp = await fetchWithTimeout(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { Accept: accept },
  });
  const text = await resp.text();
  return { resp, text };
}

async function fetchJson(url) {
  const { resp, text } = await fetchText(url, { accept: 'application/json,*/*' });
  let data = null;
  try {
    data = JSON.parse(String(text || '').trim());
  } catch {
    data = null;
  }
  return { resp, text, data };
}

async function testSearch(base, server, keyword) {
  const common = { server, type: 'search' };
  const attempts = [
    buildUrl(base, { ...common, id: keyword }),
    buildUrl(base, { ...common, keyword, id: '1' }),
  ];

  for (const url of attempts) {
    const { resp, data } = await fetchJson(url);
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
    if (Array.isArray(data) || list.length) {
      const first = Array.isArray(data) ? data[0] : list[0];
      const id = extractIdFromMetingItem(first);
      return { ok: true, url, resp, list: Array.isArray(data) ? data : list, id };
    }
  }

  return { ok: false, url: attempts[0] };
}

async function testPlaylist(base, server, playlistId) {
  const url = buildUrl(base, { server, type: 'playlist', id: playlistId });
  const { resp, data } = await fetchJson(url);
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
  return { ok: list.length > 0, url, resp, listLen: list.length };
}

async function testSongInfo(base, server, songId) {
  const url = buildUrl(base, { server, type: 'song', id: songId });
  const { resp, data } = await fetchJson(url);
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
  const first = list[0] || (data && typeof data === 'object' && !Array.isArray(data) ? data : null);
  const pic = first && typeof first === 'object' ? (first.pic || first.cover || '') : '';
  const lrc = first && typeof first === 'object' ? (first.lrc || '') : '';
  const urlField = first && typeof first === 'object' ? (first.url || '') : '';
  return { ok: !!first, url, resp, hasPic: !!pic, hasLrc: !!lrc, hasUrlField: !!urlField };
}

async function testPic(base, server, songId) {
  const url = buildUrl(base, { server, type: 'pic', id: songId });
  const { resp, text } = await fetchText(url, { accept: '*/*' });
  const body = String(text || '').trim();
  return { ok: hasHttpUrl(body), url, resp, sample: body.slice(0, 120) };
}

async function testLrc(base, server, songId) {
  const url = buildUrl(base, { server, type: 'lrc', id: songId, yrc: 'true', lrctype: '1' });
  const { resp, text } = await fetchText(url, { accept: '*/*' });
  const body = String(text || '');
  return { ok: !!body.trim(), url, resp, looksLrc: looksLikeLrc(body), looksWord: looksLikeWordLyrics(body) };
}

async function testUrl(base, server, songId) {
  const url = buildUrl(base, { server, type: 'url', id: songId, br: '320' });
  const resp = await fetchWithTimeout(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: '*/*' },
  });

  const acao = resp.headers.get('access-control-allow-origin');
  const ct = resp.headers.get('content-type');

  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get('location');
    return { ok: !!location, url, resp, location: pretty(location), acao, contentType: ct };
  }

  if (ct && /^audio\//i.test(ct)) {
    try {
      resp.body?.cancel();
    } catch {}
    return { ok: true, url, resp, location: '(audio stream)', acao, contentType: ct };
  }

  const text = await resp.text();
  const body = String(text || '').trim();
  return { ok: hasHttpUrl(body) || resp.ok, url, resp, location: body.slice(0, 160), acao, contentType: ct };
}

function printRespMeta(resp) {
  if (!resp) return '';
  const status = resp.status;
  const acao = resp.headers.get('access-control-allow-origin') || '';
  const ct = resp.headers.get('content-type') || '';
  const via = resp.headers.get('server') || '';
  return `status=${status} ct=${ct} acao=${acao} server=${via}`;
}

async function main() {
  console.log('Meting smoke test\n');
  console.log('Options:');
  console.log(`- neteaseSong: ${ARGS.neteaseSong}`);
  console.log(`- tencentSong: ${ARGS.tencentSong || '(not set)'}`);
  console.log(`- neteasePlaylists: ${(PLAYLIST_IDS.netease || []).join(', ') || '(none)'}`);
  console.log(`- tencentPlaylists: ${(PLAYLIST_IDS.tencent || []).join(', ') || '(none)'}`);
  console.log('');
  console.log('Bases:');
  for (const base of BASE_URLS) console.log(`- ${base}`);
  console.log('');

  for (const base of BASE_URLS) {
    console.log('============================================================');
    console.log(`BASE: ${base}`);

    for (const server of ['netease', 'tencent']) {
      console.log('');
      console.log(`-- server=${server}`);

      const keyword = SEARCH_KEYWORDS[server];
      let pickedSongId = '';

      if (keyword) {
        try {
          const r = await testSearch(base, server, keyword);
          if (!r.ok) {
            console.log(`search: FAIL (${keyword}) url=${r.url}`);
          } else {
            console.log(`search: OK (${keyword}) id=${r.id} url=${r.url}`);
            console.log(`  ${printRespMeta(r.resp)}`);
            pickedSongId = r.id || '';
          }
        } catch (e) {
          console.log(`search: ERROR (${keyword}) ${e?.message || e}`);
        }
      }

      if (!pickedSongId) {
        if (server === 'netease') pickedSongId = ARGS.neteaseSong || '';
        if (server === 'tencent') pickedSongId = ARGS.tencentSong || '';
      }

      if (!pickedSongId) {
        console.log('song/url/pic/lrc: SKIP (no song id; pass --tencent-song for QQ)');
      } else {
        const songId = pickedSongId;
        try {
          const songInfo = await testSongInfo(base, server, songId);
          console.log(`song: ${songInfo.ok ? 'OK' : 'FAIL'} id=${songId} hasPic=${songInfo.hasPic} hasLrc=${songInfo.hasLrc} hasUrlField=${songInfo.hasUrlField}`);
          console.log(`  url=${songInfo.url}`);
          console.log(`  ${printRespMeta(songInfo.resp)}`);

          const urlRes = await testUrl(base, server, songId);
          console.log(`url: ${urlRes.ok ? 'OK' : 'FAIL'} -> ${urlRes.location ? urlRes.location.slice(0, 120) : ''}`);
          console.log(`  url=${urlRes.url}`);
          console.log(`  ${printRespMeta(urlRes.resp)}`);

          const picRes = await testPic(base, server, songId);
          console.log(`pic: ${picRes.ok ? 'OK' : 'FAIL'} sample=${picRes.sample}`);
          console.log(`  url=${picRes.url}`);
          console.log(`  ${printRespMeta(picRes.resp)}`);

          const lrcRes = await testLrc(base, server, songId);
          console.log(`lrc: ${lrcRes.ok ? 'OK' : 'FAIL'} looksLrc=${lrcRes.looksLrc} looksWord=${lrcRes.looksWord}`);
          console.log(`  url=${lrcRes.url}`);
          console.log(`  ${printRespMeta(lrcRes.resp)}`);
        } catch (e) {
          console.log(`song/url/pic/lrc: ERROR id=${songId} ${e?.message || e}`);
        }
      }

      const playlistIds = PLAYLIST_IDS[server] || [];
      if (!playlistIds.length) {
        console.log('playlist: SKIP (no test ids)');
      } else {
        for (const pid of playlistIds) {
          try {
            const p = await testPlaylist(base, server, pid);
            console.log(`playlist: ${p.ok ? 'OK' : 'FAIL'} id=${pid} list=${p.listLen}`);
            console.log(`  url=${p.url}`);
            console.log(`  ${printRespMeta(p.resp)}`);
          } catch (e) {
            console.log(`playlist: ERROR id=${pid} ${e?.message || e}`);
          }
        }
      }
    }

    console.log('');
  }

  console.log('Done.');
}

await main();
