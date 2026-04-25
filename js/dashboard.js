// ═══════════════════════════════════════════════
// Dashboard Gerencial — Fotoperiodo v2
// ═══════════════════════════════════════════════

async function renderDashboard() {
  const wrap = document.getElementById('dashboard-content');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div>Cargando datos...</div>';

  // Cargar todos los datos locales
  const [siembras, lecturas, radiometria] = await Promise.all([
    dbGetAll('siembras'),
    dbGetAll('lecturas'),
    dbGetAll('radiometria')
  ]);

  const sem = semanaCorta();
  const hoy = new Date().toISOString().split('T')[0];

  // ── KPIs principales ──
  const guirn_on = Object.values(guirnaldas).filter(g => estadoGuirnalda(g) === 'encendida').length;
  const guirn_vence = Object.values(guirnaldas).filter(g => estadoGuirnalda(g) === 'por-vencer').length;
  const guirn_apag = Object.values(guirnaldas).filter(g => estadoGuirnalda(g) === 'apagada-auto').length;
  const siembras_hoy = siembras.filter(s => s.fecha?.startsWith(hoy)).length;
  const siembras_sem = siembras.filter(s => {
    const f = new Date(s.fecha);
    const yr = f.getFullYear(); const oneJan = new Date(yr,0,1);
    const wk = Math.ceil(((f-oneJan)/86400000+oneJan.getDay()+1)/7);
    return String(yr).slice(2)+String(wk).padStart(2,'0') === sem;
  }).length;

  // Lecturas de hoy
  const lect_hoy = lecturas.filter(l => l.fecha?.startsWith(hoy));
  const alertas_hoy = lect_hoy.filter(l => l.diff !== undefined && l.diff < 1.0).length;

  // Radiometría alertas
  const rad_alertas = radiometria.filter(r => {
    const rango = CFG.radioRangos[r.unidad];
    return rango && parseFloat(r.prom) < rango.min;
  }).length;

  let html = '';

  // ── HEADER DASHBOARD ──
  html += `<div style="background:linear-gradient(135deg,#0F6E56,#1D9E75);border-radius:14px;padding:16px;margin-bottom:12px;color:#fff">
    <div style="font-size:16px;font-weight:800;margin-bottom:2px">Dashboard Gerencial</div>
    <div style="font-size:11px;opacity:.8">Finca Olas · Semana 20${sem.slice(0,2)}-W${sem.slice(2)} · ${new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'})}</div>
  </div>`;

  // ── KPIs ROW 1 ──
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
    <div class="card" style="text-align:center;border-color:var(--vb)">
      <div style="font-size:28px;font-weight:800;color:var(--vm)">${guirn_on}</div>
      <div style="font-size:10px;color:var(--ts);text-transform:uppercase">Guirnaldas ON</div>
    </div>
    <div class="card" style="text-align:center;border-color:${guirn_vence>0?'var(--nb)':'var(--bo)'}">
      <div style="font-size:28px;font-weight:800;color:${guirn_vence>0?'var(--n)':'var(--ts)'}">${guirn_vence}</div>
      <div style="font-size:10px;color:var(--ts);text-transform:uppercase">Por vencer</div>
    </div>
    <div class="card" style="text-align:center;border-color:${guirn_apag>0?'var(--rb)':'var(--bo)'}">
      <div style="font-size:28px;font-weight:800;color:${guirn_apag>0?'var(--r)':'var(--ts)'}">${guirn_apag}</div>
      <div style="font-size:10px;color:var(--ts);text-transform:uppercase">Apagadas</div>
    </div>
    <div class="card" style="text-align:center;border-color:var(--ab)">
      <div style="font-size:28px;font-weight:800;color:var(--a)">${siembras_sem}</div>
      <div style="font-size:10px;color:var(--ts);text-transform:uppercase">Siembras sem.</div>
    </div>
  </div>`;

  // ── ALERTAS HORÓMETROS HOY ──
  html += `<div class="sec-lbl">Lecturas de horómetros — hoy</div>`;
  if (!lect_hoy.length) {
    html += `<div class="banner bb" style="margin-bottom:10px"><span>ℹ️</span><span>Sin lecturas registradas hoy.</span></div>`;
  } else {
    html += `<div class="card" style="margin-bottom:10px">`;
    // Agrupar por bloque y horómetro
    const porBloque = {};
    lect_hoy.forEach(l => {
      const k = `B${l.bloque}·${l.horometro}`;
      if (!porBloque[k]) porBloque[k] = [];
      porBloque[k].push(l);
    });
    Object.entries(porBloque).sort().forEach(([k, lects]) => {
      const ultima = lects[lects.length-1];
      const esAl = ultima.diff !== undefined && ultima.diff < 1.0;
      const col = esAl ? 'var(--r)' : 'var(--vm)';
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bo)">
        <div>
          <div style="font-size:12px;font-weight:700">${k}</div>
          <div style="font-size:10px;color:var(--ts)">${ultima.operario} · ${new Date(ultima.fecha).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:14px;font-weight:800;color:${col}">${ultima.lectura?.toFixed(1)} h</div>
          <div style="font-size:10px;color:${col}">${ultima.diff>=0?'+':''}${ultima.diff?.toFixed(2)} h</div>
        </div>
        ${esAl?'<span class="badge b-al" style="margin-left:6px">⚠ Alerta</span>':'<span class="badge b-ok">OK</span>'}
      </div>`;
    });
    html += `</div>`;
  }

  // ── HISTORIAL SIEMBRAS POR SEMANA ──
  html += `<div class="sec-lbl">Siembras registradas esta semana</div>`;
  if (!siembras_sem) {
    html += `<div class="banner bb" style="margin-bottom:10px"><span>📋</span><span>Sin siembras registradas esta semana.</span></div>`;
  } else {
    // Agrupar por variedad
    const semSiembras = siembras.filter(s => {
      const f = new Date(s.fecha);
      const yr = f.getFullYear(); const oneJan = new Date(yr,0,1);
      const wk = Math.ceil(((f-oneJan)/86400000+oneJan.getDay()+1)/7);
      return String(yr).slice(2)+String(wk).padStart(2,'0') === sem;
    });
    const porVar = {};
    semSiembras.forEach(s => {
      const v = s.variedad1 || 'Sin variedad';
      if (!porVar[v]) porVar[v] = 0;
      porVar[v]++;
    });
    html += `<div class="card" style="margin-bottom:10px">`;
    Object.entries(porVar).sort((a,b)=>b[1]-a[1]).forEach(([v,n]) => {
      const pct = Math.round(n/semSiembras.length*100);
      html += `<div style="padding:7px 0;border-bottom:1px solid var(--bo)">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:12px;font-weight:600">${v}</span>
          <span style="font-size:12px;font-weight:700;color:var(--vm)">${n} camas</span>
        </div>
        <div style="height:4px;background:#eee;border-radius:2px;overflow:hidden">
          <div style="height:4px;width:${pct}%;background:var(--vm);border-radius:2px"></div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // ── ESTADO POR BLOQUE ──
  html += `<div class="sec-lbl">Estado por bloque</div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:10px">`;
  for (let b=1; b<=50; b++) {
    const info = BLOQUES[String(b)];
    if (!info) { html += `<div style="aspect-ratio:1;border-radius:7px;background:#ebebeb;display:flex;align-items:center;justify-content:center;font-size:9px;color:#ccc">B${b}</div>`; continue; }
    let on=0, al=0;
    for (let n=1; n<=info.naves; n++) {
      ['A','B'].forEach(l => {
        for (let g=1;g<=2;g++) {
          const est = estadoGuirnalda(guirnaldas[gKey(b,n,l,g)]);
          if (est==='encendida') on++;
          if (est==='por-vencer'||est==='apagada-auto') al++;
        }
      });
    }
    const bg = al>0?'var(--rl)':on>0?'var(--vl)':'#f5f5f5';
    const col = al>0?'var(--rd)':on>0?'var(--vd)':'#bbb';
    const bord = al>0?'var(--rb)':on>0?'var(--vb)':'#e0e0e0';
    html += `<div style="aspect-ratio:1;border-radius:7px;background:${bg};border:1.5px solid ${bord};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px">
      <div style="font-size:9px;font-weight:800;color:${col}">B${b}</div>
      <div style="font-size:8px;color:${col}">${on>0?on+'g':''}</div>
    </div>`;
  }
  html += `</div>`;

  // ── RADIOMETRÍA ALERTAS ──
  if (radiometria.length > 0) {
    const radAl = radiometria.filter(r => {
      const rango = CFG.radioRangos[r.unidad];
      return rango && parseFloat(r.prom) < rango.min;
    });
    if (radAl.length > 0) {
      html += `<div class="sec-lbl">Alertas de radiometría</div>`;
      html += `<div class="card alerta" style="margin-bottom:10px">`;
      radAl.slice(0,5).forEach(r => {
        html += `<div style="padding:7px 0;border-bottom:1px solid var(--bo)">
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:12px;font-weight:700">B${r.bloque} · ${r.cama}</span>
            <span class="badge b-al">${r.prom} ${r.unidad}</span>
          </div>
          <div style="font-size:10px;color:var(--ts)">${r.operario} · ${new Date(r.fecha).toLocaleDateString('es-CO')}</div>
        </div>`;
      });
      html += `</div>`;
    }
  }

  // ── EXPORTAR A SHEETS ──
  if (tienePermiso('exportar_sheets')) {
    html += `<div class="sec-lbl">Exportar a Google Sheets</div>`;
    html += `<div class="card" style="margin-bottom:10px">`;
    const shURL = await getConfig('sheets_url') || '';
    html += `<div class="field"><label>URL del Apps Script</label>
      <input type="url" id="sheets-url-inp" value="${shURL}" placeholder="https://script.google.com/macros/s/..." style="font-size:12px">
    </div>`;
    html += `<button class="btn-g" onclick="guardarYExportar()">Guardar URL y sincronizar</button>`;
    html += `<div class="msg" id="msg-export"></div>`;
    html += `</div>`;
  }

  wrap.innerHTML = html;
}

async function guardarYExportar() {
  const url = document.getElementById('sheets-url-inp')?.value?.trim();
  const msg = document.getElementById('msg-export');
  if (!url) { msg.textContent='Ingresa la URL del Apps Script.'; msg.className='msg err'; msg.style.display='block'; return; }
  await guardarSheetsURL(url);
  msg.textContent='Sincronizando...'; msg.className='msg ok'; msg.style.display='block';
  const res = await syncConSheets();
  msg.textContent = res.ok ? `✓ Sincronizados ${res.enviados||0} registros.` : '⚠ Error al sincronizar. Verifica la URL.';
}
