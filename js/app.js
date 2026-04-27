// ── DATOS (cargados desde JSON) ───────────────
let BLOQUES    = {};
let VARIEDADES = {};
let PLAN       = [];
let _catK = '', _catNC = 0;

// ═══════════════════════════════════════════════
// Fotoperiodo v2 — App principal
// Finca Olas · Guirnaldas + Plan de Siembras
// ═══════════════════════════════════════════════

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
  // Expirada: ciclo terminado hace más de 3 noches → se oculta
  if (dr < -3) return 'expirada';
  if (dr < 0)  return 'apagada-auto';
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

  const setTxt = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  setTxt('cnt-act', Object.keys(BLOQUES).length);
  setTxt('cnt-guirn', totalGuirn);
  setTxt('cnt-aler', totalAlertas);
  const dot = document.getElementById('alerta-dot');
  if(dot) dot.style.display = totalAlertas>0 ? 'block' : 'none';

  // Mostrar semana en plan
  const semCp = semanaCorta();
  const planLbl = document.getElementById('plan-sem-lbl');
  if(planLbl) planLbl.textContent = 'Semana 20'+semCp.slice(0,2)+'-W'+semCp.slice(2)+' · '+planSem.length+' variedades';
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

function camaBaseAbsoluta(bl, nave, lado) {
  // Calcula el número de cama absoluta donde empieza esta nave para el lado dado
  const info = BLOQUES[String(bl)];
  if(!info) return (nave-1)*4;
  const navesLado = lado==='A' ? (info.navesA||[]) : (info.navesB||[]);
  let base = 0;
  for(let i=0; i<nave-1 && i<navesLado.length; i++) base += navesLado[i];
  return base;
}

function mkGuirnaldas(bl, nave, lado, b) {
  const nCamas = camasPorNaveReal(bl, nave, lado);
  const base   = camaBaseAbsoluta(bl, nave, lado); // base cama absoluta correcta
  let html = '';

  if (nCamas <= 0) {
    html += `<div style="text-align:center;padding:8px;font-size:10px;color:rgba(255,255,255,.2)">Sin camas</div>`;
    return html;
  }

  const nGuirns = Math.ceil(nCamas / 2);
  for (let g = 1; g <= nGuirns; g++) {
    const c1abs  = base + (g-1)*2 + 1;
    const c2abs  = base + (g-1)*2 + 2;
    const tieneC2 = ((g-1)*2 + 2) <= nCamas;
    const k   = gKey(bl, nave, lado, g);
    const gd  = guirnaldas[k] || {};
    const est = estadoGuirnalda(gd);
    // Ocultar guirnaldas expiradas (ciclo terminado hace más de 3 noches)
    if (est === 'expirada') continue;
    const op  = est==='sin-sembrar' ? '.4' : '1';

    html += `<div onclick="abrirGuirnalda('${k}',${bl},${nave},'${lado}',${g})" style="cursor:pointer;margin-bottom:8px">`;
    html += mkCamaBox(gd, 1, c1abs, lado);
    html += `<div style="opacity:${op}">` + crearBombillosHTML(est) + `</div>`;
    if (tieneC2) {
      html += mkCamaBox(gd, 2, c2abs, lado);
    } else {
      html += `<div style="background:rgba(255,255,255,.02);border:1px dashed rgba(255,255,255,.08);
        border-radius:7px;padding:5px 8px;margin-bottom:3px;text-align:${lado==='A'?'left':'right'}">
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

// ── FORMULARIO SIEMBRA INDIVIDUAL POR CAMA ──────────────────────────────────
function sembrarCamaIndividual(k, bl, nave, lado, g, numCama) {
  const gd      = guirnaldas[k] || {};
  const camR    = camasDeGuirnalda(nave, g);
  const camAbs  = numCama===1 ? (nave-1)*4+camR[0] : (nave-1)*4+camR[1];
  const semPlan = planSemanaActual();
  const otraVar = numCama===1 ? gd.variedad2 : gd.variedad1;
  const otraFin = gd.fechaFin;

  let html = '<div class="modal-handle"></div>';
  html += `<div class="modal-title">Sembrar Cama ${camAbs} · Lado ${lado}</div>`;
  html += `<div style="font-size:12px;color:var(--txt2);margin-bottom:12px">
    Bloque ${bl} · Nave ${nave} · Guirnalda ${g}
  </div>`;

  if (otraVar) {
    html += `<div class="banner bb" style="margin-bottom:10px"><span>ℹ️</span>
      <span>Cama adyacente: <strong>${otraVar}</strong> · Fin actual: ${fmtF(otraFin)}</span></div>`;
  }

  // VARIEDAD — botones grandes del plan de la semana
  html += '<div class="field"><label>Variedad — Plan semana actual</label>';
  // select oculto para mantener compatibilidad con updateSiembraIndividual
  html += `<select id="ind-var" style="display:none" onchange="updateSiembraIndividual('${k}',${numCama})">`;
  html += '<option value="">—</option>';
  if (semPlan.length) {
    semPlan.forEach(p => {
      html += `<option value="${p.variedad}" data-noches="${p.noches}">${p.variedad}</option>`;
    });
  }
  html += '</select>';

  // Botones grandes por variedad
  if (semPlan.length) {
    html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">';
    semPlan.slice(0,6).forEach(p => {
      html += `<button class="var-plan-btn" data-var="${p.variedad}" data-noches="${p.noches}"
        style="width:100%;padding:13px 14px;border:1.5px solid var(--bo);border-radius:12px;
               background:var(--g);cursor:pointer;display:flex;justify-content:space-between;
               align-items:center;transition:all .15s;text-align:left">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--txt)">${p.variedad}</div>
          <div style="font-size:11px;color:var(--ts);margin-top:2px">${p.cantidad} camas · sem ${semanaCorta()}</div>
        </div>
        <span style="font-size:15px;font-weight:800;color:var(--v);flex-shrink:0;margin-left:8px">${p.noches}n</span>
      </button>`;
    });
    html += '</div>';
  } else {
    html += `<div class="banner bw" style="margin:4px 0"><span>📋</span>
      <span>Sin plan esta semana. Usa el botón de abajo.</span></div>`;
  }
  html += '</div>';

  // BOTÓN — catálogo completo + nueva variedad
  html += `<button id="btn-abrir-catalogo" class="btn-outline"
    style="margin-bottom:12px;border-color:var(--a);color:var(--a)">
    🔍 Variedad no está en el plan — buscar en catálogo
  </button>`;

  // FECHA DE SIEMBRA — compatible con todos los dispositivos
  const hoyVal = hoy();
  html += '<div class="field"><label>Fecha de siembra</label>';
  html += `<input type="date" id="ind-fecha" max="${hoyVal}" value="${hoyVal}"
    data-k="${k}" data-nc="${numCama}"
    onchange="updateSiembraIndividual('${k}',${numCama})"
    style="padding:11px 14px;border:2px solid var(--bo);border-radius:10px;
           background:var(--g);font-size:15px;color:var(--txt);width:100%;
           -webkit-appearance:none;appearance:none">`;
  html += `<div style="font-size:10px;color:var(--ts);margin-top:3px">
    📅 Fecha de hoy por defecto. Cámbiala si fue sembrada antes.
  </div></div>`;
  // Fecha inicializada con value attribute

  // RESULTADO
  html += '<div id="ind-result" style="display:none" class="result-box"></div>';

  html += `<button class="btn-g" onclick="confirmarSiembraIndividual('${k}',${bl},${nave},'${lado}',${g},${numCama})">
    ⚡ Registrar y encender guirnalda
  </button>`;
  html += `<button class="btn-outline" style="margin-top:6px"
    onclick="abrirGuirnalda('${k}',${bl},${nave},'${lado}',${g})">← Volver</button>`;

  document.getElementById('modal-body').innerHTML = html;

  // Agregar listener al botón catálogo DESPUÉS de insertar el HTML
  const _k = k, _nc = numCama;
  const btnCat = document.getElementById('btn-abrir-catalogo');
  if (btnCat) {
    btnCat.addEventListener('click', function() {
      abrirCatalogoCompleto(_k, _nc);
    });
  }
  // Inicializar fecha y resultado
  const fechaEl = document.getElementById('ind-fecha');
  if (fechaEl) {
    if (!fechaEl.value) fechaEl.value = hoy();
    fechaEl.addEventListener('change', function() {
      updateSiembraIndividual(_k, _nc);
    });
  }
}
function updateSiembraIndividual(k, numCama) {
  const sel    = document.getElementById('ind-var');
  const inpF   = document.getElementById('ind-fecha');
  const res    = document.getElementById('ind-result');
  if (!sel?.value) { if(res) res.style.display='none'; return; }

  const gd     = guirnaldas[k] || {};
  const varN   = sel.value;
  const noches = parseInt(sel.selectedOptions[0]?.dataset?.noches||19);
  const otraFin = gd.fechaFin;

  // Fecha de siembra — siempre del campo ind-fecha
  const fechaIngresada  = inpF?.value || hoy();
  const esSiembraAntes  = fechaIngresada < hoy();
  const diasTrans       = esSiembraAntes
    ? Math.floor((new Date(hoy()) - new Date(fechaIngresada)) / 86400000)
    : 0;
  const nochesRestantes = Math.max(0, noches - diasTrans);
  const estaFin         = addDias(hoy(), nochesRestantes);
  const finFinal        = otraFin ? (estaFin > otraFin ? estaFin : otraFin) : estaFin;
  const cicloOk         = nochesRestantes === 0;

  // Noches perdidas (turnos que pasaron sin luz)
  const nPerdidas = esSiembraAntes
    ? calcularNochesPerdidas(fechaIngresada, new Date())
    : 0;

  let html = '';
  html += `<div class="rb-row"><span class="rb-key">Variedad</span><span class="rb-val">${varN}</span></div>`;
  html += `<div class="rb-row"><span class="rb-key">Noches totales</span><span class="rb-val">${noches}n</span></div>`;

  if (esSiembraAntes) {
    const colD = diasTrans >= noches ? 'var(--r)' : 'var(--n)';
    html += `<div class="rb-row"><span class="rb-key">Fecha real siembra</span><span class="rb-val">${fmtF(fechaIngresada)}</span></div>`;
    html += `<div class="rb-row"><span class="rb-key">Días transcurridos</span><span class="rb-val" style="color:${colD}">${diasTrans} días</span></div>`;
    const colNR = nochesRestantes<=3 ? 'var(--r)' : 'var(--vm)';
    html += `<div class="rb-row"><span class="rb-key">Noches restantes</span>
      <span class="rb-val" style="color:${colNR};font-weight:800">${nochesRestantes}n</span></div>`;
    if (nPerdidas > 0) {
      html += `<div class="rb-row"><span class="rb-key" style="color:var(--r)">Noches sin luz</span>
        <span class="rb-val" style="color:var(--r)">${nPerdidas}n (turnos perdidos)</span></div>`;
    }
    if (cicloOk) {
      html += `<div class="banner ba" style="margin:6px 0"><span>⚠</span>
        <span>Esta cama ya completó su ciclo. Se registrará como apagada.</span></div>`;
    }
  }

  html += `<div class="rb-row"><span class="rb-key">Fin esta cama</span><span class="rb-val">${fmtF(estaFin)}</span></div>`;
  if (otraFin) {
    html += `<div class="rb-row"><span class="rb-key">Fin cama adyacente</span><span class="rb-val">${fmtF(otraFin)}</span></div>`;
  }
  html += `<div class="rb-row"><span class="rb-key" style="color:var(--v);font-weight:800">Fecha fin guirnalda</span>
    <span class="rb-val" style="color:var(--v)">${fmtF(finFinal)}</span></div>`;
  html += `<div class="banner bk" style="margin-top:6px"><span>⚡</span>
    <span>Guirnalda se enciende automáticamente al guardar.</span></div>`;

  if (res) { res.style.display='block'; res.innerHTML = html; }
}

async function confirmarSiembraIndividual(k, bl, nave, lado, g, numCama) {
  const sel = document.getElementById('ind-var');
  if(!sel?.value){ alert('Selecciona una variedad'); return; }

  const varN   = sel.value;
  const noches = parseInt(sel.selectedOptions[0]?.dataset?.noches||19);
  const gd     = guirnaldas[k] || {};

  // Leer fecha real siempre del campo ind-fecha
  const inpFecha    = document.getElementById('ind-fecha');
  const fechaIniReal = inpFecha?.value || hoy();
  const esAnterior   = fechaIniReal < hoy();
  const diasTrans    = esAnterior
    ? Math.floor((new Date(hoy()) - new Date(fechaIniReal)) / 86400000) : 0;
  let nochesRestantes = Math.max(0, noches - diasTrans);

  // Fecha fin de esta cama = hoy + noches restantes
  const finEsta = addDias(hoy(), nochesRestantes);

  // MAX con la otra cama si existe
  let fechaFin = finEsta;
  if (gd.fechaFin && gd.fechaFin > finEsta) fechaFin = gd.fechaFin;

  // Ciclo ya completado
  const cicloCompleto = nochesRestantes === 0;

  // Si había ciclo anterior completado → REINICIO de ciclo
  const eraExpirada = gd.fechaFin && diasRest(gd.fechaFin) < 0;
  const gdActual = {
    ...gd, id:k, bloque:bl, nave, lado, g,
    encendida: !cicloCompleto,
    fechaFin,
    noches: Math.ceil((new Date(fechaFin) - new Date(fechaIniReal)) / 86400000),
    cicloReiniciado: eraExpirada,
    fechaReinicio: eraExpirada ? hoy() : undefined
  };

  if (numCama === 1) {
    gdActual.variedad1 = varN;
    gdActual.noches1   = noches;
    gdActual.fechaIni1 = fechaIniReal;
    gdActual.nochesRestantes1 = nochesRestantes;
    if (!gdActual.fechaIni) gdActual.fechaIni = fechaIniReal;
  } else {
    gdActual.variedad2 = varN;
    gdActual.noches2   = noches;
    gdActual.fechaIni2 = fechaIniReal;
    gdActual.nochesRestantes2 = nochesRestantes;
    if (!gdActual.fechaIni) gdActual.fechaIni = fechaIniReal;
  }

  // Calcular noches perdidas entre fecha real y ahora
  const nochesPerdidas = calcularNochesPerdidas(fechaIniReal, new Date());

  // Función para guardar definitivamente
  async function ejecutarGuardado(nPerdidas) {
    const nochesEfect = Math.max(0, noches - nPerdidas);
    const finEfect    = addDias(hoy(), nochesEfect);
    // Recalcular fecha fin con noches efectivas
    let fechaFinFinal = finEfect;
    if(gdActual.fechaFin && gdActual.fechaFin > finEfect) fechaFinFinal = gdActual.fechaFin;
    gdActual.fechaFin         = fechaFinFinal;
    gdActual.nochesPerdidas   = nPerdidas;
    gdActual.nochesEfectivas  = nochesEfect;
    if(numCama===1){ gdActual.nochesPerdidas1=nPerdidas; }
    else           { gdActual.nochesPerdidas2=nPerdidas; }

    guirnaldas[k] = gdActual;
    await dbPut('guirnaldas', gdActual);

    const gpsRes = await gpsValidar(bl);
    const camR   = camasDeGuirnalda(nave, g);
    const camAbs = numCama===1 ? (nave-1)*4+camR[0] : (nave-1)*4+camR[1];

    await dbAdd('siembras', {
      bloque:bl, nave, lado, g, key:k, cama:camAbs, numCama,
      variedad:varN, noches, nochesRestantes, nochesEfectivas:nochesEfect,
      nochesPerdidas:nPerdidas,
      fechaIniReal, fechaIni:hoy(), fechaFinGuirnalda:fechaFinFinal,
      esAnterior, operario,
      gps:gpsRes.punto, gpsValido:gpsRes.valid,
      fecha:new Date().toISOString()
    });
    await addToSyncQueue('siembra', gdActual);
    tipoSiembra = 'nueva';
    cerrarModal();
    renderGuirnaldas(bl);
    abrirBloque(bl);
  }

  // Si hay noches perdidas → mostrar alerta y pedir confirmación
  if (nochesPerdidas > 0) {
    mostrarAlertaNochesPerdidas(nochesPerdidas, noches, varN,
      (n) => ejecutarGuardado(n),
      () => {}
    );
  } else {
    await ejecutarGuardado(0);
  }
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
  navigator.serviceWorker.register('/fotoperiodo-finca-olas/sw.js', {scope:'/fotoperiodo-finca-olas/'})
    .then(reg => {
      // Verificar actualizaciones al abrir la app
      reg.update();
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW.addEventListener('statechange', () => {
          if(newSW.state === 'installed' && navigator.serviceWorker.controller) {
            // Nueva versión disponible — activar inmediatamente
            newSW.postMessage({type:'SKIP_WAITING'});
            window.location.reload();
          }
        });
      });
    })
    .catch(e=>console.warn('SW:',e));

  // Recargar cuando el SW nuevo tome control
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
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
  const mIco = document.getElementById('modo-ico');
  const mLbl = document.getElementById('modo-lbl');
  if(mIco) mIco.textContent = modoNoche ? '☀️' : '🌙';
  if(mLbl) mLbl.textContent = modoNoche ? 'Día' : 'Noche';
}

async function init(){
  cargarModo();
  await cargarDatos();
  await cargarNochesCustom();
  initLogin();
}
init();

// == SIEMBRA ANTERIOR ==
function irSiembraAnterior() {
  showScreen('sc-siembra-ant');
  setNavSel('nb-siembra-ant');
  renderSiembraAnterior();
}

function renderSiembraAnterior() {
  const wrap = document.getElementById('siembra-ant-content');
  if(!wrap) return;

  const semPlan = planSemanaActual();
  let html = '';

  html += '<div class="banner bb" style="border-radius:10px;margin-bottom:14px">';
  html += '<span>📅</span><span>Registra camas sembradas antes de la semana actual que aún no están en el sistema.</span></div>';
  html += '<div class="card">';
  html += '<div class="sem-title" style="margin-bottom:14px">Datos de la siembra anterior</div>';

  // BLOQUE
  html += '<div class="field"><label>Bloque</label><select id="sant-bloque" onchange="actualizarCamasAnt()"><option value="">Selecciona bloque...</option>';
  Object.keys(BLOQUES).sort((a,b)=>parseInt(a)-parseInt(b)).forEach(bl=>{
    html+=`<option value="${bl}">Bloque ${bl}</option>`;
  });
  html += '</select></div>';

  // LADO
  html += '<div class="field"><label>Lado</label><select id="sant-lado" onchange="actualizarCamasAnt()"><option value="">Selecciona lado...</option><option value="A">Lado A</option><option value="B">Lado B</option></select></div>';

  // CAMA — número absoluto directo
  html += '<div class="field"><label>Número de cama</label><select id="sant-cama" onchange="calcularSiembraAnt()" disabled><option value="">Primero selecciona bloque y lado</option></select></div>';

  // VARIEDAD
  html += '<div class="field"><label>Variedad</label><select id="sant-var" onchange="calcularSiembraAnt()"><option value="">Selecciona variedad...</option>';
  if(semPlan.length){
    html += '<optgroup label="Plan semana actual">';
    semPlan.forEach(p=>{ html+=`<option value="${p.variedad}" data-noches="${p.noches}">${p.variedad} (${p.noches}n)</option>`; });
    html += '</optgroup>';
  }
  html += '<optgroup label="Todas las variedades">';
  Object.entries(VARIEDADES).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([v,n])=>{
    html+=`<option value="${v}" data-noches="${n}">${v} (${n}n)</option>`;
  });
  html += '</optgroup></select></div>';

  // FECHA REAL
  const hace7 = new Date(); hace7.setDate(hace7.getDate()-7);
  html += '<div class="field"><label>Fecha real de siembra</label>';
  html += `<input type="date" id="sant-fecha" max="${hoy()}" value="${hace7.toISOString().split('T')[0]}" onchange="calcularSiembraAnt()" style="padding:11px 14px;border:2px solid var(--bo);border-radius:10px;background:var(--g);font-size:15px;color:var(--txt);width:100%"></div>`;

  html += '<div id="sant-result" style="display:none" class="result-box"></div>';
  html += '<button class="btn-g" onclick="guardarSiembraAnterior()">Registrar siembra y encender guirnalda</button>';
  html += '<div class="msg" id="msg-sant"></div></div>';

  wrap.innerHTML = html;

  // Cargar historial
  dbGetAll('siembras').then(todas=>{
    const ant = todas.filter(s=>s.esAnterior).sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).slice(0,8);
    if(!ant.length) return;
    let hist = '<div class="sec-lbl" style="margin-top:14px">Registradas anteriormente</div><div class="card">';
    ant.forEach(s=>{
      hist+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bo)">
        <div><div style="font-size:12px;font-weight:700">B${s.bloque} N${s.nave} L${s.lado} C${s.cama}</div>
        <div style="font-size:10px;color:var(--ts)">${s.variedad} · Sembrada ${fmtF(s.fechaIniReal)}</div></div>
        <div style="text-align:right"><div style="font-size:12px;font-weight:700;color:var(--vm)">${s.nochesRestantes}n rest.</div></div></div>`;
    });
    hist += '</div>';
    wrap.innerHTML += hist;
  });
}

function actualizarNavesAnt() {
  actualizarCamasAnt(); // Nave se calcula automáticamente desde la cama
}

function actualizarCamasAnt() {
  const bl   = document.getElementById('sant-bloque')?.value;
  const lado = document.getElementById('sant-lado')?.value;
  const sel  = document.getElementById('sant-cama');
  if(!sel) return;
  if(!bl||!lado){ sel.disabled=true; sel.innerHTML='<option value="">Primero selecciona bloque y lado</option>'; return; }

  const info = BLOQUES[bl];
  if(!info){ sel.disabled=true; return; }

  // Generar todas las camas del bloque para el lado seleccionado
  sel.innerHTML = '<option value="">Selecciona cama...</option>';
  const naves = info.navesA || Array(info.naves).fill(info.cAbase||4);
  const navesLado = lado==='A'
    ? (info.navesA || Array(info.naves).fill(info.cAbase||4))
    : (info.navesB || Array(info.naves).fill(info.cBbase||4));

  let camAbs = 0;
  navesLado.forEach((nCamas, naveIdx) => {
    const nave = naveIdx + 1;
    for(let c=1; c<=nCamas; c++){
      camAbs++;
      // Calcular posición dentro de la guirnalda
      const posEnNave = c; // 1-based dentro de la nave
      const g = Math.ceil(posEnNave/2);
      const numCama = posEnNave%2===0 ? 2 : 1;
      sel.innerHTML += `<option value="${camAbs}" data-nave="${nave}" data-pos="${posEnNave}" data-g="${g}" data-numcama="${numCama}">
        Cama ${camAbs} (Nave ${nave})</option>`;
    }
  });
  sel.disabled = false;
  calcularSiembraAnt();
}

function calcularSiembraAnt() {
  const selVar = document.getElementById('sant-var');
  const inpF   = document.getElementById('sant-fecha');
  const res    = document.getElementById('sant-result');
  if(!selVar?.value||!inpF?.value||!res) return;
  const noches    = parseInt(selVar.selectedOptions[0]?.dataset?.noches||19);
  const fReal     = inpF.value;
  const diasTrans = Math.floor((new Date(hoy())-new Date(fReal))/86400000);
  const nochRest  = Math.max(0,noches-diasTrans);
  const finCama   = addDias(hoy(),nochRest);
  const col       = nochRest===0?'var(--r)':nochRest<=3?'var(--n)':'var(--vm)';
  res.style.display='block';
  res.innerHTML=
    `<div class="rb-row"><span class="rb-key">Noches variedad</span><span class="rb-val">${noches}n</span></div>`+
    `<div class="rb-row"><span class="rb-key">Fecha real siembra</span><span class="rb-val">${fmtF(fReal)}</span></div>`+
    `<div class="rb-row"><span class="rb-key">Días transcurridos</span><span class="rb-val" style="color:var(--n)">${diasTrans} días</span></div>`+
    `<div class="rb-row"><span class="rb-key">Noches restantes</span><span class="rb-val" style="color:${col};font-weight:800">${nochRest} noches</span></div>`+
    `<div class="rb-row"><span class="rb-key">Fecha apagado</span><span class="rb-val" style="color:${col}">${fmtF(finCama)}</span></div>`+
    (nochRest===0?'<div class="banner ba" style="margin-top:6px"><span>⚠</span><span>Ya completó su ciclo. Se registrará como apagada.</span></div>':
    '<div class="banner bk" style="margin-top:6px"><span>⚡</span><span>Guirnalda se encenderá automáticamente.</span></div>');
}

async function guardarSiembraAnterior() {
  const bl     = document.getElementById('sant-bloque')?.value;
  const lado   = document.getElementById('sant-lado')?.value;
  const camEl  = document.getElementById('sant-cama');
  const camAbs = parseInt(camEl?.value||0);
  const nave   = parseInt(camEl?.selectedOptions[0]?.dataset?.nave||0);
  const posEnNave = parseInt(camEl?.selectedOptions[0]?.dataset?.pos||0);
  const g      = parseInt(camEl?.selectedOptions[0]?.dataset?.g||0);
  const numCama= parseInt(camEl?.selectedOptions[0]?.dataset?.numcama||0);
  const selVar = document.getElementById('sant-var');
  const fReal  = document.getElementById('sant-fecha')?.value;
  const msg    = document.getElementById('msg-sant');
  if(!bl||!nave||!lado||!camAbs||!selVar?.value||!fReal){
    msg.textContent='Completa todos los campos.'; msg.className='msg err'; msg.style.display='block'; return;
  }
  const varN      = selVar.value;
  const noches    = parseInt(selVar.selectedOptions[0]?.dataset?.noches||19);
  const diasTrans = Math.floor((new Date(hoy())-new Date(fReal))/86400000);
  const nochRest  = Math.max(0,noches-diasTrans);
  const finCama   = addDias(hoy(),nochRest);
  const k         = gKey(bl,nave,lado,g);
  const gdExist   = guirnaldas[k]||{};
  let fechaFin    = finCama;
  if(gdExist.fechaFin&&gdExist.fechaFin>finCama) fechaFin=gdExist.fechaFin;
  const gdActual  = {...gdExist,id:k,bloque:parseInt(bl),nave,lado,g,encendida:nochRest>0,fechaFin,
    noches:Math.ceil((new Date(fechaFin)-new Date(gdExist.fechaIni||fReal))/86400000)};
  if(numCama===1){gdActual.variedad1=varN;gdActual.noches1=noches;gdActual.fechaIni1=fReal;gdActual.nochesRestantes1=nochRest;if(!gdActual.fechaIni)gdActual.fechaIni=fReal;}
  else{gdActual.variedad2=varN;gdActual.noches2=noches;gdActual.fechaIni2=fReal;gdActual.nochesRestantes2=nochRest;if(!gdActual.fechaIni)gdActual.fechaIni=fReal;}
  const nPerd = calcularNochesPerdidas(fReal, new Date());

  async function ejecutarGuardadoAnt(nPerdidas) {
    const nochesEfect = Math.max(0, noches - nPerdidas);
    gdActual.nochesPerdidas  = nPerdidas;
    gdActual.nochesEfectivas = nochesEfect;
    guirnaldas[k]=gdActual;
    await dbPut('guirnaldas',gdActual);
    const gpsRes=await gpsValidar(parseInt(bl));
    await dbAdd('siembras',{bloque:parseInt(bl),nave,lado,g,key:k,cama:camAbs,numCama,
      variedad:varN,noches,nochesRestantes:nochRest,
      nochesEfectivas:nochesEfect,nochesPerdidas:nPerdidas,
      fechaIniReal:fReal,fechaIni:hoy(),fechaFinGuirnalda:fechaFin,
      esAnterior:true,operario,
      gps:gpsRes.punto,gpsValido:gpsRes.valid,fecha:new Date().toISOString()});
    await addToSyncQueue('siembra',gdActual);
    msg.textContent=`Guardado: B${bl} N${nave} L${lado} C${camAbs} - ${varN} - ${nochRest}n restantes${nPerdidas>0?' · '+nPerdidas+'n perdidas':''}`;
    msg.className='msg ok'; msg.style.display='block';
    buildInicio();
    setTimeout(()=>renderSiembraAnterior(),2000);
  }

  if(nPerd>0){
    mostrarAlertaNochesPerdidas(nPerd,noches,varN,
      (n)=>ejecutarGuardadoAnt(n),
      ()=>{}
    );
  } else {
    await ejecutarGuardadoAnt(0);
  }
}

// == VALIDACION NOCHES PERDIDAS ==
function calcularNochesPerdidas(fechaSiembraReal, fechaRegistro) {
  // Turno: 21:00 a 03:00 (siguiente día)
  // Una noche se "pierde" si entre la fecha real de siembra
  // y la fecha de registro pasó al menos un turno completo
  const fReal = new Date(fechaSiembraReal);
  const fReg  = new Date(fechaRegistro || new Date());
  
  let nochesPerdidas = 0;
  let cursor = new Date(fReal);
  
  // Avanzar día a día y contar turnos que pasaron sin registro
  while (true) {
    // Turno de este día: 21:00 de cursor hasta 03:00 del día siguiente
    const turnoInicio = new Date(cursor);
    turnoInicio.setHours(21, 0, 0, 0);
    const turnoFin = new Date(cursor);
    turnoFin.setDate(turnoFin.getDate() + 1);
    turnoFin.setHours(3, 0, 0, 0);
    
    // Si el turno ya terminó antes del registro → noche perdida
    if (turnoFin < fReg) {
      // Solo cuenta si la siembra ocurrió antes del inicio del turno
      if (fReal <= turnoInicio) {
        nochesPerdidas++;
      }
    } else {
      break; // turno aún no terminó o es el turno actual
    }
    cursor.setDate(cursor.getDate() + 1);
    if (nochesPerdidas > 60) break; // límite de seguridad
  }
  return nochesPerdidas;
}

function mostrarAlertaNochesPerdidas(nochesPerdidas, noches, variedad, onConfirmar, onCancelar) {
  if (nochesPerdidas <= 0) { onConfirmar(0); return; }
  
  const nochesEfectivas = Math.max(0, noches - nochesPerdidas);
  const html = `
    <div class="modal-handle"></div>
    <div class="modal-title" style="color:var(--n)">⚠ Noches perdidas detectadas</div>
    <div style="font-size:13px;color:var(--txt2);margin-bottom:14px;line-height:1.7">
      Entre la fecha real de siembra y el registro de hoy, 
      pasaron <strong style="color:var(--r)">${nochesPerdidas} noche(s)</strong> 
      sin luz para esta cama.
    </div>
    <div class="result-box" style="display:block;margin-bottom:14px">
      <div class="rb-row">
        <span class="rb-key">Variedad</span>
        <span class="rb-val">${variedad}</span>
      </div>
      <div class="rb-row">
        <span class="rb-key">Noches programadas</span>
        <span class="rb-val">${noches} noches</span>
      </div>
      <div class="rb-row">
        <span class="rb-key" style="color:var(--r)">Noches perdidas</span>
        <span class="rb-val" style="color:var(--r);font-weight:800">${nochesPerdidas} noches</span>
      </div>
      <div class="rb-row">
        <span class="rb-key" style="color:var(--vm)">Noches efectivas</span>
        <span class="rb-val" style="color:var(--vm);font-weight:800">${nochesEfectivas} noches</span>
      </div>
    </div>
    <div class="banner bw" style="margin-bottom:14px">
      <span>ℹ️</span>
      <span>Esto quedará registrado en el historial al finalizar el ciclo. 
      La fecha de apagado se ajusta a las noches efectivas restantes.</span>
    </div>
    <button class="btn-g" onclick="confirmarNochesPerdidas(${nochesPerdidas})">
      Entendido · Registrar con ${nochesEfectivas} noches efectivas
    </button>
    <button class="btn-outline" style="margin-top:8px" onclick="cerrarModal()">
      Cancelar
    </button>`;
  
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('show');
  
  // Guardar callbacks
  window._onConfirmarNoches  = onConfirmar;
  window._onCancelarNoches   = onCancelar;
  window._nochesPerdidas     = nochesPerdidas;
}

function confirmarNochesPerdidas(n) {
  cerrarModal();
  if (window._onConfirmarNoches) window._onConfirmarNoches(n);
}

// Agregar info de noches perdidas al historial al completar ciclo
async function registrarFinCiclo(k, gd) {
  const siembras = await dbGetAll('siembras');
  const delGuirn = siembras.filter(s => s.key === k);
  
  let totalPerdidas = 0;
  delGuirn.forEach(s => {
    totalPerdidas += s.nochesPerdidas || 0;
  });
  
  if (totalPerdidas > 0) {
    await dbAdd('siembras', {
      tipo: 'fin_ciclo',
      key: k,
      bloque: gd.bloque,
      nave: gd.nave,
      lado: gd.lado,
      variedad1: gd.variedad1,
      variedad2: gd.variedad2,
      nochesProgr: gd.noches,
      nochesPerdidas: totalPerdidas,
      nochesEfectivas: gd.noches - totalPerdidas,
      fechaIni: gd.fechaIni,
      fechaFin: gd.fechaFin,
      operario,
      fecha: new Date().toISOString()
    });
  }
}

// == PERMISOS Y ROLES ==
function aplicarPermisos() {
  // Ocultar por data-permiso
  document.querySelectorAll('[data-permiso]').forEach(el => {
    const permiso = el.dataset.permiso;
    if (!tienePermiso(permiso)) el.style.display = 'none';
    else el.style.display = '';
  });
  // Ocultar por data-roles
  document.querySelectorAll('[data-roles]').forEach(el => {
    const roles = el.dataset.roles.split(',').map(r => r.trim());
    el.style.display = roles.includes(window.currentRol) ? '' : 'none';
  });
  // Gerente: solo lectura
  if (window.currentRol === 'gerente') {
    document.querySelectorAll('[data-permiso="registrar_siembras"]')
      .forEach(el => el.style.display = 'none');
  }
}

// == AGREGAR VARIEDAD NUEVA ==
function abrirAgregarVariedad(k, numCama) {
  // Detectar modo para colores correctos
  const esNoche = document.body.classList.contains('noche');
  const bgInp   = esNoche ? '#1e293b' : '#f4f4f4';
  const colTxt  = esNoche ? '#f1f5f9' : '#222';
  const borInp  = esNoche ? '#334155' : '#e0e0e0';

  let html = '<div class="modal-handle"></div>';
  html += '<div class="modal-title" style="color:var(--v)">➕ Nueva variedad</div>';
  html += `<div style="font-size:12px;color:${esNoche?'rgba(255,255,255,.6)':'#666'};margin-bottom:14px">Agrega una variedad que no está en el catálogo</div>`;

  html += '<div class="field"><label style="color:'+( esNoche?'rgba(255,255,255,.6)':'#888')+'">NOMBRE DE LA VARIEDAD</label>';
  html += `<input type="text" id="nueva-var-nombre" placeholder="Ej: Maisy Lime" autocomplete="off"
    style="padding:13px 14px;border:2px solid ${borInp};border-radius:10px;width:100%;
           font-size:15px;background:${bgInp};color:${colTxt}"></div>`;

  html += '<div class="field"><label style="color:'+( esNoche?'rgba(255,255,255,.6)':'#888')+'">NOCHES DE LUZ REQUERIDAS</label>';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  html += `<button onclick="ajustarNuevaVar(-1)"
    style="width:44px;height:44px;border-radius:50%;border:2px solid ${borInp};
           background:${bgInp};font-size:22px;cursor:pointer;color:var(--r);
           flex-shrink:0;font-weight:800;color:#E24B4A">−</button>`;
  html += `<input type="number" id="nueva-var-noches" value="19" min="1" max="99"
    style="flex:1;padding:12px;border:2px solid ${borInp};border-radius:10px;
           font-size:22px;font-weight:800;text-align:center;
           background:${bgInp};color:${colTxt}">`;
  html += `<button onclick="ajustarNuevaVar(1)"
    style="width:44px;height:44px;border-radius:50%;border:2px solid ${borInp};
           background:${bgInp};font-size:22px;cursor:pointer;
           flex-shrink:0;font-weight:800;color:#1D9E75">+</button>`;
  html += '</div></div>';

  html += `<button class="btn-g" onclick="guardarNuevaVariedad('${k}',${numCama})">Guardar variedad</button>`;
  html += '<div class="msg" id="msg-nueva-var"></div>';
  html += `<button onclick="cerrarModal()"
    style="margin-top:8px;width:100%;padding:11px;border-radius:12px;font-size:14px;font-weight:700;
           cursor:pointer;background:transparent;
           color:${esNoche?'rgba(255,255,255,.7)':'#555'};
           border:2px solid ${esNoche?'rgba(255,255,255,.25)':'#ccc'}">
    Cancelar</button>`;

  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-body').style.background = esNoche ? '#1e293b' : '#ffffff';
  document.getElementById('modal-body').style.color = colTxt;
  document.getElementById('modal-overlay').classList.add('show');
  setTimeout(()=>document.getElementById('nueva-var-nombre')?.focus(), 300);
}

function ajustarNuevaVar(delta) {
  const inp = document.getElementById('nueva-var-noches');
  if(!inp) return;
  inp.value = Math.max(1, Math.min(99, parseInt(inp.value||19) + delta));
}

async function guardarNuevaVariedad(k, numCama) {
  const nombre = document.getElementById('nueva-var-nombre')?.value?.trim();
  const noches = parseInt(document.getElementById('nueva-var-noches')?.value||19);
  const msg    = document.getElementById('msg-nueva-var');
  if(!nombre){ msg.textContent='Escribe el nombre de la variedad.'; msg.className='msg err'; msg.style.display='block'; return; }
  if(VARIEDADES[nombre]){ msg.textContent='Esta variedad ya existe en el catálogo.'; msg.className='msg err'; msg.style.display='block'; return; }
  VARIEDADES[nombre] = noches;
  await setConfig('variedades_custom', JSON.stringify(VARIEDADES));
  await addToSyncQueue('variedades', VARIEDADES);
  msg.textContent = `✓ "${nombre}" agregada con ${noches} noches.`;
  msg.className = 'msg ok'; msg.style.display = 'block';
  setTimeout(() => cerrarModal(), 1500);
}

// == CATÁLOGO COMPLETO DESDE SIEMBRA ==
// == CATÁLOGO COMPLETO ==
function abrirCatalogoCompleto(k, numCama) {
  _catK  = k;
  _catNC = numCama;

  const esNoche = document.body.classList.contains('noche');
  const bg      = esNoche ? '#1e293b' : '#ffffff';
  const bgInp   = esNoche ? '#0f172a' : '#f4f4f4';
  const colTxt  = esNoche ? '#f1f5f9' : '#222';
  const borInp  = esNoche ? '#334155' : '#e0e0e0';
  const colSub  = esNoche ? 'rgba(255,255,255,.5)' : '#888';

  const items = Object.entries(VARIEDADES)
    .filter(([v,n]) => n > 0)
    .sort((a,b) => a[0].localeCompare(b[0]));

  const filaHTML = ([v,n]) =>
    `<div class="cat-row" data-var="${v.replace(/"/g,'&quot;')}" data-noches="${n}"
      style="padding:12px 14px;border-bottom:1px solid ${borInp};cursor:pointer;
             display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600;color:${colTxt}">${v}</span>
      <span style="font-size:13px;font-weight:800;color:#1D9E75;margin-left:8px">${n}n</span>
    </div>`;

  let html = '<div class="modal-handle"></div>';
  html += `<div class="modal-title" style="color:#0F6E56">🔍 Catálogo de variedades</div>`;
  html += `<div style="font-size:11px;color:${colSub};margin-bottom:8px">${items.length} variedades disponibles</div>`;

  html += `<input type="text" id="cat-search-inp" placeholder="Escribe para buscar..."
    style="width:100%;padding:12px 14px;border:2px solid ${borInp};border-radius:10px;
           font-size:14px;background:${bgInp};color:${colTxt};margin-bottom:8px;
           -webkit-appearance:none;box-sizing:border-box">`;

  html += `<div id="cat-lista-div"
    style="max-height:260px;overflow-y:auto;border:1px solid ${borInp};
           border-radius:10px;margin-bottom:12px">
    ${items.map(filaHTML).join('')}
  </div>`;

  // Nueva variedad
  html += `<div style="border:2px solid ${borInp};border-radius:12px;padding:12px;margin-bottom:10px">
    <div style="font-size:12px;font-weight:700;color:#185FA5;margin-bottom:8px">
      ➕ No está en el catálogo — agregar nueva
    </div>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <input type="text" id="cat-nueva-nombre" placeholder="Nombre variedad"
        style="flex:1;padding:10px;border:2px solid ${borInp};border-radius:10px;
               font-size:13px;background:${bgInp};color:${colTxt};min-width:0">
      <button id="cat-menos"
        style="width:34px;height:42px;border-radius:8px;border:2px solid ${borInp};
               background:${bgInp};font-size:18px;cursor:pointer;color:#E24B4A;font-weight:800">−</button>
      <input type="number" id="cat-nueva-noches" value="19" min="1" max="99"
        style="width:48px;padding:8px 2px;border:2px solid ${borInp};border-radius:8px;
               font-size:15px;font-weight:800;text-align:center;background:${bgInp};color:${colTxt}">
      <button id="cat-mas"
        style="width:34px;height:42px;border-radius:8px;border:2px solid ${borInp};
               background:${bgInp};font-size:18px;cursor:pointer;color:#1D9E75;font-weight:800">+</button>
    </div>
    <button id="cat-guardar-nueva"
      style="width:100%;padding:10px;background:#0F6E56;color:#fff;border:none;
             border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">
      Guardar y usar esta variedad
    </button>
    <div id="cat-msg-nueva" style="display:none;margin-top:6px;padding:6px;border-radius:8px;
         font-size:11px;font-weight:700;text-align:center"></div>
  </div>`;

  html += `<button id="cat-cancelar"
    style="width:100%;padding:10px;border-radius:10px;font-size:13px;font-weight:700;
           cursor:pointer;background:transparent;color:${colSub};border:2px solid ${borInp}">
    Cancelar</button>`;

  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-body').style.background = bg;
  document.getElementById('modal-overlay').classList.add('show');

  // Event listeners — sin onclick inline
  setTimeout(() => {
    // Buscar
    const inp = document.getElementById('cat-search-inp');
    const lista = document.getElementById('cat-lista-div');
    if (inp) inp.focus();
    if (inp && lista) {
      inp.addEventListener('input', () => {
        const val = inp.value.toLowerCase();
        lista.querySelectorAll('.cat-row').forEach(row => {
          row.style.display = row.dataset.var.toLowerCase().includes(val) ? '' : 'none';
        });
        // Pre-rellenar nombre si no hay resultados
        const visible = [...lista.querySelectorAll('.cat-row')].filter(r=>r.style.display!=='none');
        if (!visible.length) {
          const nm = document.getElementById('cat-nueva-nombre');
          if (nm && inp.value) nm.value = inp.value;
        }
      });
    }

    // Seleccionar del catálogo
    if (lista) {
      lista.addEventListener('click', (e) => {
        const row = e.target.closest('.cat-row');
        if (!row) return;
        seleccionarDelCatalogo(row.dataset.var, parseInt(row.dataset.noches));
      });
    }

    // +/- noches nueva variedad
    document.getElementById('cat-menos')?.addEventListener('click', () => {
      const n = document.getElementById('cat-nueva-noches');
      if (n) n.value = Math.max(1, parseInt(n.value||19)-1);
    });
    document.getElementById('cat-mas')?.addEventListener('click', () => {
      const n = document.getElementById('cat-nueva-noches');
      if (n) n.value = Math.min(99, parseInt(n.value||19)+1);
    });

    // Guardar nueva variedad
    document.getElementById('cat-guardar-nueva')?.addEventListener('click', async () => {
      const nombre = document.getElementById('cat-nueva-nombre')?.value?.trim();
      const noches = parseInt(document.getElementById('cat-nueva-noches')?.value||19);
      const msg    = document.getElementById('cat-msg-nueva');
      if (!nombre) {
        msg.textContent='Escribe el nombre.'; msg.style.background='#FCEBEB';
        msg.style.color='#791F1F'; msg.style.display='block'; return;
      }
      VARIEDADES[nombre] = noches;
      await setConfig('variedades_custom', JSON.stringify(VARIEDADES));
      await addToSyncQueue('variedades', VARIEDADES);
      seleccionarDelCatalogo(nombre, noches);
    });

    // Cancelar
    document.getElementById('cat-cancelar')?.addEventListener('click', cerrarModal);
  }, 150);
}

// Versión para siembra anterior — usa abrirCatalogoCompleto con contexto
function abrirCatalogoCompletoAnt() {
  _catK  = '';
  _catNC = 0;
  const esNoche = document.body.classList.contains('noche');
  abrirCatalogoCompleto('', 0); // reusar la misma función
  // Sobrescribir selección para apuntar al sant-var
  setTimeout(()=>{
    const lista = document.getElementById('cat-lista');
    if(lista) {
      lista.onclick = (e)=>{
        const row = e.target.closest('[data-var]');
        if(!row) return;
        const sel = document.getElementById('sant-var');
        if(sel){
          let opt=Array.from(sel.options).find(o=>o.value===row.dataset.var);
          if(!opt){opt=new Option(`${row.dataset.var} (${row.dataset.noches}n)`,row.dataset.var);opt.dataset.noches=row.dataset.noches;sel.appendChild(opt);}
          sel.value=row.dataset.var; sel.style.display='';
        }
        cerrarModal();
        calcularSiembraAnt();
      };
    }
  }, 300);
}


function filtrarCatalogoAnt() {
  const val = document.getElementById('cat-search-ant')?.value?.toLowerCase()||'';
  document.querySelectorAll('.cat-item-ant').forEach(el => {
    el.style.display = el.dataset.nombre.includes(val) ? '' : 'none';
  });
}

function seleccionarCatalogoAnt(variedad, noches) {
  const sel = document.getElementById('sant-var');
  if(sel) {
    let opt = Array.from(sel.options).find(o=>o.value===variedad);
    if(!opt){ opt = new Option(`${variedad} (${noches}n)`,variedad); opt.dataset.noches=noches; sel.appendChild(opt); }
    sel.value = variedad;
    sel.style.display = '';
  }
  cerrarModal();
  calcularSiembraAnt();
}

// == FUNCIONES DEL CATÁLOGO ==
function renderCatItems() {
  const lista = document.getElementById('cat-lista');
  if(!lista) return;
  const val     = (document.getElementById('cat-search')?.value||'').toLowerCase();
  const esNoche = document.body.classList.contains('noche');
  const col     = esNoche ? '#f1f5f9' : '#222222';
  const bor     = esNoche ? '#334155' : '#e0e0e0';
  const sub     = esNoche ? 'rgba(255,255,255,.5)' : '#888';

  const items = Object.entries(VARIEDADES)
    .filter(([v,n]) => n>0 && v.toLowerCase().includes(val))
    .sort((a,b)=>a[0].localeCompare(b[0]));

  if(!items.length){
    lista.innerHTML = `<div style="padding:20px;text-align:center;color:${sub};font-size:13px">
      No se encontró en el catálogo.<br>
      <strong style="color:var(--a)">Agrégala en el cuadro de abajo ↓</strong>
    </div>`;
    const inp = document.getElementById('nueva-nombre');
    if(inp && val) inp.value = document.getElementById('cat-search').value;
    return;
  }
  lista.innerHTML = items.map(([v,n])=>
    `<div data-var="${v.replace(/"/g,'&quot;')}" data-noches="${n}"
      style="padding:12px 14px;border-bottom:1px solid ${bor};cursor:pointer;
             display:flex;justify-content:space-between;align-items:center;
             -webkit-tap-highlight-color:transparent">
      <span style="font-size:13px;font-weight:600;color:${col}">${v}</span>
      <span style="font-size:13px;font-weight:800;color:var(--vm);margin-left:8px">${n}n</span>
    </div>`
  ).join('');
}

function seleccionarDelCatalogo(variedad, noches) {
  // Agregar la variedad al selector del formulario activo
  const sel = document.getElementById('ind-var') || document.getElementById('sant-var');
  if (sel) {
    let opt = Array.from(sel.options).find(o => o.value === variedad);
    if (!opt) {
      opt = new Option(variedad + ' (' + noches + 'n)', variedad);
      opt.dataset.noches = noches;
      sel.appendChild(opt);
    }
    sel.value = variedad;
    sel.style.display = '';
  }
  cerrarModal();
  // Recalcular según el formulario activo
  if (document.getElementById('ind-fecha')) {
    updateSiembraIndividual(_catK, _catNC);
  } else {
    calcularSiembraAnt();
  }
}

async function guardarYSeleccionar() {
  const nombre = document.getElementById('nueva-nombre')?.value?.trim();
  const noches = parseInt(document.getElementById('nueva-noches')?.value||19);
  const msg    = document.getElementById('msg-nueva-cat');
  if(!nombre){
    if(msg){msg.textContent='Escribe el nombre.';msg.className='msg err';msg.style.display='block';}
    return;
  }
  VARIEDADES[nombre] = noches;
  await setConfig('variedades_custom', JSON.stringify(VARIEDADES));
  await addToSyncQueue('variedades', VARIEDADES);
  seleccionarDelCatalogo(nombre, noches);
}

// == CARGA MASIVA DE SIEMBRAS ==
function irCargaMasiva() {
  showScreen('sc-carga-masiva');
  setNavSel('nb-carga-masiva');
  renderCargaMasiva();
}

function renderCargaMasiva() {
  const wrap = document.getElementById('carga-masiva-content');
  if(!wrap) return;

  let html = '';
  html += `<div class="banner bb" style="border-radius:10px;margin-bottom:12px">
    <span>📤</span>
    <span>Carga el archivo Excel con las siembras anteriores. El sistema calculará noches restantes y encenderá las guirnaldas automáticamente.</span>
  </div>`;

  // Descargar plantilla
  html += `<div class="card" style="margin-bottom:10px">
    <div style="font-size:13px;font-weight:700;margin-bottom:8px">1. Descarga la plantilla</div>
    <div style="font-size:11px;color:var(--ts);margin-bottom:10px;line-height:1.6">
      Completa la plantilla con: Bloque, Cama, Lado, Variedad y Fecha real de siembra.
    </div>
    <a href="plantilla_siembras.xlsx" download
      style="display:block;width:100%;padding:11px;background:#7C3AED;color:#fff;
             border-radius:10px;text-align:center;font-size:13px;font-weight:700;
             text-decoration:none">
      ⬇ Descargar plantilla Excel
    </a>
  </div>`;

  // Cargar archivo
  html += `<div class="card" style="margin-bottom:10px">
    <div style="font-size:13px;font-weight:700;margin-bottom:8px">2. Carga el archivo completado</div>
    <label style="display:block;width:100%;padding:20px;border:2.5px dashed var(--bo);
                  border-radius:12px;text-align:center;cursor:pointer;background:var(--g)">
      <div style="font-size:24px;margin-bottom:6px">📂</div>
      <div style="font-size:13px;font-weight:600;color:var(--txt)">Toca para seleccionar archivo Excel</div>
      <div style="font-size:11px;color:var(--ts);margin-top:4px">.xlsx — máx 5MB</div>
      <input type="file" id="archivo-excel" accept=".xlsx"
        onchange="procesarExcel(this)" style="display:none">
    </label>
  </div>`;

  // Área de resumen (oculta hasta cargar)
  html += `<div id="resumen-carga" style="display:none"></div>`;
  wrap.innerHTML = html;
}

async function procesarExcel(input) {
  const file = input.files[0];
  if(!file) return;

  const wrap = document.getElementById('resumen-carga');
  wrap.style.display = 'block';
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div>Procesando archivo...</div>';

  try {
    // Leer con SheetJS (disponible vía CDN — necesita script tag)
    const data = await file.arrayBuffer();
    const wb   = XLSX.read(data, { type:'array', cellDates:true });
    const ws   = wb.Sheets['Siembras'];
    if(!ws){ throw new Error('No se encontró la hoja "Siembras" en el archivo.'); }

    const rows = XLSX.utils.sheet_to_json(ws, { header:1, range:4 }); // desde fila 5

    const validas = [];
    const errores = [];

    rows.forEach((row, idx) => {
      if(!row[0] && !row[1]) return; // fila vacía
      const fila = idx + 5;

      // Columnas: A=Bloque B=Cama C=Lado D=Variedad E=Noches F=Fecha G=Calculado
      const bl      = String(row[0]||'').trim();
      const cama    = parseInt(row[1]);
      const lado    = String(row[2]||'').trim().toUpperCase();
      const varN    = String(row[3]||'').trim();
      const nochesExcel = row[4] ? parseInt(row[4]) : null;
      let   fechaR  = row[5]; // Fecha ahora en columna F

      // Validaciones
      const errs = [];
      if(!BLOQUES[bl])              errs.push('Bloque no existe');
      if(isNaN(cama)||cama<1)       errs.push('Cama inválida');
      if(!['A','B'].includes(lado)) errs.push('Lado debe ser A o B');
      if(!varN && !nochesExcel)     errs.push('Debe tener Variedad o Noches');
      if(nochesExcel && (nochesExcel<1||nochesExcel>99)) errs.push('Noches debe ser entre 1 y 99');

      // Procesar fecha
      let fechaStr = '';
      if(fechaR instanceof Date) {
        fechaStr = fechaR.toISOString().split('T')[0];
      } else if(typeof fechaR === 'string') {
        fechaStr = fechaR.trim();
      } else if(typeof fechaR === 'number') {
        const d = new Date(Math.round((fechaR - 25569)*86400000));
        fechaStr = d.toISOString().split('T')[0];
      }
      if(!fechaStr || fechaStr > hoy()) errs.push('Fecha inválida o futura');

      if(errs.length) {
        errores.push({ fila, bl, cama, lado, varN, nochesExcel, errs });
        return;
      }

      // PRIORIDAD NOCHES:
      // 1. Noches del Excel (override) si están definidas
      // 2. Noches del catálogo si hay variedad
      // 3. 19 como fallback
      let noches;
      const varNombre = varN || 'Sin variedad';
      if(nochesExcel) {
        noches = nochesExcel;
        // Si variedad nueva (no en catálogo) + noches → agregar al catálogo
        if(varN && !VARIEDADES[varN]) {
          VARIEDADES[varN] = noches; // se guarda al confirmar
        }
      } else if(varN && VARIEDADES[varN]) {
        noches = VARIEDADES[varN];
      } else {
        noches = 19;
      }
      const diasT   = Math.floor((new Date(hoy())-new Date(fechaStr))/86400000);
      const nochR   = Math.max(0, noches - diasT);
      const nPerd   = calcularNochesPerdidas(fechaStr, new Date());
      const finCama = addDias(hoy(), nochR);

      // Identificar guirnalda
      const info  = BLOQUES[bl];
      const navesL = lado==='A' ? (info.navesA||[]) : (info.navesB||[]);
      let nave=0, posEnNave=0, acum=0;
      for(let n=0;n<navesL.length;n++){
        if(cama <= acum + navesL[n]){ nave=n+1; posEnNave=cama-acum; break; }
        acum += navesL[n];
      }
      const g       = Math.ceil(posEnNave/2);
      const numCama = posEnNave%2===0 ? 2 : 1;
      const k       = gKey(bl, nave, lado, g);

      validas.push({
        fila, bl:parseInt(bl), cama, lado,
        varN: varNombre, noches, nochesExcel,
        fechaStr, diasT, nochR, nPerd, finCama,
        nave, g, numCama, k,
        esNuevaVar: varN && !VARIEDADES[varN] && !!nochesExcel,
        yaRegistrada: !!guirnaldas[k]?.['variedad'+numCama]
      });
    });

    mostrarResumen(validas, errores);

  } catch(e) {
    wrap.innerHTML = `<div class="banner ba" style="border-radius:10px">
      <span>⚠</span><span>Error al leer el archivo: ${e.message}</span></div>`;
  }
}

function mostrarResumen(validas, errores) {
  const wrap = document.getElementById('resumen-carga');
  const ok   = validas.filter(v=>!v.yaRegistrada);
  const dup  = validas.filter(v=>v.yaRegistrada);
  let html   = '';

  html += `<div class="sec-lbl" style="margin-top:4px">3. Resumen — Confirma antes de guardar</div>`;

  // Stats
  html += `<div class="res-row" style="margin-bottom:10px">
    <div class="res-chip"><div class="res-num" style="color:var(--vm)">${ok.length}</div><div class="res-lbl">A registrar</div></div>
    <div class="res-chip"><div class="res-num" style="color:var(--n)">${dup.length}</div><div class="res-lbl">Duplicadas</div></div>
    <div class="res-chip"><div class="res-num" style="color:var(--r)">${errores.length}</div><div class="res-lbl">Con error</div></div>
  </div>`;

  // Tabla de registros válidos
  if(ok.length) {
    html += `<div class="card" style="margin-bottom:10px;padding:0;overflow:hidden">
      <div style="padding:10px 14px;background:var(--vl);font-size:11px;font-weight:700;color:var(--vd)">
        ✓ Siembras a registrar (${ok.length})
      </div>`;
    ok.slice(0,50).forEach(v => {
      const colN = v.nochR===0?'var(--r)':v.nochR<=3?'var(--n)':'var(--vm)';
      html += `<div style="display:flex;justify-content:space-between;align-items:center;
        padding:8px 14px;border-bottom:1px solid var(--bo)">
        <div>
          <div style="font-size:12px;font-weight:700">B${v.bl} · C${v.cama} · L${v.lado}</div>
          <div style="font-size:10px;color:var(--ts)">${v.varN} · Sembrada ${fmtF(v.fechaStr)}</div>
          ${v.nPerd>0?`<div style="font-size:10px;color:var(--r)">⚠ ${v.nPerd}n perdidas</div>`:''}
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:8px">
          <div style="font-size:13px;font-weight:800;color:${colN}">${v.nochR}n</div>
          <div style="font-size:9px;color:var(--ts)">Fin: ${fmtF(v.finCama)}</div>
        </div>
      </div>`;
    });
    if(ok.length>50) html += `<div style="padding:8px 14px;font-size:11px;color:var(--ts)">... y ${ok.length-50} más</div>`;
    html += `</div>`;
  }

  // Errores
  if(errores.length) {
    html += `<div class="card alerta" style="margin-bottom:10px;padding:0;overflow:hidden">
      <div style="padding:10px 14px;background:var(--rl);font-size:11px;font-weight:700;color:var(--rd)">
        ✗ Filas con error — no se registrarán (${errores.length})
      </div>`;
    errores.forEach(e => {
      html += `<div style="padding:8px 14px;border-bottom:1px solid var(--bo)">
        <div style="font-size:11px;font-weight:700">Fila ${e.fila}: B${e.bl} C${e.cama} L${e.lado}</div>
        <div style="font-size:10px;color:var(--r)">${e.errs.join(' · ')}</div>
      </div>`;
    });
    html += `</div>`;
  }

  if(ok.length) {
    html += `<button class="btn-g" onclick="confirmarCargaMasiva()">
      ⚡ Registrar ${ok.length} siembras y encender guirnaldas
    </button>`;
  } else {
    html += `<div class="banner ba" style="border-radius:10px">
      <span>⚠</span><span>No hay siembras válidas para registrar.</span></div>`;
  }
  html += `<div class="msg" id="msg-carga" style="margin-top:8px"></div>`;

  wrap.innerHTML = html;
  // Guardar datos para confirmación
  window._cargaMasivaDatos = ok;
}

async function confirmarCargaMasiva() {
  const datos = window._cargaMasivaDatos || [];
  if(!datos.length) return;
  const msg = document.getElementById('msg-carga');
  msg.textContent = 'Guardando...'; msg.className='msg ok'; msg.style.display='block';

  // Guardar variedades nuevas al catálogo
  let varNuevas = 0;
  for(const v of datos) {
    if(v.esNuevaVar && v.nochesExcel) {
      VARIEDADES[v.varN] = v.nochesExcel;
      varNuevas++;
    }
  }
  if(varNuevas > 0) {
    await setConfig('variedades_custom', JSON.stringify(VARIEDADES));
    await addToSyncQueue('variedades', VARIEDADES);
  }

  let guardados = 0;
  for(const v of datos) {
    const gdExist = guirnaldas[v.k] || {};
    const gdActual = {
      ...gdExist, id:v.k, bloque:v.bl, nave:v.nave, lado:v.lado, g:v.g,
      encendida: v.nochR > 0, fechaFin: v.finCama,
      noches: Math.max(v.nochR, gdExist.noches||0)
    };
    if(v.numCama===1){
      gdActual.variedad1=v.varN; gdActual.noches1=v.noches;
      gdActual.fechaIni1=v.fechaStr; gdActual.nochesRestantes1=v.nochR;
      if(!gdActual.fechaIni) gdActual.fechaIni=v.fechaStr;
    } else {
      gdActual.variedad2=v.varN; gdActual.noches2=v.noches;
      gdActual.fechaIni2=v.fechaStr; gdActual.nochesRestantes2=v.nochR;
      if(!gdActual.fechaIni) gdActual.fechaIni=v.fechaStr;
    }
    guirnaldas[v.k] = gdActual;
    await dbPut('guirnaldas', gdActual);
    await dbAdd('siembras',{
      bloque:v.bl, nave:v.nave, lado:v.lado, g:v.g, key:v.k,
      cama:v.cama, numCama:v.numCama, variedad:v.varN,
      noches:v.noches, nochesRestantes:v.nochR, nochesPerdidas:v.nPerd,
      fechaIniReal:v.fechaStr, fechaIni:hoy(), fechaFinGuirnalda:v.finCama,
      esAnterior:true, cargaMasiva:true, operario,
      fecha:new Date().toISOString()
    });
    await addToSyncQueue('siembra', gdActual);
    guardados++;
  }

  msg.textContent = `✓ ${guardados} siembras registradas correctamente.`;
  buildInicio();
  window._cargaMasivaDatos = [];
}

// == LIMPIEZA DE GUIRNALDAS EXPIRADAS ==
async function limpiarGuirnaldasExpiradas() {
  // Archiva guirnaldas cuyo ciclo terminó hace más de 3 noches
  // EXCEPCIÓN: si se registró una nueva siembra en esa cama → reinicia el ciclo
  let limpiadas = 0;

  for (const [k, gd] of Object.entries(guirnaldas)) {
    if (estadoGuirnalda(gd) !== 'expirada') continue;

    // Verificar si hay una siembra POSTERIOR a la fecha de fin del ciclo anterior
    // Esto indica que la cama fue resembrada → no expirar
    const siembrasDB = await dbGetAll('siembras');
    const siembraPost = siembrasDB.find(s =>
      s.key === k &&
      s.fecha > (gd.fechaFin || '') &&
      !s.esAnterior  // siembra nueva registrada después del fin de ciclo
    );

    if (siembraPost) {
      // Hay siembra nueva — el ciclo ya fue reiniciado, no expirar
      console.log(`Guirnalda ${k} tiene siembra nueva — no se archiva`);
      continue;
    }

    // Sin siembra nueva → archivar y eliminar
    await dbAdd('historial_guirnaldas', {
      ...gd,
      archivedAt: new Date().toISOString(),
      motivo: 'ciclo_completado_3_noches_gracia'
    }).catch(()=>{});

    delete guirnaldas[k];
    await dbDelete('guirnaldas', k).catch(()=>{});
    limpiadas++;
  }

  if (limpiadas > 0) {
    console.log(`Guirnaldas expiradas archivadas: ${limpiadas}`);
    buildInicio();
  }
}


// == TAREAS DEL DÍA ==
function irTareas() {
  showScreen('sc-tareas');
  setNavSel('nb-tareas');
  renderTareas();
}

async function renderTareas() {
  const wrap = document.getElementById('tareas-content');
  if (!wrap) return;

  // Datos base
  const hoyStr    = hoy();
  const semCp     = semanaCorta(); // ej: "2618"
  const semLabel  = '20'+semCp.slice(0,2)+'-W'+semCp.slice(2);
  const diasSem   = diaDeSemana(); // 0=lun...6=dom
  const diasNombres = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const fechaLabel = diasNombres[diasSem]+' '+hoyStr.split('-').reverse().slice(0,2).join('/');

  // ── HORÓMETROS SIN REGISTRAR ──
  const lecturasTodas = await dbGetAll('lecturas');
  const lectsHoy = lecturasTodas.filter(l => l.fecha?.startsWith(hoyStr));
  const horosPendientes = [];

  for (const [bl, info] of Object.entries(BLOQUES)) {
    if (!info.naves) continue;
    const horos = calcHoros(parseInt(bl));
    for (const h of horos) {
      let tieneActivas = false;
      let gEncCount = 0;
      for (let n = h.nIni; n <= h.nFin; n++) {
        for (const lado of ['A','B']) {
          for (let g = 1; g <= 2; g++) {
            const est = estadoGuirnalda(guirnaldas[gKey(bl,n,lado,g)]);
            if (est==='encendida'||est==='por-vencer') { tieneActivas=true; gEncCount++; }
          }
        }
      }
      if (!tieneActivas) continue;
      const tieneReg = lectsHoy.some(l => String(l.bloque)===String(bl) && l.horometro===h.id);
      if (!tieneReg) horosPendientes.push({ bl:parseInt(bl), horo:h.id, turno:h.turno, gEnc:gEncCount });
    }
  }

  // ── GUIRNALDAS POR VENCER (≤3 noches) ──
  const porVencer = Object.values(guirnaldas)
    .filter(gd => estadoGuirnalda(gd)==='por-vencer')
    .map(gd => {
      const dr = diasRest(gd.fechaFin);
      const camR = camasDeGuirnalda(gd.nave, gd.g);
      const base = camaBaseAbsoluta(gd.bloque, gd.nave, gd.lado);
      return { ...gd, dr, c1: base+camR[0], c2: base+camR[1] };
    })
    .sort((a,b) => a.dr - b.dr);

  // ── PROGRESO PLAN DE SIEMBRA ──
  const planSem   = planSemanaActual();
  const siembras  = await dbGetAll('siembras');
  const semIni    = semanaIso(new Date());
  const siembrasSem = siembras.filter(s => {
    const f = new Date(s.fecha);
    return semanaIso(f) === semIni;
  });

  const planProgress = planSem.map(p => {
    const sembradas = siembrasSem.filter(s =>
      (s.variedad||s.variedad1||'').toUpperCase() === p.variedad.toUpperCase()
    ).length;
    return { ...p, sembradas, faltan: Math.max(0, p.cantidad - sembradas) };
  }).sort((a,b) => b.faltan - a.faltan);

  const totalPorSembrar = planProgress.reduce((s,p) => s+p.faltan, 0);

  // ── GUIRNALDAS ACTIVAS ──
  const totalActivas = Object.values(guirnaldas)
    .filter(gd => estadoGuirnalda(gd)==='encendida'||estadoGuirnalda(gd)==='por-vencer').length;

  // ── RECORRIDO SUGERIDO ──
  const bloquesHoros = [...new Set(horosPendientes.map(h=>h.bl))];
  const bloquesVence = [...new Set(porVencer.map(g=>g.bloque))].filter(b=>!bloquesHoros.includes(b));
  const recorrido    = [...bloquesHoros, ...bloquesVence].slice(0, 8);

  // ── RENDER HTML ──
  const esNoche = document.body.classList.contains('noche');
  const colSub  = esNoche ? 'rgba(255,255,255,.5)' : '#888';
  const colBrd  = esNoche ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)';

  const cardStyle = `background:var(--card);border:1px solid ${colBrd};border-radius:14px;overflow:hidden;margin-bottom:12px`;
  const rowStyle  = `display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid ${colBrd}`;
  const lastRowS  = `display:flex;align-items:center;gap:10px;padding:10px 12px`;
  const secLbl    = `font-size:10px;font-weight:700;color:${colSub};text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;padding:0 2px`;
  const icoBase   = `width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;font-weight:700`;

  let html = '';

  // Header
  html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
    <div>
      <div style="font-size:16px;font-weight:700;color:var(--txt)">Buenos días, ${operario||'—'}</div>
      <div style="font-size:12px;color:${colSub};margin-top:2px">${fechaLabel} · Sem ${semLabel}</div>
    </div>
    ${horosPendientes.length>0 ?
      `<span style="background:rgba(226,75,74,.15);color:#E24B4A;border:1px solid rgba(226,75,74,.3);font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px">${horosPendientes.length} urgentes</span>` :
      `<span style="background:rgba(29,158,117,.15);color:#1D9E75;border:1px solid rgba(29,158,117,.3);font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px">Al día ✓</span>`
    }
  </div>`;

  // Stats
  html += `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:14px">
    <div style="background:var(--card);border:1px solid ${colBrd};border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#E24B4A">${horosPendientes.length}</div>
      <div style="font-size:10px;color:${colSub};margin-top:2px">Horómetros pendientes</div>
    </div>
    <div style="background:var(--card);border:1px solid ${colBrd};border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:#F59E0B">${porVencer.length}</div>
      <div style="font-size:10px;color:${colSub};margin-top:2px">Guirnaldas por vencer</div>
    </div>
    <div style="background:var(--card);border:1px solid ${colBrd};border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:var(--v)">${totalActivas}</div>
      <div style="font-size:10px;color:${colSub};margin-top:2px">Guirnaldas activas</div>
    </div>
    <div style="background:var(--card);border:1px solid ${colBrd};border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:${colSub}">${totalPorSembrar}</div>
      <div style="font-size:10px;color:${colSub};margin-top:2px">Camas por sembrar</div>
    </div>
  </div>`;

  // HORÓMETROS PENDIENTES
  if (horosPendientes.length > 0) {
    html += `<div style="${secLbl}">Horómetros sin registrar hoy</div>`;
    html += `<div style="${cardStyle}">`;
    horosPendientes.forEach((h, i) => {
      const isLast = i === horosPendientes.length-1;
      html += `<div style="${isLast?lastRowS:rowStyle}">
        <div style="${icoBase};background:rgba(226,75,74,.15);color:#E24B4A">!</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--txt)">Bloque ${h.bl} · ${h.horo}</div>
          <div style="font-size:11px;color:${colSub}">Naves ${h.nIni||1}–${h.nFin||6} · ${h.turno.inicio}–${h.turno.fin} · ${h.gEnc} guirnaldas activas</div>
        </div>
        <button onclick="irHoroDirecto(${h.bl})"
          style="background:rgba(226,75,74,.15);color:#E24B4A;border:1px solid rgba(226,75,74,.3);border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0">
          Ir →
        </button>
      </div>`;
    });
    html += `</div>`;
  }

  // GUIRNALDAS POR VENCER
  if (porVencer.length > 0) {
    html += `<div style="${secLbl}">Guirnaldas próximas a vencer</div>`;
    html += `<div style="${cardStyle}">`;
    porVencer.slice(0,5).forEach((g, i) => {
      const isLast = i === Math.min(porVencer.length,5)-1;
      const colN = g.dr <= 1 ? '#E24B4A' : '#F59E0B';
      const bgN  = g.dr <= 1 ? 'rgba(226,75,74,.15)' : 'rgba(245,158,11,.15)';
      const borN = g.dr <= 1 ? 'rgba(226,75,74,.3)'  : 'rgba(245,158,11,.3)';
      html += `<div style="${isLast?lastRowS:rowStyle}">
        <div style="${icoBase};background:${bgN};color:${colN}">~</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--txt)">B${g.bloque} · Nave ${g.nave} · Lado ${g.lado} · Camas ${g.c1}–${g.c2}</div>
          <div style="font-size:11px;color:${colSub}">${g.variedad1||'—'} · Vence ${fmtF(g.fechaFin)}</div>
        </div>
        <span style="background:${bgN};color:${colN};border:1px solid ${borN};font-size:11px;font-weight:700;padding:4px 9px;border-radius:20px;flex-shrink:0">
          ${g.dr <= 0 ? 'Hoy' : g.dr+'n'}
        </span>
      </div>`;
    });
    html += `</div>`;
  }

  // PLAN DE SIEMBRA
  if (planProgress.length > 0) {
    html += `<div style="${secLbl}">Plan de siembra — semana ${semLabel}</div>`;
    html += `<div style="${cardStyle}">`;
    planProgress.slice(0,6).forEach((p, i) => {
      const isLast = i === Math.min(planProgress.length,6)-1;
      const pct  = p.cantidad > 0 ? Math.round(p.sembradas/p.cantidad*100) : 100;
      const done = p.faltan === 0;
      const colB = done ? '#3B6D11' : p.sembradas>0 ? '#0F6E56' : '#E24B4A';
      html += `<div style="padding:10px 12px;${!isLast?'border-bottom:1px solid '+colBrd:''}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
          <span style="font-size:13px;font-weight:700;color:var(--txt)">${p.variedad}</span>
          <span style="font-size:11px;color:${colSub}">${p.sembradas}/${p.cantidad}
            ${done
              ? '<span style="color:#3B6D11;font-weight:700"> ✓ Completo</span>'
              : `· <span style="color:#E24B4A;font-weight:700">faltan ${p.faltan}</span>`}
          </span>
        </div>
        <div style="height:5px;background:var(--g);border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${colB};border-radius:3px;transition:width .4s"></div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // RECORRIDO SUGERIDO
  if (recorrido.length > 0) {
    html += `<div style="${secLbl}">Recorrido sugerido hoy</div>`;
    html += `<div style="${cardStyle}">`;
    html += `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:10px 12px">`;
    recorrido.forEach((bl, i) => {
      const esHoro  = bloquesHoros.includes(bl);
      const bg = esHoro ? 'rgba(226,75,74,.15)' : 'rgba(245,158,11,.15)';
      const col= esHoro ? '#E24B4A' : '#854F0B';
      const bor= esHoro ? 'rgba(226,75,74,.3)' : 'rgba(245,158,11,.3)';
      if (i>0) html += `<span style="font-size:11px;color:${colSub}">→</span>`;
      html += `<span onclick="abrirBloque(${bl});irBloques();"
        style="font-size:12px;font-weight:700;padding:5px 11px;border-radius:20px;
               background:${bg};color:${col};border:1px solid ${bor};cursor:pointer">B${bl}</span>`;
    });
    html += `</div>`;
    html += `<div style="padding:0 12px 10px;font-size:11px;color:${colSub}">
      Rojo = horómetro urgente · Naranja = guirnalda por vencer · Toca para ir al bloque
    </div></div>`;
  }

  // Si todo está al día
  if (horosPendientes.length===0 && porVencer.length===0) {
    html += `<div style="background:rgba(29,158,117,.1);border:1px solid rgba(29,158,117,.2);border-radius:14px;padding:20px;text-align:center;margin-bottom:12px">
      <div style="font-size:24px;margin-bottom:8px">✓</div>
      <div style="font-size:14px;font-weight:700;color:var(--v)">Todo al día</div>
      <div style="font-size:12px;color:${colSub};margin-top:4px">Sin tareas urgentes hoy</div>
    </div>`;
  }

  wrap.innerHTML = html;
}

// Ir directamente al horómetro de un bloque
function irHoroDirecto(bl) {
  abrirBloque(bl);
  showScreen('sc-bloque');
  // Cambiar pestaña a horómetros
  setTimeout(() => {
    const tabHoro = document.querySelector('[onclick*="renderHoros"]');
    if (tabHoro) tabHoro.click();
  }, 300);
}

// Helper: semana ISO para comparar
function semanaIso(fecha) {
  const d = new Date(fecha);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate()+4-(d.getDay()||7));
  const y = d.getFullYear();
  const w = Math.ceil(((d-new Date(y,0,1))/86400000+1)/7);
  return `${y}-W${String(w).padStart(2,'0')}`;
}

// Helper: día de semana lunes=0
function diaDeSemana() {
  return (new Date().getDay()+6)%7;
}

// == LISTENER BOTONES VARIEDAD (event delegation) ==
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.var-plan-btn');
  if (!btn) return;
  // Desmarcar todos
  document.querySelectorAll('.var-plan-btn').forEach(b => {
    b.style.borderColor = 'var(--bo)';
    b.style.background  = 'var(--g)';
    b.querySelector('div > div:first-child').style.color = 'var(--txt)';
  });
  // Marcar el seleccionado
  btn.style.borderColor = '#0F6E56';
  btn.style.background  = 'rgba(29,158,117,.1)';
  btn.querySelector('div > div:first-child').style.color = '#0F6E56';

  // Sincronizar con el select oculto
  const sel = document.getElementById('ind-var');
  if (sel) {
    sel.value = btn.dataset.var;
    // Asegurar que la opción existe
    let opt = Array.from(sel.options).find(o => o.value === btn.dataset.var);
    if (!opt) {
      opt = new Option(btn.dataset.var, btn.dataset.var);
      opt.dataset.noches = btn.dataset.noches;
      sel.appendChild(opt);
      sel.value = btn.dataset.var;
    }
    if (opt) opt.dataset.noches = btn.dataset.noches;
    // Disparar actualización
    const k  = document.getElementById('ind-fecha')?.dataset?.k;
    const nc = document.getElementById('ind-fecha')?.dataset?.nc;
    if (k && nc) updateSiembraIndividual(k, parseInt(nc));
  }
});
