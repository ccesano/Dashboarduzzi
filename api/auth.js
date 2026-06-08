// api/auth.js — Password verification endpoint
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const CORRECT = process.env.DASHBOARD_PASSWORD;
  if (!CORRECT) return res.status(500).json({ error: 'DASHBOARD_PASSWORD not configured' });

  // Parse body — Vercel sometimes needs manual parsing
  let password = '';
  try {
    if (typeof req.body === 'object' && req.body !== null) {
      password = req.body.password || '';
    } else if (typeof req.body === 'string') {
      password = JSON.parse(req.body).password || '';
    }
  } catch(e) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  if (!password || password !== CORRECT) {
    await new Promise(r => setTimeout(r, 400));
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  const crypto = require('crypto');
  const window = Math.floor(Date.now() / (1000 * 60 * 60 * 8));
  const token  = crypto.createHmac('sha256', CORRECT).update(String(window)).digest('hex');
  return res.status(200).json({ token, expiresIn: '8h' });
};
