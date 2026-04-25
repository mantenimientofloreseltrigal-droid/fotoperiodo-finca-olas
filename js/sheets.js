// ═══════════════════════════════════════════════
// Google Sheets — Sincronización de datos
// ═══════════════════════════════════════════════

// URL del Apps Script Web App (se configura por el supervisor)
let SHEETS_URL = '';

async function cargarSheetsURL() {
  const url = await getConfig('sheets_url');
  if (url) SHEETS_URL = url;
}

async function guardarSheetsURL(url) {
  SHEETS_URL = url;
  await setConfig('sheets_url', url);
}

// Enviar datos al Apps Script
async function enviarASheets(tipo, datos) {
  if (!SHEETS_URL) {
    console.warn('URL de Sheets no configurada');
    return { ok: false, msg: 'URL de Sheets no configurada' };
  }
  try {
    const res = await fetch(SHEETS_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, datos, ts: new Date().toISOString() })
    });
    return { ok: true };
  } catch (e) {
    console.error('Error enviando a Sheets:', e);
    return { ok: false, msg: e.message };
  }
}

// Sincronizar cola pendiente
async function syncConSheets() {
  if (!SHEETS_URL || !navigator.onLine) return { ok: false, pendientes: 0 };
  const queue = await dbGetAll('sync_queue');
  const pendientes = queue.filter(q => !q.synced);
  if (!pendientes.length) return { ok: true, pendientes: 0 };

  let enviados = 0;
  for (const item of pendientes) {
    const res = await enviarASheets(item.type, item.data);
    if (res.ok) {
      item.synced = true;
      await dbPut('sync_queue', item);
      enviados++;
    }
  }
  return { ok: true, enviados, pendientes: pendientes.length };
}

// Exportar historial completo a Sheets
async function exportarTodo() {
  if (!SHEETS_URL) return { ok: false, msg: 'Configura la URL de Google Sheets primero' };

  const [siembras, lecturas, radiometria, gps] = await Promise.all([
    dbGetAll('siembras'),
    dbGetAll('lecturas'),
    dbGetAll('radiometria'),
    dbGetAll('gps')
  ]);

  const res = await enviarASheets('exportar_completo', {
    siembras, lecturas, radiometria, gps,
    exportado_por: window.currentOperario,
    fecha: new Date().toISOString()
  });
  return res;
}

// ── Apps Script (Code.gs) para pegar en Google Sheets ──
// El supervisor configura este script en su Sheet:
const APPS_SCRIPT_CODE = `
// Pegar en Google Apps Script — Extensions > Apps Script
function doPost(e) {
  try {
    const datos = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tipo = datos.tipo;

    if (tipo === 'lectura') {
      const sh = ss.getSheetByName('Lecturas') || ss.insertSheet('Lecturas');
      if (sh.getLastRow() === 0)
        sh.appendRow(['Fecha','Bloque','Horómetro','Lectura','Diferencia','Operario','Observación','GPS_Lat','GPS_Lng','GPS_Válido']);
      const d = datos.datos;
      sh.appendRow([d.fecha,d.bloque,d.horometro,d.lectura,d.diff,d.operario,d.observacion||'',
        d.gps?.lat||'',d.gps?.lng||'',d.gpsValido?'SI':'NO']);
    }
    else if (tipo === 'siembra') {
      const sh = ss.getSheetByName('Siembras') || ss.insertSheet('Siembras');
      if (sh.getLastRow() === 0)
        sh.appendRow(['Fecha','Bloque','Nave','Lado','Guirnalda','Cama1','Cama2','Variedad1','Variedad2','Noches','FechaIni','FechaFin','Operario']);
      const d = datos.datos;
      sh.appendRow([d.fechaRegistro,d.bloque,d.nave,d.lado,d.g,d.cama1,d.cama2,
        d.variedad1,d.variedad2,d.noches,d.fechaIni,d.fechaFin,d.operario]);
    }
    else if (tipo === 'radiometria') {
      const sh = ss.getSheetByName('Radiometria') || ss.insertSheet('Radiometria');
      if (sh.getLastRow() === 0)
        sh.appendRow(['Fecha','Bloque','Cama','P1','P2','P3','Promedio','Unidad','Operario','GPS_Lat','GPS_Lng']);
      const d = datos.datos;
      sh.appendRow([d.fecha,d.bloque,d.cama,d.p1,d.p2,d.p3,d.prom,d.unidad,d.operario,
        d.gps?.lat||'',d.gps?.lng||'']);
    }
    else if (tipo === 'exportar_completo') {
      // Exportación masiva
      const d = datos.datos;
      const log = ss.getSheetByName('Log_Exportaciones') || ss.insertSheet('Log_Exportaciones');
      log.appendRow([datos.ts, d.exportado_por, d.siembras.length, d.lecturas.length, d.radiometria.length]);
    }

    return ContentService.createTextOutput(JSON.stringify({ok:true}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
`;
