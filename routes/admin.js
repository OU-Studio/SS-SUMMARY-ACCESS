const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const usersPath = '/data/authorized-users.json'; // ✅ absolute, persistent


function loadUsers() {
  return JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
}

function saveUsers(users) {
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf-8');
}

router.get('/users', (req, res) => {
  res.json(loadUsers());
});

router.post('/users', (req, res) => {
  const users = loadUsers();
  users.push(req.body);
  saveUsers(users);
  res.json({ success: true });
});

router.delete('/users/:index', (req, res) => {
  const users = loadUsers();
  users.splice(req.params.index, 1);
  saveUsers(users);
  res.json({ success: true });
});

module.exports = router;
