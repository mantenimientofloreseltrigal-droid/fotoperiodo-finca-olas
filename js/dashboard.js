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
  const guirn_on    = Object.values(guirnaldas).filter(g => estadoGuirnalda(g) === 'encendida').length;
  const guirn_vence = Object.values(guirnaldas).filter(g => estadoGuirnalda(g) === 'por-vencer').length;
  const guirn_apag  = Object.values(guirnaldas).filter(g => estadoGuirnalda(g) === 'apagada-auto').length;
  const siembras_sem = siembras.filter(s => {
    const f = new Date(s.fecha);
    const yr = f.getFullYear(); const oneJan = new Date(yr,0,1);
    const wk = Math.ceil(((f-oneJan)/86400000+oneJan.getDay()+1)/7);
    return String(yr).slice(2)+String(wk).padStart(2,'0') === sem;
  }).length;

  // Lecturas de hoy
  const lect_hoy    = lecturas.filter(l => l.fecha?.startsWith(hoy));
  const alertas_hoy = lect_hoy.filter(l => l.diff !== undefined && l.diff < 1.0).length;

  // Radiometría alertas
  const rad_alertas = radiometria.filter(r => {
    const rango = CFG.radioRangos[r.unidad];
    return rango && parseFloat(r.prom) < rango.min;
  }).length;

  // ── HORAS DE LUZ: esperadas vs recibidas ──────────────
  // Cada noche = 2h reales (ciclo 10min luz / 20min oscuridad, turno 21:00–03:00)
  const HORAS_POR_NOCHE = CFG.horasPorNoche || 2.0;
  const resumenHoras = [];
  let totalHorasEsp = 0, totalHorasRec = 0, alertasHoras = 0;

  Object.entries(guirnaldas).forEach(([k, gd]) => {
    if(!gd.variedad1 && !gd.variedad2) return;
    const horasEsp = (gd.noches||0) * HORAS_POR_NOCHE;

    // Sumar lecturas reales del horómetro correspondiente
    const horo = guirnaldas[k] ? calcHoros(gd.bloque)
      .find(h => { for(let n=h.nIni;n<=h.nFin;n++) if(n===gd.nave) return true; }) : null;

    const lectsHoro = horo ? lecturas.filter(l =>
      l.bloque==gd.bloque && l.horometro===horo.id
    ) : [];

    // Horas recibidas = diferencia acumulada de todas las lecturas
    const horasRec = lectsHoro.reduce((s,l) => s + (parseFloat(l.diff)||0), 0);
    totalHorasEsp += horasEsp;
    totalHorasRec += horasRec;

    // Alerta al final del ciclo: si apagada y recibió menos del 90%
    const est = estadoGuirnalda(gd);
    if(est === 'apagada-auto') {
      const pct = horasEsp > 0 ? horasRec/horasEsp*100 : 100;
      if(pct < 90) {
        alertasHoras++;
        resumenHoras.push({
          k, bl:gd.bloque, nave:gd.nave, lado:gd.lado,
          variedad:gd.variedad1||gd.variedad2,
          horasEsp: horasEsp.toFixed(1),
          horasRec: horasRec.toFixed(1),
          diff: (horasEsp-horasRec).toFixed(1),
          pct: pct.toFixed(0)
        });
      }
    }
  });

  // ── HORÓMETROS OMITIDOS HOY (antes 13:00) ──
  const horaActual = new Date().getHours();
  const horosOmitidos = [];
  if(horaActual < 13) {
    Object.keys(BLOQUES).forEach(bl => {
      calcHoros(parseInt(bl)).forEach(h => {
        let activo = false;
        for(let n=h.nIni;n<=h.nFin;n++){
          ['A','B'].forEach(lado=>{
            for(let g=1;g<=2;g++){
              const est=estadoGuirnalda(guirnaldas[gKey(parseInt(bl),n,lado,g)]);
              if(est==='encendida'||est==='por-vencer') activo=true;
            }
          });
        }
        if(!activo) return;
        const tieneHoy = lect_hoy.some(l=>l.bloque==bl && l.horometro===h.id);
        if(!tieneHoy) horosOmitidos.push({bl, horo:h.id});
      });
    });
  }

  let html = '';

  // ── BANNER HORÓMETROS OMITIDOS (supervisor) ──
  if(horosOmitidos.length > 0) {
    const lista = horosOmitidos.slice(0,4).map(o=>`B${o.bl}-${o.horo}`).join(', ');
    const mas   = horosOmitidos.length>4 ? ` y ${horosOmitidos.length-4} más`:'';
    html += `<div style="background:#E24B4A;border-radius:12px;padding:12px 14px;margin-bottom:10px;color:#fff">
      <div style="font-size:13px;font-weight:800;margin-bottom:4px">⚠ Horómetros sin registrar hoy</div>
      <div style="font-size:11px;opacity:.9">${lista}${mas}</div>
      <div style="font-size:10px;opacity:.7;margin-top:4px">Pendientes antes de las 13:00 · No desaparece hasta registrar</div>
    </div>`;
  }

  // ── HEADER DASHBOARD ──
  html += `<div style="background:linear-gradient(135deg,#0F6E56,#1D9E75);border-radius:14px;padding:16px;margin-bottom:12px;color:#fff">
    <div style="font-size:16px;font-weight:800;margin-bottom:2px">Dashboard Gerencial</div>
    <div style="font-size:11px;opacity:.8">Finca Olas · Semana 20${sem.slice(0,2)}-W${sem.slice(2)} · ${new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'})}</div>
  </div>`;

  // ── KPI HORAS LUZ ──
  const pctHoras = totalHorasEsp>0 ? Math.min(100,Math.round(totalHorasRec/totalHorasEsp*100)) : 0;
  const colHoras = pctHoras>=90?'var(--vm)':pctHoras>=70?'var(--n)':'var(--r)';
  html += `<div style="background:#fff;border-radius:12px;padding:12px 14px;margin-bottom:8px;border:1px solid var(--bo)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--ts)">HORAS DE LUZ — Todas las guirnaldas</div>
      <div style="font-size:11px;font-weight:800;color:${colHoras}">${pctHoras}%</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
      <div style="text-align:center;background:var(--g);border-radius:8px;padding:6px">
        <div style="font-size:16px;font-weight:800">${totalHorasEsp.toFixed(0)}h</div>
        <div style="font-size:9px;color:var(--ts)">Esperadas</div>
      </div>
      <div style="text-align:center;background:var(--vl);border-radius:8px;padding:6px">
        <div style="font-size:16px;font-weight:800;color:var(--vm)">${totalHorasRec.toFixed(1)}h</div>
        <div style="font-size:9px;color:var(--ts)">Recibidas</div>
      </div>
      <div style="text-align:center;background:${alertasHoras>0?'var(--rl)':'var(--g)'};border-radius:8px;padding:6px">
        <div style="font-size:16px;font-weight:800;color:${alertasHoras>0?'var(--r)':'var(--ts)'}">${(totalHorasEsp-totalHorasRec).toFixed(1)}h</div>
        <div style="font-size:9px;color:var(--ts)">Diferencia</div>
      </div>
    </div>
    <div style="height:6px;background:#eee;border-radius:3px;overflow:hidden">
      <div style="height:6px;width:${pctHoras}%;background:${colHoras};border-radius:3px;transition:width .4s"></div>
    </div>
    <div style="font-size:10px;color:var(--ts);margin-top:4px">2h reales por noche · ciclo 10min luz / 20min oscuridad</div>
  </div>`;

  // Alertas de diferencia al cierre de ciclo
  if(resumenHoras.length > 0) {
    html += `<div style="background:var(--rl);border:1.5px solid var(--rb);border-radius:12px;padding:12px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:800;color:var(--rd);margin-bottom:8px">⚠ ${resumenHoras.length} guirnalda(s) con horas insuficientes al cierre</div>`;
    resumenHoras.slice(0,5).forEach(r=>{
      html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--rb)">
        <div>
          <div style="font-size:11px;font-weight:700">B${r.bl}·N${r.nave}·${r.lado} · ${r.variedad}</div>
          <div style="font-size:10px;color:var(--rd)">Esperadas: ${r.horasEsp}h · Recibidas: ${r.horasRec}h</div>
        </div>
        <div style="font-size:13px;font-weight:800;color:var(--rd)">-${r.diff}h</div>
      </div>`;
    });
    html += `</div>`;
  }

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

  // ── HORAS LUZ ESPERADAS VS RECIBIDAS ──
  const horasLuzPorNoche = CFG.horasLuzPorNoche || 2;
  const guirnaActivas = Object.values(guirnaldas).filter(g => estadoGuirnalda(g) === 'encendida' || estadoGuirnalda(g) === 'por-vencer');
  const guirnaVencidas = Object.values(guirnaldas).filter(g => estadoGuirnalda(g) === 'apagada-auto');

  // Calcular déficit de horas para guirnaldas vencidas
  let totalEsperadas = 0, totalAlertas = 0;
  const alertasDeficit = [];

  for (const gd of guirnaVencidas) {
    // Horas esperadas = noches × 2h
    const hEsp = gd.noches * horasLuzPorNoche;
    // Buscar lecturas del horómetro de este bloque
    const horo = calcHoros(gd.bloque).find(h => {
      for(let n=h.nIni;n<=h.nFin;n++) if(n===gd.nave) return true;
      return false;
    });
    if(!horo) continue;
    const lectsBloque = lecturas[`${gd.bloque}_${horo?.id}`];
    const hRecibidas = lectsBloque?.hoy || 0;
    const deficit = hEsp - hRecibidas;
    totalEsperadas += hEsp;
    if(deficit > horasLuzPorNoche) { // más de 1 noche de déficit
      totalAlertas++;
      alertasDeficit.push({ gd, hEsp, hRecibidas, deficit });
    }
  }

  html += `<div class="sec-lbl">Horas de luz — ciclos completados</div>`;
  html += `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
    <div class="res-chip">
      <div class="res-num" style="color:var(--a)">${guirnaActivas.length}</div>
      <div class="res-lbl">En ciclo</div>
    </div>
    <div class="res-chip">
      <div class="res-num" style="color:var(--ts)">${guirnaVencidas.length}</div>
      <div class="res-lbl">Completadas</div>
    </div>
    <div class="res-chip">
      <div class="res-num" style="color:${totalAlertas>0?'var(--r)':'var(--vm)'}">${totalAlertas}</div>
      <div class="res-lbl">Con déficit</div>
    </div>
  </div>`;

  // Info sobre el ciclo
  html += `<div class="banner bb" style="border-radius:10px;margin-bottom:10px">
    <span>💡</span>
    <span>Ciclo: 10 min luz + 20 min oscuridad = <strong>2 h efectivas/noche</strong> (turno 21:00–03:00)</span>
  </div>`;

  // Alertas de déficit
  if(alertasDeficit.length > 0){
    html += `<div class="sec-lbl">⚠ Guirnaldas con déficit de horas al completar ciclo</div>`;
    html += `<div class="card alerta" style="margin-bottom:10px">`;
    alertasDeficit.slice(0,8).forEach(({gd, hEsp, hRecibidas, deficit}) => {
      const pct = Math.round(hRecibidas/hEsp*100);
      html += `<div style="padding:8px 0;border-bottom:1px solid var(--bo)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div>
            <div style="font-size:12px;font-weight:700">B${gd.bloque} · N${gd.nave} · L${gd.lado}</div>
            <div style="font-size:10px;color:var(--ts)">${gd.variedad1||'—'} · ${gd.noches} noches</div>
          </div>
          <span class="badge b-al">−${deficit.toFixed(1)} h</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--ts);margin-bottom:3px">
          <span>Esperadas: ${hEsp} h</span><span>Recibidas: ${hRecibidas.toFixed(1)} h</span><span>${pct}%</span>
        </div>
        <div class="prog"><div class="prog-f" style="width:${pct}%;background:var(--r)"></div></div>
      </div>`;
    });
    html += `</div>`;
  }

  // ── HORÓMETROS OMITIDOS (para supervisor) ──
  const faltantes = await verificarHorosOmitidos();
  if(faltantes && faltantes.length > 0){
    html += `<div class="sec-lbl">🚨 Horómetros sin registrar hoy</div>`;
    html += `<div class="card alerta" style="margin-bottom:10px">`;
    faltantes.forEach(f => {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bo)">
        <div>
          <div style="font-size:13px;font-weight:700">Bloque ${f.bl} · ${f.horo}</div>
          <div style="font-size:10px;color:var(--ts)">Turno ${f.turno.inicio}–${f.turno.fin}</div>
        </div>
        <span class="badge b-al">Sin registro</span>
      </div>`;
    });
    html += `<div style="font-size:11px;color:var(--rd);padding:6px 0">
      Esta alerta desaparece cuando el operario registre las lecturas faltantes.
    </div></div>`;
  }

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
      <input type="url" id="sheets-url-inp" value="${shURL}" placeholder="Configurado por administrador" style="font-size:12px">
    </div>`;
    html += `<button class="btn-g" onclick="guardarYExportar()">Guardar URL y sincronizar</button>`;
    html += `<div class="msg" id="msg-export"></div>`;
    html += `</div>`;
  }

  // ── RECORRIDO GPS — ÚLTIMOS 7 DÍAS ──
  const gpsData = await dbGetAll('gps');
  const hace7 = new Date(); hace7.setDate(hace7.getDate()-7);
  const gpsFiltrado = gpsData
    .filter(p => new Date(p.fecha) >= hace7)
    .sort((a,b) => new Date(a.fecha)-new Date(b.fecha));

  html += `<div class="sec-lbl">Recorrido del operario — últimos 7 días</div>`;

  if(!gpsFiltrado.length){
    html += `<div class="banner bb" style="border-radius:10px;margin-bottom:10px">
      <span>📍</span><span>Sin registros GPS en los últimos 7 días.</span>
    </div>`;
  } else {
    // Agrupar por día
    const porDia = {};
    gpsFiltrado.forEach(p => {
      const dia = p.fecha.split('T')[0];
      if(!porDia[dia]) porDia[dia] = [];
      porDia[dia].push(p);
    });

    Object.entries(porDia).sort((a,b)=>b[0].localeCompare(a[0])).forEach(([dia, puntos]) => {
      const fDia = new Date(dia+'T12:00:00');
      const lblDia = fDia.toLocaleDateString('es-CO',{weekday:'short',day:'numeric',month:'short'});

      // Extraer bloques visitados en orden
      const visitas = [];
      puntos.forEach(p => {
        if(p.bloque && (visitas.length===0 || visitas[visitas.length-1].bl !== p.bloque)){
          visitas.push({bl:p.bloque, hora:p.fecha, tipo:p.tipo, enFinca:p.enFinca});
        }
      });

      html += `<div class="card" style="margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;color:var(--ts);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">
          📅 ${lblDia} · ${puntos.length} registros
        </div>`;

      // MAPA ESQUEMÁTICO — grid de bloques con visitas marcadas
      const bloquesVisitados = new Set(visitas.map(v=>v.bl));
      html += `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:3px;margin-bottom:10px">`;
      for(let b=1;b<=50;b++){
        const info    = BLOQUES[String(b)];
        const visited = bloquesVisitados.has(b)||bloquesVisitados.has(String(b));
        const orden   = visitas.findIndex(v=>v.bl==b||v.bl==String(b));
        if(!info){
          html+=`<div style="aspect-ratio:1;border-radius:5px;background:rgba(0,0,0,.03);display:flex;align-items:center;justify-content:center;font-size:8px;color:#ddd">B${b}</div>`;
        } else if(visited){
          html+=`<div style="aspect-ratio:1;border-radius:5px;background:var(--vl);border:2px solid var(--vb);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px">
            <div style="font-size:8px;font-weight:800;color:var(--vd)">B${b}</div>
            <div style="font-size:9px;font-weight:800;color:var(--v)">${orden+1}</div>
          </div>`;
        } else {
          html+=`<div style="aspect-ratio:1;border-radius:5px;background:#f5f5f5;border:1px solid #e8e8e8;display:flex;align-items:center;justify-content:center;font-size:8px;color:#bbb">B${b}</div>`;
        }
      }
      html += `</div>`;

      // SECUENCIA CON FLECHAS
      if(visitas.length > 0){
        html += `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-bottom:4px">`;
        visitas.forEach((v,i) => {
          const f = new Date(v.hora);
          const hr = f.getHours()+':'+String(f.getMinutes()).padStart(2,'0');
          html += `<div style="background:var(--vl);border:1.5px solid var(--vb);border-radius:8px;padding:4px 8px;text-align:center">
            <div style="font-size:10px;font-weight:800;color:var(--vd)">B${v.bl}</div>
            <div style="font-size:9px;color:var(--ts)">${hr}</div>
          </div>`;
          if(i < visitas.length-1){
            html += `<div style="font-size:14px;color:var(--ts)">→</div>`;
          }
        });
        html += `</div>`;
      }

      // Puntos sin bloque (automáticos)
      const sinBloque = puntos.filter(p=>!p.bloque);
      if(sinBloque.length){
        html += `<div style="font-size:10px;color:var(--ts);margin-top:4px">
          + ${sinBloque.length} registros automáticos de posición
        </div>`;
      }
      html += `</div>`;
    });
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
