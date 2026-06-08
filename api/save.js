// api/save.js — Write a key-value pair to the Config sheet
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  // Verify token
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
  const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
  const PRIVATE_KEY  = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  let key, value;
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    key   = String(body.key   || '').trim();
    value = String(body.value ?? '').trim();
  } catch(e) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  if (!key) return res.status(400).json({ error: 'key required' });

  try {
    const gtoken = await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY);

    // Read current Config sheet to find the row with this key
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Config!A:B`;
    const readResp = await fetch(readUrl, {
      headers: { Authorization: `Bearer ${gtoken}` }
    });
    if (!readResp.ok) throw new Error('Error reading Config: ' + await readResp.text());
    const readData = await readResp.json();
    const rows = readData.values || [];

    // Find row index (1-based for Sheets API)
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === key) {
        rowIndex = i + 1; // Sheets API is 1-based
        break;
      }
    }

    if (rowIndex < 0) {
      // Key not found — append a new row
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Config!A:B:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const appendResp = await fetch(appendUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gtoken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[key, value]] })
      });
      if (!appendResp.ok) throw new Error('Error appending: ' + await appendResp.text());
    } else {
      // Update existing row
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Config!B${rowIndex}?valueInputOption=RAW`;
      const updateResp = await fetch(updateUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${gtoken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[value]] })
      });
      if (!updateResp.ok) throw new Error('Error updating: ' + await updateResp.text());
    }

    return res.status(200).json({ ok: true, key, value });
  } catch(err) {
    console.error('Save error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function verifyToken(token) {
  if (!token) return false;
  const crypto = require('crypto');
  const PASS   = (process.env.DASHBOARD_PASSWORD || '').trim();
  if (!PASS) return false;
  return token === crypto.createHash('sha256').update(PASS).digest('hex');
}

async function getAccessToken(clientEmail, privateKey) {
  const crypto = require('crypto');
  const now    = Math.floor(Date.now() / 1000);
  const claim  = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  };
  const b64url = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const header  = b64url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const payload = b64url(JSON.stringify(claim));
  const toSign  = `${header}.${payload}`;
  const sign    = crypto.createSign('RSA-SHA256');
  sign.update(toSign);
  const sig = sign.sign(privateKey,'base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${toSign}.${sig}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.access_token;
}
