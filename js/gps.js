// ═══════════════════════════════════════
// GPS — Tracking Finca Olas
// Centro: 6.122428°N, -75.437225°O
// ═══════════════════════════════════════
const FINCA = { lat: 6.122428, lng: -75.437225, radio: 1500 };
let gpsWatch = null, gpsInterval = null;
let posActual = null;
window.currentOperario = '';

function initGPS() {
  if (!navigator.geolocation) return false;
  gpsWatch = navigator.geolocation.watchPosition(
    pos => {
      posActual = { lat: pos.coords.latitude, lng: pos.coords.longitude,
        acc: pos.coords.accuracy, ts: Date.now() };
      updGPSUI(true);
    },
    () => updGPSUI(false),
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
  );
  gpsInterval = setInterval(() => { if (posActual) saveGPSPoint('auto'); }, 300000);
  return true;
}
function stopGPS() {
  if (gpsWatch) navigator.geolocation.clearWatch(gpsWatch);
  if (gpsInterval) clearInterval(gpsInterval);
}
function updGPSUI(ok) {
  const dot = document.getElementById('gps-dot');
  const txt = document.getElementById('gps-text');
  if (dot) dot.style.background = ok ? '#9FE1CB' : '#E24B4A';
  if (txt) txt.textContent = ok ? 'GPS activo' : 'Sin GPS';
}
function haversineM(la1, lo1, la2, lo2) {
  const R = 6371e3, r = x => x * Math.PI / 180;
  const dLa = r(la2-la1), dLo = r(lo2-lo1);
  const a = Math.sin(dLa/2)**2 + Math.cos(r(la1))*Math.cos(r(la2))*Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function enFinca() {
  if (!posActual) return false;
  return haversineM(posActual.lat, posActual.lng, FINCA.lat, FINCA.lng) <= FINCA.radio;
}
async function saveGPSPoint(tipo, bloque) {
  if (!posActual) return null;
  const p = { lat: posActual.lat, lng: posActual.lng, acc: posActual.acc,
    fecha: new Date().toISOString(), tipo, bloque: bloque||null,
    operario: window.currentOperario, enFinca: enFinca() };
  await dbAdd('gps', p);
  await addToSyncQueue('gps', p);
  return p;
}
async function gpsValidar(bloque) {
  if (!posActual) return { valid: false, msg: 'GPS no disponible', punto: null };
  const punto = await saveGPSPoint('registro', bloque);
  const ok = enFinca();
  return { valid: ok, msg: ok ? 'Ubicación verificada ✓' : '⚠ Fuera del área de la finca', punto };
}
