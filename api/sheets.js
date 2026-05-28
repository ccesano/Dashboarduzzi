// api/sheets.js — Vercel Serverless Function
// Reads data from Google Sheets using Service Account credentials
// Credentials are stored as Vercel environment variables (never in code)

export default async function handler(req, res) {
  // CORS headers — allow requests from any origin (your Vercel domain)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const SHEET_ID    = process.env.GOOGLE_SHEET_ID;
  const CLIENT_EMAIL= process.env.GOOGLE_CLIENT_EMAIL;
  const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    // 1. Get JWT token from Google
    const token = await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY);

    // 2. Fetch all three sheets in parallel
    const [cobranzas, pagos, otrosIngresos] = await Promise.all([
      fetchSheet(token, SHEET_ID, 'Cobranzas'),
      fetchSheet(token, SHEET_ID, 'Pagos'),
      fetchSheet(token, SHEET_ID, 'Otros Ingresos'),
    ]);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // cache 5 min
    return res.status(200).json({
      cobranzas,
      pagos,
      otrosIngresos,
      ts: Date.now(),
      cached: false,
    });
  } catch (err) {
    console.error('Sheets API error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── JWT Auth ──────────────────────────────────────────────────────────────────
async function getAccessToken(clientEmail, privateKey) {
  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss  : clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud  : 'https://oauth2.googleapis.com/token',
    exp  : now + 3600,
    iat  : now,
  };

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claim));
  const toSign  = `${header}.${payload}`;

  // Sign with RS256 using Web Crypto API (available in Vercel Edge/Node)
  const keyData = pemToArrayBuffer(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(toSign)
  );
  const jwt = `${toSign}.${b64url(sig)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method : 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body   : `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.access_token;
}

// ── Fetch a single sheet ──────────────────────────────────────────────────────
async function fetchSheet(token, sheetId, sheetName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Error reading ${sheetName}: ${err}`);
  }
  const data = await resp.json();
  return data.values || []; // array of arrays
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function b64url(data) {
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : new Uint8Array(data);
  let str = '';
  bytes.forEach(b => str += String.fromCharCode(b));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
