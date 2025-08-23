const express = require('express');
const cors = require('cors');
const path = require('path');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

const auth = require('basic-auth');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'secret';

const summaryHandler = require('./routes/summary');

const protect = (req, res, next) => {
  const credentials = auth(req);
  if (!credentials || credentials.name !== ADMIN_USER || credentials.pass !== ADMIN_PASS) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Access denied');
  }
  next();
};

app.use(cors());
app.use(express.json());
app.use('/admin/api', adminRoutes); // API routes under /admin/api

const fs = require('fs');
const verifyAccess = require('./middleware/verifyAccess');

const usersDirPath = '/data';
const usersFilePath = '/data/authorized-users.json';

try {
  // Ensure the /data directory exists (Railway Volume mount)
  if (!fs.existsSync(usersDirPath)) {
    fs.mkdirSync(usersDirPath, { recursive: true });
  }

  // Seed the file if missing
  if (!fs.existsSync(usersFilePath)) {
    fs.writeFileSync(usersFilePath, JSON.stringify([], null, 2), 'utf-8');
  }
} catch (e) {
  console.error('Failed to initialize persistent storage at /data:', e);
  // Optional: bail early so you notice the problem in logs
  process.exit(1);
}

if (!fs.existsSync('/data/cache')) fs.mkdirSync('/data/cache', { recursive: true });


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


// Serve admin.html manually for /admin
app.get('/admin', protect, (req, res) => {

  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve static assets (if any)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('OU Plugin Auth Server Running');
});

// after other routes
app.get('/api/summary', summaryHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});






