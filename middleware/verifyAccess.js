const fs = require('fs');

module.exports = function verifyAccess(req, res, next) {
  /*
  const accessKey = req.body.accessKey || req.headers['x-access-key'];
  const domain = req.body.domain || req.headers['x-domain'];

  if (!accessKey || !domain) {
    return res.status(400).json({ error: 'Missing access key or domain.' });
  }

  const users = JSON.parse(fs.readFileSync('/data/authorized-users.json', 'utf-8'));

  const match = users.find(user =>
    user.accessKey === accessKey &&
    (user.domain === domain || user.ssDomain === domain)
  );

  if (!match) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  req.user = match;
  */
  next();
};
