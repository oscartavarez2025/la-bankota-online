// app.js — App móvil de LA BANKOTA (vendedor / admin_sucursal / admin_empresa)
// Mobile-first: la mayoría de usuarios reales entra desde el teléfono.
// Vanilla JS sin build step, consistente con el resto del proyecto.

const $app = document.getElementById('app');

const state = {
  token: localStorage.getItem('lb_token') || null,
  user: JSON.parse(localStorage.getItem('lb_user') || 'null'),
  screen: 'vender',
  loterias: [],
  sucursales: [],
  loginSucursales: [], // Sucursales para el login
  loading: false,
  sel: { sorteosIds: [], tipos: ['quiniela'], numeros: [], numTemp: '', monto: '', isSuperPaleMode: false },
  carrito: [], // array de { id: timestamp, sorteosIds: [...], combinaciones: [...] }
  ui: { loteriasModalOpen: false, carritoModalOpen: false, revisarModalOpen: false, cobroModalOpen: false, autoSaved: false, focusedField: 'numeros' },
};

function showToast(msg) {
  let toast = document.getElementById('lb-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'lb-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '80px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = '#d63031';
    toast.style.color = '#fff';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = 'bold';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
    toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    toast.style.pointerEvents = 'none';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  
  if (toast.timeoutId) clearTimeout(toast.timeoutId);
  
  toast.timeoutId = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
  }, 2000);
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, { ...opts, headers });
  let data = {};
  try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo */ }
  if (res.status === 401 && state.token) {
    logout(); // sesión vencida o token inválido
    throw new Error('Sesión expirada, vuelve a iniciar sesión.');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('lb_token'); localStorage.removeItem('lb_user');
  render();
}

function saveSession(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('lb_token', token); localStorage.setItem('lb_user', JSON.stringify(user));
}

function fmtMoney(n) {
  return 'RD$' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Fecha "de hoy" fijada a la zona horaria de RD (no la del teléfono ni la
// del navegador) — mismo criterio que el servidor, ver fechaHoyRD() en server.js.
function hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date()); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------------------------------------------------------------------------
// Render dispatcher
// ---------------------------------------------------------------------------
function render() {
  if (!state.token || !state.user) return renderLogin();
  const screens = { vender: renderVender, historial: renderHistorial, caja: renderCaja, resultados: renderResultados };
  const body = (screens[state.screen] || renderVender)();
  $app.innerHTML = shell(body);
  wireTabbar();
}

function shell(mainHtml) {
  return `<div class="main-fullscreen">${mainHtml}</div>`;
}

function rolLabel(rol) {
  return { admin_empresa: 'Admin. Empresa', admin_sucursal: 'Admin. Sucursal', vendedor: 'Vendedor' }[rol] || rol;
}
function esAdminEmpresa() { return state.user?.rol === 'admin_empresa'; }

function renderMenuDropdown() {
  const u = state.user;
  const esAdmin = u.rol === 'admin_empresa' || u.rol === 'admin_sucursal';
  return `
    <div class="menu-dropdown" id="menu-dropdown">
      <div class="menu-user-info">
        <span class="menu-dot"></span>
        <span><b>${esc(u.nombre)}</b> · ${rolLabel(u.rol)}</span>
      </div>
      <button class="menu-item ${state.screen === 'vender' ? 'active' : ''}" data-tab="vender">✎ Vender</button>
      <button class="menu-item ${state.screen === 'historial' ? 'active' : ''}" data-tab="historial">≡ Historial</button>
      <button class="menu-item ${state.screen === 'caja' ? 'active' : ''}" data-tab="caja">$ Caja</button>
      ${esAdmin ? `<button class="menu-item ${state.screen === 'resultados' ? 'active' : ''}" data-tab="resultados">🏆 Resultados</button>` : ''}
      <button class="menu-item menu-item--danger" data-tab="salir">⏻ Salir</button>
    </div>
  `;
}

function wireTabbar() {
  // Wire floating menu button
  const menuBtn = document.getElementById('btn-menu-float');
  if (menuBtn) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.ui.menuOpen = !state.ui.menuOpen;
      const dd = document.getElementById('menu-dropdown');
      if (state.ui.menuOpen) {
        if (!dd) {
          const el = document.createElement('div');
          el.innerHTML = renderMenuDropdown();
          menuBtn.parentElement.appendChild(el.firstElementChild);
          wireMenuItems();
        }
      } else {
        if (dd) dd.remove();
      }
    });
  }
  // Close menu on outside click
  document.addEventListener('click', (e) => {
    if (state.ui.menuOpen && !e.target.closest('#btn-menu-float') && !e.target.closest('#menu-dropdown')) {
      state.ui.menuOpen = false;
      const dd = document.getElementById('menu-dropdown');
      if (dd) dd.remove();
    }
  }, { once: false });
}

function wireMenuItems() {
  document.querySelectorAll('#menu-dropdown [data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      state.ui.menuOpen = false;
      const dd = document.getElementById('menu-dropdown');
      if (dd) dd.remove();
      if (tab === 'salir') return logout();
      state.screen = tab;
      render();
      if (tab === 'vender') Promise.all([loadLoterias(), loadSucursales()]).then(() => { if (state.screen === 'vender') render(); });
      if (tab === 'historial') loadHistorial();
      if (tab === 'caja') loadCaja();
      if (tab === 'resultados') loadResultadosScreenData();
    });
  });
}

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
function renderLogin() {
  $app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="logo">LA BANKOTA</div>
        <div class="tagline">Quiniela · Palé · Tripleta — República Dominicana</div>
        <div class="card">
          <div id="login-error"></div>
          <form id="login-form">
            <div class="field">
              <label>Sucursal</label>
              <select id="f-sucursal-login" required>
                <option value="">-- Seleccionar sucursal --</option>
                <option value="todas">Todas (solo Admin Empresa)</option>
                ${state.loginSucursales.map(s => `<option value="${s.codigo_corto}">${esc(s.codigo_corto)} - ${esc(s.nombre)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Usuario</label>
              <input type="text" id="f-usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
            </div>
            <div class="field">
              <label>Contraseña</label>
              <input type="password" id="f-password" autocomplete="current-password" required>
            </div>
            <button type="submit" class="btn btn-primary" id="login-btn">Entrar</button>
          </form>
        </div>
      </div>
    </div>
  `;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const errBox = document.getElementById('login-error');
    errBox.innerHTML = '';
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const sucursalCodigo = document.getElementById('f-sucursal-login').value;
      const usuario = document.getElementById('f-usuario').value.trim().toLowerCase();
      const password = document.getElementById('f-password').value;
      const data = await api('/auth/login-sucursal', { method: 'POST', body: JSON.stringify({ sucursalCodigo, usuario, password }) });
      saveSession(data.token, data.usuario);
      state.screen = 'vender';
      await Promise.all([loadLoterias(), loadSucursales()]);
      render();
    } catch (err) {
      errBox.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
}

// ---------------------------------------------------------------------------
// VENDER
// ---------------------------------------------------------------------------
async function loadLoterias() {
  try { state.loterias = await api('/loterias'); } catch (e) { state.loterias = []; }
}

async function loadSucursales() {
  if (state.user?.rol !== 'admin_empresa') return; // vendedor/admin_sucursal ya tienen la suya fija, no la necesitan
  try {
    state.sucursales = await api('/sucursales');
    if (!state.sel.sucursalId && state.sucursales[0]) state.sel.sucursalId = state.sucursales[0].id;
  } catch (e) { state.sucursales = []; }
}

function cantidadEsperada(tipo) { return { quiniela: 1, pale: 2, tripleta: 3 }[tipo]; }

function renderVender() {
  const sorteosFlat = [];
  state.loterias.forEach(l => (l.sorteos || []).forEach(s => sorteosFlat.push({ ...s, loteriaNombre: l.nombre })));

  const arr = [...state.sel.numeros];
  if (state.sel.numTemp) arr.push(state.sel.numTemp);
  const numStr = arr.length ? arr.join('-') : '';

  const selectedSorteos = sorteosFlat.filter(s => state.sel.sorteosIds.includes(s.id));
  const sorteosNames = selectedSorteos.map(s => `• ${esc(s.loteriaNombre)} | ${s.hora}`).join('<br>');

  return `
    <div class="vender-pos">
      <div class="pos-header">
        <button class="btn-open-loterias" id="btn-open-loterias">
           <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e1614a" stroke-width="2.5" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"></path></svg>
        </button>
        <div class="selected-loterias-display" id="display-sorteos">
          ${sorteosNames || 'Ninguna lotería seleccionada'}
        </div>
        <div class="pos-menu-wrap">
          <button id="btn-menu-float" class="pos-menu-btn" title="Menú" style="color: #57c97a; font-size: 32px;">☰</button>
        </div>
      </div>

      <div class="pos-actions" style="background: transparent; border: none;">
        <div class="pos-date-mini">
          <input type="date" id="f-fecha" value="${state.sel.fecha || hoy()}">
        </div>
        <button id="btn-invertir" class="icon-action-btn" title="Invertir"><span style="display:inline-block; transform: rotate(180deg);">R</span></button>
        <button id="btn-copiar" class="icon-action-btn" title="Copiar">📋</button>
        <button id="btn-limpiar" class="icon-action-btn" title="Limpiar">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
        <button id="btn-open-cart" class="icon-action-btn" style="position:relative;" title="Carrito">
          ${state.carrito.length > 0 
            ? `<svg width="26" height="26" viewBox="0 0 24 24" fill="#0984e3" stroke="#0984e3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
               <span class="cart-badge-small">${state.carrito.length}</span>`
            : `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0984e3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`
          }
        </button>
      </div>

      <div class="pos-types">
        <button data-tipo="quiniela" class="pos-type-btn ${state.sel.tipos.includes('quiniela') ? 'active' : ''}">QN</button>
        <button data-tipo="pale" class="pos-type-btn ${state.sel.tipos.includes('pale') ? 'active' : ''}">PL</button>
        <button data-tipo="tripleta" class="pos-type-btn ${state.sel.tipos.includes('tripleta') ? 'active' : ''}">TPL</button>
      </div>

      <div class="pos-display ${state.ui.focusedField === 'numeros' ? 'focused-field' : ''}" id="pos-display">
        ${numStr}
      </div>

      <div class="pos-keypad" id="pos-keypad">
        ${[1,2,3,4,5,6,7,8,9].map(n => `<button data-key="${n}">${n}</button>`).join('')}
        <button data-key="clear">C</button>
        <button data-key="0">0</button>
        <button data-key="del">⌫</button>
      </div>

      <div class="pos-bottom">
        <button class="pos-btn" id="btn-guardar" style="background:#a2d2ff; margin-bottom:0; max-width:100px;">GUARDAR</button>
        <div class="monto-wrap ${state.ui.focusedField === 'monto' ? 'focused-field' : ''}" id="monto-wrap">
          <span class="currency">$</span>
          <input type="text" id="f-monto" inputmode="none" readonly placeholder="0.00" value="${esc(state.sel.monto)}">
        </div>
        <button class="icon-print-btn" id="btn-print">
           🖨️
        </button>
      </div>
      <div id="vender-error"></div>

      ${state.ui.loteriasModalOpen ? renderLoteriasModal(sorteosFlat) : ''}
      ${state.ui.carritoModalOpen ? renderCarritoModal() : ''}
      ${state.ui.revisarModalOpen ? renderRevisarModal() : ''}
      ${state.ui.cobroModalOpen ? renderCobroModal() : ''}
    </div>
  `;
}

function fmtHoraAmPm(horaStr) {
  if (!horaStr) return '';
  const parts = horaStr.split(':');
  let hh = parseInt(parts[0], 10);
  const mm = parts[1] || '00';
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  hh = hh ? hh : 12;
  return `${hh}:${mm} ${ampm}`;
}

function getHoraRD() {
  const options = { timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  return new Intl.DateTimeFormat('en-US', options).format(new Date());
}

function haPasadoSorteo(fechaSorteoStr, horaSorteoStr) {
  const hoyRD = hoy();
  if (fechaSorteoStr < hoyRD) return true;
  if (fechaSorteoStr > hoyRD) return false;
  
  const horaActualRD = getHoraRD();
  const partsS = horaSorteoStr.split(':');
  const hhS = parseInt(partsS[0], 10);
  const mmS = parseInt(partsS[1] || '00', 10);
  const ssS = parseInt(partsS[2] || '00', 10);
  
  const partsA = horaActualRD.split(':');
  const hhA = parseInt(partsA[0], 10);
  const mmA = parseInt(partsA[1] || '00', 10);
  const ssA = parseInt(partsA[2] || '00', 10);
  
  const totalSegundosSorteo = hhS * 3600 + mmS * 60 + ssS;
  const totalSegundosActual = hhA * 3600 + mmA * 60 + ssA;
  
  return totalSegundosActual > totalSegundosSorteo;
}

function renderLoteriasModal(sorteosFlat) {
  const fechaSel = state.sel.fecha || hoy();
  
  return `
    <div class="pos-modal-overlay">
      <div class="pos-modal">
        <h3 style="margin:0 0 10px;">Seleccionar loterías</h3>
        <label style="color:#d63031; font-weight:bold; margin-bottom:10px; display:block; font-size:14px; text-transform:uppercase;">
          SUPER PALÉ <input type="checkbox" id="chk-sp-mode" ${state.sel.isSuperPaleMode ? 'checked' : ''} style="margin-left:8px; transform:scale(1.3);">
        </label>
        <div class="pos-modal-list">
          ${sorteosFlat.map(s => {
            const paso = haPasadoSorteo(fechaSel, s.hora);
            const styleDisabled = paso ? 'style="opacity: 0.5; cursor: not-allowed; pointer-events: none;"' : '';
            const checked = state.sel.sorteosIds.includes(s.id) ? 'checked' : '';
            const disabledAttr = paso ? 'disabled' : '';
            return `
              <label class="pos-loteria-item" ${styleDisabled}>
                <span>${esc(s.loteriaNombre)} | ${fmtHoraAmPm(s.hora)}</span>
                <input type="checkbox" class="chk-sorteo-modal" value="${s.id}" ${checked} ${disabledAttr}>
              </label>
            `;
          }).join('')}
        </div>
        <div class="pos-modal-actions">
          <button id="btn-modal-aceptar" style="background:#0984e3; color:#fff;">Aceptar</button>
          <button id="btn-modal-atras" style="background:#d63031; color:#fff;">Atrás</button>
        </div>
      </div>
    </div>
  `;
}

function renderCarritoModal() {
  if (state.carrito.length === 0) {
    return `
      <div class="pos-modal-overlay">
        <div class="pos-modal">
          <h3 style="margin:0 0 10px;">Carrito de jugadas</h3>
          <p>No hay jugadas guardadas.</p>
          <button id="btn-cerrar-carrito" style="margin-top:15px; padding:10px; background:#d63031; color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">Cerrar</button>
        </div>
      </div>
    `;
  }

  // Agrupar por sorteos seleccionados para hacer las "carpetas"
  let idx = 0;
  const htmlJugadas = state.carrito.map((j, i) => {
    const sorteos = state.loterias.flatMap(l => l.sorteos.map(s => ({...s, lotNombre: l.nombre})))
      .filter(s => j.sorteosIds.includes(s.id));
    const descSorteos = sorteos.map(s => `${s.lotNombre}|${s.hora}`).join(' + ');
    
    const lineas = j.combinaciones.map(c => `(${c.tipo.toUpperCase()}:${c.numeros.join('-')} $${c.monto})`).join(', ');

    return `
      <div class="btn-editar-jugada" data-idx="${i}" style="border-bottom:1px solid #ccc; padding:8px; font-size:12px; cursor:pointer; border-radius:6px; margin-bottom:4px; background:#fff; transition:background 0.15s;" onmouseenter="this.style.background='#e8f4fd'" onmouseleave="this.style.background='#fff'">
        <div style="font-weight:bold; color:#0984e3; margin-bottom:4px;">${i+1}- ${descSorteos}</div>
        <div style="margin-bottom:6px;">${lineas}</div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:10px; color:#636e72;">Toca para editar</span>
          <button class="btn-borrar-jugada" data-idx="${i}" style="margin-left:auto; background:transparent; border:1px solid #d63031; color:#d63031; padding:2px 8px; border-radius:4px; font-size:11px;">Eliminar</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="pos-modal-overlay">
      <div class="pos-modal" style="max-height:90vh;">
        <h3 style="margin:0 0 10px;">Carrito de jugadas</h3>
        <div class="pos-modal-list" style="max-height:300px; overflow-y:auto; background:#f9f9f9;">
          ${htmlJugadas}
        </div>
        <button id="btn-cerrar-carrito" style="margin-top:10px; padding:12px; background:#0984e3; color:#fff; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">Cerrar Carrito</button>
      </div>
    </div>
  `;
}

// Calcula el total real del carrito multiplicando por cantidad de sorteos
// (ej: 5 jugadas × $10 × 2 loterías = $100, no $50)
function calcGranTotal() {
  return state.carrito.reduce((sum, folder) => {
    const isSuperPale = folder.combinaciones.some(c => c.tipo === 'superpale');
    const mult = isSuperPale ? 1 : folder.sorteosIds.length;
    return sum + folder.combinaciones.reduce((s, c) => s + c.monto * mult, 0);
  }, 0);
}

function renderRevisarModal() {
  const ALIAS = { quiniela: 'QN', pale: 'PL', tripleta: 'TPL', superpale: 'SPL' };
  let granTotal = 0;
  let rowsHtml = '';

  state.carrito.forEach((folder, fi) => {
    const isSuperPale = folder.combinaciones.some(c => c.tipo === 'superpale');
    const mult = isSuperPale ? 1 : folder.sorteosIds.length;
    const sorteos = state.loterias.flatMap(l => l.sorteos.map(s => ({...s, lotNombre: l.nombre})))
      .filter(s => folder.sorteosIds.includes(s.id));
    const descSorteos = sorteos.map(s => s.lotNombre).join(' + ');

    folder.combinaciones.forEach((comb, ci) => {
      granTotal += comb.monto * mult;
      rowsHtml += `
        <tr style="border-bottom:1px solid #ddd;">
          <td style="padding:6px 4px; font-size:12px;">${esc(descSorteos)}</td>
          <td style="padding:4px;">
            <div style="display:flex; align-items:center; gap:4px;">
              <span style="font-size:11px; font-weight:bold; color:#fff; background:#0984e3; border-radius:3px; padding:2px 5px; white-space:nowrap;">${ALIAS[comb.tipo] || comb.tipo}</span>
              <input type="text" class="edit-nums-revisar" data-folder-idx="${fi}" data-comb-idx="${ci}" data-tipo="${comb.tipo}"
                value="${comb.numeros.join('-')}"
                style="width:80px; text-align:center; font-size:13px; font-weight:bold; font-family:monospace; border:1px solid #ccc; border-radius:4px; padding:3px 4px;"
                maxlength="11" inputmode="numeric" placeholder="00">
            </div>
          </td>
          <td style="padding:4px;">
            <input type="number" class="edit-monto-revisar" data-folder-idx="${fi}" data-comb-idx="${ci}"
              value="${comb.monto}" min="1" step="1"
              style="width:70px; text-align:right; font-size:13px; border:1px solid #ccc; border-radius:4px; padding:3px 4px;">
          </td>
          <td style="padding:4px; text-align:center;">
            <button class="btn-del-revisar" data-folder-idx="${fi}" data-comb-idx="${ci}"
              style="background:#d63031; color:#fff; border:none; border-radius:4px; padding:3px 8px; font-size:12px; cursor:pointer;">✕</button>
          </td>
        </tr>
      `;
    });
  });

  return `
    <div class="pos-modal-overlay">
      <div class="pos-modal" style="max-height:90vh; overflow-y:auto;">
        <h3 style="margin:0 0 10px; text-align:center;">REVISAR JUGADAS</h3>
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:10px;">
          <thead>
            <tr style="background:#f0f0f0; font-size:11px;">
              <th style="padding:5px; text-align:left;">Sorteo</th>
              <th style="padding:5px; text-align:left;">Jugada</th>
              <th style="padding:5px; text-align:right;">Monto</th>
              <th style="padding:5px;"></th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div id="revisar-total" style="font-size:16px; font-weight:bold; text-align:right; margin-bottom:12px;">
          Total: ${fmtMoney(granTotal)}
        </div>
        <div class="pos-modal-actions">
          <button id="btn-revisar-continuar" style="background:#0984e3; color:#fff;">Continuar →</button>
          <button id="btn-revisar-cancelar" style="background:#d63031; color:#fff;">Cancelar</button>
        </div>
      </div>
    </div>
  `;
}

function renderCobroModal() {
  const granTotal = calcGranTotal();
  return `
    <div class="pos-modal-overlay">
      <div class="pos-modal">
        <h3 style="margin:0 0 10px; text-align:center;">COBRO Y CAMBIO</h3>
        <div style="font-size:18px; text-align:center; margin-bottom:15px;">Total a pagar: <b>${fmtMoney(granTotal)}</b></div>
        <div class="monto-wrap" style="margin-bottom:15px; border:2px solid #000; height:60px;">
          <span class="currency" style="font-size:30px;">$</span>
          <input type="number" id="f-efectivo" inputmode="decimal" placeholder="Efectivo recibido" style="font-size:30px;" autofocus>
        </div>
        <div id="cambio-display" style="font-size:22px; text-align:center; margin-bottom:15px; font-weight:bold; color:#d63031;">Cambio: $0.00</div>
        
        <div class="pos-modal-actions">
          <button id="btn-cancelar-imprimir" style="background:#d63031; color:#fff;">Cancelar</button>
          <button id="btn-confirmar-imprimir" style="background:#0984e3; color:#fff; font-size:18px; padding:15px;">Imprimir Tickets</button>
        </div>
      </div>
    </div>
  `;
}

// Delegación de eventos para la pantalla "Vender"
document.addEventListener('click', (e) => {
  if (state.screen !== 'vender') return;
  
  if (e.target.closest('#btn-open-loterias')) {
    state.ui.loteriasModalOpen = true;
    render(); return;
  }
  if (e.target.closest('#btn-modal-atras') || e.target.closest('#btn-modal-aceptar')) {
    state.ui.loteriasModalOpen = false;
    render(); return;
  }

  // Rutear foco del teclado virtual
  if (e.target.closest('#f-monto') || e.target.closest('#monto-wrap')) {
    state.ui.focusedField = 'monto';
    render(); return;
  }
  if (e.target.closest('#pos-display')) {
    state.ui.focusedField = 'numeros';
    render(); return;
  }

  // Papelera (borrar todo, y preguntar si borra carrito)
  if (e.target.closest('#btn-limpiar')) {
    if (confirm('¿Limpiar digitación actual?')) {
      state.sel.numeros = []; 
      state.sel.numTemp = '';
      state.sel.monto = '';
      state.sel.sorteosIds = [];
      if (state.carrito.length > 0) {
        if (confirm('¿Deseas también vaciar las jugadas del carrito?')) {
          state.carrito = [];
        }
      }
      render();
    }
    return;
  }

  // Tecla C limpia solo digitación actual, no sorteos ni carrito
  if (e.target.closest('[data-key="clear"]')) {
    state.sel.numeros = []; state.sel.numTemp = '';
    render(); return;
  }

  const keyBtn = e.target.closest('#pos-keypad button');
  if (keyBtn) {
    if (navigator.vibrate) navigator.vibrate(50);
    const k = keyBtn.dataset.key;
    
    if (state.ui.focusedField === 'monto') {
      if (k === 'del') {
        state.sel.monto = state.sel.monto.slice(0, -1);
      } else if (k === 'clear') {
        state.sel.monto = '';
      } else if (k !== 'clear') {
        state.sel.monto += k;
      }
    } else {
      // Logic para numeros
      if (k === 'del') {
        if (state.sel.numTemp.length > 0) {
          state.sel.numTemp = state.sel.numTemp.slice(0, -1);
        } else if (state.sel.numeros.length > 0) {
          state.sel.numeros.pop();
        }
      } else if (k !== 'clear') {
        if (state.sel.numTemp.length === 1) {
          state.sel.numeros.push(state.sel.numTemp + k);
          state.sel.numTemp = '';
        } else {
          state.sel.numTemp = k;
        }
      }
    }
    render();
    return;
  }

  const tipoBtn = e.target.closest('.pos-types button');
  if (tipoBtn) {
    const tipo = tipoBtn.dataset.tipo;
    if (tipo === 'superpale') {
      // Exclusivo
      state.sel.tipos = ['superpale'];
      state.sel.isSuperPaleMode = true;
      state.ui.loteriasModalOpen = true; // Forzar seleccionar 2 loterías
    } else {
      state.sel.isSuperPaleMode = false;
      state.sel.tipos = state.sel.tipos.filter(t => t !== 'superpale');
      if (state.sel.tipos.includes(tipo)) {
        if (state.sel.tipos.length > 1) state.sel.tipos = state.sel.tipos.filter(t => t !== tipo);
      } else {
        state.sel.tipos.push(tipo);
      }
    }
    render();
    return;
  }

  // Invertir números
  if (e.target.closest('#btn-invertir')) {
    if (state.sel.numeros.length === 0) return;
    const invertidos = state.sel.numeros.map(n => n.split('').reverse().join(''));
    state.sel.numeros = [...state.sel.numeros, ...invertidos];
    // Eliminar duplicados si los hay
    state.sel.numeros = [...new Set(state.sel.numeros)];
    render();
    return;
  }

  // Carrito
  if (e.target.closest('#btn-open-cart')) {
    state.ui.carritoModalOpen = true;
    render(); return;
  }
  if (e.target.closest('#btn-cerrar-carrito')) {
    state.ui.carritoModalOpen = false;
    render(); return;
  }
  if (e.target.classList.contains('btn-borrar-jugada')) {
    const idx = parseInt(e.target.dataset.idx, 10);
    state.carrito.splice(idx, 1);
    render(); return;
  }
  // Clic en jugada del carrito -> abrir REVISAR JUGADAS
  const cardEditar = e.target.closest('.btn-editar-jugada');
  if (cardEditar && !e.target.classList.contains('btn-borrar-jugada')) {
    state.ui.carritoModalOpen = false;
    state.ui.revisarModalOpen = true;
    render(); return;
  }

  // Guardar jugada al carrito
  if (e.target.closest('#btn-guardar')) return guardarJugada();

  // Imprimir -> Abre modal de cobro con validaciones secuenciales
  if (e.target.closest('#btn-print')) {
    if (state.carrito.length === 0) {
      if (state.sel.numeros.length === 0) {
        showToast("Digite los números.");
        document.getElementById('pos-display')?.focus();
        return;
      }
      if (state.sel.numTemp.length > 0) {
        showToast("Tiene un número incompleto. Complételo o bórrelo.");
        document.getElementById('pos-display')?.focus();
        return;
      }
      if (state.sel.sorteosIds.length === 0) {
        showToast("Seleccione el sorteo.");
        state.ui.loteriasOpen = true;
        state.ui.loteriasModalOpen = true;
        render();
        return;
      }
      if (!state.sel.monto || parseFloat(state.sel.monto) <= 0) {
        showToast("Digite un monto a apostar.");
        document.getElementById('f-monto')?.focus();
        return;
      }
      guardarJugada(false);
      if (state.carrito.length === 0) return; // guardar falló por alguna razón
      state.ui.autoSaved = true; // marcar que auto-guardamos para poder restaurar al cancelar
    } else {
      // Si hay jugadas en el carrito y en pantalla hay algo completo, lo guardamos automáticamente
      if (state.sel.numeros.length > 0 && state.sel.numTemp.length === 0 && state.sel.sorteosIds.length > 0 && state.sel.monto && parseFloat(state.sel.monto) > 0) {
        guardarJugada(false);
        state.ui.autoSaved = true;
      }
    }

    state.ui.revisarModalOpen = true;
    render();
    return;
  }

  // Modal Revisar
  if (e.target.closest('#btn-revisar-cancelar')) {
    state.ui.revisarModalOpen = false;
    // Si auto-guardamos al presionar imprimir, restauramos esa jugada a la pantalla
    if (state.ui.autoSaved && state.carrito.length > 0) {
      const lastFolder = state.carrito.pop();
      // Reconstruir números únicos de todas las combinaciones
      const nums = new Set();
      lastFolder.combinaciones.forEach(c => c.numeros.forEach(n => nums.add(n)));
      state.sel.numeros = [...nums];
      state.sel.sorteosIds = [...lastFolder.sorteosIds];
      state.sel.tipos = [...new Set(lastFolder.combinaciones.map(c => c.tipo))];
      state.sel.monto = String(lastFolder.combinaciones[0]?.monto || '');
      state.sel.numTemp = '';
    }
    state.ui.autoSaved = false;
    render(); return;
  }
  if (e.target.closest('#btn-revisar-continuar')) {
    state.ui.revisarModalOpen = false;
    state.ui.cobroModalOpen = true;
    render(); return;
  }
  const btnDelRev = e.target.closest('.btn-del-revisar');
  if (btnDelRev) {
    const fi = parseInt(btnDelRev.dataset.folderIdx, 10);
    const ci = parseInt(btnDelRev.dataset.combIdx, 10);
    if (state.carrito[fi]) {
      state.carrito[fi].combinaciones.splice(ci, 1);
      if (state.carrito[fi].combinaciones.length === 0) state.carrito.splice(fi, 1);
      if (state.carrito.length === 0) state.ui.revisarModalOpen = false;
      render();
    }
    return;
  }

  // Modal Cobro
  if (e.target.closest('#btn-cancelar-imprimir')) {
    state.ui.cobroModalOpen = false;
    render(); return;
  }
  if (e.target.closest('#btn-confirmar-imprimir')) return imprimirTickets();
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'f-efectivo') {
    const granTotal = calcGranTotal();
    const efectivo = parseFloat(e.target.value) || 0;
    const cambio = efectivo - granTotal;
    const disp = document.getElementById('cambio-display');
    if (disp) {
      if (cambio >= 0) {
        disp.style.color = '#57c97a';
        disp.textContent = `Cambio: ${fmtMoney(cambio)}`;
      } else {
        disp.style.color = '#d63031';
        disp.textContent = `Falta: ${fmtMoney(Math.abs(cambio))}`;
      }
    }
  }
  // Edición de monto en modal de revisión (sin re-render completo)
  if (e.target.classList.contains('edit-monto-revisar')) {
    const fi = parseInt(e.target.dataset.folderIdx, 10);
    const ci = parseInt(e.target.dataset.combIdx, 10);
    const val = parseFloat(e.target.value) || 0;
    if (state.carrito[fi] && state.carrito[fi].combinaciones[ci]) {
      state.carrito[fi].combinaciones[ci].monto = val;
      const totalEl = document.getElementById('revisar-total');
      if (totalEl) totalEl.textContent = `Total: ${fmtMoney(calcGranTotal())}`;
    }
  }
  // Edición de números en modal de revisión con auto-formateo xx-xx-xx
  if (e.target.classList.contains('edit-nums-revisar')) {
    const fi = parseInt(e.target.dataset.folderIdx, 10);
    const ci = parseInt(e.target.dataset.combIdx, 10);
    const tipo = e.target.dataset.tipo || 'quiniela';
    const maxSegs = tipo === 'tripleta' ? 3 : tipo === 'quiniela' ? 1 : 2; // pale/superpale=2

    // Extraer solo dígitos
    const digits = e.target.value.replace(/\D/g, '');

    // Agrupar en segmentos de 2, máximo maxSegs
    const groups = [];
    for (let i = 0; i < digits.length && groups.length < maxSegs; i += 2) {
      groups.push(digits.substr(i, 2));
    }

    const formatted = groups.join('-');

    // Actualizar input con formato sin mover el cursor si ya está bien
    if (e.target.value !== formatted) {
      e.target.value = formatted;
      e.target.setSelectionRange(formatted.length, formatted.length);
    }

    // Validar: todos los grupos deben tener exactamente 2 dígitos
    const complete = groups.filter(g => g.length === 2);
    const allValid = complete.length === groups.length && groups.length > 0;

    if (allValid && state.carrito[fi] && state.carrito[fi].combinaciones[ci]) {
      state.carrito[fi].combinaciones[ci].numeros = complete;
      e.target.style.borderColor = '#00b894'; // verde: válido
    } else if (groups.length > 0) {
      e.target.style.borderColor = '#f0a500'; // naranja: escribiendo
    } else {
      e.target.style.borderColor = '#d63031'; // rojo: vacío/inválido
    }
  }
});

document.addEventListener('change', (e) => {
  if (state.screen !== 'vender') return;
  if (e.target.id === 'f-fecha') {
    state.sel.fecha = e.target.value;
    render();
    return;
  }
  if (e.target.classList.contains('chk-sorteo-modal')) {
    const val = e.target.value;
    if (e.target.checked) {
      if (!state.sel.sorteosIds.includes(val)) state.sel.sorteosIds.push(val);
    } else {
      state.sel.sorteosIds = state.sel.sorteosIds.filter(id => id !== val);
    }
  }
  if (e.target.id === 'chk-sp-mode') state.sel.isSuperPaleMode = e.target.checked;
  if (e.target.id === 'f-monto') state.sel.monto = e.target.value;
});

function getCombinations(arr, size) {
  if (size === 1) return arr.map(e => [e]);
  if (arr.length < size) return [];
  const result = [];
  for (let i = 0; i <= arr.length - size; i++) {
    const head = arr[i];
    const tailcombs = getCombinations(arr.slice(i + 1), size - 1);
    for (const tail of tailcombs) {
      result.push([head, ...tail]);
    }
  }
  return result;
}

function guardarJugada(doRender = true) {
  const errBox = document.getElementById('vender-error');
  errBox.innerHTML = '';
  const { sorteosIds, tipos, numeros, monto } = state.sel;
  
  if (sorteosIds.length === 0) return errBox.innerHTML = `<div class="error-box">Selecciona al menos un sorteo.</div>`;
  if (tipos.length === 0) return errBox.innerHTML = `<div class="error-box">Selecciona al menos un tipo de jugada.</div>`;
  if (numeros.length === 0) return errBox.innerHTML = `<div class="error-box">Ingresa al menos un número (debe tener dos dígitos).</div>`;
  if (state.sel.numTemp.length > 0) return errBox.innerHTML = `<div class="error-box">Tienes un número incompleto. Terminalo de escribir o bórralo.</div>`;
  if (!monto || Number(monto) <= 0) return errBox.innerHTML = `<div class="error-box">Ingresa un monto válido.</div>`;

  const combinaciones = [];
  const pales = getCombinations(numeros, 2);
  const tripletas = getCombinations(numeros, 3);
  const quinielas = numeros.map(n => [n]);

  let errorCombinaciones = null;
  tipos.forEach(tipo => {
    if (tipo === 'quiniela') {
      if (quinielas.length === 0) errorCombinaciones = "Faltan números para Quiniela";
      quinielas.forEach(nums => combinaciones.push({ tipo, numeros: nums, monto: Number(monto) }));
    } else if (tipo === 'pale') {
      if (pales.length === 0) errorCombinaciones = "Se requieren al menos 2 números para Palé";
      pales.forEach(nums => combinaciones.push({ tipo, numeros: nums, monto: Number(monto) }));
    } else if (tipo === 'tripleta') {
      if (tripletas.length === 0) errorCombinaciones = "Se requieren al menos 3 números para Tripleta";
      tripletas.forEach(nums => combinaciones.push({ tipo, numeros: nums, monto: Number(monto) }));
    } else if (tipo === 'superpale') {
      if (sorteosIds.length < 2) errorCombinaciones = "Se requieren al menos 2 sorteos para Súper Palé";
      else if (pales.length === 0) errorCombinaciones = "Se requieren al menos 2 números para Súper Palé";
      else pales.forEach(nums => combinaciones.push({ tipo, numeros: nums, monto: Number(monto) }));
    }
  });

  if (errorCombinaciones || combinaciones.length === 0) {
    errBox.innerHTML = `<div class="error-box">${errorCombinaciones || "No se pudieron generar jugadas válidas."}</div>`;
    return;
  }

  // Agrupar en una "carpeta" de jugada
  state.carrito.push({
    id: Date.now(),
    sorteosIds: [...sorteosIds],
    combinaciones
  });

  // Limpiar campos y desactivar botones
  state.sel.numeros = [];
  state.sel.numTemp = '';
  state.sel.monto = '';
  state.sel.sorteosIds = [];
  state.sel.tipos = []; // Se desactivan todos

  if(doRender) render();
}

async function imprimirTickets() {
  const btn = document.getElementById('btn-confirmar-imprimir');
  btn.disabled = true; btn.innerHTML = 'Imprimiendo...';
  
  const errBox = document.getElementById('vender-error');

  try {
    const payloads = [];
    const sucursalVenta = state.user.sucursalId || document.getElementById('f-sucursal-login')?.value || null;

    // Expandir carrito a payloads individuales para el backend
    for (const folder of state.carrito) {
      const isSuperPale = folder.combinaciones.some(c => c.tipo === 'superpale');
      
      if (isSuperPale) {
        // Super Pale usa sorteo_id y sorteo_id_b
        const sIds = folder.sorteosIds;
        for (const comb of folder.combinaciones) {
          payloads.push({
            sorteo_id: sIds[0],
            sorteo_id_b: sIds[1],
            tipo_jugada: comb.tipo,
            numeros: comb.numeros,
            monto: comb.monto,
            sucursal_id: sucursalVenta
          });
        }
      } else {
        // Normal: una jugada por cada sorteo y combinación
        for (const sId of folder.sorteosIds) {
          for (const comb of folder.combinaciones) {
            payloads.push({
              sorteo_id: sId,
              tipo_jugada: comb.tipo,
              numeros: comb.numeros,
              monto: comb.monto,
              sucursal_id: sucursalVenta
            });
          }
        }
      }
    }

    // Consolidar jugadas duplicadas (mismo sorteo, mismo tipo, mismos números) sumando sus montos
    const consolidatedPayloads = [];
    for (const p of payloads) {
      const numsKey = [...p.numeros].sort().join('-');
      const dup = consolidatedPayloads.find(c => 
        c.sorteo_id === p.sorteo_id &&
        c.sorteo_id_b === p.sorteo_id_b &&
        c.tipo_jugada === p.tipo_jugada &&
        [...c.numeros].sort().join('-') === numsKey
      );
      if (dup) {
        dup.monto += p.monto;
      } else {
        consolidatedPayloads.push(p);
      }
    }

    // Llamadas en paralelo para velocidad (en vez de secuenciales)
    const ticketsGenerados = await Promise.all(
      consolidatedPayloads.map(async (j) => {
        const data = await api('/jugadas', { method: 'POST', body: JSON.stringify(j) });
        return { ...j, folio: data.folio };
      })
    );

    state.ui.cobroModalOpen = false;
    mostrarTicketsSeparados(ticketsGenerados);
    
    // Limpiar tras imprimir
    state.carrito = []; 
    state.sel.tipos = ['quiniela']; // volver a QN por defecto
    render();
  } catch (err) {
    btn.disabled = false; btn.innerHTML = 'Imprimir Tickets';
    alert(err.message); // Mostrar error y permitir corregir
  }
}

function mostrarTicketsSeparados(jugadas) {
  // Obtener efectivo ingresado en el input
  const efectivoInput = document.getElementById('f-efectivo');
  const totalEfectivo = efectivoInput ? parseFloat(efectivoInput.value) || 0 : 0;

  // Agrupar jugadas por Lotería(s) para imprimir tickets separados por sorteo
  const grupos = {};
  
  jugadas.forEach(j => {
    // Buscar nombres de sorteos
    let nombreSorteo = 'Desconocido';
    let horaSorteo = '';
    const sorteoA = state.loterias.flatMap(l=>l.sorteos.map(s=>({ ...s, lot: l.nombre}))).find(s=>s.id === j.sorteo_id);
    if(sorteoA) {
      nombreSorteo = sorteoA.lot;
      horaSorteo = sorteoA.hora;
    }
    
    let key = j.sorteo_id;
    if (j.tipo_jugada === 'superpale') {
      const sorteoB = state.loterias.flatMap(l=>l.sorteos.map(s=>({ ...s, lot: l.nombre}))).find(s=>s.id === j.sorteo_id_b);
      if(sorteoB) {
        nombreSorteo += ' + ' + sorteoB.lot;
        horaSorteo += ' y ' + sorteoB.hora;
      }
      key = j.sorteo_id + '_' + j.sorteo_id_b;
    }

    if(!grupos[key]) {
      grupos[key] = { nombreSorteo, horaSorteo, jugadas: [], total: 0 };
    }
    grupos[key].jugadas.push(j);
    grupos[key].total += j.monto;
  });

  // Helpers de formato de fecha y hora
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  
  function fmtFechaVenta(date) {
    const dia = String(date.getDate()).padStart(2, '0');
    const mes = meses[date.getMonth()];
    const anio = date.getFullYear();
    
    let hh = date.getHours();
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12;
    hh = hh ? hh : 12;
    
    return `${dia}/${mes}/${anio}   ${hh}:${mm}:${ss} ${ampm}`;
  }

  function fmtHoraAmPm(horaStr) {
    if (!horaStr) return '';
    const parts = horaStr.split(':');
    let hh = parseInt(parts[0], 10);
    const mm = parts[1] || '00';
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12;
    hh = hh ? hh : 12;
    return `${hh}:${mm} ${ampm}`;
  }

  const dateVentaStr = fmtFechaVenta(new Date());

  // Generar HTML por cada grupo (un ticket visual por lotería)
  const ticketsHtml = Object.values(grupos).map(g => {
    // Clasificar y ordenar por tipo de jugada (quiniela, pale, tripleta, superpale)
    const bloques = {
      quiniela: { titulo: 'QUINIELAS', alias: 'QN', lista: [] },
      pale: { titulo: 'PALÉS', alias: 'PL', lista: [] },
      tripleta: { titulo: 'TRIPLETAS', alias: 'TPL', lista: [] },
      superpale: { titulo: 'SÚPER PALÉS', alias: 'SPL', lista: [] }
    };

    g.jugadas.forEach(j => {
      if (bloques[j.tipo_jugada]) {
        bloques[j.tipo_jugada].lista.push(j);
      }
    });

    let bloquesHtml = '';
    for (const key of ['quiniela', 'pale', 'tripleta', 'superpale']) {
      const b = bloques[key];
      if (b.lista.length > 0) {
        bloquesHtml += `
          <div style="font-weight:bold; border-bottom:1px solid #000; margin-top:8px; text-transform:uppercase; font-size:11px; text-align:left;">${b.titulo}</div>
        `;
        b.lista.forEach(j => {
          bloquesHtml += `
            <div class="row" style="margin-bottom:2px; font-size:12px; display:flex; justify-content:space-between; width:100%;">
              <span><b>${b.alias}</b> ${j.numeros.join('-')}</span>
              <span>$${j.monto}.</span>
            </div>
          `;
        });
      }
    }

    // El enlace QR utiliza el primer folio de este boleto
    const primerFolio = g.jugadas[0].folio;
    const linkVerif = `${location.origin}/verificar.html?empresa=la-bankota&folio=${encodeURIComponent(primerFolio)}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(linkVerif)}`;

    // Calcular cambio local para este boleto
    let efectivoSeccion = '';
    if (totalEfectivo > 0) {
      efectivoSeccion = `
        <div class="row" style="font-size:12px; display:flex; justify-content:space-between; width:100%; margin-top:4px;">
          <span>Efectivo:</span>
          <span>$${totalEfectivo}</span>
        </div>
        <div class="row" style="font-size:12px; display:flex; justify-content:space-between; width:100%;">
          <span>Cambio:</span>
          <span>$${totalEfectivo - g.total}</span>
        </div>
      `;
    }

    // Formatear las horas de los sorteos
    const horasSorteoFmt = g.horaSorteo.split(' y ').map(fmtHoraAmPm).join(' y ');

    return `
      <div class="boleta" style="margin-bottom: 20px; background: #fff; padding: 20px; border: 1px solid #ccc; color:#000; text-align:center; font-family:'Courier New', monospace;">
        <div style="font-size:18px; font-weight:bold; margin-bottom:4px;">LA BANKOTA</div>
        <div style="font-size:11px; margin-bottom:8px;">
          Vendedor: ${state.user.codigoCorto || state.user.nombre}<br>
          ${dateVentaStr}
        </div>
        <div style="font-weight:bold; font-size:13px; margin-bottom:2px;">${g.nombreSorteo}</div>
        <div style="font-size:10px; margin-bottom:8px;">Válido para hoy [${horasSorteoFmt}]</div>
        <hr style="border-top: 1px dashed #000; margin-bottom:6px;">
        
        <div style="text-align: left; margin-bottom: 8px;">
          ${bloquesHtml}
        </div>
        
        <hr style="border-top: 1px dashed #000; margin-bottom:6px;">
        <div class="row" style="font-size:14px; font-weight:bold; display:flex; justify-content:space-between; width:100%;">
          <span>Total jugada:</span>
          <span>$${g.total}</span>
        </div>
        
        ${efectivoSeccion}
        
        <div style="font-size:10px; margin-top:12px; font-weight:bold;">VERIFIQUE SU JUGADA</div>
        <div style="font-size:9px; margin-top:3px; color:#333; line-height:1.2;">
          Revise su ticket cuidadosamente.<br>
          No se cancela despues de 5 minutos.<br>
          72 horas para reclamar el pago<br>
          del presente el ticket
        </div>
        
        <div style="margin-top:12px;">
          <img src="${qrUrl}" alt="QR" style="width:100px; height:100px; display:block; margin: 0 auto 4px;">
          <span style="font-size:10px; font-weight:bold; word-break:break-all;">${primerFolio}</span>
        </div>
      </div>
    `;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.alignItems = 'flex-start';
  overlay.style.overflowY = 'auto';
  
  overlay.innerHTML = `
    <div style="width: 100%; max-width: 320px; margin: 20px auto;">
      ${ticketsHtml}
      <button class="btn btn-primary" style="margin-top:10px; width:100%;" id="cerrar-boleta">Cerrar y Nueva Jugada</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#cerrar-boleta').addEventListener('click', () => overlay.remove());
}

// ---------------------------------------------------------------------------
// HISTORIAL
// ---------------------------------------------------------------------------
let historialCache = [];
let historialLoaded = false;
async function loadHistorial() {
  try { historialCache = await api(`/jugadas?fecha=${hoy()}`); } catch (e) { historialCache = []; }
  historialLoaded = true;
  if (state.screen === 'historial') render();
}

function renderHistorial() {
  if (!historialLoaded) return `<div class="empty-state"><span class="spinner"></span></div>`;
  const items = historialCache;
  return `
    <div class="card">
      <h2>Historial de hoy</h2>
      <p class="sub">${items.length} jugada(s) — ${hoy()}</p>
    </div>
    ${items.length ? items.map(j => `
      <div class="list-item">
        <div>
          <div class="num">${(Array.isArray(j.numeros) ? j.numeros : []).join(' - ')}</div>
          <div class="meta">${esc(j.tipo_jugada)} · ${fmtMoney(j.monto)} · ${esc(j.sorteo_nombre || '')} · Folio ${esc(j.folio)}</div>
        </div>
        <span class="badge ${esc(j.estado)}">${esc(j.estado)}</span>
      </div>
    `).join('') : `<div class="empty-state"><div class="icon">🎟️</div>Aún no hay jugadas hoy.</div>`}
  `;
}

// ---------------------------------------------------------------------------
// CAJA
// ---------------------------------------------------------------------------
let resumenCache = null;
let cajaLoaded = false;
async function loadCaja() {
  try { resumenCache = await api(`/reportes/resumen?fecha=${hoy()}`); } catch (e) { resumenCache = null; }
  cajaLoaded = true;
  if (state.screen === 'caja') render();
}

function renderCaja() {
  if (!cajaLoaded) return `<div class="empty-state"><span class="spinner"></span></div>`;
  const r = resumenCache || {};
  return `
    <div class="card">
      <h2>Cierre de caja</h2>
      <p class="sub">Resumen del día — ${hoy()}</p>
      <div class="stat-grid">
        <div class="stat-box"><div class="v">${fmtMoney(r.total_vendido)}</div><div class="l">Vendido</div></div>
        <div class="stat-box"><div class="v">${fmtMoney(r.total_premiado)}</div><div class="l">Premiado</div></div>
        <div class="stat-box"><div class="v">${r.total_jugadas ?? 0}</div><div class="l">Jugadas</div></div>
        <div class="stat-box"><div class="v">${fmtMoney(r.balance)}</div><div class="l">Balance</div></div>
      </div>
      <div id="caja-msg"></div>
      <button class="btn btn-primary" id="btn-cerrar-caja">Cerrar caja del día</button>
    </div>
  `;
}

document.addEventListener('click', async (e) => {
  if (e.target.id !== 'btn-cerrar-caja') return;
  const msg = document.getElementById('caja-msg');
  e.target.disabled = true; e.target.innerHTML = '<span class="spinner"></span>';
  try {
    const data = await api('/caja/cerrar', { method: 'POST', body: JSON.stringify({ fecha: hoy() }) });
    msg.innerHTML = `<div class="ok-box">Caja cerrada. Balance final: ${fmtMoney(data.balance)}</div>`;
  } catch (err) {
    msg.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  } finally {
    e.target.disabled = false; e.target.textContent = 'Cerrar caja del día';
  }
});

// ---------------------------------------------------------------------------
// RESULTADOS (solo admin_empresa / admin_sucursal)
// ---------------------------------------------------------------------------
let sorteosParaResultado = [];
let resultadosLoaded = false;
async function loadResultadosScreenData() {
  await loadLoterias();
  sorteosParaResultado = [];
  state.loterias.forEach(l => (l.sorteos || []).forEach(s => sorteosParaResultado.push({ ...s, loteriaNombre: l.nombre })));
  resultadosLoaded = true;
  if (state.screen === 'resultados') render();
}

function renderResultados() {
  if (!resultadosLoaded) return `<div class="empty-state"><span class="spinner"></span></div>`;
  if (!sorteosParaResultado.length) {
    return `<div class="empty-state"><div class="icon">🏆</div>No hay sorteos configurados todavía.</div>`;
  }
  return `
    <div class="card">
      <h2>Cargar resultado</h2>
      <p class="sub">Liquida automáticamente las jugadas pendientes del sorteo.</p>
      <form id="form-resultado">
        <div class="field">
          <label>Sorteo</label>
          <select id="r-sorteo">
            ${sorteosParaResultado.map(s => `<option value="${s.id}">${esc(s.loteriaNombre)} — ${esc(s.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Fecha del sorteo</label><input type="date" id="r-fecha" value="${hoy()}"></div>
        <div class="field"><label>1ra (00-99)</label><input type="text" id="r-num1" maxlength="2" inputmode="numeric" placeholder="00"></div>
        <div class="field"><label>2da (00-99)</label><input type="text" id="r-num2" maxlength="2" inputmode="numeric" placeholder="00"></div>
        <div class="field"><label>3ra (00-99)</label><input type="text" id="r-num3" maxlength="2" inputmode="numeric" placeholder="00"></div>
        <div id="resultado-msg"></div>
        <button type="submit" class="btn btn-primary">Cargar y liquidar</button>
      </form>
    </div>
  `;
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'form-resultado') return;
  e.preventDefault();
  const msg = document.getElementById('resultado-msg');
  const body = {
    sorteo_id: document.getElementById('r-sorteo').value,
    fecha: document.getElementById('r-fecha').value,
    num1: document.getElementById('r-num1').value.padStart(2, '0'),
    num2: document.getElementById('r-num2').value.padStart(2, '0'),
    num3: document.getElementById('r-num3').value.padStart(2, '0'),
  };
  try {
    const data = await api('/resultados', { method: 'POST', body: JSON.stringify(body) });
    msg.innerHTML = `<div class="ok-box">Liquidadas ${data.liquidadas} jugadas — ${data.ganadoras} ganadoras, ${fmtMoney(data.totalPremios)} en premios.</div>`;
  } catch (err) {
    msg.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
(async function init() {
  try {
    state.loginSucursales = await api('/auth/sucursales');
  } catch (e) {
    state.loginSucursales = [];
  }
  
  if (state.token) await Promise.all([loadLoterias(), loadSucursales()]);
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
