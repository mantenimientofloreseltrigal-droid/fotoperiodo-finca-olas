// ═══════════════════════════════════════════════
// Google Sheets — Sincronización de datos
// ═══════════════════════════════════════════════

// URL del Apps Script Web App (se configura por el supervisor)
let SHEETS_URL = '';

// URL configurada directamente en el código — no editable desde la app
// Para cambiarla editar este archivo y redesplegar en GitHub
const SHEETS_URL_FIJA = 'https://script.google.com/macros/s/AKfycbyQ-sZsmehwJJfgJc9VFIvNj6JAJOi0ni9gHtsWhBKbC4yoeGP0BvpOSZgTl4-jkptw/exec'; // ← PEGA AQUÍ LA URL DEL APPS SCRIPT

async function cargarSheetsURL() {
  // Prioridad: URL fija en código > URL guardada localmente
  if (SHEETS_URL_FIJA) {
    SHEETS_URL = SHEETS_URL_FIJA;
    return;
  }
  // Fallback: URL guardada (para compatibilidad)
  const url = await getConfig('sheets_url');
  if (url) SHEETS_URL = url;
}

async function guardarSheetsURL(url) {
  // Solo se usa internamente, no desde la UI
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

// ═══════════════════════════════════════════════
// SINCRONIZACIÓN AUTOMÁTICA EN TIEMPO REAL
// ═══════════════════════════════════════════════

// Cola de sincronización en memoria para reintentos
let _syncPendiente = false;

// Agregar a la cola Y enviar inmediatamente si hay conexión
// Subir estado completo de todas las guirnaldas a Sheets
async function subirEstadoCompleto() {
  if (!SHEETS_URL || !navigator.onLine) return;
  try {
    const todasGuirnaldas = Object.values(guirnaldas).filter(g =>
      g.variedad1 || g.variedad2
    );
    if (!todasGuirnaldas.length) return;
    await enviarASheets('estado_guirnaldas', {
      guirnaldas: todasGuirnaldas,
      ts: new Date().toISOString()
    });
  } catch(e) {
    console.warn('Error subiendo estado:', e.message);
  }
}

async function addToSyncQueue(tipo, datos) {
  const item = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2,7),
    type: tipo,
    data: datos,
    synced: false,
    ts: new Date().toISOString()
  };
  // Guardar en cola local primero (protección offline)
  await dbAdd('sync_queue', item).catch(()=>{});

  // Intentar enviar inmediatamente si hay internet
  if (navigator.onLine && SHEETS_URL) {
    try {
      await enviarASheets(tipo, datos);
      item.synced = true;
      await dbPut('sync_queue', item).catch(()=>{});
    } catch(e) {
      // Fallará silenciosamente — se reintentará con syncConSheets
      console.warn('Sync inmediato falló, quedó en cola:', e.message);
    }
  }
}

// Sincronización automática cada 5 minutos cuando hay WiFi
function iniciarSyncAutomatico() {
  // Al recuperar conexión: subir Y descargar
  window.addEventListener('online', async () => {
    console.log('Conexión recuperada — sincronizando...');
    // Subir pendientes
    const up = await syncConSheets();
    if (up.enviados > 0) mostrarToastSync(up.enviados);
    // Descargar de otros dispositivos
    const down = await descargarDesdSheets().catch(()=>({ok:false}));
    if (down.ok && down.importadas > 0) {
      if (typeof buildInicio === 'function') buildInicio();
      console.log(`Descargados: ${down.importadas} registros`);
    }
  });

  // Cada 5 min: subir pendientes + descargar actualizaciones
  setInterval(async () => {
    if (navigator.onLine && SHEETS_URL && !_syncPendiente) {
      _syncPendiente = true;
      // Subir registros pendientes
      const up = await syncConSheets();
      if (up.enviados > 0) mostrarToastSync(up.enviados);
      // Descargar actualizaciones de otros dispositivos
      const down = await descargarDesdSheets().catch(()=>({ok:false}));
      if (down.ok && down.importadas > 0) {
        if (typeof buildInicio === 'function') buildInicio();
        console.log(`Sync automático: ${down.importadas} registros descargados`);
      }
      _syncPendiente = false;
    }
  }, 300000); // 5 minutos

  // Al recuperar conexión: subir Y descargar
  

  // Sincronizar al iniciar si hay conexión
  if (navigator.onLine && SHEETS_URL) {
    setTimeout(() => syncConSheets(), 3000);
  }
}

// Toast de confirmación de sync
function mostrarToastSync(n) {
  const toast = document.createElement('div');
  toast.innerHTML = `✓ ${n} registros sincronizados con Sheets`;
  toast.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:#0F6E56;color:#fff;padding:8px 16px;border-radius:20px;
    font-size:12px;font-weight:700;z-index:999;
    animation:fadeInUp .3s ease;pointer-events:none;
    white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.2)
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Indicador de estado de sync en tiempo real
function actualizarIndicadorSync() {
  dbGetAll('sync_queue').then(queue => {
    const pendientes = queue.filter(q => !q.synced).length;
    const dot = document.getElementById('gps-dot');
    if (!dot) return;
    // Reusar el indicador GPS para mostrar estado de sync
    const syncEl = document.getElementById('sync-indicator');
    if (syncEl) {
      syncEl.textContent = pendientes > 0
        ? `${pendientes} pend.`
        : '✓ Sync';
      syncEl.style.color = pendientes > 0 ? '#F59E0B' : '#1D9E75';
    }
  });
}

// ═══════════════════════════════════════════════
// DESCARGA DE DATOS DESDE SHEETS (para supervisor)
// ═══════════════════════════════════════════════

async function descargarDesdSheets() {
  if (!SHEETS_URL) {
    if (typeof SHEETS_URL_APP !== 'undefined') SHEETS_URL = SHEETS_URL_APP;
    else return { ok: false, msg: 'URL no configurada' };
  }
  if (!navigator.onLine) return { ok: false, msg: 'Sin conexión' };

  try {
    const url  = SHEETS_URL + '?action=estado&ts=' + Date.now();
    console.log('Descargando estado desde Sheets...');
    // Google Apps Script soporta CORS en GET automáticamente
    const res  = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return { ok: false, msg: `HTTP ${res.status}` };
    const text = await res.text();
    console.log('Respuesta recibida:', text.slice(0,150));
    let data;
    try { data = JSON.parse(text); }
    catch(e) { return { ok: false, msg: 'JSON inválido: ' + text.slice(0,80) }; }
    if (!data.ok) return { ok: false, msg: data.error || 'Error en Sheets' };

    let importadas = 0;

    // Importar estado completo de guirnaldas
    if (data.guirnaldas && data.guirnaldas.length) {
      for (const g of data.guirnaldas) {
        const k       = g.id || gKey(g.bloque, g.nave, g.lado, g.g);
        const gdLocal = guirnaldas[k];

        // Usar el más reciente comparando fechaRegistro
        const tsRemoto = g.fechaRegistro || g.fechaIni || '';
        const tsLocal  = gdLocal?.fechaRegistro || gdLocal?.fechaIni || '';

        if (!gdLocal || tsRemoto >= tsLocal) {
          guirnaldas[k] = { ...g, id: k };
          await dbPut('guirnaldas', guirnaldas[k]);
          importadas++;
        }
      }
    }

    // También importar lecturas de horómetros
    if (data.lecturas && data.lecturas.length) {
      for (const l of data.lecturas) {
        const key = `${l.bloque}_${l.horometro}_${l.fecha}`;
        await dbPut('lecturas', { ...l, id: key }).catch(()=>{});
      }
    }

    if (importadas > 0 && typeof buildInicio === 'function') buildInicio();
    return { ok: true, importadas };
  } catch(e) {
    return { ok: false, msg: e.message };
  }
}
