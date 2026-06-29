// api/mark-extraordinario.js — Marks/unmarks a specific row as "extraordinario"
// Identifies the row by Fecha+Sucursal+Destino+Monto+Personal (NOT by row number,
// so re-sorting the sheet never breaks an existing mark).
// Writes "SI" (or "" to unmark) into a new column "Extraordinario" — appended as the
// LAST column of the sheet if it doesn't exist yet (auto-created on first use).

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!verifyToken(token)) return res.status(401).json({ error: 'No autorizado' });

  const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
  const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
  const PRIVATE_KEY  = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch(e) { return res.status(400).json({ error: 'Invalid body' }); }

  // sheetName: 'Cobranzas' | 'Pagos' | 'Otros Ingresos'
  const { sheetName, fecha, sucursal, destino, monto, personal, mark } = body || {};
  if (!sheetName || !fecha || !destino || monto === undefined) {
    return res.status(400).json({ error: 'Missing identifying fields' });
  }

  // Column layout per sheet (0-indexed) — matches the loaders used across the dashboard
  const LAYOUT = {
    'Cobranzas':      { fecha:0, sucursal:2, personal:3, destino:6, monto:8 },
    'Pagos':          { fecha:0, sucursal:2, personal:3, destino:6, monto:7 },
    'Otros Ingresos': { fecha:0, sucursal:1, personal:2, destino:3, monto:5 },
  };
  const L = LAYOUT[sheetName];
  if (!L) return res.status(400).json({ error: 'Unknown sheetName' });

  try {
    const gtoken = await getAccessToken(CLIENT_EMAIL, PRIVATE_KEY);

    // Read the full sheet (values) to locate the matching row + find/create the Extraordinario column
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(sheetName)}`;
    const readResp = await fetch(readUrl, { headers: { Authorization: `Bearer ${gtoken}` } });
    if (!readResp.ok) throw new Error('Error reading sheet: ' + await readResp.text());
    const data = await readResp.json();
    const rows = data.values || [];

    // Find header row (first row where col A === 'Fecha')
    let hdrIdx = -1;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      if (String(rows[i][0] || '').trim() === 'Fecha') { hdrIdx = i; break; }
    }
    if (hdrIdx < 0) throw new Error('Header row not found');

    // Find or determine the "Extraordinario" column index (append as new last column if missing)
    const header = rows[hdrIdx] || [];
    let extColIdx = header.findIndex(h => String(h || '').trim() === 'Extraordinario');
    const isNewColumn = extColIdx < 0;
    if (isNewColumn) extColIdx = header.length; // will be appended

    // Locate the matching data row by Fecha+Sucursal+Destino+Monto(+Personal)
    // fecha arrives already normalized as 'YYYY-MM-DD' (same as the frontend's parseDate output) —
    // so the raw Sheets date must be normalized the SAME way before comparing, since Sheets may
    // store dates as 'DD/MM/YYYY[ HH:mm]', as 'YYYY-MM-DD', or as a raw Excel/Sheets serial number.
    const fechaNorm = String(fecha).trim();
    const sucNorm   = String(sucursal||'').trim();
    const destNorm  = String(destino).trim();
    const persNorm  = String(personal||'').trim();
    const montoNum  = parseFloat(monto);

    let foundRowIdx = -1;
    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[L.fecha]) continue;
      const rFecha = normalizeDate(r[L.fecha]);
      const rSuc   = String(r[L.sucursal]||'').trim();
      const rDest  = String(r[L.destino]||'').trim();
      const rPers  = String(r[L.personal]||'').trim();
      const rMonto = parseMontoServer(r[L.monto]);
      if (rFecha === fechaNorm && rSuc === sucNorm && rDest === destNorm &&
          rPers === persNorm && Math.abs(rMonto - montoNum) < 0.5) {
        foundRowIdx = i;
        break;
      }
    }
    if (foundRowIdx < 0) {
      return res.status(404).json({ error: 'Movimiento no encontrado — puede que los datos hayan cambiado. Recargá la página e intentá de nuevo.' });
    }

    // If the column is new, the sheet's grid must be expanded BEFORE writing to it —
    // Sheets API rejects writes outside the current grid limits (rows/cols), even though
    // appending via values.append would auto-expand. A direct cell PUT does not.
    const colLetter = colIndexToLetter(extColIdx);
    if (isNewColumn) {
      await ensureColumnExists(gtoken, SHEET_ID, sheetName, extColIdx + 1); // +1 = total columns needed
      await writeCell(gtoken, SHEET_ID, sheetName, colLetter, hdrIdx+1, 'Extraordinario');
    }

    // Write SI / '' into that row's Extraordinario cell
    const value = mark ? 'SI' : '';
    await writeCell(gtoken, SHEET_ID, sheetName, colLetter, foundRowIdx+1, value);

    return res.status(200).json({ ok: true, row: foundRowIdx+1, value });
  } catch(err) {
    console.error('mark-extraordinario error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// Expands the sheet's grid to have at least `neededCols` columns, if it doesn't already.
// Needed before writing to a column index that exceeds the sheet's current gridProperties.
async function ensureColumnExists(token, sheetId, sheetName, neededCols) {
  // 1. Get the sheet's numeric ID + current column count
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`;
  const metaResp = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!metaResp.ok) throw new Error('Error reading spreadsheet metadata: ' + await metaResp.text());
  const meta = await metaResp.json();
  const sheetProps = (meta.sheets || []).find(s => s.properties?.title === sheetName)?.properties;
  if (!sheetProps) throw new Error(`Sheet "${sheetName}" not found in spreadsheet metadata`);

  const currentCols = sheetProps.gridProperties?.columnCount || 0;
  if (currentCols >= neededCols) return; // already big enough, nothing to do

  // 2. Expand via batchUpdate (updateSheetProperties)
  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;
  const batchResp = await fetch(batchUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        updateSheetProperties: {
          properties: {
            sheetId: sheetProps.sheetId,
            gridProperties: { columnCount: neededCols }
          },
          fields: 'gridProperties.columnCount'
        }
      }]
    })
  });
  if (!batchResp.ok) throw new Error('Error expanding sheet grid: ' + await batchResp.text());
}

async function writeCell(token, sheetId, sheetName, colLetter, rowNumber1Indexed, value) {
  const range = `${sheetName}!${colLetter}${rowNumber1Indexed}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[value]] })
  });
  if (!resp.ok) throw new Error('Error writing cell: ' + await resp.text());
}

function parseMontoServer(s) {
  // Mirrors the frontend's parseMonto(): handles '1.234,56' (AR), '1,234.56' (US),
  // plain '1234.56', and values with a leading '$'.
  if (!s && s !== 0) return 0;
  let str = String(s).trim().replace(/[$\s]/g, '');
  if (str === '' || str === '-') return 0;
  if (/^\d+(\.\d{1,2})?$/.test(str)) return parseFloat(str) || 0;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(str)) {
    return parseFloat(str.replace(/\./g,'').replace(',','.')) || 0;
  }
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(str)) {
    return parseFloat(str.replace(/,/g,'')) || 0;
  }
  str = str.replace(/[^\d.,]/g,'');
  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');
  if (lastComma > lastDot) return parseFloat(str.replace(/\./g,'').replace(',','.')) || 0;
  return parseFloat(str.replace(/,/g,'')) || 0;
}

function normalizeDate(raw) {
  // Mirrors the frontend's parseDate(): handles 'DD/MM/YYYY[ HH:mm]', 'YYYY-MM-DD',
  // and raw Excel/Sheets date serial numbers — always returns 'YYYY-MM-DD' or ''.
  if (!raw) return '';
  const str = String(raw).trim();
  let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return str.slice(0,10);
  if (/^\d+(\.\d+)?$/.test(str)) {
    const d = new Date((parseFloat(str) - 25569) * 86400 * 1000);
    return d.toISOString().slice(0,10);
  }
  return '';
}

function colIndexToLetter(idx) {
  let s = '';
  idx += 1;
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
}

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
