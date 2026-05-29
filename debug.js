// api/debug.js — temporary debug endpoint to inspect raw Sheets data
// DELETE THIS FILE after debugging

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
  const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
  const PRIVATE_KEY  = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  try {
    const crypto = require('crypto');
    const now    = Math.floor(Date.now() / 1000);
    const claim  = {
      iss: CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600, iat: now,
    };
    function b64url(str) {
      return Buffer.from(str).toString('base64')
        .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    }
    const header  = b64url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
    const payload = b64url(JSON.stringify(claim));
    const toSign  = `${header}.${payload}`;
    const sign    = crypto.createSign('RSA-SHA256');
    sign.update(toSign);
    const sig = sign.sign(PRIVATE_KEY,'base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const jwt = `${toSign}.${sig}`;

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    const { access_token } = await tokenResp.json();

    // Fetch first 10 rows of Cobranzas to see raw format
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Cobranzas!A1:J15`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` }});
    const data = await resp.json();

    // Also get total row count
    const url2 = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Cobranzas`;
    const resp2 = await fetch(url2, { headers: { Authorization: `Bearer ${access_token}` }});
    const data2 = await resp2.json();
    const totalRows = (data2.values || []).length;

    return res.status(200).json({
      totalRows,
      first15rows: data.values || [],
      note: 'DELETE api/debug.js after debugging'
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
