// routes/summary.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- Config ----------
const CACHE_ROOT = '/data/cache'; // persistent volume
const TTL_MS = Number(process.env.SUMMARY_CACHE_TTL_MS || 5 * 60 * 1000); // default 5 min
const REQUIRE_AUTHORIZED_DOMAIN = true; // set to false to allow any domain

// ---------- Utils ----------
function safeMkdir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function hashKey(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}
function cacheFilePath(domain, key) {
  const dir = path.join(CACHE_ROOT, encodeURIComponent(domain));
  safeMkdir(dir);
  return path.join(dir, `${key}.json`);
}
function loadAuthorized() {
  try {
    return JSON.parse(fs.readFileSync('/data/authorized-users.json', 'utf-8'));
  } catch {
    return [];
  }
}

// Small helper to parse base to *path only* (drop protocol/host if given)
function toPathOnly(raw) {
  try {
    const u = new URL(String(raw), 'https://example.com');
    return u.pathname + (u.search || '');
  } catch {
    return String(raw || '');
  }
}

// Retry helper for transient upstream errors; also surfaces 401 distinctly
async function fetchJsonWithRetry(url, retries = 2, backoff = 300) {
  let last;
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.ok) return res.json();

    if (res.status === 401) {
      const e = new Error('UPSTREAM_401');
      e.status = 401;
      e.url = url;
      throw e;
    }

    last = new Error(`Upstream ${res.status} on ${url}`);
    if (i < retries && [429, 500, 502, 503, 504].includes(res.status)) {
      await new Promise(r => setTimeout(r, backoff * (i + 1)));
      continue;
    }
    throw last;
  }
  throw last;
}

// Fetches all pages of a Squarespace collection JSON
async function fetchAll(domain, baseUrl, filters) {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.tag) params.set('tag', filters.tag);
  params.set('format', 'json');

  const origin = `https://${domain}`;
  const base = origin + baseUrl;
  const initialUrl = base + (base.includes('?') ? '&' : '?') + params.toString();

  const items = [];
  let nextUrl = initialUrl;

  while (nextUrl) {
    const json = await fetchJsonWithRetry(nextUrl);
    if (Array.isArray(json.items)) items.push(...json.items);

    const next = json.pagination?.nextPage && json.pagination?.nextPageUrl;
    if (next) {
      nextUrl = next.includes('format=json')
        ? next
        : next + (next.includes('?') ? '&' : '?') + 'format=json';
    } else {
      nextUrl = null;
    }
  }

  if (String(filters.featured).toLowerCase() === 'true') {
    return items.filter(i => i.starred === true);
  }
  return items;
}

module.exports = async function summaryHandler(req, res) {
  try {
    const domain = String(req.query.domain || '').replace(/^www\./, '');
    const rawBase = String(req.query.base || '');
    const baseUrl = toPathOnly(rawBase);
    const category = req.query.category ? String(req.query.category) : '';
    const tag = req.query.tag ? String(req.query.tag) : '';
    const featured = req.query.featured ? String(req.query.featured) : '';

    if (!domain || !baseUrl.startsWith('/')) {
      return res.status(400).json({ error: 'Missing or invalid domain/base' });
    }

    // 🔒 Optional: gate by authorized users list
    if (REQUIRE_AUTHORIZED_DOMAIN) {
      const users = loadAuthorized();
      const allowed = users.some(u => u &&
        (u.domain === domain || u.ssDomain === domain));
      if (!allowed) {
        return res.status(403).json({ error: 'Unauthorized domain for summary API' });
      }
    }

    // Cache key per domain/base/filters
    const keyRaw = JSON.stringify({ domain, baseUrl, category, tag, featured });
    const key = hashKey(keyRaw);
    const file = cacheFilePath(domain, key);

    // Serve fresh cache if valid
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      const age = Date.now() - stat.mtimeMs;
      if (age < TTL_MS) {
        const cached = fs.readFileSync(file, 'utf-8');
        res.set('Cache-Control', 'public, max-age=60');
        return res.type('application/json').send(cached);
      }
    }

    // Fetch upstream and cache
    const items = await fetchAll(domain, baseUrl, { category, tag, featured });
    const payload = JSON.stringify({ items });

    safeMkdir(path.dirname(file));
    fs.writeFileSync(file, payload, 'utf-8');

    res.set('Cache-Control', 'public, max-age=60');
    return res.type('application/json').send(payload);

  } catch (e) {
    if (e && e.status === 401) {
      // Private Squarespace (visitor password). Tell client to fallback.
      return res.status(401).json({
        error: 'UPSTREAM_401',
        detail: 'Squarespace requires visitor password; use client-side fetch fallback.'
      });
    }
    console.error('summary error:', e);
    return res.status(500).json({ error: 'Failed to aggregate summary', detail: e.message });
  }
};
