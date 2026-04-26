// ═══════════════════════════════════════════════
// Fotoperiodo v2 — App principal
// Finca Olas · Guirnaldas + Plan de Siembras
// ═══════════════════════════════════════════════

// ── DATOS (cargados desde JSON) ───────────────
let BLOQUES    = {};  // {bl: {naves, ladoA, ladoB,...}}
let VARIEDADES = {};  // {nombre: noches}
let PLAN       = [];  // [{variedad, semana, cantidad, noches}]

// ── CONFIG ────────────────────────────────────
const CFG = {
  horoMinimo  : 1.0,
  horasPorNoche: 2.0,  // 10min luz × 12 ciclos = 2h reales por noche
  maxNavesH   : 6,
  camasPorNave: 4,
  turnos: [
    { inicio:'21:00', fin:'03:00' },
    { inicio:'21:10', fin:'03:10' },
    { inicio:'21:20', fin:'03:20' }
  ],
  pines: {
    '1234': { rol:'operario',   nombre:'Operario'   },
    '5678': { rol:'supervisor', nombre:'Supervisor' },
    '9999': { rol:'gerente',    nombre:'Gerente'    }
  },
  radioRangos: {
    'µmol/m²/s': { min:1.5, max:80,   label:'PAR'  },
    'Lux'       : { min:1000,max:6000, label:'Lux'  },
    'Candela'   : { min:500, max:3000, label:'cd'   },
    'W/m²'      : { min:2,   max:20,   label:'W/m²' }
  }
};

// ── ESTADO ────────────────────────────────────
let operario  = '', rol = '';
let bloqueAct = null, unidad = 'µmol/m²/s';
let guirnaldas = {};   // key→{estado,var1,noches1,var2,noches2,fechaIni,fechaFin}
let lecturas   = {};   // key b_hid→{ayer,hoy}

// ── CARGAR DATOS JSON ─────────────────────────
async function cargarDatos() {
  const [rB, rV, rP] = await Promise.all([
    fetch('js/data_bloques.json').then(r=>r.json()),
    fetch('js/data_variedades.json').then(r=>r.json()),
    fetch('js/data_plan.json').then(r=>r.json())
  ]);
  BLOQUES    = rB;
  VARIEDADES = rV;
  PLAN       = rP;
  // Cargar guirnaldas guardadas
  const saved = await dbGetAll('guirnaldas');
  saved.forEach(g => guirnaldas[g.id] = g);
  console.log(`Datos cargados: ${Object.keys(BLOQUES).length} bloques, ${Object.keys(VARIEDADES).length} variedades`);
}

// ── SEMANA ACTUAL ─────────────────────────────
function semanaActual() {
  const d = new Date();
  const yr = d.getFullYear();
  const oneJan = new Date(yr, 0, 1);
  const wk = Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  // Formato: YYYYWW (ej: 202618) y también YYWW (ej: 2618) para compatibilidad
  return '' + yr + String(wk).padStart(2,'0');
}

function semanaCorta() {
  // Formato YY+WW para coincidir con el plan (ej: 2617, 2618)
  const d = new Date();
  const yr = String(d.getFullYear()).slice(2); // "26"
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const wk = Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  return yr + String(wk).padStart(2,'0'); // "2618"
}

function planSemanaActual() {
  const semL = semanaActual();   // "202618"
  const semC = semanaCorta();    // "2618"
  // Buscar en ambos formatos
  return PLAN.filter(p => p.semana === semL || p.semana === semC);
}

// ── FECHA UTILS ───────────────────────────────
function hoy() {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function addDias(fecha, dias) {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function diasRest(fecha) {
  return Math.ceil((new Date(fecha) - new Date(hoy())) / 86400000);
}
function fmtF(f) {
  if (!f) return '—';
  const [y,m,d] = f.split('-');
  return d+'/'+m+'/'+y;
}
function fechaLarga() {
  const d = new Date();
  const dias  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return dias[d.getDay()]+', '+d.getDate()+' de '+meses[d.getMonth()]+' '+d.getFullYear();
}

// ── GUIRNALDAS — CLAVE y LÓGICA ──────────────
// Guirnalda key: "B{bl}_N{nave}_L{lado}_G{g}"
// G1 = camas 1-2, G2 = camas 3-4
function gKey(bl, nave, lado, g) {
  return 'B'+bl+'_N'+nave+'_L'+lado+'_G'+g;
}
function camasDeGuirnalda(nave, g) {
  // g=1 → camas 1,2  |  g=2 → camas 3,4
  const base = (g-1)*2 + 1;
  return [base, base+1];
}
function guirnaldaDeCama(cama) {
  // cama 1,2→G1  |  cama 3,4→G2
  return Math.ceil(cama / 2);
}

// Calcular horómetros del bloque (6 naves, fusión si último=1)
function calcHoros(bl) {
  const info = BLOQUES[String(bl)];
  if (!info) return [];
  const nNaves = info.naves;
  const MAX = CFG.maxNavesH;
  let grupos = [];
  let ini = 1;
  while (ini <= nNaves) {
    const fin = Math.min(ini + MAX - 1, nNaves);
    grupos.push({ ini, fin });
    ini = fin + 1;
  }
  // Fusión: si último tiene 1 nave, absorber al penúltimo
  if (grupos.length >= 2) {
    const ult = grupos[grupos.length-1];
    if (ult.fin - ult.ini + 1 === 1) {
      grupos[grupos.length-2].fin = ult.fin;
      grupos.pop();
    }
  }
  return grupos.map((g, i) => ({
    id   : 'H'+(i+1),
    nIni : g.ini,
    nFin : g.fin,
    turno: CFG.turnos[i % CFG.turnos.length]
  }));
}

function horoDeNave(bl, nave) {
  const horos = calcHoros(bl);
  return horos.find(h => nave >= h.nIni && nave <= h.nFin);
}

// Contar camas por lado en una nave
function camasPorLado(bl, lado) {
  const info = BLOQUES[String(bl)];
  if (!info) return 4;
  const total = lado === 'A' ? info.ladoA : info.ladoB;
  const naves = info.naves;
  return Math.ceil(total / naves);
}

// Guirnaldas por nave: 2 guirnaldas por lado
function guirnaIdsDeNave(nave, lado, cPorLado) {
  // cuántas guirnaldas caben según camas del lado en esa nave
  const nGuirn = Math.ceil(Math.min(cPorLado, 4) / 2);
  const ids = [];
  for (let g = 1; g <= nGuirn; g++) ids.push(g);
  return ids;
}

// Estado de guirnalda según fecha
function estadoGuirnalda(gd) {
  // Una guirnalda está activa si AL MENOS una cama está sembrada
  if (!gd || (!gd.variedad1 && !gd.variedad2)) return 'sin-sembrar';
  if (!gd.encendida) return 'sembrada-apagada';
  const dr = diasRest(gd.fechaFin);
  if (dr < 0) return 'apagada-auto';
  if (dr <= 3) return 'por-vencer';
  return 'encendida';
}
function colorEstado(est) {
  const m = { 'encendida':'#1D9E75','por-vencer':'#F59E0B','apagada-auto':'#E24B4A','sembrada-apagada':'#EF9F27','sin-sembrar':'#ccc' };
  return m[est] || '#ccc';
}
function textoEstado(est) {
  const m = { 'encendida':'En luces','por-vencer':'Por vencer','apagada-auto':'Apagada','sembrada-apagada':'Sembrada','sin-sembrar':'Sin sembrar' };
  return m[est] || '—';
}

// ── LOGIN ─────────────────────────────────────
function initLogin() {
  document.getElementById('lc-date').textContent = fechaLarga();
}
function pinInput(el, idx) {
  if (el.value.length === 1 && idx < 3)
    document.querySelectorAll('.pin-inp')[idx+1].focus();
}
function intentarLogin() {
  const nombre = document.getElementById('lc-nombre').value.trim();
  const pin    = Array.from(document.querySelectorAll('.pin-inp')).map(i=>i.value).join('');
  if (!nombre) { showErr('Escribe tu nombre'); return; }
  if (pin.length < 4) { showErr('Ingresa el PIN de 4 dígitos'); return; }
  const rolPin = validarPin(pin);
  if (!rolPin) { showErr('PIN incorrecto'); return; }
  operario = nombre; rol = rolPin;
  window.currentOperario = nombre;
  window.currentRol = rolPin;
  document.getElementById('u-initials').textContent =
    nombre.split(' ').map(w=>w[0].toUpperCase()).slice(0,2).join('');
  document.getElementById('u-name').textContent = nombre.split(' ')[0];
  document.getElementById('hdr-date').textContent = fechaLarga();
  const sem = semanaActual();
  const semC2 = semanaCorta();
  document.getElementById('hdr-sem').textContent = 'Sem 20'+semC2.slice(0,2)+'-W'+semC2.slice(2);
  document.getElementById('login-screen').style.display = 'none';
  const app = document.getElementById('app-shell');
  app.style.display='flex'; app.style.flexDirection='column'; app.style.flex='1';
  initGPS();
  buildInicio();
  checkOnline();
}
function showErr(msg) {
  const el = document.getElementById('lc-err');
  el.textContent = msg; el.style.display='block';
  setTimeout(()=>el.style.display='none', 3000);
}
function confirmarSalir() {
  // Mostrar modal de confirmación
  const html = `<div class="modal-handle"></div>
    <div class="modal-title" style="color:var(--r)">⏻ Salir de la app</div>
    <div style="font-size:13px;color:var(--txt2);margin-bottom:20px;line-height:1.6">
      ¿Estás seguro que deseas salir?<br>
      Los datos no sincronizados se guardan localmente y se enviarán cuando haya WiFi.
    </div>
    <button class="btn-g" style="background:var(--r);margin-bottom:8px" onclick="ejecutarSalir()">
      Sí, salir
    </button>
    <button class="btn-outline" onclick="cerrarModal()">Cancelar</button>`;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('show');
}

function ejecutarSalir() {
  cerrarModal();
  // Limpiar estado
  operario = ''; rol = '';
  window.currentOperario = '';
  window.currentRol = '';
  stopGPS();
  // Volver al login
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('lc-nombre').value = '';
  document.querySelectorAll('.pin-inp').forEach(i => i.value = '');
  document.getElementById('lc-err').style.display = 'none';
  // Reset nav
  setNavSel('nb-bloques');
  showScreen('sc-inicio');
}

function cerrarSesion() {
  if (!confirm('¿Cerrar sesión?')) return;
  stopGPS();
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('app-shell').style.display='none';
  document.getElementById('lc-nombre').value='';
  document.querySelectorAll('.pin-inp').forEach(i=>i.value='');
}

// ── ONLINE ────────────────────────────────────
function checkOnline() {
  const bar = document.getElementById('offline-bar');
  bar.classList.toggle('on', !navigator.onLine);
}
window.addEventListener('online',  checkOnline);
window.addEventListener('offline', checkOnline);

// ── ALERTA HORÓMETRO OMITIDO ──────────────────────
async function checkHorometrosOmitidos() {
  const ahora = new Date();
  const hora  = ahora.getHours();
  // Solo aplica entre 00:00 y 13:00
  if(hora >= 13) {
    document.getElementById('banner-horo-omitido')?.remove();
    return;
  }
  const hoy = ahora.toISOString().split('T')[0];
  const todasLecturas = await dbGetAll('lecturas');
  const lecturasHoy   = todasLecturas.filter(l => l.fecha?.startsWith(hoy));

  // Buscar horómetros con guirnaldas activas que no tienen lectura hoy
  const omitidos = [];
  Object.keys(BLOQUES).forEach(bl => {
    const horos = calcHoros(parseInt(bl));
    horos.forEach(h => {
      // Verificar si tiene guirnaldas encendidas
      let tieneActivas = false;
      for(let n=h.nIni;n<=h.nFin;n++){
        ['A','B'].forEach(lado=>{
          for(let g=1;g<=2;g++){
            const est = estadoGuirnalda(guirnaldas[gKey(parseInt(bl),n,lado,g)]);
            if(est==='encendida'||est==='por-vencer') tieneActivas=true;
          }
        });
      }
      if(!tieneActivas) return;
      // Verificar si ya tiene lectura hoy
      const tieneHoy = lecturasHoy.some(l=>l.bloque==bl && l.horometro===h.id);
      if(!tieneHoy) omitidos.push({bl, horo:h.id, naves:`${h.nIni}–${h.nFin}`});
    });
  });

  // Mostrar/actualizar banner
  let banner = document.getElementById('banner-horo-omitido');
  if(omitidos.length === 0){
    banner?.remove(); return;
  }
  if(!banner){
    banner = document.createElement('div');
    banner.id = 'banner-horo-omitido';
    banner.style.cssText = 'position:sticky;top:0;z-index:150;background:#E24B4A;color:#fff;padding:10px 14px;font-size:11px;line-height:1.6;cursor:pointer';
    banner.onclick = () => {
      const b = omitidos[0];
      abrirBloque(parseInt(b.bl));
    };
    document.getElementById('body-main').prepend(banner);
  }
  const lista = omitidos.slice(0,3).map(o=>`B${o.bl}-${o.horo}`).join(', ');
  const mas   = omitidos.length>3 ? ` y ${omitidos.length-3} más` : '';
  banner.innerHTML = `⚠ <strong>Horómetros sin registrar hoy:</strong> ${lista}${mas}<br>
    <span style="font-size:10px;opacity:.85">Toca para ir al bloque · Registra antes de las 13:00 · No desaparecerá hasta registrar</span>`;
}

// Verificar al iniciar y cada 5 minutos
setInterval(checkHorometrosOmitidos, 300000);

// ── INICIO — BLOQUES ──────────────────────────
function buildInicio() {
  const ga = document.getElementById('grid-activos');
  const gi = document.getElementById('grid-inactivos');
  ga.innerHTML=''; gi.innerHTML='';
  const sem = semanaActual();
  const planSem = PLAN.filter(p=>p.semana===sem);
  let totalGuirn=0, totalAlertas=0;

  for (let b=1; b<=50; b++) {
    const info = BLOQUES[String(b)];
    const activo = !!info;
    const btn = document.createElement('button');

    // Contar guirnaldas encendidas y alertas
    let encendidas=0, alertas=0;
    if (activo) {
      const naves = info.naves;
      for (let n=1; n<=naves; n++) {
        ['A','B'].forEach(lado => {
          for (let g=1; g<=2; g++) {
            const k = gKey(b,n,lado,g);
            const gd = guirnaldas[k];
            const est = estadoGuirnalda(gd);
            if (est==='encendida') encendidas++;
            if (est==='por-vencer'||est==='apagada-auto') alertas++;
          }
        });
      }
      totalGuirn += encendidas;
      totalAlertas += alertas;
    }

    btn.className = 'blq-btn '+(activo?(alertas>0?'alerta':'activo'):'inactivo');
    btn.innerHTML = '<span class="blq-num">B'+b+'</span>' +
      '<span class="blq-sub">'+(activo&&encendidas>0?encendidas+'g':'—')+'</span>' +
      (alertas>0?'<span class="blq-dot"></span>':'');
    if (activo) btn.onclick = ()=>abrirBloque(b);
    (activo?ga:gi).appendChild(btn);
  }

  document.getElementById('cnt-act').textContent  = Object.keys(BLOQUES).length;
  document.getElementById('cnt-guirn').textContent = totalGuirn;
  document.getElementById('cnt-aler').textContent  = totalAlertas;
  if (totalAlertas>0) document.getElementById('alerta-dot').style.display='block';

  // Mostrar semana en plan
  const semCp = semanaCorta();
  document.getElementById('plan-sem-lbl').textContent =
    'Semana 20'+semCp.slice(0,2)+'-W'+semCp.slice(2)+' · '+planSem.length+' variedades';
}

// ── DETALLE BLOQUE ────────────────────────────
function abrirBloque(b) {
  bloqueAct = b;
  const info = BLOQUES[String(b)];
  if(!info) return;
  // Recalcular naves si el bloque usa medias naves
  if(info.naves === 0 && info.medias > 0) {
    info.naves = info.medias;
    if(!info.navesA || !info.navesA.length) info.navesA = Array(info.medias).fill(4);
    if(!info.navesB || !info.navesB.length) info.navesB = Array(info.medias).fill(0);
  }
  showScreen('sc-detalle');
  document.getElementById('det-title').textContent = 'Bloque '+b;
  document.getElementById('d-naves').textContent   = info.naves;
  document.getElementById('d-horos').textContent   = calcHoros(b).length;

  // Contar camas activas/pendientes y guirnaldas ON por lado
  let camA=info.ladoA||0, camB=info.ladoB||0;
  let sembA=0, sembB=0, gOnA=0, gOnB=0, al=0;
  const naves = info.naves;
  for(let n=1;n<=naves;n++){
    ['A','B'].forEach(lado=>{
      for(let g=1;g<=2;g++){
        const k=gKey(b,n,lado,g);
        const gd=guirnaldas[k];
        const est=estadoGuirnalda(gd);
        if(gd?.variedad1){
          if(lado==='A') sembA+=2; else sembB+=2;
        }
        if(est==='encendida'||est==='por-vencer'){
          if(lado==='A') gOnA++; else gOnB++;
        }
        if(est==='por-vencer'||est==='apagada-auto') al++;
      }
    });
  }
  const pendA = Math.max(0, camA-sembA);
  const pendB = Math.max(0, camB-sembB);

  document.getElementById('d-cam-a').textContent  = camA;
  document.getElementById('d-pend-a').textContent = pendA;
  document.getElementById('d-gA').textContent     = gOnA;
  document.getElementById('d-cam-b').textContent  = camB;
  document.getElementById('d-pend-b').textContent = pendB;
  document.getElementById('d-gB').textContent     = gOnB;

  renderGuirnaldas(b);
  renderHoros(b);
  renderPlanBloque();
  renderHistBloque(b);
  resetTabs();
  setNavSel('nb-bloques');
}

// ── GUIRNALDAS ────────────────────────────────
// ── GUIRNALDAS — DISEÑO VISUAL BOMBILLOS ────────────────────────────────────
function crearBombillosHTML(estado, n=10) {
  let b = '';
  for(let i=0;i<n;i++)
    b += '<div class="bombillo"><div class="b-sock"></div><div class="b-bulb"><div class="b-shine"></div><div class="b-fil"></div></div></div>';
  return `<div class="bombillos-wrap-v2"><div class="cable-h"></div><div class="bombillos-row ${estado}">${b}</div></div>`;
}

function colorCama(gd, numCama) {
  const varN = numCama===1 ? gd?.variedad1 : gd?.variedad2;
  if (!varN) return { bg:'rgba(255,255,255,.05)', borde:'rgba(255,255,255,.1)', txt:'rgba(255,255,255,.25)' };
  const est = estadoGuirnalda(gd);
  if (est==='encendida')       return { bg:'rgba(29,158,117,.25)', borde:'#5DCAA5', txt:'#9FE1CB' };
  if (est==='por-vencer')      return { bg:'rgba(245,158,11,.25)', borde:'#F59E0B', txt:'#fcd34d' };
  if (est==='apagada-auto')    return { bg:'rgba(226,75,74,.2)',   borde:'#E24B4A', txt:'#fca5a5' };
  if (est==='sembrada-apagada') return { bg:'rgba(245,158,11,.15)', borde:'#F59E0B', txt:'#fcd34d' };
  return { bg:'rgba(255,255,255,.05)', borde:'rgba(255,255,255,.1)', txt:'rgba(255,255,255,.25)' };
}

function mkCamaBox(gd, numCama, camAbs, lado) {
  const c    = colorCama(gd, numCama);
  const varN = numCama===1 ? gd?.variedad1 : gd?.variedad2;
  const aln  = lado==='A' ? 'left' : 'right';
  const txtCls = varN ? 'cama-box-txt-var' : 'cama-box-txt-empty';
  return `<div style="background:${c.bg};border:1.5px solid ${c.borde};border-radius:7px;padding:5px 8px;margin-bottom:3px;text-align:${aln}">` +
    `<div class="cama-box-txt-num" style="font-size:11px;font-weight:800;color:${c.txt}">Cama ${camAbs}</div>` +
    `<div class="${txtCls}" style="font-size:9px;color:${c.txt};opacity:.85">${varN||'Sin sembrar'}</div></div>`;
}

function camasPorNaveReal(bl, nave, lado) {
  // Obtener número exacto de camas de esta nave y lado desde el JSON
  const info = BLOQUES[String(bl)];
  if (!info) return 4;
  const naveIdx = nave - 1; // 0-indexed
  if (lado === 'A') {
    return (info.navesA && info.navesA[naveIdx]) || info.cAbase || 4;
  } else {
    return (info.navesB && info.navesB[naveIdx]) || info.cBbase || 4;
  }
}

function mkGuirnaldas(bl, nave, lado, b) {
  // Generar guirnaldas según camas reales de esa nave/lado
  const nCamas = camasPorNaveReal(bl, nave, lado);
  const base   = (nave-1)*4; // base cama absoluta aproximada
  let html = '';

  if (nCamas <= 0) {
    html += `<div style="text-align:center;padding:8px;font-size:10px;color:rgba(255,255,255,.2)">Sin camas</div>`;
    return html;
  }

  // Calcular guirnaldas: cada guirnalda cubre 2 camas
  const nGuirns = Math.ceil(nCamas / 2);
  for (let g = 1; g <= nGuirns; g++) {
    const c1abs = base + (g-1)*2 + 1;
    const c2abs = base + (g-1)*2 + 2;
    const tieneC2 = ((g-1)*2 + 2) <= nCamas;
    const k  = gKey(bl, nave, lado, g);
    const gd = guirnaldas[k] || {};
    const est = estadoGuirnalda(gd);
    const op  = est==='sin-sembrar' ? '.4' : '1';

    html += `<div onclick="abrirGuirnalda('${k}',${bl},${nave},'${lado}',${g})" style="cursor:pointer;margin-bottom:8px">`;
    html += mkCamaBox(gd, 1, c1abs, lado);
    html += `<div style="opacity:${op}">` + crearBombillosHTML(est) + `</div>`;
    if (tieneC2) {
      html += mkCamaBox(gd, 2, c2abs, lado);
    } else {
      html += `<div style="background:rgba(255,255,255,.02);border:1px dashed rgba(255,255,255,.08);border-radius:7px;padding:5px 8px;margin-bottom:3px;text-align:${lado==='A'?'left':'right'}">
        <div style="font-size:10px;color:rgba(255,255,255,.15)">— Media nave</div></div>`;
    }
    html += `</div>`;
  }
  return html;
}

function renderGuirnaldas(b) {
  const info  = BLOQUES[String(b)];
  const horos = calcHoros(b);

  let html = '<div class="leyenda-v2">';
  html += '<div class="ley-item"><div class="ley-dot" style="background:#5DCAA5"></div>En luces</div>';
  html += '<div class="ley-item"><div class="ley-dot" style="background:#F59E0B"></div>Por vencer</div>';
  html += '<div class="ley-item"><div class="ley-dot" style="background:#E24B4A"></div>Completada</div>';
  html += '<div class="ley-item"><div class="ley-dot" style="border:1.5px dashed rgba(255,255,255,.3);background:transparent"></div>Sin sembrar</div>';
  html += '</div>';

  // Encabezado fijo A / B
  html += `<div style="display:flex;margin-bottom:6px;padding:0 2px">
    <div style="flex:1;font-size:10px;font-weight:800;color:rgba(100,200,160,.9);letter-spacing:.08em">◀ LADO A</div>
    <div style="width:10px"></div>
    <div style="flex:1;font-size:10px;font-weight:800;color:rgba(220,120,120,.9);letter-spacing:.08em;text-align:right">LADO B ▶</div>
  </div>`;

  horos.forEach(h => {
    html += `<div class="nave-container" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.35);margin-bottom:10px;text-align:center;letter-spacing:.06em">
        🏠 ${h.id} · Naves ${h.nIni}–${h.nFin} · ${h.turno.inicio}–${h.turno.fin}
      </div>`;

    for (let n = h.nIni; n <= h.nFin; n++) {
      const info_bl = BLOQUES[String(b)] || {};
      const soloA   = info_bl.soloLadoA || false;
      const colA    = mkGuirnaldas(b, n, 'A', b);
      const colB    = soloA ? '<div style="text-align:center;padding:20px;font-size:11px;color:var(--txt3)">Media nave<br>Sin Lado B</div>' : mkGuirnaldas(b, n, 'B', b);

      html += `<table width="100%" style="border-collapse:collapse;margin-bottom:10px">
        <tr>
          <td style="width:48%;vertical-align:top;padding-right:4px">${colA}</td>
          <td style="width:4%;vertical-align:top">
            <div style="width:1px;background:rgba(255,255,255,.1);height:100%;margin:0 auto"></div>
          </td>
          <td style="width:48%;vertical-align:top;padding-left:4px">${colB}</td>
        </tr>
      </table>
      <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,.2);text-align:center;margin-bottom:6px">Nave ${n}</div>`;
    }
    html += `</div>`;
  });

  document.getElementById('dv-guirnaldas').innerHTML = html ||
    '<div class="empty">Sin guirnaldas configuradas</div>';
}


// ── MODAL GUIRNALDA ───────────────────────────────────────────────────────────
function abrirGuirnalda(k, bl, nave, lado, g) {
  const gd   = guirnaldas[k] || {};
  const est  = estadoGuirnalda(gd);
  const camR = camasDeGuirnalda(nave, g);
  const c1   = (nave-1)*4 + camR[0];
  const c2   = (nave-1)*4 + camR[1];
  const horo = horoDeNave(bl, nave);
  const semPlan = planSemanaActual();
  const colE = colorEstado(est);

  let html = '<div class="modal-handle"></div>';
  html += '<div class="modal-title">Bloque '+bl+' · Nave '+nave+' · Lado '+lado+'</div>';
  html += '<div style="font-size:12px;color:var(--txt2);margin-bottom:10px">Horómetro: '+(horo?horo.id+' ('+horo.turno.inicio+'–'+horo.turno.fin+')':'—')+'</div>';

  // Estado banner
  html += '<div class="banner '+(est==='encendida'?'bk':est==='apagada-auto'?'ba':est==='por-vencer'?'bw':'bb')+'" style="margin-bottom:12px">';
  html += '<div style="width:10px;height:10px;border-radius:50%;background:'+colE+';flex-shrink:0;margin-top:2px"></div>';
  html += '<div><strong>'+textoEstado(est)+'</strong>';
  if(gd.fechaIni) html += ' · Inicio: '+fmtF(gd.fechaIni);
  if(gd.fechaFin) html += ' · Fin: '+fmtF(gd.fechaFin);
  html += '</div></div>';

  // ── ESTADO DETALLADO POR CAMA ──
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">';
  [1,2].forEach(nc => {
    const camN   = nc===1?c1:c2;
    const varN   = nc===1?gd.variedad1:gd.variedad2;
    const nochN  = nc===1?gd.noches1:gd.noches2;
    const fIniN  = nc===1?gd.fechaIni1:gd.fechaIni2;
    const sembN  = !!varN;
    const bg     = sembN?'var(--vl)':'var(--g)';
    const borde  = sembN?'var(--vb)':'var(--bo)';
    html += `<div style="background:${bg};border:1.5px solid ${borde};border-radius:10px;padding:10px">
      <div style="font-size:11px;font-weight:800;color:var(--txt);margin-bottom:4px">Cama ${camN} · Lado ${lado}</div>`;
    if(sembN){
      html += `<div style="font-size:12px;font-weight:700;color:var(--vd)">${varN}</div>`;
      html += `<div style="font-size:10px;color:var(--txt2)">${nochN} noches</div>`;
      if(fIniN) html += `<div style="font-size:10px;color:var(--txt3)">Desde ${fmtF(fIniN)}</div>`;
    } else {
      html += `<div style="font-size:11px;color:var(--txt3)">Sin sembrar</div>`;
      html += `<button onclick="sembrarCamaIndividual('${k}',${bl},${nave},'${lado}',${g},${nc})"
        style="margin-top:6px;width:100%;padding:6px;background:var(--v);color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">
        + Sembrar</button>`;
    }
    html += '</div>';
  });
  html += '</div>';

  // ── PROGRESO ──
  if(gd.fechaFin && (est==='encendida'||est==='por-vencer')){
    const dr  = diasRest(gd.fechaFin);
    const pct = Math.max(0,Math.min(100,Math.round((gd.noches-Math.max(0,dr))/gd.noches*100)));
    const col = est==='por-vencer'?'var(--n)':'var(--vm)';
    html += `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;color:var(--txt2)">
        <span>Progreso ciclo</span><span>${pct}% · Faltan ${Math.max(0,dr)} noches</span>
      </div>
      <div class="prog"><div class="prog-f" style="width:${pct}%;background:${col}"></div></div>
    </div>`;
  }

  html += '<button class="btn-outline" onclick="cerrarModal()">Cerrar</button>';
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('show');
}

// ── FORMULARIO SIEMBRA INDIVIDUAL POR CAMA ──
function sembrarCamaIndividual(k, bl, nave, lado, g, numCama) {
  const gd     = guirnaldas[k] || {};
  const camR   = camasDeGuirnalda(nave, g);
  const camAbs = numCama===1 ? (nave-1)*4+camR[0] : (nave-1)*4+camR[1];
  const semPlan = planSemanaActual();

  let html = '<div class="modal-handle"></div>';
  html += `<div class="modal-title">Sembrar Cama ${camAbs} · Lado ${lado}</div>`;
  html += `<div style="font-size:12px;color:var(--txt2);margin-bottom:12px">Bloque ${bl} · Nave ${nave} · Guirnalda ${numCama===1?'primera':'segunda'} cama</div>`;

  // Si ya hay otra cama sembrada mostrar info
  const otraVar  = numCama===1?gd.variedad2:gd.variedad1;
  const otraFin  = gd.fechaFin;
  if(otraVar){
    html += `<div class="banner bb" style="margin-bottom:10px"><span>ℹ️</span>
      <span>Cama adyacente: <strong>${otraVar}</strong> · Fin actual: ${fmtF(otraFin)}<br>
      La fecha fin se recalculará con MAX(ambas camas).</span></div>`;
  }

  // Selector variedad — primero las del plan
  html += '<div class="field"><label>Variedad de la semana</label>';
  html += `<select id="ind-var" onchange="updateSiembraIndividual('${k}',${numCama})">`;
  html += '<option value="">Selecciona variedad...</option>';
  if(semPlan.length){
    html += '<optgroup label="── Plan semana actual ──">';
    semPlan.forEach(p=>{
      html+=`<option value="${p.variedad}" data-noches="${p.noches}">${p.variedad} (${p.noches}n · ${p.cantidad}c)</option>`;
    });
    html += '</optgroup>';
  }
  html += '<optgroup label="── Todas las variedades ──">';
  Object.entries(VARIEDADES).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([v,n])=>{
    html+=`<option value="${v}" data-noches="${n}">${v} (${n} noches)</option>`;
  });
  html += '</optgroup></select></div>';

  html += '<div id="ind-result" style="display:none" class="result-box"></div>';
  html += `<button class="btn-g" onclick="confirmarSiembraIndividual('${k}',${bl},${nave},'${lado}',${g},${numCama})">
    ⚡ Registrar y encender guirnalda</button>`;
  // Opción agregar variedad nueva (si no está en plan semana)
  html += `<div style="margin-top:10px;border-top:1px solid var(--bo);padding-top:10px">
    <div style="font-size:10px;color:var(--txt3);margin-bottom:6px">¿No encuentras la variedad en el plan?</div>
    <button class="btn-outline" onclick="mostrarFormNuevaVariedad('${k}',${bl},${nave},'${lado}',${g},${numCama})"
      style="font-size:12px;padding:8px">+ Agregar variedad nueva</button>
  </div>`;
  html += `<button class="btn-outline" style="margin-top:6px" onclick="abrirGuirnalda('${k}',${bl},${nave},'${lado}',${g})">Volver</button>`;

  document.getElementById('modal-body').innerHTML = html;
}

// ── FORMULARIO NUEVA VARIEDAD ──────────────────────────
function mostrarFormNuevaVariedad(k, bl, nave, lado, g, numCama) {
  let html = '<div class="modal-handle"></div>';
  html += '<div class="modal-title">+ Nueva variedad</div>';
  html += `<div style="font-size:12px;color:var(--txt2);margin-bottom:12px">
    La variedad se agregará al catálogo con las noches indicadas.</div>`;
  html += `<div class="field"><label>Nombre de la variedad</label>
    <input type="text" id="nv-nombre" placeholder="Ej: Atlantis Pink" autocomplete="off"
      style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase()">
  </div>`;
  html += `<div class="field"><label>Noches de luz</label>
    <div style="display:flex;align-items:center;gap:8px">
      <button onclick="ajustarNochesNV(-1)"
        style="width:36px;height:36px;border-radius:50%;border:1.5px solid var(--bo);background:var(--g);font-size:20px;cursor:pointer;color:var(--r)">−</button>
      <input type="number" id="nv-noches" value="19" min="1" max="99" inputmode="numeric"
        style="flex:1;text-align:center;padding:10px;border:2px solid var(--bo);border-radius:10px;font-size:18px;font-weight:800;background:var(--g)">
      <button onclick="ajustarNochesNV(1)"
        style="width:36px;height:36px;border-radius:50%;border:1.5px solid var(--bo);background:var(--g);font-size:20px;cursor:pointer;color:var(--vm)">+</button>
    </div>
    <div style="font-size:10px;color:var(--txt3);margin-top:4px;text-align:center">Promedio catálogo: 19 noches</div>
  </div>`;
  html += `<div class="msg" id="msg-nv"></div>`;
  html += `<button class="btn-g" onclick="guardarNuevaVariedad('${k}',${bl},${nave},'${lado}',${g},${numCama})">
    Guardar variedad y sembrar</button>`;
  html += `<button class="btn-outline" style="margin-top:6px"
    onclick="sembrarCamaIndividual('${k}',${bl},${nave},'${lado}',${g},${numCama})">Volver</button>`;
  document.getElementById('modal-body').innerHTML = html;
}

function ajustarNochesNV(delta) {
  const inp = document.getElementById('nv-noches');
  if(!inp) return;
  inp.value = Math.max(1, Math.min(99, parseInt(inp.value||19)+delta));
}

async function guardarNuevaVariedad(k, bl, nave, lado, g, numCama) {
  const nombre = document.getElementById('nv-nombre')?.value?.trim().toUpperCase();
  const noches = parseInt(document.getElementById('nv-noches')?.value||19);
  const msg    = document.getElementById('msg-nv');
  if(!nombre || nombre.length < 2) {
    msg.textContent='Ingresa el nombre de la variedad.';
    msg.className='msg err'; msg.style.display='block'; return;
  }
  if(VARIEDADES[nombre]){
    msg.textContent=`"${nombre}" ya existe con ${VARIEDADES[nombre]} noches.`;
    msg.className='msg err'; msg.style.display='block'; return;
  }
  // Agregar al catálogo en memoria y en IndexedDB
  VARIEDADES[nombre] = noches;
  const custom = JSON.parse(await getConfig('variedades_custom')||'{}');
  custom[nombre] = noches;
  await setConfig('variedades_custom', JSON.stringify(custom));
  await addToSyncQueue('variedades', VARIEDADES);
  // Agregar al plan de la semana actual
  const sem = semanaCorta();
  PLAN.push({ variedad:nombre, semana:sem, cantidad:1, noches });
  msg.textContent=`✓ "${nombre}" agregada. Sembrando...`;
  msg.className='msg ok'; msg.style.display='block';
  // Seleccionar automáticamente y sembrar
  setTimeout(async () => {
    // Simular selección de la nueva variedad
    const gdActual = guirnaldas[k] || {};
    const finEsta  = addDias(hoy(), noches);
    let fechaFin   = finEsta;
    if(gdActual.fechaFin && gdActual.fechaFin > finEsta) fechaFin = gdActual.fechaFin;
    const gd = { ...gdActual, id:k, bloque:bl, nave, lado, g, encendida:true, fechaFin };
    if(numCama===1){ gd.variedad1=nombre; gd.noches1=noches; gd.fechaIni1=hoy(); if(!gd.fechaIni) gd.fechaIni=hoy(); }
    else           { gd.variedad2=nombre; gd.noches2=noches; gd.fechaIni2=hoy(); if(!gd.fechaIni) gd.fechaIni=hoy(); }
    gd.noches = Math.ceil((new Date(fechaFin)-new Date(gd.fechaIni))/86400000);
    guirnaldas[k] = gd;
    await dbPut('guirnaldas', gd);
    const gpsRes = await gpsValidar(bl);
    const camR   = camasDeGuirnalda(nave, g);
    const camAbs = numCama===1?(nave-1)*4+camR[0]:(nave-1)*4+camR[1];
    await dbAdd('siembras',{bloque:bl,nave,lado,g,key:k,cama:camAbs,numCama,
      variedad:nombre,noches,fechaIni:hoy(),fechaFinGuirnalda:fechaFin,
      operario,gps:gpsRes.punto,gpsValido:gpsRes.valid,fecha:new Date().toISOString()});
    await addToSyncQueue('siembra', gd);
    cerrarModal(); renderGuirnaldas(bl); abrirBloque(bl);
  }, 800);
}

// ── AGREGAR VARIEDAD NUEVA ──────────────────────────────────────────────────
function abrirAgregarVariedad(k, numCama) {
  let html = '<div class="modal-handle"></div>';
  html += '<div class="modal-title">➕ Nueva variedad</div>';
  html += '<div style="font-size:12px;color:var(--txt2);margin-bottom:12px">Agrega una variedad que no está en el plan de esta semana</div>';
  html += '<div class="field"><label>Nombre de la variedad</label>';
  html += '<input type="text" id="nueva-var-nombre" placeholder="Ej: Maisy Lime" style="padding:12px;border:2px solid var(--bo);border-radius:10px;width:100%;font-size:14px;background:var(--g);color:var(--txt)">';
  html += '</div>';
  html += '<div class="field"><label>Noches de luz requeridas</label>';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  html += '<button onclick="ajustarNuevaVar(-1)" style="width:40px;height:40px;border-radius:50%;border:2px solid var(--bo);background:var(--bg2);font-size:20px;cursor:pointer;color:var(--r);flex-shrink:0">−</button>';
  html += '<input type="number" id="nueva-var-noches" value="19" min="1" max="99" style="flex:1;padding:12px;border:2px solid var(--bo);border-radius:10px;font-size:20px;font-weight:800;text-align:center;background:var(--g);color:var(--txt)">';
  html += '<button onclick="ajustarNuevaVar(1)" style="width:40px;height:40px;border-radius:50%;border:2px solid var(--bo);background:var(--bg2);font-size:20px;cursor:pointer;color:var(--vm);flex-shrink:0">+</button>';
  html += '</div></div>';
  html += `<button class="btn-g" onclick="guardarNuevaVariedad('${k}',${numCama})">Guardar variedad</button>`;
  html += '<div class="msg" id="msg-nueva-var"></div>';
  html += `<button class="btn-outline" style="margin-top:8px" onclick="sembrarCamaIndividual('${k}',0,0,'',0,${numCama})">Volver</button>`;
  document.getElementById('modal-body').innerHTML = html;
}

function ajustarNuevaVar(delta) {
  const inp = document.getElementById('nueva-var-noches');
  if(!inp) return;
  inp.value = Math.max(1, Math.min(99, parseInt(inp.value||19)+delta));
}

async function guardarNuevaVariedad(k, numCama) {
  const nombre = document.getElementById('nueva-var-nombre')?.value?.trim();
  const noches = parseInt(document.getElementById('nueva-var-noches')?.value||19);
  const msg    = document.getElementById('msg-nueva-var');
  if(!nombre){ msg.textContent='Escribe el nombre de la variedad.'; msg.className='msg err'; msg.style.display='block'; return; }
  if(VARIEDADES[nombre]){ msg.textContent='Esta variedad ya existe en el catálogo.'; msg.className='msg err'; msg.style.display='block'; return; }

  // Guardar en catálogo local
  VARIEDADES[nombre] = noches;
  await setConfig('variedades_custom', JSON.stringify(VARIEDADES));
  await addToSyncQueue('variedades', VARIEDADES);

  msg.textContent = `✓ "${nombre}" agregada con ${noches} noches.`;
  msg.className = 'msg ok'; msg.style.display = 'block';
  setTimeout(() => {
    // Volver al selector ya con la nueva variedad disponible
    const gdParts = k.split('_');
    // Reabrir el formulario de siembra con la nueva var preseleccionada
    document.getElementById('modal-overlay').classList.remove('show');
  }, 1500);
}

function updateSiembraIndividual(k, numCama) {
  const sel   = document.getElementById('ind-var');
  const res   = document.getElementById('ind-result');
  if(!sel?.value){ res.style.display='none'; return; }
  const gd    = guirnaldas[k] || {};
  const var1  = sel.value;
  const noch1 = parseInt(sel.selectedOptions[0]?.dataset?.noches||19);
  const otraFin = gd.fechaFin;
  const estaFin = addDias(hoy(), noch1);
  const finFinal= otraFin ? (estaFin>otraFin?estaFin:otraFin) : estaFin;
  res.style.display='block';
  res.innerHTML =
    `<div class="rb-row"><span class="rb-key">Variedad</span><span class="rb-val">${var1}</span></div>`+
    `<div class="rb-row"><span class="rb-key">Noches</span><span class="rb-val">${noch1} noches</span></div>`+
    `<div class="rb-row"><span class="rb-key">Fin esta cama</span><span class="rb-val">${fmtF(estaFin)}</span></div>`+
    (otraFin?`<div class="rb-row"><span class="rb-key">Fin cama adyacente</span><span class="rb-val">${fmtF(otraFin)}</span></div>`:'' )+
    `<div class="rb-row"><span class="rb-key" style="color:var(--v);font-weight:800">Fecha fin guirnalda</span><span class="rb-val" style="color:var(--v)">${fmtF(finFinal)} (más tardía)</span></div>`+
    '<div class="banner bk" style="margin-top:6px"><span>⚡</span><span>Guirnalda se enciende automáticamente.</span></div>';
}

async function confirmarSiembraIndividual(k, bl, nave, lado, g, numCama) {
  const sel = document.getElementById('ind-var');
  if(!sel?.value){ alert('Selecciona una variedad'); return; }
  const varN  = sel.value;
  const nochN = parseInt(sel.selectedOptions[0]?.dataset?.noches||19);
  const gd    = guirnaldas[k] || {};

  // Calcular fecha fin para esta cama
  const finEsta = addDias(hoy(), nochN);

  // Recalcular MAX con la otra cama si existe
  let fechaFin = finEsta;
  if(gd.fechaFin && gd.fechaFin > finEsta) fechaFin = gd.fechaFin;

  // Construir objeto actualizado
  const gdActual = { ...gd,
    id:k, bloque:bl, nave, lado, g,
    encendida:true,
    fechaFin,
    noches: Math.ceil((new Date(fechaFin)-new Date(gd.fechaIni||hoy()))/86400000)
  };

  if(numCama===1){
    gdActual.variedad1 = varN;
    gdActual.noches1   = nochN;
    gdActual.fechaIni1 = hoy();
    if(!gdActual.fechaIni) gdActual.fechaIni = hoy();
  } else {
    gdActual.variedad2 = varN;
    gdActual.noches2   = nochN;
    gdActual.fechaIni2 = hoy();
    if(!gdActual.fechaIni) gdActual.fechaIni = hoy();
  }

  guirnaldas[k] = gdActual;
  await dbPut('guirnaldas', gdActual);

  const gpsRes = await gpsValidar(bl);
  const camR   = camasDeGuirnalda(nave, g);
  const camAbs = numCama===1 ? (nave-1)*4+camR[0] : (nave-1)*4+camR[1];

  await dbAdd('siembras', {
    bloque:bl, nave, lado, g, key:k, cama:camAbs, numCama,
    variedad:varN, noches:nochN,
    fechaIni:hoy(), fechaFinGuirnalda:fechaFin,
    operario, gps:gpsRes.punto, gpsValido:gpsRes.valid,
    fecha:new Date().toISOString()
  });
  await addToSyncQueue('siembra', gdActual);

  cerrarModal();
  renderGuirnaldas(bl);
  abrirBloque(bl);
}

function updateGuirnResult(k) {
  // Mantener compatibilidad — ya no se usa directamente
}

async function registrarSiembra(k, bl, nave, lado, g) {
  // Redirigir al nuevo flujo por cama individual
  sembrarCamaIndividual(k, bl, nave, lado, g, 1);
}

// ── HORÓMETROS ────────────────────────────────
function renderHoros(b) {
  const horos = calcHoros(b);
  let html = '';
  let algunoActivo = false;
  horos.forEach(h=>{
    const key = b+'_'+h.id;
    const lect = lecturas[key] || {};
    const diff = lect.hoy>0 && lect.ayer>=0 ? parseFloat((lect.hoy-lect.ayer).toFixed(2)) : null;
    const esAl = diff!==null && diff<CFG.horoMinimo;
    const esAv = diff!==null && !esAl && diff<CFG.horoMinimo*1.3;
    const col  = diff===null?'var(--ts)':esAl?'var(--r)':esAv?'var(--n)':'var(--vm)';
    const dcls = diff===null?'':esAl?'d-al':esAv?'d-av':'d-ok';

    // Contar guirnaldas encendidas en este horómetro
    let gEnc=0, gVence=0;
    for(let n=h.nIni;n<=h.nFin;n++){
      ['A','B'].forEach(lado=>{
        for(let g=1;g<=2;g++){
          const est=estadoGuirnalda(guirnaldas[gKey(b,n,lado,g)]);
          if(est==='encendida') gEnc++;
          if(est==='por-vencer') gVence++;
        }
      });
    }

    // ── HORÓMETRO INACTIVO (sin guirnaldas encendidas) ──
    if(gEnc===0 && gVence===0){
      html += `<div class="card" style="opacity:.45;border-style:dashed">
        <div class="card-top">
          <div>
            <div class="card-name" style="color:var(--ts)">${h.id}</div>
            <div class="card-sub">Naves ${h.nIni}–${h.nFin} · Sin guirnaldas activas</div>
          </div>
          <span class="badge b-gr">Inactivo</span>
        </div>
        <div class="turno-chip">
          <span class="tc-k">Turno</span><span class="tc-v">${h.turno.inicio}–${h.turno.fin}</span>
          <span class="tc-k">Estado</span><span class="tc-v" style="color:var(--ts)">Sin camas en luces</span>
        </div>
        <div style="text-align:center;padding:10px;font-size:12px;color:var(--ts)">
          ⚫ Este horómetro no tiene guirnaldas encendidas.<br>No requiere lectura.
        </div>
      </div>`;
      return;
    }

    algunoActivo = true;
    const cls = diff===null?'':esAl?'alerta':esAv?'aviso':'ok';
    html += '<div class="card '+cls+'">';
    html += '<div class="card-top"><div><div class="card-name">'+h.id+'</div>';
    html += '<div class="card-sub">Naves '+h.nIni+'–'+h.nFin+' · '+gEnc+' guirnaldas encendidas</div></div>';
    html += '<span class="badge '+(diff===null?'b-gr':esAl?'b-al':esAv?'b-av':'b-ok')+'">'+(diff===null?'Sin lectura':esAl?'Alerta':esAv?'Revisar':'Normal')+'</span></div>';
    html += '<div class="turno-chip"><span class="tc-k">Turno</span><span class="tc-v">'+h.turno.inicio+'–'+h.turno.fin+'</span><span class="tc-k">Mín.</span><span class="tc-v">'+CFG.horoMinimo+' h</span></div>';
    html += '<div class="horo-big" style="color:'+col+'">'+(lect.hoy||0).toFixed(1)+' h</div>';
    html += '<div class="diff-row"><span>Ayer: '+(lect.ayer||0).toFixed(1)+' h</span>';
    html += diff!==null?'<span class="'+dcls+'">'+(diff>=0?'+':'')+diff.toFixed(2)+' h hoy</span>':'<span style="color:var(--ts)">Ingrese lectura</span>';
    html += '</div>';
    if(diff!==null){
      const pct=Math.min(100,Math.round(diff/CFG.horoMinimo*50));
      html+='<div class="prog"><div class="prog-f" style="width:'+pct+'%;background:'+col+'"></div></div>';
      if(esAl) html+='<div class="banner ba"><span>⚠</span><span>Horas hoy ('+diff.toFixed(2)+' h) bajo mínimo ('+CFG.horoMinimo+' h). Verificar sistema de luces.</span></div>';
    }
    html += '<div class="field" style="margin-top:8px"><label>Lectura de hoy (h acumuladas)</label>';
    html += '<input type="number" step="0.1" inputmode="decimal" placeholder="Ej: '+(((lect.hoy||0)+10).toFixed(1))+'" id="inp-'+b+'-'+h.id+'"></div>';
    html += '<div class="field"><label>Observación (opcional)</label>';
    html += '<input type="text" placeholder="Ej: bombillo intermitente" id="obs-'+b+'-'+h.id+'"></div>';
    html += '<button class="btn-g" onclick="guardarHoro('+b+',\''+h.id+'\')">Guardar lectura</button>';
    html += '<div class="msg" id="msg-'+b+'-'+h.id+'"></div></div>';
  });
  if(!algunoActivo && html.length > 0) {
    html = `<div class="banner bw" style="border-radius:10px;margin-bottom:10px">
      <span>⚠</span>
      <span>Ningún horómetro tiene guirnaldas encendidas en este bloque. Registra siembras primero.</span>
    </div>` + html;
  }
  document.getElementById('dv-horometros').innerHTML = html ||
    '<div class="empty">Sin horómetros configurados</div>';
}

async function guardarHoro(b, hid) {
  const inp = document.getElementById('inp-'+b+'-'+hid);
  const obs = document.getElementById('obs-'+b+'-'+hid);
  const msg = document.getElementById('msg-'+b+'-'+hid);
  if(!inp?.value){ msg.textContent='Ingresa la lectura.'; msg.className='msg err'; msg.style.display='block'; return; }
  const val = parseFloat(inp.value);
  const key = b+'_'+hid;
  msg.textContent='Guardando...'; msg.className='msg ok'; msg.style.display='block';
  const gpsRes = await gpsValidar(b);
  const lect = lecturas[key]||{ayer:0,hoy:0};
  const diff = parseFloat((val-lect.hoy).toFixed(2));
  lecturas[key] = { ayer: lect.hoy, hoy: val };
  const reg = { bloque:b, horometro:hid, lectura:val, diff, operario,
    observacion:obs?.value||'', fecha:new Date().toISOString(),
    gps:gpsRes.punto, gpsValido:gpsRes.valid };
  await dbAdd('lecturas', reg);
  await addToSyncQueue('lectura', reg);
  const esAl = diff < CFG.horoMinimo;
  msg.textContent = esAl?'Guardado. ⚠ Alerta: '+diff.toFixed(2)+' h bajo mínimo.':'Guardado — '+diff.toFixed(2)+' h registradas.';
  if(inp) inp.value='';
  renderHoros(b);
}

// ── PLAN DE SIEMBRAS ──────────────────────────
function renderPlanBloque() {
  const sem    = semanaCorta();
  const plan   = planSemanaActual();
  let html = '';
  html += '<div class="plan-week"><span class="plan-week-lbl">Semana actual</span><span class="plan-week-val">20'+sem.slice(0,2)+'-W'+sem.slice(2)+'</span></div>';

  if(!plan.length){
    html += '<div class="empty">Sin siembras planeadas esta semana.</div>';
  } else {
    html += '<div class="card"><div class="sec-lbl" style="margin-bottom:8px">Variedades a sembrar esta semana</div>';
    plan.forEach(p=>{
      html += '<div class="plan-item"><div>';
      html += '<div class="plan-var">'+p.variedad+'</div>';
      html += '<div class="plan-detail">'+p.noches+' noches de luz</div></div>';
      html += '<div class="plan-right"><div class="plan-camas">'+p.cantidad+'</div>';
      html += '<div class="plan-noches">camas</div></div></div>';
    });
    html += '</div>';
  }
  document.getElementById('dv-plan').innerHTML = html;
}

// ── HISTORIAL ─────────────────────────────────
async function renderHistBloque(b) {
  const siembras = await dbGetAll('siembras');
  const del = siembras.filter(s=>s.bloque===b).sort((a,c)=>new Date(c.fecha)-new Date(a.fecha)).slice(0,20);
  let html = '<div class="card">';
  if(!del.length){
    html += '<div class="empty">Sin siembras registradas aún.</div>';
  } else {
    del.forEach(s=>{
      const f=new Date(s.fecha);
      const fStr=f.getDate()+'/'+(f.getMonth()+1)+' '+f.getHours()+':'+String(f.getMinutes()).padStart(2,'0');
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--bo)">';
      html += '<div><div style="font-size:12px;font-weight:700">N'+s.nave+' C'+s.cama1+'-'+s.cama2+' L'+s.lado+'</div>';
      html += '<div style="font-size:10px;color:var(--ts)">'+s.variedad1+(s.variedad2!==s.variedad1?' / '+s.variedad2:'')+'</div></div>';
      html += '<div style="text-align:right"><div style="font-size:11px;font-weight:700;color:var(--vm)">'+s.noches+'n</div>';
      html += '<div style="font-size:10px;color:var(--ts)">'+fStr+'</div></div></div>';
    });
  }
  html += '</div>';
  document.getElementById('dv-hist').innerHTML = html;
}

// ── ALERTAS ───────────────────────────────────
function renderAlertas() {
  let html='';
  Object.entries(guirnaldas).forEach(([k,gd])=>{
    const est = estadoGuirnalda(gd);
    if(est==='por-vencer'||est==='apagada-auto'){
      const dr=diasRest(gd.fechaFin);
      const esVenc=dr<0;
      html+='<div class="alert-item '+(esVenc?'ba':'bw')+'" style="border-radius:10px;margin-bottom:8px;cursor:pointer" onclick="abrirBloque('+gd.bloque+')">';
      html+='<div style="width:10px;height:10px;border-radius:50%;background:'+(esVenc?'var(--r)':'var(--n))');
      html+='flex-shrink:0;margin-top:2px"></div>';
      html+='<div><div style="font-size:13px;font-weight:700">B'+gd.bloque+' · G'+gd.nave+gd.lado+gd.g+'</div>';
      html+='<div style="font-size:11px;line-height:1.6">'+gd.variedad1+(gd.variedad2!==gd.variedad1?' / '+gd.variedad2:'')+'<br>';
      html+=esVenc?'⚠ Venció hace '+Math.abs(dr)+' días':'⏱ Vence en '+dr+' noches';
      html+=' · Fin: '+fmtF(gd.fechaFin)+'<br>Toca para ir al bloque ›</div></div></div>';
    }
  });
  if(!html) html='<div class="banner bk" style="border-radius:10px"><span>✓</span><span>Sin alertas activas.</span></div>';
  document.getElementById('alertas-content').innerHTML=html;
}

// ── MODAL ─────────────────────────────────────
function cerrarModal(){document.getElementById('modal-overlay').classList.remove('show');}
function cerrarOverlay(e){if(e.target===document.getElementById('modal-overlay'))cerrarModal();}

// ── EDITAR NOCHES DE LUZ ─────────────────────
function abrirEditorNoches() {
  const vars = Object.entries(VARIEDADES).sort((a,b)=>a[0].localeCompare(b[0]));
  let html = '<div class="modal-handle"></div>';
  html += '<div class="modal-title">✏️ Editar noches de luz</div>';
  html += '<div class="banner bb" style="margin-bottom:10px"><span>ℹ️</span>';
  html += '<span>Modifica las noches de luz. El cambio se aplica en nuevas siembras.</span></div>';
  html += '<input type="text" id="search-var-edit" placeholder="🔍 Buscar variedad..." ';
  html += 'oninput="filtrarEditorNoches(this.value)" ';
  html += 'style="width:100%;padding:10px 12px;border:2px solid var(--bo);border-radius:10px;font-size:14px;background:var(--g);margin-bottom:10px">';
  html += '<div id="vars-edit-list" style="max-height:380px;overflow-y:auto">';
  vars.forEach(([nombre, noches]) => {
    const safeId = 'noch-'+nombre.replace(/[^a-zA-Z0-9]/g,'_');
    const safeName = nombre.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    html += '<div class="var-edit-row" data-nombre="'+nombre.toLowerCase()+'" ';
    html += 'style="display:flex;align-items:center;padding:7px 0;border-bottom:1px solid var(--bo);gap:8px">';
    html += '<div style="flex:1;font-size:12px;font-weight:600">'+nombre+'</div>';
    html += '<button onclick="cambiarNoches(\''+safeName+'\', -1)" ';
    html += 'style="width:28px;height:28px;border-radius:50%;border:1.5px solid var(--bo);background:#fff;font-size:18px;cursor:pointer;color:var(--r);flex-shrink:0">−</button>';
    html += '<input type="number" id="'+safeId+'" value="'+noches+'" min="1" max="99" ';
    html += 'onchange="actualizarNochesInput(\''+safeName+'\')" ';
    html += 'style="width:46px;text-align:center;padding:5px 2px;border:1.5px solid var(--bo);border-radius:8px;font-size:14px;font-weight:700;background:var(--g)">';
    html += '<button onclick="cambiarNoches(\''+safeName+'\', 1)" ';
    html += 'style="width:28px;height:28px;border-radius:50%;border:1.5px solid var(--bo);background:#fff;font-size:18px;cursor:pointer;color:var(--vm);flex-shrink:0">+</button>';
    html += '</div>';
  });
  html += '</div>';
  html += '<button class="btn-g" style="margin-top:12px" onclick="guardarCambiosNoches()">Guardar cambios</button>';
  html += '<div class="msg" id="msg-noches"></div>';
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('show');
}

function filtrarEditorNoches(val) {
  const v = val.toLowerCase();
  document.querySelectorAll('.var-edit-row').forEach(r => {
    r.style.display = r.dataset.nombre.includes(v) ? '' : 'none';
  });
}

function cambiarNoches(nombre, delta) {
  const id = 'noch-'+nombre.replace(/[^a-zA-Z0-9]/g,'_');
  const inp = document.getElementById(id);
  if(!inp) return;
  const nuevo = Math.max(1, Math.min(99, parseInt(inp.value||19) + delta));
  inp.value = nuevo;
  VARIEDADES[nombre] = nuevo;
}

function actualizarNochesInput(nombre) {
  const id = 'noch-'+nombre.replace(/[^a-zA-Z0-9]/g,'_');
  const inp = document.getElementById(id);
  if(!inp) return;
  const v = Math.max(1, Math.min(99, parseInt(inp.value)||19));
  inp.value = v;
  VARIEDADES[nombre] = v;
}

async function guardarCambiosNoches() {
  await setConfig('variedades_custom', JSON.stringify(VARIEDADES));
  await addToSyncQueue('variedades', VARIEDADES);
  const msg = document.getElementById('msg-noches');
  if(msg){ msg.textContent='✓ Guardado. Se aplica en nuevas siembras.'; msg.className='msg ok'; msg.style.display='block'; }
}

async function cargarNochesCustom() {
  const custom = await getConfig('variedades_custom');
  if(custom) Object.assign(VARIEDADES, JSON.parse(custom));
}

// ── NAVEGACIÓN ────────────────────────────────
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('show'));document.getElementById(id).classList.add('show');}
function setNavSel(id){document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('sel'));document.getElementById(id)?.classList.add('sel');}
function resetTabs(){
  document.querySelectorAll('.dtab').forEach(t=>t.classList.remove('sel'));
  document.querySelectorAll('.dview').forEach(v=>v.classList.remove('show'));
  document.querySelectorAll('.dtab')[0].classList.add('sel');
  document.getElementById('dv-guirnaldas').classList.add('show');
}
function switchDT(id,el){
  document.querySelectorAll('.dtab').forEach(t=>t.classList.remove('sel'));
  document.querySelectorAll('.dview').forEach(v=>v.classList.remove('show'));
  el.classList.add('sel');
  document.getElementById('dv-'+id).classList.add('show');
  if(id==='hist') renderHistBloque(bloqueAct);
  if(id==='radio') renderRadioBloque(bloqueAct);
}
function volver(){showScreen('sc-inicio');setNavSel('nb-bloques');}
function irBloques(){showScreen('sc-inicio');setNavSel('nb-bloques');}
function irAlertas(){showScreen('sc-alertas');renderAlertas();setNavSel('nb-alertas');}
function irPlan(){showScreen('sc-plan-global');renderPlanGlobal();setNavSel('nb-plan');}
function irDashboard(){
  if(!tienePermiso('ver_dashboard_gerencial')&&!tienePermiso('ver_dashboard_basico')) return;
  showScreen('sc-dashboard');
  renderDashboard();
  setNavSel('nb-dash');
}
function irConfig(){
  if(!tienePermiso('cambiar_pines')) return;
  showScreen('sc-config');
  renderConfig();
  setNavSel('nb-config');
}
function irRadiometria(){
  if(!tienePermiso('medir_radiometria')) return;
  showScreen('sc-radio-global');
  renderRadioGlobal();
  setNavSel('nb-radio');
}

function renderPlanGlobal(){
  const sem=semanaCorta();
  const plan=planSemanaActual();
  let html='<div class="plan-week"><span class="plan-week-lbl">Semana actual</span><span class="plan-week-val">20'+sem.slice(0,2)+'-W'+sem.slice(2)+'</span></div>';
  if(!plan.length){ html+='<div class="empty">Sin siembras planeadas esta semana.</div>'; }
  else {
    const total=plan.reduce((s,p)=>s+p.cantidad,0);
    html+='<div class="banner bb" style="border-radius:10px;margin-bottom:10px"><span>📋</span><span>'+plan.length+' variedades · '+total+' camas total esta semana</span></div>';
    html+='<div class="card">';
    plan.forEach(p=>{
      html+='<div class="plan-item"><div><div class="plan-var">'+p.variedad+'</div><div class="plan-detail">'+p.noches+' noches de luz</div></div>';
      html+='<div class="plan-right"><div class="plan-camas">'+p.cantidad+'</div><div class="plan-noches">camas</div></div></div>';
    });
    html+='</div>';
  }
  document.getElementById('plan-global-content').innerHTML=html;
}

// ── SERVICE WORKER ────────────────────────────
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('SW:',e));
}

// ── INIT ──────────────────────────────────────
function renderConfig() {
  const wrap = document.getElementById('config-content');
  let html = '';

  // ── INFO CONEXIÓN ──
  const conectado = !!SHEETS_URL;
  html += `<div class="banner ${conectado?'bk':'bw'}" style="border-radius:10px;margin-bottom:12px">
    <span>${conectado?'✓':'⚠'}</span>
    <span>${conectado
      ? 'Sincronización con Google Sheets activa.'
      : 'Sincronización no configurada. Contacta al administrador.'}</span>
  </div>`;

  // ── CAMBIAR PINes ──
  html += '<div class="sec-lbl">Gestión de PINes</div>';
  html += '<div class="card" style="margin-bottom:10px">';
  html += `<div class="banner bb" style="margin-bottom:10px;font-size:11px">
    <span>🔑</span>
    <span>Deja el campo vacío para mantener el PIN actual.</span>
  </div>`;
  Object.entries(PINES_CONFIG).forEach(([pin, r]) => {
    const rol_info = ROLES[r];
    const pinMask = '●'.repeat(pin.length);
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bo);gap:8px">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:${rol_info?.color||'#888'}">${rol_info?.label||r}</div>
        <div style="font-size:10px;color:var(--ts)">PIN: ${pinMask}</div>
      </div>
      <input type="tel" maxlength="4" inputmode="numeric" placeholder="Nuevo PIN"
        id="pin-new-${pin}"
        style="width:90px;padding:9px;border:1.5px solid var(--bo);border-radius:8px;text-align:center;font-size:15px;font-weight:700;background:var(--g)">
    </div>`;
  });
  html += `<button class="btn-g" style="margin-top:10px" onclick="guardarPinesNuevos()">Guardar PINes</button>`;
  html += `<div class="msg" id="msg-pines"></div>`;
  html += '</div>';

  // ── SINCRONIZAR ──
  html += '<div class="sec-lbl">Sincronización</div>';
  html += '<div class="card" style="margin-bottom:10px">';
  html += `<button class="btn-g" onclick="sincronizarManual()">↑ Sincronizar ahora con Sheets</button>`;
  html += `<div class="msg" id="msg-sync"></div>`;
  html += '</div>';

  // ── RESETEO DATOS DE PRUEBA ──
  html += '<div class="sec-lbl">Datos de prueba</div>';
  html += '<div class="card" style="margin-bottom:10px">';
  html += `<div class="banner bw" style="margin-bottom:10px">
    <span>⚠</span>
    <span>Esto borra SOLO las guirnaldas registradas. No afecta lecturas de horómetros ni radiometría.</span>
  </div>`;
  html += `<button class="btn-outline" style="color:var(--r);border-color:var(--r)" onclick="resetGuirnaldas()">
    🗑 Borrar guirnaldas de prueba
  </button>`;
  html += `<div class="msg" id="msg-reset"></div>`;
  html += '</div>';

  wrap.innerHTML = html;
}

async function sincronizarManual() {
  const msg = document.getElementById('msg-sync');
  if (!SHEETS_URL) {
    msg.textContent = '⚠ Sin conexión a Sheets. Contacta al administrador.';
    msg.className = 'msg err'; msg.style.display = 'block'; return;
  }
  if (!navigator.onLine) {
    msg.textContent = '⚠ Sin internet. Conéctate al WiFi de la oficina.';
    msg.className = 'msg err'; msg.style.display = 'block'; return;
  }
  msg.textContent = 'Sincronizando...'; msg.className = 'msg ok'; msg.style.display = 'block';
  const res = await syncConSheets();
  msg.textContent = res.ok
    ? `✓ ${res.enviados||0} registros sincronizados correctamente.`
    : '⚠ Error al sincronizar. Verifica la conexión.';
}

async function resetGuirnaldas() {
  const msg = document.getElementById('msg-reset');
  const confirmar = confirm('¿Borrar todas las guirnaldas registradas?\n\nEsto NO borra lecturas de horómetros ni radiometría.');
  if (!confirmar) return;
  // Borrar solo el store de guirnaldas
  await dbClear('guirnaldas');
  guirnaldas = {};
  msg.textContent = '✓ Guirnaldas borradas. La app está lista para datos reales.';
  msg.className = 'msg ok'; msg.style.display = 'block';
  // Refrescar la vista de bloques
  setTimeout(() => { buildInicio(); }, 1500);
}

async function guardarPinesNuevos() {
  const msg = document.getElementById('msg-pines');
  const nuevos = {};
  let ok = true;
  Object.entries(PINES_CONFIG).forEach(([pinViejo, r]) => {
    const inp = document.getElementById('pin-new-'+pinViejo);
    const val = inp?.value?.trim();
    if (val && val.length === 4 && /^\d{4}$/.test(val)) {
      nuevos[val] = r;
    } else if (!val) {
      nuevos[pinViejo] = r; // mantener el viejo
    } else {
      ok = false;
    }
  });
  if (!ok) { msg.textContent='Los PINes deben ser de 4 dígitos.'; msg.className='msg err'; msg.style.display='block'; return; }
  Object.assign(PINES_CONFIG, nuevos);
  await guardarPines();
  msg.textContent='✓ PINes actualizados correctamente.'; msg.className='msg ok'; msg.style.display='block';
}

// guardarConfigSheets eliminado — URL se configura directo en sheets.js

// ── ALERTA HORÓMETROS OMITIDOS ──────────────────────────────────────────────
let alertaHorosInterval = null;

async function verificarHorosOmitidos() {
  const ahora = new Date();
  const horaCol = ahora.getHours(); // hora local (Colombia UTC-5)
  if (horaCol < CFG.horaLimiteAlerta) return; // antes de las 13:00 no alerta

  const hoyStr = hoy();
  const lecturasHoy = await dbGetAll('lecturas');
  const lecturasDeHoy = lecturasHoy.filter(l => l.fecha?.startsWith(hoyStr));

  // Bloques activos con guirnaldas encendidas
  const bloquesFaltantes = [];
  for (const [bl, info] of Object.entries(BLOQUES)) {
    const horos = calcHoros(parseInt(bl));
    for (const h of horos) {
      // Verificar si este horómetro tiene guirnaldas activas
      let tieneActivas = false;
      for (let n = h.nIni; n <= h.nFin; n++) {
        for (const lado of ['A','B']) {
          for (let g = 1; g <= 2; g++) {
            const est = estadoGuirnalda(guirnaldas[gKey(bl,n,lado,g)]);
            if (est === 'encendida' || est === 'por-vencer') { tieneActivas = true; break; }
          }
          if (tieneActivas) break;
        }
        if (tieneActivas) break;
      }
      if (!tieneActivas) continue;

      // Verificar si tiene lectura de hoy
      const tieneRegistro = lecturasDeHoy.some(l =>
        String(l.bloque) === String(bl) && l.horometro === h.id
      );
      if (!tieneRegistro) {
        bloquesFaltantes.push({ bl: parseInt(bl), horo: h.id, turno: h.turno });
      }
    }
  }

  // Mostrar banner persistente
  const banner = document.getElementById('alerta-horos-banner');
  if (!banner) return;

  if (bloquesFaltantes.length > 0) {
    const lista = bloquesFaltantes.slice(0,5).map(f =>
      `B${f.bl}·${f.horo} (${f.turno.inicio})`
    ).join(' · ');
    const mas = bloquesFaltantes.length > 5 ? ` +${bloquesFaltantes.length-5} más` : '';
    banner.innerHTML = `<div style="display:flex;align-items:flex-start;gap:8px">
      <span style="font-size:16px;flex-shrink:0">🚨</span>
      <div>
        <div style="font-weight:800;margin-bottom:2px">Horómetros sin registrar hoy</div>
        <div style="font-size:11px;opacity:.9">${lista}${mas}</div>
        <div style="font-size:10px;opacity:.7;margin-top:2px">Registra las lecturas para que desaparezca esta alerta</div>
      </div>
    </div>`;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }

  return bloquesFaltantes;
}

function iniciarVerificacionHoros() {
  verificarHorosOmitidos();
  // Verificar cada 10 minutos
  alertaHorosInterval = setInterval(verificarHorosOmitidos, 600000);
}

// ── MODO DÍA / NOCHE ─────────────────────────────────────────────────────────
let modoNoche = true;
function toggleModo() {
  modoNoche = !modoNoche;
  document.body.className = modoNoche ? 'noche' : 'dia';
  document.getElementById('modo-ico').textContent = modoNoche ? '☀️' : '🌙';
  document.getElementById('modo-lbl').textContent = modoNoche ? 'Día' : 'Noche';
  localStorage.setItem('ftp_modo', modoNoche ? 'noche' : 'dia');
}
function cargarModo() {
  const m = localStorage.getItem('ftp_modo') || 'noche';
  modoNoche = m === 'noche';
  document.body.className = m;
  document.getElementById('modo-ico').textContent = modoNoche ? '☀️' : '🌙';
  document.getElementById('modo-lbl').textContent = modoNoche ? 'Día' : 'Noche';
}

async function init(){
  cargarModo();
  await cargarDatos();
  await cargarNochesCustom();
  initLogin();
}
init();
