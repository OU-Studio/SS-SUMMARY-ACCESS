const express = require('express');
const cors = require('cors');
const path = require('path');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/admin', adminRoutes);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('OU Plugin Auth Server Running');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
