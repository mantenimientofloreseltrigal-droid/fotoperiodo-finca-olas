// ═══════════════════════════════════════════════
// Roles y permisos — Fotoperiodo v2
// ═══════════════════════════════════════════════

const ROLES = {
  operario: {
    label: 'Operario',
    color: '#1D9E75',
    permisos: [
      'ver_guirnaldas',
      'registrar_siembras',
      'registrar_horometros',
      'medir_radiometria',
      'editar_noches',
      'ver_dashboard_basico'
    ]
  },
  supervisor: {
    label: 'Supervisor',
    color: '#185FA5',
    permisos: [
      'ver_guirnaldas',
      'registrar_siembras',
      'registrar_horometros',
      'medir_radiometria',
      'editar_noches',
      'cargar_plan_camas',
      'cambiar_pines',
      'configurar_bloques',
      'exportar_sheets',
      'ver_dashboard_basico',
      'ver_dashboard_gerencial'
    ]
  },
  gerente: {
    label: 'Gerente',
    color: '#7C3AED',
    permisos: [
      'ver_guirnaldas',
      'exportar_sheets',
      'ver_dashboard_basico',
      'ver_dashboard_gerencial'
    ]
  }
};

// PINes configurables por el supervisor
let PINES_CONFIG = {
  '1234': 'operario',
  '5678': 'supervisor',
  '9999': 'gerente'
};

function tienePermiso(permiso) {
  const r = ROLES[window.currentRol];
  return r ? r.permisos.includes(permiso) : false;
}

function getRolLabel() {
  return ROLES[window.currentRol]?.label || '—';
}

function getRolColor() {
  return ROLES[window.currentRol]?.color || '#888';
}

// Mostrar u ocultar elementos según rol
function aplicarPermisos() {
  document.querySelectorAll('[data-permiso]').forEach(el => {
    const permiso = el.dataset.permiso;
    el.style.display = tienePermiso(permiso) ? '' : 'none';
  });
}

// Cargar PINes guardados localmente
async function cargarPines() {
  const saved = await getConfig('pines_config');
  if (saved) PINES_CONFIG = JSON.parse(saved);
}

async function guardarPines() {
  await setConfig('pines_config', JSON.stringify(PINES_CONFIG));
}

function validarPin(pin) {
  return PINES_CONFIG[pin] || null;
}
