// api/auth.js
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const CORRECT = (process.env.DASHBOARD_PASSWORD || '').trim();
  if (!CORRECT) return res.status(500).json({ error: 'DASHBOARD_PASSWORD not set' });

  // Parse body
  let password = '';
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    if (body && typeof body === 'object') password = String(body.password || '').trim();
  } catch(e) {}

  if (!password || password !== CORRECT) {
    await new Promise(r => setTimeout(r, 400));
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  // Token = simple SHA256 of password — same result every time, no time window
  const crypto = require('crypto');
  const token  = crypto.createHash('sha256').update(CORRECT).digest('hex');
  return res.status(200).json({ token });
};
