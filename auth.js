// api/auth.js — Password verification endpoint
// Password is stored as DASHBOARD_PASSWORD env variable in Vercel
// Returns a session token valid for 8 hours

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { password } = req.body || {};
  const CORRECT = process.env.DASHBOARD_PASSWORD;

  if (!CORRECT) {
    return res.status(500).json({ error: 'Server not configured' });
  }
  if (!password || password !== CORRECT) {
    // Small delay to prevent brute force
    await new Promise(r => setTimeout(r, 500));
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  // Generate a simple token: hash of password + timestamp rounded to 8h window
  const crypto = require('crypto');
  const window = Math.floor(Date.now() / (1000 * 60 * 60 * 8)); // 8-hour window
  const token  = crypto
    .createHmac('sha256', CORRECT)
    .update(String(window))
    .digest('hex');

  return res.status(200).json({ token, expiresIn: '8h' });
};
