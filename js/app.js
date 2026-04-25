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
  horoMinimo : 1.0,
  maxNavesH  : 6,      // máx naves por horómetro
  camasPorNave: 4,     // camas por nave por lado
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
  if (!gd || !gd.variedad1) return 'sin-sembrar';
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
// ── GUIRNALDAS — DISEÑO VISUAL BOMBILLOS ─────────────────────────────────────
function crearBombillosHTML(estado, n=10) {
  let html = '<div class="bombillos-wrap-v2"><div class="cable-h"></div><div class="bombillos-row '+estado+'">';
  for(let i=0;i<n;i++){
    html += '<div class="bombillo"><div class="b-sock"></div>';
    html += '<div class="b-bulb"><div class="b-shine"></div><div class="b-fil"></div></div></div>';
  }
  html += '</div></div>';
  return html;
}

function renderGuirnaldas(b) {
  const info  = BLOQUES[String(b)];
  const horos = calcHoros(b);

  // Leyenda
  let html = '<div class="leyenda-v2">';
  html += '<div class="ley-item"><div class="ley-dot" style="background:#fdd835;box-shadow:0 0 4px #fdd835"></div>Encendida</div>';
  html += '<div class="ley-item"><div class="ley-dot" style="background:#F59E0B"></div>Por vencer</div>';
  html += '<div class="ley-item"><div class="ley-dot" style="background:#555"></div>Apagada</div>';
  html += '<div class="ley-item"><div class="ley-dot" style="border:1.5px dashed #888;background:transparent"></div>Sin sembrar</div>';
  html += '</div>';

  horos.forEach(h=>{
    for(let n=h.nIni;n<=h.nFin;n++){
      html += '<div class="nave-wrap">';
      html += '<div class="nave-header">';
      html += '<span class="nave-num">🏠 Nave '+n+'</span>';
      html += '<span class="nave-horo">⏱ '+h.id+' · '+h.turno.inicio+'–'+h.turno.fin+'</span>';
      html += '</div>';

      ['A','B'].forEach(lado=>{
        html += '<div class="lado-section">';
        html += '<div class="lado-label">';
        html += '<span class="lado-tag">Lado '+lado+'</span>';
        html += '<div class="lado-line-v2"></div>';
        html += '<span class="lado-count">2 guirnaldas</span>';
        html += '</div>';

        for(let g=1;g<=2;g++){
          const k    = gKey(b,n,lado,g);
          const gd   = guirnaldas[k];
          const est  = estadoGuirnalda(gd);
          const camR = camasDeGuirnalda(n,g);
          const c1   = (n-1)*4 + camR[0];
          const c2   = (n-1)*4 + camR[1];
          const dr   = gd?.fechaFin ? diasRest(gd.fechaFin) : null;

          // Badge días
          let badgeCls='dias-empty', badgeTxt='Sin sembrar';
          if(est==='encendida'&&dr!==null){badgeCls='dias-ok';badgeTxt=dr+' noches';}
          if(est==='por-vencer'&&dr!==null){badgeCls='dias-warn';badgeTxt='⚠ '+dr+' noches';}
          if(est==='apagada-auto'){badgeCls='dias-off';badgeTxt='Ciclo completo';}

          // Tag estado
          let etCls='et-empty', etTxt='Sin sembrar';
          if(est==='encendida'){etCls='et-on';etTxt='● Encendida';}
          if(est==='por-vencer'){etCls='et-warn';etTxt='⚠ Por vencer';}
          if(est==='apagada-auto'){etCls='et-off';etTxt='✕ Apagada';}
          if(est==='sembrada-apagada'){etCls='et-warn';etTxt='Sembrada';}

          html += '<div class="guirnalda-card '+est+'" onclick="abrirGuirnalda(\''+ k+'\','+b+','+n+',\''+lado+'\','+g+')">';
          html += '<span class="estado-tag '+etCls+'">'+etTxt+'</span>';
          html += '<div class="camas-title-v2">';
          html += '<span class="camas-num-v2">Camas '+c1+' — '+c2+'</span>';
          html += '<span class="camas-side-v2">Lado '+lado+'</span>';
          html += '</div>';
          html += '<div class="camas-nave-v2">Nave '+n+' · '+h.id+'</div>';
          html += crearBombillosHTML(est);

          if(gd?.variedad1){
            const v2 = gd.variedad2 && gd.variedad2!==gd.variedad1 ? ' / '+gd.variedad2 : '';
            html += '<div class="info-row-v2">';
            html += '<div><div class="variedad-name-v2">🌸 '+gd.variedad1+v2+'</div>';
            html += '<div class="variedad-sub-v2">'+gd.noches+' noches';
            if(gd.fechaIni) html += ' · desde '+fmtF(gd.fechaIni);
            html += '</div></div>';
            html += '<div class="dias-badge '+badgeCls+'">'+badgeTxt+'</div>';
            html += '</div>';
          } else {
            html += '<div class="sembrar-hint-v2">🌱 Toca para registrar siembra</div>';
          }
          html += '</div>';
        }
        html += '</div>'; // lado-section
      });
      html += '</div>'; // nave-wrap
    }
  });

  document.getElementById('dv-guirnaldas').innerHTML = html || '<div class="empty">Sin guirnaldas configuradas</div>';
}

// ── MODAL GUIRNALDA ───────────────────────────
function abrirGuirnalda(k, bl, nave, lado, g) {
  const gd  = guirnaldas[k] || {};
  const est = estadoGuirnalda(gd);
  const cams = camasDeGuirnalda(nave, g);
  const camAbs = [(nave-1)*4+cams[0], (nave-1)*4+cams[1]];
  const horo = horoDeNave(bl, nave);
  const semPlan = planSemanaActual();

  let html = '<div class="modal-handle"></div>';
  html += '<div class="modal-title">Guirnalda G'+nave+lado+g+' · Bloque '+bl+'</div>';
  html += '<div style="font-size:12px;color:var(--ts);margin-bottom:12px">';
  html += 'Camas '+camAbs[0]+' y '+camAbs[1]+' · Lado '+lado+' · Nave '+nave+'<br>';
  html += 'Horómetro: '+(horo?horo.id+' ('+horo.turno.inicio+'–'+horo.turno.fin+')':'—')+'</div>';

  // Estado actual
  const colE = colorEstado(est);
  html += '<div class="banner '+(est==='encendida'?'bk':est==='apagada-auto'?'ba':est==='por-vencer'?'bw':'bb')+'" style="margin-bottom:12px">';
  html += '<div style="width:10px;height:10px;border-radius:50%;background:'+colE+';flex-shrink:0;margin-top:2px"></div>';
  html += '<div><strong>'+textoEstado(est)+'</strong>';
  if(gd.variedad1) html += '<br>'+gd.variedad1+(gd.variedad2&&gd.variedad2!==gd.variedad1?' / '+gd.variedad2:'');
  if(gd.noches)    html += '<br>'+gd.noches+' noches';
  if(gd.fechaIni)  html += ' · Inicio: '+fmtF(gd.fechaIni);
  if(gd.fechaFin)  html += ' · Fin: '+fmtF(gd.fechaFin);
  html += '</div></div>';

  if(est==='sin-sembrar'||est==='sembrada-apagada'){
    // REGISTRO DE SIEMBRA
    html += '<div class="sem-form">';
    html += '<div class="sem-title">Registrar siembra</div>';

    // Cama 1
    html += '<div class="field"><label>Variedad — Cama '+camAbs[0]+'</label>';
    html += '<select id="g-var1" onchange="updateGuirnResult(\''+k+'\')"><option value="">Selecciona variedad...</option>';
    semPlan.forEach(p=>{
      html+='<option value="'+p.variedad+'" data-noches="'+p.noches+'">'+p.variedad+' ('+p.noches+'n · '+p.cantidad+'c)</option>';
    });
    // También todas las variedades
    html += '<optgroup label="── Todas las variedades ──">';
    Object.entries(VARIEDADES).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([v,n])=>{
      html+='<option value="'+v+'" data-noches="'+n+'">'+v+' ('+n+' noches)</option>';
    });
    html += '</optgroup></select></div>';

    // Cama 2
    html += '<div class="field"><label>Variedad — Cama '+camAbs[1]+' (opcional)</label>';
    html += '<select id="g-var2" onchange="updateGuirnResult(\''+k+'\')"><option value="">Igual que cama '+camAbs[0]+'</option>';
    semPlan.forEach(p=>{
      html+='<option value="'+p.variedad+'" data-noches="'+p.noches+'">'+p.variedad+' ('+p.noches+'n)</option>';
    });
    html += '<optgroup label="── Todas ──">';
    Object.entries(VARIEDADES).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([v,n])=>{
      html+='<option value="'+v+'" data-noches="'+n+'">'+v+' ('+n+' noches)</option>';
    });
    html += '</optgroup></select></div>';

    html += '<div id="guirn-result" style="display:none" class="result-box"></div>';
    html += '<button class="btn-g" onclick="registrarSiembra(\''+k+'\','+bl+','+nave+',\''+lado+'\','+g+')">Registrar siembra y encender guirnalda</button>';
    html += '</div>';
  } else {
    // VER DETALLE
    if(gd.fechaFin){
      const dr = diasRest(gd.fechaFin);
      if(dr>0){
        const pct = Math.round((gd.noches-dr)/gd.noches*100);
        html += '<div style="margin-bottom:12px">';
        html += '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span>Progreso</span><span>'+pct+'%</span></div>';
        html += '<div class="prog"><div class="prog-f" style="width:'+pct+'%;background:var(--vm)"></div></div>';
        html += '<div style="font-size:11px;color:var(--ts)">Faltan '+dr+' noches · Fin: '+fmtF(gd.fechaFin)+'</div></div>';
      }
    }
    html += '<button class="btn-outline" onclick="cerrarModal()" style="margin-top:4px">Cerrar</button>';
  }

  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('show');
}

function updateGuirnResult(k) {
  const sel1 = document.getElementById('g-var1');
  const sel2 = document.getElementById('g-var2');
  const res  = document.getElementById('guirn-result');
  if (!sel1?.value) { res.style.display='none'; return; }
  const var1   = sel1.value;
  const noch1  = parseInt(sel1.selectedOptions[0]?.dataset?.noches||0);
  const var2   = sel2?.value || var1;
  const noch2  = sel2?.value ? parseInt(sel2.selectedOptions[0]?.dataset?.noches||noch1) : noch1;
  const noches = Math.max(noch1, noch2);
  const fechaFin = addDias(hoy(), noches);
  res.style.display='block';
  res.innerHTML =
    '<div class="rb-row"><span class="rb-key">Cama 1 — variedad</span><span class="rb-val">'+var1+'</span></div>'+
    '<div class="rb-row"><span class="rb-key">Cama 2 — variedad</span><span class="rb-val">'+var2+'</span></div>'+
    '<div class="rb-row"><span class="rb-key">Noches de luz</span><span class="rb-val">'+noches+' (máximo)</span></div>'+
    '<div class="rb-row"><span class="rb-key">Fecha inicio</span><span class="rb-val">'+fmtF(hoy())+'</span></div>'+
    '<div class="rb-row"><span class="rb-key">Fecha apagado</span><span class="rb-val">'+fmtF(fechaFin)+'</span></div>'+
    '<div class="banner bk" style="margin-top:6px"><span>⚡</span><span>Guirnalda se encenderá automáticamente al guardar.</span></div>';
}

async function registrarSiembra(k, bl, nave, lado, g) {
  const sel1 = document.getElementById('g-var1');
  if (!sel1?.value) { alert('Selecciona la variedad de la cama 1'); return; }
  const var1  = sel1.value;
  const noch1 = parseInt(sel1.selectedOptions[0]?.dataset?.noches||0);
  const sel2  = document.getElementById('g-var2');
  const var2  = sel2?.value || var1;
  const noch2 = sel2?.value ? parseInt(sel2.selectedOptions[0]?.dataset?.noches||noch1) : noch1;
  const noches   = Math.max(noch1, noch2);
  const fechaIni = hoy();
  const fechaFin = addDias(fechaIni, noches);

  // Crear/actualizar guirnalda
  const gd = {
    id: k, bloque:bl, nave, lado, g,
    variedad1:var1, noches1:noch1,
    variedad2:var2, noches2:noch2,
    noches, fechaIni, fechaFin,
    encendida: true,  // ← AUTOMÁTICO
    operario, fechaRegistro: new Date().toISOString()
  };
  guirnaldas[k] = gd;
  await dbPut('guirnaldas', gd);

  // GPS
  const gpsRes = await gpsValidar(bl);

  // Siembra en historial
  const cams = camasDeGuirnalda(nave, g);
  const camAbs = [(nave-1)*4+cams[0], (nave-1)*4+cams[1]];
  await dbAdd('siembras', {
    bloque:bl, nave, lado, g, key:k,
    cama1:camAbs[0], cama2:camAbs[1],
    variedad1:var1, variedad2:var2,
    noches, fechaIni, fechaFin,
    operario, gps:gpsRes.punto,
    gpsValido:gpsRes.valid,
    fecha:new Date().toISOString()
  });
  await addToSyncQueue('siembra', gd);

  cerrarModal();
  renderGuirnaldas(bl);
  buildInicio();
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
  if(!tienePermiso('ver_dashboard_gerencial')&&!tienePermiso('ver_dashboard_basico')){
    alert('Sin permiso para ver el dashboard.');return;
  }
  showScreen('sc-dashboard');
  renderDashboard();
  setNavSel('nb-dash');
}
function irConfig(){
  if(!tienePermiso('cambiar_pines')){alert('Solo el supervisor puede acceder a configuración.');return;}
  showScreen('sc-config');
  renderConfig();
  setNavSel('nb-config');
}
function irRadiometria(){
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

  // Cambiar PINes
  html += '<div class="sec-lbl">Gestión de PINes</div>';
  html += '<div class="card" style="margin-bottom:10px">';
  Object.entries(PINES_CONFIG).forEach(([pin, r]) => {
    const rol_info = ROLES[r];
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bo)">
      <div>
        <div style="font-size:12px;font-weight:700;color:${rol_info?.color||'#888'}">${rol_info?.label||r}</div>
        <div style="font-size:11px;color:var(--ts)">PIN actual: ${pin}</div>
      </div>
      <input type="tel" maxlength="4" inputmode="numeric" placeholder="Nuevo PIN"
        id="pin-new-${pin}" style="width:80px;padding:8px;border:1.5px solid var(--bo);border-radius:8px;text-align:center;font-size:14px;font-weight:700">
    </div>`;
  });
  html += `<button class="btn-g" style="margin-top:10px" onclick="guardarPinesNuevos()">Guardar PINes</button>`;
  html += `<div class="msg" id="msg-pines"></div>`;
  html += '</div>';

  // URL de Sheets
  html += '<div class="sec-lbl">Google Sheets</div>';
  html += '<div class="card" style="margin-bottom:10px">';
  html += `<div class="field"><label>URL del Apps Script</label>
    <input type="url" id="cfg-sheets-url" value="${SHEETS_URL||''}" placeholder="https://script.google.com/macros/s/...">
  </div>`;
  html += `<div class="banner bb" style="margin-bottom:10px"><span>ℹ️</span><span>Crea un Apps Script en tu Google Sheet y pega la URL aquí para sincronizar registros automáticamente.</span></div>`;
  html += `<button class="btn-g" onclick="guardarConfigSheets()">Guardar URL</button>`;
  html += `<div class="msg" id="msg-sheets-cfg"></div>`;
  html += '</div>';

  wrap.innerHTML = html;
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

async function guardarConfigSheets() {
  const url = document.getElementById('cfg-sheets-url')?.value?.trim();
  const msg = document.getElementById('msg-sheets-cfg');
  if (!url) { msg.textContent='Ingresa la URL.'; msg.className='msg err'; msg.style.display='block'; return; }
  await guardarSheetsURL(url);
  msg.textContent='✓ URL guardada.'; msg.className='msg ok'; msg.style.display='block';
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
