// ══════════════════════════════════════════════════════
// UZZI DASHBOARD — shared-data.js
// Funciones compartidas para persistencia de datos Excel
// ══════════════════════════════════════════════════════

const DB_KEY = 'dashboardData';

// Carga los datos guardados. Retorna { rows, file, ts } o null.
function loadStoredData() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

// Guarda los datos parseados.
function saveData(rows, fileName) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify({ rows, file: fileName, ts: Date.now() }));
    return true;
  } catch(e) {
    console.warn('localStorage lleno o no disponible:', e);
    return false;
  }
}

// Borra los datos guardados.
function clearData() {
  localStorage.removeItem(DB_KEY);
}

// Formatea "hace X min / h / días"
function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1)   return 'recién cargado';
  if (mins < 60)  return 'hace ' + mins + ' min';
  if (mins < 1440) return 'hace ' + Math.round(mins/60) + 'h';
  return 'hace ' + Math.round(mins/1440) + 'd';
}
