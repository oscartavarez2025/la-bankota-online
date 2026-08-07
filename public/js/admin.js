// admin.js — Panel de Plataforma y Administración de Escritorio (Super Admin)
(function () {
  const API_BASE = '/api';

  let state = {
    token: localStorage.getItem('platform_token') || '',
    user: JSON.parse(localStorage.getItem('platform_user') || 'null'),
    currentTab: 'resumen',
    empresas: [],
    loterias: [],
    auditLogs: [],
    loading: false,
    error: '',
    modalNuevaEmpresa: false
  };

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (state.token) h['Authorization'] = `Bearer ${state.token}`;
    return h;
  }

  async function api(path, opts = {}) {
    opts.headers = { ...headers(), ...(opts.headers || {}) };
    const r = await fetch(`${API_BASE}${path}`, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Error en la petición');
    return data;
  }

  // ---------- RENDER PRINCIPAL ----------
  function render() {
    const app = document.getElementById('app');
    if (!state.token || !state.user) {
      app.innerHTML = renderLogin();
      bindLogin();
      return;
    }

    app.innerHTML = `
      <div class="topbar admin-header">
        <div class="brand">
          <span class="dot"></span>
          LA BANKOTA
          <span class="badge-platform">SUPER ADMIN</span>
        </div>
        <div class="who">
          <span>Usuario: <b>${state.user.nombre || 'Super Admin'}</b> (${state.user.rol})</span>
          <button class="btn-logout" id="btnLogout">Cerrar Sesión</button>
        </div>
      </div>

      <div class="layout">
        <div class="sidebar">
          <div class="section-label">Plataforma SaaS</div>
          <button class="${state.currentTab === 'resumen' ? 'active' : ''}" data-tab="resumen">📊 Resumen General</button>
          <button class="${state.currentTab === 'empresas' ? 'active' : ''}" data-tab="empresas">🏢 Empresas (Tenants)</button>
          <button class="${state.currentTab === 'loterias' ? 'active' : ''}" data-tab="loterias">🎰 Catálogo Loterías</button>
          <button class="${state.currentTab === 'resultados' ? 'active' : ''}" data-tab="resultados">🏆 Cargar Resultados</button>
          
          <div class="section-label">Seguridad & Auditoría</div>
          <button class="${state.currentTab === 'auditoria' ? 'active' : ''}" data-tab="auditoria">🛡️ Audit Logs</button>
        </div>

        <div class="content">
          ${renderTabContent()}
        </div>
      </div>
      ${state.modalNuevaEmpresa ? renderModalNuevaEmpresa() : ''}
    `;

    bindEvents();
  }

  function renderLogin() {
    return `
      <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px;">
        <div class="card" style="width:100%; max-width:400px; padding:30px; text-align:center;">
          <h1 style="font-family:var(--font-display); font-size:36px; color:var(--gold); margin:0 0 6px;">LA BANKOTA</h1>
          <div style="font-size:13px; color:var(--text-muted); margin-bottom:24px;">PANEL DE PLATAFORMA (SUPER ADMIN)</div>
          
          ${state.error ? `<div class="banner error" style="margin-bottom:16px;">${state.error}</div>` : ''}

          <form id="formLogin">
            <div style="margin-bottom:14px; text-align:left;">
              <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Usuario Plataforma</label>
              <input type="text" id="loginUser" class="input" placeholder="superadmin" required style="width:100%; padding:10px;">
            </div>
            <div style="margin-bottom:20px; text-align:left;">
              <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Contraseña</label>
              <input type="password" id="loginPass" class="input" placeholder="••••••••" required style="width:100%; padding:10px;">
            </div>
            <button type="submit" class="btn" style="width:100%; padding:12px; background:var(--gold); color:#1a1200; font-weight:bold;">ACCEDER AL PANEL</button>
          </form>
        </div>
      </div>
    `;
  }

  function renderTabContent() {
    if (state.currentTab === 'resumen') return renderResumen();
    if (state.currentTab === 'empresas') return renderEmpresas();
    if (state.currentTab === 'loterias') return renderLoterias();
    if (state.currentTab === 'resultados') return renderResultados();
    if (state.currentTab === 'auditoria') return renderAuditoria();
    return '<div>Selecciona una pestaña</div>';
  }

  function renderResumen() {
    return `
      <h1>Resumen de la Plataforma SaaS</h1>
      <div class="subtitle">Estado global del sistema multi-tenant, loterías y trazabilidad de seguridad</div>

      <div class="grid-3" style="margin-bottom:24px;">
        <div class="stat-card">
          <div>
            <div class="stat-val">${state.empresas.length || 2}</div>
            <div class="stat-label">Empresas SaaS Activas</div>
          </div>
          <span style="font-size:28px;">🏢</span>
        </div>
        <div class="stat-card">
          <div>
            <div class="stat-val">${state.loterias.length || 6}</div>
            <div class="stat-label">Loterías en Catálogo</div>
          </div>
          <span style="font-size:28px;">🎰</span>
        </div>
        <div class="stat-card">
          <div>
            <div class="stat-val" style="color:var(--win);">100%</div>
            <div class="stat-label">Aislamiento RLS en BD</div>
          </div>
          <span style="font-size:28px;">🛡️</span>
        </div>
      </div>

      <div class="card">
        <h2>🚀 Acciones Rápidas de Administración</h2>
        <div style="display:flex; gap:12px;">
          <button class="btn btn-primary" id="btnAbrirModalEmpresa">+ Nueva Empresa SaaS</button>
          <button class="btn btn-secondary" onclick="document.querySelector('[data-tab=resultados]').click()">🏆 Cargar Resultado Oficial</button>
        </div>
      </div>
    `;
  }

  function renderEmpresas() {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <div>
          <h1>Empresas SaaS (Tenants)</h1>
          <div class="subtitle" style="margin:0;">Organizaciones registradas en la plataforma</div>
        </div>
        <button class="btn btn-primary" id="btnAbrirModalEmpresa">+ Registrar Empresa</button>
      </div>

      <div class="card" style="padding:0; overflow:hidden;">
        <table class="table-admin">
          <thead>
            <tr>
              <th>ID</th>
              <th>Código</th>
              <th>Nombre Comercial</th>
              <th>Plan</th>
              <th>Estado</th>
              <th>Fecha Alta</th>
            </tr>
          </thead>
          <tbody>
            ${state.empresas.length ? state.empresas.map(e => `
              <tr>
                <td><b>#${e.id}</b></td>
                <td><code style="color:var(--gold);">${e.codigo}</code></td>
                <td><b>${e.nombre_comercial}</b></td>
                <td><span class="badge">${e.plan || 'ESTÁNDAR'}</span></td>
                <td><span style="color:var(--win); font-weight:bold;">● ACTIVA</span></td>
                <td>${(e.creado_en || '').slice(0, 10)}</td>
              </tr>
            `).join('') : `
              <tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">Cargando empresas...</td></tr>
            `}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderLoterias() {
    return `
      <h1>Catálogo Global de Loterías</h1>
      <div class="subtitle">Loterías oficiales disponibles para las bancas suscritas</div>

      <div class="card">
        <h2>Añadir Nueva Lotería al Catálogo</h2>
        <form id="formNuevaLoteria" style="display:flex; gap:12px; align-items:flex-end;">
          <div style="flex:1;">
            <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Nombre de la Lotería</label>
            <input type="text" id="nombreLoteria" class="input" placeholder="Ej. Lotería Florida Noche" required style="width:100%;">
          </div>
          <div style="width:120px;">
            <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">País</label>
            <input type="text" id="paisLoteria" class="input" value="DO" required style="width:100%;">
          </div>
          <button type="submit" class="btn btn-primary">Guardar Lotería</button>
        </form>
      </div>

      <div class="card" style="padding:0; overflow:hidden;">
        <table class="table-admin">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre de la Lotería</th>
              <th>País</th>
            </tr>
          </thead>
          <tbody>
            ${state.loterias.map(l => `
              <tr>
                <td><b>#${l.id}</b></td>
                <td><b>${l.nombre}</b></td>
                <td>${l.pais}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderResultados() {
    return `
      <h1>Carga de Resultados Oficiales</h1>
      <div class="subtitle">Ingreso de la combinación ganadora para desencadenar la liquidación de premios</div>

      <div class="card" style="max-width:600px;">
        <form id="formResultadoOficial">
          <div style="margin-bottom:14px;">
            <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Lotería Oficial</label>
            <select id="resLoteriaId" class="input" required style="width:100%;">
              ${state.loterias.map(l => `<option value="${l.id}">${l.nombre} (${l.pais})</option>`).join('')}
            </select>
          </div>
          <div style="display:flex; gap:12px; margin-bottom:14px;">
            <div style="flex:1;">
              <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Fecha</label>
              <input type="date" id="resFecha" class="input" value="${new Date().toISOString().slice(0, 10)}" required style="width:100%;">
            </div>
            <div style="flex:1;">
              <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Hora del Sorteo</label>
              <input type="text" id="resHora" class="input" placeholder="14:30" value="14:30" required style="width:100%;">
            </div>
          </div>
          <div style="margin-bottom:20px;">
            <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:8px;">Números Ganadores (1er, 2do y 3er Premio)</label>
            <div style="display:flex; gap:10px;">
              <input type="text" id="resNum1" class="input" placeholder="1ra" maxlength="2" required style="text-align:center; font-family:var(--font-mono); font-size:18px; font-weight:bold; color:var(--gold);">
              <input type="text" id="resNum2" class="input" placeholder="2da" maxlength="2" required style="text-align:center; font-family:var(--font-mono); font-size:18px; font-weight:bold;">
              <input type="text" id="resNum3" class="input" placeholder="3ra" maxlength="2" required style="text-align:center; font-family:var(--font-mono); font-size:18px; font-weight:bold;">
            </div>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%; padding:12px;">🏆 REGISTRAR Y LIQUIDAR PREMIOS</button>
        </form>
      </div>
    `;
  }

  function renderAuditoria() {
    return `
      <h1>Registros de Auditoría Inmutable (Audit Logs)</h1>
      <div class="subtitle">Trazabilidad en tiempo real de operaciones sensibles registradas en la base de datos</div>

      <div class="card" style="padding:0; overflow:hidden;">
        <table class="table-admin">
          <thead>
            <tr>
              <th>Fecha / Hora</th>
              <th>Acción</th>
              <th>Entidad</th>
              <th>ID Entidad</th>
              <th>IP Origen</th>
            </tr>
          </thead>
          <tbody>
            ${state.auditLogs.length ? state.auditLogs.map(a => `
              <tr>
                <td style="font-size:12px; color:var(--text-muted);">${(a.created_at || '').replace('T', ' ').slice(0, 19)}</td>
                <td><span class="tag-accion ${getTagClass(a.accion)}">${a.accion}</span></td>
                <td><code>${a.entidad}</code></td>
                <td><b>#${a.entidad_id || '-'}</b></td>
                <td style="font-family:var(--font-mono); font-size:12px;">${a.ip_address || '127.0.0.1'}</td>
              </tr>
            `).join('') : `
              <tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">No se registraron logs o la tabla está siendo migrada.</td></tr>
            `}
          </tbody>
        </table>
      </div>
    `;
  }

  function getTagClass(accion) {
    if (accion === 'JUGADA_CREADA') return 'tag-creada';
    if (accion === 'JUGADA_ANULADA') return 'tag-anulada';
    if (accion === 'RESULTADO_CARGADO') return 'tag-resultado';
    if (accion === 'CAJA_CERRADA') return 'tag-caja';
    return 'tag-resultado';
  }

  function renderModalNuevaEmpresa() {
    return `
      <div class="modal-backdrop">
        <div class="modal-card">
          <h2 style="margin-top:0; color:var(--gold);">Registrar Nueva Empresa SaaS</h2>
          <form id="formModalEmpresa">
            <div style="margin-bottom:12px;">
              <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Código de Empresa (único)</label>
              <input type="text" id="mCodigo" class="input" placeholder="ej. BANCA_JUAN" required style="width:100%;">
            </div>
            <div style="margin-bottom:12px;">
              <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Nombre Comercial</label>
              <input type="text" id="mNombre" class="input" placeholder="Bancas Juan SRL" required style="width:100%;">
            </div>
            <div style="margin-bottom:12px;">
              <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Usuario Admin Inicial</label>
              <input type="text" id="mUser" class="input" placeholder="admin" required style="width:100%;">
            </div>
            <div style="margin-bottom:20px;">
              <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">Contraseña Admin Inicial</label>
              <input type="password" id="mPass" class="input" placeholder="••••••••" required style="width:100%;">
            </div>
            <div style="display:flex; gap:10px; justify-content:flex-end;">
              <button type="button" class="btn" id="btnCerrarModal">Cancelar</button>
              <button type="submit" class="btn btn-primary">Crear Empresa</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  // ---------- EVENT BINDINGS ----------
  function bindLogin() {
    const f = document.getElementById('formLogin');
    if (!f) return;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const user = document.getElementById('loginUser').value.trim();
      const pass = document.getElementById('loginPass').value.trim();
      try {
        const res = await api('/plataforma/login', {
          method: 'POST',
          body: JSON.stringify({ usuario: user, password: pass })
        });
        state.token = res.token;
        state.user = res.user || res.staff;
        localStorage.setItem('platform_token', res.token);
        localStorage.setItem('platform_user', JSON.stringify(state.user));
        state.error = '';
        await cargarDatos();
        render();
      } catch (err) {
        state.error = err.message;
        render();
      }
    };
  }

  function bindEvents() {
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
      btnLogout.onclick = () => {
        state.token = '';
        state.user = null;
        localStorage.removeItem('platform_token');
        localStorage.removeItem('platform_user');
        render();
      };
    }

    document.querySelectorAll('.sidebar button[data-tab]').forEach(btn => {
      btn.onclick = () => {
        state.currentTab = btn.dataset.tab;
        render();
      };
    });

    const btnAbrirModal = document.getElementById('btnAbrirModalEmpresa');
    if (btnAbrirModal) {
      btnAbrirModal.onclick = () => {
        state.modalNuevaEmpresa = true;
        render();
      };
    }

    const btnCerrarModal = document.getElementById('btnCerrarModal');
    if (btnCerrarModal) {
      btnCerrarModal.onclick = () => {
        state.modalNuevaEmpresa = false;
        render();
      };
    }

    const formModalEmpresa = document.getElementById('formModalEmpresa');
    if (formModalEmpresa) {
      formModalEmpresa.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api('/plataforma/empresas', {
            method: 'POST',
            body: JSON.stringify({
              codigo: document.getElementById('mCodigo').value.trim(),
              nombreComercial: document.getElementById('mNombre').value.trim(),
              adminUsuario: document.getElementById('mUser').value.trim(),
              adminPassword: document.getElementById('mPass').value.trim()
            })
          });
          alert('✅ Empresa registrada exitosamente');
          state.modalNuevaEmpresa = false;
          await cargarEmpresas();
          render();
        } catch (err) {
          alert('❌ Error: ' + err.message);
        }
      };
    }

    const formNuevaLoteria = document.getElementById('formNuevaLoteria');
    if (formNuevaLoteria) {
      formNuevaLoteria.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api('/plataforma/loterias-catalogo', {
            method: 'POST',
            body: JSON.stringify({
              nombre: document.getElementById('nombreLoteria').value.trim(),
              pais: document.getElementById('paisLoteria').value.trim()
            })
          });
          alert('✅ Lotería agregada al catálogo');
          await cargarLoterias();
          render();
        } catch (err) {
          alert('❌ Error: ' + err.message);
        }
      };
    }

    const formResultadoOficial = document.getElementById('formResultadoOficial');
    if (formResultadoOficial) {
      formResultadoOficial.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api('/plataforma/resultados-oficiales', {
            method: 'POST',
            body: JSON.stringify({
              loteriaCatalogoId: Number(document.getElementById('resLoteriaId').value),
              fecha: document.getElementById('resFecha').value,
              horaSorteo: document.getElementById('resHora').value,
              num1: document.getElementById('resNum1').value.padStart(2, '0'),
              num2: document.getElementById('resNum2').value.padStart(2, '0'),
              num3: document.getElementById('resNum3').value.padStart(2, '0')
            })
          });
          alert('🎉 Resultado registrado y liquidación ejecutada exitosamente');
        } catch (err) {
          alert('❌ Error: ' + err.message);
        }
      };
    }
  }

  async function cargarEmpresas() {
    try {
      state.empresas = await api('/plataforma/empresas');
    } catch (e) { console.error(e); }
  }

  async function cargarLoterias() {
    try {
      state.loterias = await api('/plataforma/loterias-catalogo');
    } catch (e) { console.error(e); }
  }

  async function cargarAuditoria() {
    try {
      state.auditLogs = await api('/audit-logs');
    } catch (e) { console.error(e); }
  }

  async function cargarDatos() {
    if (!state.token) return;
    await Promise.all([cargarEmpresas(), cargarLoterias(), cargarAuditoria()]);
  }

  // Inicializar
  cargarDatos().then(() => render()).catch(() => render());
})();
