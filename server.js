// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const auth = require('basic-auth');

const adminRoutes = require('./routes/admin');
const verifyAccess = require('./middleware/verifyAccess');
const summaryHandler = require('./routes/summary');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Basic Auth for /admin ----------
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'secret';

const protect = (req, res, next) => {
  const credentials = auth(req);
  if (!credentials || credentials.name !== ADMIN_USER || credentials.pass !== ADMIN_PASS) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Access denied');
  }
  next();
};

// ---------- Global middleware ----------
app.use(cors());
app.use(express.json());

// ---------- Persistent storage bootstrap (/data) ----------
const DATA_DIR = '/data';
const USERS_FILE = path.join(DATA_DIR, 'authorized-users.json');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
} catch (e) {
  console.error('Failed to initialize persistent storage at /data:', e);
  process.exit(1);
}

// ---------- Admin API ----------
app.use('/admin/api', adminRoutes);

// ---------- Auth-gated plugin delivery ----------
app.post('/check', verifyAccess, (req, res) => {
  const pluginPath = path.join(__dirname, 'public', 'plugins', 'ou-summary-v2.5.js');
  fs.readFile(pluginPath, 'utf8', (err, data) => {
    if (err) {
      console.error('Plugin read error:', err);
      return res.status(500).json({ error: 'Plugin not found' });
    }
    res.setHeader('Content-Type', 'application/javascript');
    res.send(data);
  });
});

// ---------- Admin UI (Basic Auth protected) ----------
app.get('/admin', protect, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------- Static assets ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Health root ----------
app.get('/', (req, res) => {
  res.send('OU Plugin Auth Server Running');
});

// ---------- Summary aggregator + cache ----------
app.get('/api/summary', summaryHandler);

// (Optional) Admin-only cache purge endpoint
app.post('/api/summary/purge', protect, (req, res) => {
  try {
    const { domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: 'domain required' });

    const safeDomain = String(domain).replace(/^www\./, '');
    const domainDir = path.join(CACHE_DIR, encodeURIComponent(safeDomain));

    if (fs.existsSync(domainDir)) {
      for (const f of fs.readdirSync(domainDir)) {
        fs.unlinkSync(path.join(domainDir, f));
      }
    }
    return res.json({ ok: true, purged: safeDomain });
  } catch (e) {
    console.error('purge error:', e);
    return res.status(500).json({ error: 'purge failed' });
  }
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Admin user set?', !!process.env.ADMIN_USER);
  console.log('Data dir:', DATA_DIR);
  console.log('Users file:', USERS_FILE);
  console.log('Cache dir:', CACHE_DIR);
});
