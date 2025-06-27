const express = require('express');
const cors = require('cors');
const path = require('path');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/admin/api', adminRoutes); // API routes under /admin/api

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
