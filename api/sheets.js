// api/sheets.js — Vercel Serverless Function
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Verify token
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'No autorizado — sesión expirada o inválida' });
  }

  const SHEET_ID    = process.env.GOOGLE_SHEET_ID;
  const CLIENT_EMAIL= process.env.GOOGLE_CLIENT_EMAIL;
  const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    const gtoken = await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY);

    // Fetch all sheets in parallel including Config
    const [cobranzas, pagos, otrosIngresos, configRaw] = await Promise.all([
      fetchSheet(gtoken, SHEET_ID, 'Cobranzas'),
      fetchSheet(gtoken, SHEET_ID, 'Pagos'),
      fetchSheet(gtoken, SHEET_ID, 'Otros Ingresos'),
      fetchSheet(gtoken, SHEET_ID, 'Config').catch(() => []),
    ]);

    // Parse Config sheet into a key-value object
    const config = parseConfig(configRaw);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({ cobranzas, pagos, otrosIngresos, config, ts: Date.now() });
  } catch (err) {
    console.error('Sheets error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// Parse Config sheet: col A = key, col B = value (skip rows starting with # or empty)
function parseConfig(rows) {
  const cfg = {};
  if (!rows || rows.length < 2) return cfg;
  // Skip header row (row 0)
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0] || '').trim();
    const val = String(rows[i][1] || '').trim();
    if (!key || key.startsWith('#')) continue;
    cfg[key] = val;
  }
  return cfg;
}

// Token verification
function verifyToken(token) {
  if (!token) return false;
  const crypto = require('crypto');
  const PASS   = (process.env.DASHBOARD_PASSWORD || '').trim();
  if (!PASS) return false;
  const expected = crypto.createHash('sha256').update(PASS).digest('hex');
  return token === expected;
}

// Google Auth
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
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
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
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
