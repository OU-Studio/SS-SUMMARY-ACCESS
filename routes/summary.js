// routes/summary.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Node 18+ has global fetch
const CACHE_ROOT = '/data/cache';         // persistent volume
const TTL_MS = 5 * 60 * 1000;            // 5 minutes (tweak as you like)

function safeMkdir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function hashKey(s) { return crypto.createHash('md5').update(s).digest('hex'); }

function cacheFilePath(domain, key) {
  const dir = path.join(CACHE_ROOT, encodeURIComponent(domain));
  safeMkdir(dir);
  return path.join(dir, `${key}.json`);
}

async function fetchAll(domain, baseUrl, filters) {
  // Build initial URL
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.tag)      params.set('tag', filters.tag);
  params.set('format', 'json');

  const base = `https://${domain}${baseUrl}`;
  const initialUrl = base + (base.includes('?') ? '&' : '?') + params.toString();

  const items = [];
  let nextUrl = initialUrl;

  while (nextUrl) {
    const res = await fetch(nextUrl, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Upstream ${res.status} on ${nextUrl}`);
    const json = await res.json();

    if (Array.isArray(json.items)) items.push(...json.items);

    const next = json.pagination?.nextPage && json.pagination?.nextPageUrl;
    if (next) {
      // Ensure format=json is kept
      nextUrl = next.includes('format=json') ? next : next + (next.includes('?') ? '&' : '?') + 'format=json';
    } else {
      nextUrl = null;
    }
  }

  // Optional: featured filter server-side
  if (String(filters.featured).toLowerCase() === 'true') {
    return items.filter(i => i.starred === true);
  }
  return items;
}

module.exports = async function summaryHandler(req, res) {
  try {
    const domain  = String(req.query.domain || '').replace(/^www\./, '');
    const baseUrl = String(req.query.base || '');
    const category = req.query.category ? String(req.query.category) : '';
    const tag      = req.query.tag ? String(req.query.tag) : '';
    const featured = req.query.featured ? String(req.query.featured) : '';

    if (!domain || !baseUrl.startsWith('/')) {
      return res.status(400).json({ error: 'Missing or invalid domain/base' });
    }

    // Cache key: domain + base + filters
    const keyRaw = JSON.stringify({ domain, baseUrl, category, tag, featured });
    const key = hashKey(keyRaw);
    const file = cacheFilePath(domain, key);

    // Serve fresh cache if valid
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      const age = Date.now() - stat.mtimeMs;
      if (age < TTL_MS) {
        const cached = fs.readFileSync(file, 'utf-8');
        res.set('Cache-Control', 'public, max-age=60'); // client cache (optional)
        return res.type('application/json').send(cached);
      }
    }

    // Fetch and cache
    const items = await fetchAll(domain, baseUrl, { category, tag, featured });
    const payload = JSON.stringify({ items }, null, 0);
    safeMkdir(path.dirname(file));
    fs.writeFileSync(file, payload, 'utf-8');

    res.set('Cache-Control', 'public, max-age=60');
    res.type('application/json').send(payload);
  } catch (e) {
    console.error('summary error:', e);
    res.status(500).json({ error: 'Failed to aggregate summary', detail: e.message });
  }
};
