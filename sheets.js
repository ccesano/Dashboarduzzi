// api/sheets.js — Vercel Serverless Function (CommonJS)
// Requires valid auth token from /api/auth

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // ── Verify token ──────────────────────────────────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'No autorizado — sesión expirada o inválida' });
  }

  const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
  const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
  const PRIVATE_KEY  = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    const token_gcp = await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY);
    const [cobranzas, pagos, otrosIngresos] = await Promise.all([
      fetchSheet(token_gcp, SHEET_ID, 'Cobranzas'),
      fetchSheet(token_gcp, SHEET_ID, 'Pagos'),
      fetchSheet(token_gcp, SHEET_ID, 'Otros Ingresos'),
    ]);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({ cobranzas, pagos, otrosIngresos, ts: Date.now() });
  } catch (err) {
    console.error('Sheets error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ── Token verification ────────────────────────────────────────────────────────
function verifyToken(token) {
  if (!token) return false;
  const crypto  = require('crypto');
  const PASS    = process.env.DASHBOARD_PASSWORD;
  if (!PASS) return false;
  // Check current and previous 8h window (to avoid logout at window boundary)
  const now = Math.floor(Date.now() / (1000 * 60 * 60 * 8));
  for (const w of [now, now - 1]) {
    const expected = crypto.createHmac('sha256', PASS).update(String(w)).digest('hex');
    if (token === expected) return true;
  }
  return false;
}

// ── JWT Auth ──────────────────────────────────────────────────────────────────
async function getAccessToken(clientEmail, privateKey) {
  const crypto = require('crypto');
  const now    = Math.floor(Date.now() / 1000);
  const claim  = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  };
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claim));
  const toSign  = `${header}.${payload}`;
  const sign    = crypto.createSign('RSA-SHA256');
  sign.update(toSign);
  const sig = sign.sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${toSign}.${sig}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function fetchSheet(token, sheetId, sheetName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Error reading "${sheetName}": ${await resp.text()}`);
  const data = await resp.json();
  return data.values || [];
}

function b64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
