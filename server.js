const express = require('express');
const cors = require('cors');
const path = require('path');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/admin/api', adminRoutes); // API routes under /admin/api

const fs = require('fs');
const verifyAccess = require('./middleware/verifyAccess');

app.post('/check', verifyAccess, (req, res) => {
  const pluginPath = path.join(__dirname, 'public', 'plugins', 'ou-summary-v2.3.js');

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
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve static assets (if any)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('OU Plugin Auth Server Running');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const usersFilePath = '/data/authorized-users.json'; // this must be a string

if (!fs.existsSync(usersFilePath)) {
  fs.writeFileSync(usersFilePath, JSON.stringify([], null, 2), 'utf-8');
}




