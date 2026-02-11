import { proxyWorker as worker } from './worker.js';

function buildFullUrl(req) {
    const proto = (req && req.headers && (req.headers['x-forwarded-proto'] || req.headers['X-Forwarded-Proto'])) || 'https';
    const host =
        (req && req.headers && (req.headers['x-forwarded-host'] || req.headers['X-Forwarded-Host'])) ||
        (req && req.headers && req.headers.host) ||
        'localhost';
    const path = (req && req.url) || '/';
    return `${proto}://${host}${path}`;
}

function toHeaders(nodeHeaders) {
    const headers = new Headers();
    const raw = nodeHeaders || {};
    for (const [k, v] of Object.entries(raw)) {
        if (v == null) continue;
        if (Array.isArray(v)) headers.set(k, v.join(','));
        else headers.set(k, String(v));
    }
    return headers;
}

async function sendResponse(req, res, resp) {
    res.statusCode = resp.status;
    resp.headers.forEach((value, key) => {
        try {
            res.setHeader(key, value);
        } catch (e) {
            // ignore invalid headers
        }
    });

    if (resp.body == null || String(req.method || '').toUpperCase() === 'HEAD') {
        res.end();
        return;
    }

    const reader = resp.body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) res.write(Buffer.from(value));
        }
    } finally {
        res.end();
    }
}

export default async function handler(req, res) {
    const full = buildFullUrl(req);
    const url = new URL(full);
    url.pathname = '/__health';
    const request = new Request(url.toString(), {
        method: req.method || 'GET',
        headers: toHeaders(req.headers)
    });
    const resp = await worker.fetch(request);
    await sendResponse(req, res, resp);
}
