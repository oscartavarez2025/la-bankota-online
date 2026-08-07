// server.js — API REST del Sistema de Banca de Lotería (SaaS multi-tenant)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { pool, withTenant, withPlatform } = require('./db');
const { signTenantToken, signPlatformToken, authTenant, authPlatform } = require('./auth');
const { validarNumeros, evaluarJugada, calcularPremio, generarFolio } = require('./logica');
const { AppError, asyncHandler, errorHandler } = require('./errors');
const { validate } = require('./schemas');
const { registrarAuditoria } = require('./audit');

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3500')
  .split(',').map(o => o.trim()).filter(Boolean);

const app = express();
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    // En desarrollo/pruebas se permite cualquier origen — necesario para probar
    // con túneles como ngrok, cuya URL pública cambia en cada sesión. En
    // producción (NODE_ENV=production) esto vuelve a ser estricto: solo los
    // orígenes listados en ALLOWED_ORIGINS.
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    callback(new Error('Origen no permitido por CORS'));
  }
}));
const { requestLogger } = require('./logger');

app.use(express.json());
app.use(requestLogger);
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en unos minutos.' }
});
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

// Helper: ¿esta jugada/consulta debe restringirse a una sola sucursal?
// admin_empresa (sucursal_id null) ve todo; admin_sucursal y vendedor solo lo suyo.
function scopeSucursal(tenant) {
  return tenant.rol === 'admin_empresa' ? null : tenant.sucursalId;
}

// Helper: la fecha "de hoy" del NEGOCIO, fijada a la zona horaria de
// República Dominicana — nunca la del servidor o el dispositivo del
// usuario. Usar SIEMPRE esto (nunca new Date().toISOString().slice(0,10)),
// porque toISOString() da la fecha en UTC, que después de las ~8pm hora RD
// (UTC-4) ya es "mañana" en UTC — causaba que ventas/resultados/cierres de
// caja se agruparan en el día calendario incorrecto. Bug real encontrado en
// pruebas el 31 jul 2026 (~8:30pm hora RD).
function fechaHoyRD() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
}

function esSorteoCerrado(sorteo) {
  const horaCierre = sorteo.hora_cierre || sorteo.hora;
  const ahoraRD = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' }));
  const horas = String(ahoraRD.getHours()).padStart(2, '0');
  const minutos = String(ahoraRD.getMinutes()).padStart(2, '0');
  const segundos = String(ahoraRD.getSeconds()).padStart(2, '0');
  const horaActualStr = `${horas}:${minutos}:${segundos}`;
  return horaActualStr > horaCierre;
}

// ============================================================================
// AUTENTICACIÓN
// ============================================================================

app.post('/api/auth/login', loginLimiter, validate('loginTenant'), asyncHandler(async (req, res) => {
  const { codigoEmpresa, usuario, password } = req.body;

  const empresaRow = await withPlatform(client =>
    client.query(`SELECT id, estado FROM empresas WHERE codigo = $1`, [codigoEmpresa])
  );
  const empresa = empresaRow.rows[0];
  if (!empresa || empresa.estado !== 'activa') {
    throw new AppError(401, 'Empresa no encontrada o inactiva');
  }

  const result = await withTenant(empresa.id, client =>
    client.query(
      `SELECT * FROM usuarios WHERE empresa_id = $1 AND usuario = $2 AND activo = true`,
      [empresa.id, usuario]
    )
  );
  const row = result.rows[0];
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    throw new AppError(401, 'Usuario o contraseña incorrectos');
  }

  const token = signTenantToken({
    usuarioId: row.id, empresaId: row.empresa_id, sucursalId: row.sucursal_id,
    rol: row.rol, nombre: row.nombre,
  });
  res.json({ token, usuario: { id: row.id, nombre: row.nombre, rol: row.rol, sucursalId: row.sucursal_id, codigoCorto: row.codigo_corto } });
}));

// Login simplificado para La Bankota (empresa única): solo sucursal + usuario + password
app.post('/api/auth/login-sucursal', loginLimiter, asyncHandler(async (req, res) => {
  const { sucursalCodigo, usuario, password } = req.body;
  if (!usuario || !password) throw new AppError(400, 'Usuario y contraseña son requeridos');

  // La Bankota es la única empresa
  const empresaRow = await withPlatform(client =>
    client.query(`SELECT id, estado FROM empresas WHERE codigo = 'la-bankota'`)
  );
  const empresa = empresaRow.rows[0];
  if (!empresa || empresa.estado !== 'activa') throw new AppError(500, 'Empresa La Bankota no encontrada');

  // Buscar usuario — si viene sucursalCodigo, filtrar por ella
  let userQuery = `SELECT u.*, s.codigo_corto AS suc_codigo, s.nombre AS suc_nombre
    FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id
    WHERE u.empresa_id = $1 AND u.usuario = $2 AND u.activo = true`;
  const params = [empresa.id, usuario.trim().toLowerCase()];

  if (sucursalCodigo && sucursalCodigo !== 'todas') {
    userQuery += ` AND s.codigo_corto = $3`;
    params.push(sucursalCodigo);
  }

  const result = await withTenant(empresa.id, client => client.query(userQuery, params));
  const row = result.rows[0];
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    throw new AppError(401, 'Usuario o contraseña incorrectos');
  }

  const token = signTenantToken({
    usuarioId: row.id, empresaId: row.empresa_id, sucursalId: row.sucursal_id,
    rol: row.rol, nombre: row.nombre,
  });
  res.json({
    token,
    usuario: {
      id: row.id, nombre: row.nombre, rol: row.rol,
      sucursalId: row.sucursal_id, codigoCorto: row.codigo_corto,
      sucursalCodigo: row.suc_codigo, sucursalNombre: row.suc_nombre,
    }
  });
}));

// Endpoint público: listar sucursales de La Bankota para el selector de login
app.get('/api/auth/sucursales', asyncHandler(async (req, res) => {
  const empresaRow = await withPlatform(client =>
    client.query(`SELECT id FROM empresas WHERE codigo = 'la-bankota'`)
  );
  if (!empresaRow.rows[0]) return res.json([]);
  const empresaId = empresaRow.rows[0].id;
  
  const { rows } = await withTenant(empresaId, client =>
    client.query(
      `SELECT id, nombre, codigo_corto FROM sucursales ORDER BY codigo_corto`
    )
  );
  res.json(rows);
}));

app.post('/api/plataforma/login', loginLimiter, validate('loginPlatform'), asyncHandler(async (req, res) => {
  const { usuario, password } = req.body;
  const result = await withPlatform(client =>
    client.query(`SELECT * FROM staff_plataforma WHERE usuario = $1 AND activo = true`, [usuario])
  );
  const row = result.rows[0];
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    throw new AppError(401, 'Usuario o contraseña incorrectos');
  }
  const token = signPlatformToken({ staffId: row.id, rol: row.rol, nombre: row.nombre });
  res.json({ token, staff: { id: row.id, nombre: row.nombre, rol: row.rol } });
}));

// ============================================================================
// PLATAFORMA (super_admin) — onboarding de empresas, catálogo global,
// resultados oficiales compartidos entre todas las bancas.
// ============================================================================

app.post('/api/plataforma/empresas', authPlatform(['super_admin']), validate('crearEmpresa'), asyncHandler(async (req, res) => {
  const { codigo, nombreComercial, razonSocial, rnc, adminNombre, adminUsuario, adminPassword } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const empresaResult = await client.query(
      `INSERT INTO empresas (codigo, nombre_comercial, razon_social, rnc) VALUES ($1,$2,$3,$4) RETURNING id`,
      [codigo, nombreComercial, razonSocial || null, rnc || null]
    );
    const empresaId = empresaResult.rows[0].id;
    await client.query('SELECT set_config($1, $2, true)', ['app.current_empresa_id', empresaId]);
    await client.query(
      `INSERT INTO usuarios (empresa_id, nombre, usuario, password_hash, rol)
       VALUES ($1,$2,$3,$4,'admin_empresa')`,
      [empresaId, adminNombre, adminUsuario, bcrypt.hashSync(adminPassword, 12)]
    );
    await client.query('COMMIT');
    res.json({ empresaId, codigo });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

app.get('/api/plataforma/empresas', authPlatform(['super_admin', 'soporte']), asyncHandler(async (req, res) => {
  const { rows } = await withPlatform(client =>
    client.query(`SELECT id, codigo, nombre_comercial, plan, estado, creado_en FROM empresas ORDER BY creado_en DESC`)
  );
  res.json(rows);
}));

app.get('/api/plataforma/loterias-catalogo', authPlatform(), asyncHandler(async (req, res) => {
  const { rows } = await withPlatform(client => client.query(`SELECT * FROM loterias_catalogo ORDER BY nombre`));
  res.json(rows);
}));

app.post('/api/plataforma/loterias-catalogo', authPlatform(['super_admin']), validate('crearLoteriaCatalogo'), asyncHandler(async (req, res) => {
  const { nombre, pais } = req.body;
  const { rows } = await withPlatform(client =>
    client.query(`INSERT INTO loterias_catalogo (nombre, pais) VALUES ($1,$2) RETURNING id`, [nombre, pais || 'DO'])
  );
  res.json({ id: rows[0].id });
}));

// Carga del resultado oficial — el número real del sorteo, compartido por
// todas las empresas que ofrezcan esa lotería del catálogo.
app.post('/api/plataforma/resultados-oficiales', authPlatform(['super_admin']), validate('resultadoOficial'), asyncHandler(async (req, res) => {
  const { loteriaCatalogoId, fecha, horaSorteo, num1, num2, num3 } = req.body;
  const { rows } = await withPlatform(client =>
    client.query(
      `INSERT INTO resultados_oficiales (loteria_catalogo_id, fecha, hora_sorteo, num1, num2, num3)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [loteriaCatalogoId, fecha, horaSorteo, num1, num2, num3]
    )
  );
  res.json({ id: rows[0].id, ok: true });
}));

app.get('/api/plataforma/resultados-oficiales', authPlatform(), asyncHandler(async (req, res) => {
  const { rows } = await withPlatform(client =>
    client.query(`
      SELECT r.*, l.nombre AS loteria_nombre FROM resultados_oficiales r
      JOIN loterias_catalogo l ON l.id = r.loteria_catalogo_id
      ORDER BY r.fecha DESC, r.hora_sorteo DESC LIMIT 200
    `)
  );
  res.json(rows);
}));

// ============================================================================
// TENANT — SUCURSALES
// ============================================================================

app.get('/api/sucursales', authTenant(), asyncHandler(async (req, res) => {
  const scope = scopeSucursal(req.tenant);
  const rows = await withTenant(req.tenant.empresaId, client =>
    scope
      ? client.query(`SELECT * FROM sucursales WHERE id = $1`, [scope])
      : client.query(`SELECT * FROM sucursales ORDER BY nombre`)
  );
  res.json(rows.rows);
}));

app.post('/api/sucursales', authTenant(['admin_empresa']), validate('crearSucursal'), asyncHandler(async (req, res) => {
  const { nombre, codigo, direccion } = req.body;
  const result = await withTenant(req.tenant.empresaId, async (client) => {
    // Generar código corto secuencial: S01, S02, S03...
    const countRes = await client.query(`SELECT COUNT(*)::int AS c FROM sucursales`);
    const nextNum = countRes.rows[0].c + 1;
    const codigoCorto = `S${String(nextNum).padStart(2, '0')}`;

    const { rows } = await client.query(
      `INSERT INTO sucursales (empresa_id, nombre, codigo, direccion, codigo_corto)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, codigo_corto`,
      [req.tenant.empresaId, nombre, codigo, direccion || null, codigoCorto]
    );
    return rows[0];
  });
  res.json(result);
}));

// ============================================================================
// TENANT — LOTERÍAS Y SORTEOS
// ============================================================================

app.get('/api/loterias', authTenant(), asyncHandler(async (req, res) => {
  const { rows } = await withTenant(req.tenant.empresaId, client =>
    client.query(`
      SELECT el.id, el.nombre_personalizado, lc.nombre AS nombre_catalogo, el.activo,
        COALESCE(
          json_agg(json_build_object('id', s.id, 'nombre', s.nombre, 'hora', s.hora))
            FILTER (WHERE s.id IS NOT NULL), '[]'
        ) AS sorteos
      FROM empresa_loterias el
      LEFT JOIN loterias_catalogo lc ON lc.id = el.loteria_catalogo_id
      LEFT JOIN sorteos s ON s.empresa_loteria_id = el.id AND s.activo = true
      WHERE el.activo = true
      GROUP BY el.id, el.nombre_personalizado, lc.nombre, el.activo
    `)
  );
  res.json(rows.map(r => ({ ...r, nombre: r.nombre_personalizado || r.nombre_catalogo })));
}));

app.post('/api/loterias', authTenant(['admin_empresa']), validate('activarLoteria'), asyncHandler(async (req, res) => {
  const { loteriaCatalogoId, nombrePersonalizado } = req.body;
  const { rows } = await withTenant(req.tenant.empresaId, client =>
    client.query(
      `INSERT INTO empresa_loterias (empresa_id, loteria_catalogo_id, nombre_personalizado)
       VALUES ($1,$2,$3) RETURNING id`,
      [req.tenant.empresaId, loteriaCatalogoId || null, nombrePersonalizado || null]
    )
  );
  res.json({ id: rows[0].id });
}));

app.post('/api/sorteos', authTenant(['admin_empresa']), validate('crearSorteo'), asyncHandler(async (req, res) => {
  const { empresaLoteriaId, nombre, hora, horaCierre } = req.body;
  const { rows } = await withTenant(req.tenant.empresaId, client =>
    client.query(
      `INSERT INTO sorteos (empresa_id, empresa_loteria_id, nombre, hora, hora_cierre) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.tenant.empresaId, empresaLoteriaId, nombre, hora, horaCierre || null]
    )
  );
  res.json({ id: rows[0].id });
}));

// ============================================================================
// TENANT — TABLA DE PAGOS (empresa por defecto, override por sucursal)
// ============================================================================

app.get('/api/pagos', authTenant(), asyncHandler(async (req, res) => {
  const sucursalId = req.query.sucursal_id || scopeSucursal(req.tenant);
  const { rows } = await withTenant(req.tenant.empresaId, client =>
    client.query(
      `SELECT * FROM tabla_pagos WHERE sucursal_id IS NULL OR sucursal_id = $1 ORDER BY tipo_jugada, posicion NULLS FIRST`,
      [sucursalId || null]
    )
  );
  res.json(rows);
}));

app.put('/api/pagos', authTenant(['admin_empresa', 'admin_sucursal']), validate('pago'), asyncHandler(async (req, res) => {
  const { tipoJugada, posicion, multiplicador, sucursalId } = req.body;
  const targetSucursal = req.tenant.rol === 'admin_sucursal' ? req.tenant.sucursalId : (sucursalId || null);
  if (req.tenant.rol === 'admin_sucursal' && !targetSucursal) {
    throw new AppError(403, 'Un admin de sucursal no puede modificar el default de la empresa');
  }
  await withTenant(req.tenant.empresaId, client => {
    if (targetSucursal) {
      return client.query(
        `INSERT INTO tabla_pagos (empresa_id, sucursal_id, tipo_jugada, posicion, multiplicador)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (empresa_id, sucursal_id, tipo_jugada, (COALESCE(posicion, ''))) WHERE sucursal_id IS NOT NULL
         DO UPDATE SET multiplicador = excluded.multiplicador`,
        [req.tenant.empresaId, targetSucursal, tipoJugada, posicion || null, multiplicador]
      );
    }
    return client.query(
      `INSERT INTO tabla_pagos (empresa_id, sucursal_id, tipo_jugada, posicion, multiplicador)
       VALUES ($1,NULL,$2,$3,$4)
       ON CONFLICT (empresa_id, tipo_jugada, (COALESCE(posicion, ''))) WHERE sucursal_id IS NULL
       DO UPDATE SET multiplicador = excluded.multiplicador`,
      [req.tenant.empresaId, tipoJugada, posicion || null, multiplicador]
    );
  });
  res.json({ ok: true });
}));

// ============================================================================
// TENANT — VENTA DE JUGADAS
// ============================================================================

app.post('/api/jugadas', authTenant(['vendedor', 'admin_sucursal', 'admin_empresa']), validate('crearJugada'), asyncHandler(async (req, res) => {
  const { sorteo_id, sorteo_id_b, tipo_jugada, numeros, posicion, monto, fecha_sorteo, sucursal_id } = req.body;

  const errorValidacion = validarNumeros(tipo_jugada, numeros);
  if (errorValidacion) throw new AppError(400, errorValidacion);
  if (tipo_jugada !== 'quiniela' && posicion) {
    throw new AppError(400, 'La posición solo aplica a quiniela');
  }

  if (tipo_jugada === 'superpale') {
    if (!sorteo_id_b) throw new AppError(400, 'El Super Palé requiere dos sorteos (sorteo_id y sorteo_id_b)');
    if (sorteo_id === sorteo_id_b) throw new AppError(400, 'Los sorteos de un Super Palé deben ser diferentes');
  } else {
    if (sorteo_id_b) throw new AppError(400, 'El segundo sorteo solo está permitido en Super Palé');
  }

  const sucursalVenta = req.tenant.rol === 'admin_empresa' ? sucursal_id : req.tenant.sucursalId;
  if (!sucursalVenta) throw new AppError(400, 'sucursal_id requerido');

  const result = await withTenant(req.tenant.empresaId, async (client) => {
    // Validar sorteo A
    const sorteoA = await client.query(`SELECT * FROM sorteos WHERE id=$1 AND empresa_id=$2`, [sorteo_id, req.tenant.empresaId]);
    if (!sorteoA.rows[0]) throw new AppError(400, 'Sorteo principal no encontrado');

    let sorteoB = null;
    if (sorteo_id_b) {
      const resB = await client.query(`SELECT * FROM sorteos WHERE id=$1 AND empresa_id=$2`, [sorteo_id_b, req.tenant.empresaId]);
      if (!resB.rows[0]) throw new AppError(400, 'Segundo sorteo no encontrado');
      sorteoB = resB;
    }

    const folio = generarFolio();
    const hoy = fechaHoyRD();
    const fechaSorteoFinal = fecha_sorteo || hoy;

    if (fechaSorteoFinal < hoy) {
      throw new AppError(400, 'No se pueden realizar jugadas para una fecha pasada');
    }
    if (fechaSorteoFinal === hoy) {
      if (esSorteoCerrado(sorteoA.rows[0])) {
        throw new AppError(400, `El sorteo ${sorteoA.rows[0].nombre} ya está cerrado para el día de hoy`);
      }
      if (sorteoB && esSorteoCerrado(sorteoB.rows[0])) {
        throw new AppError(400, `El sorteo ${sorteoB.rows[0].nombre} ya está cerrado para el día de hoy`);
      }
    }

    const info = await client.query(
      `INSERT INTO jugadas (empresa_id, sucursal_id, folio, vendedor_id, sorteo_id, sorteo_id_b, tipo_jugada, numeros, posicion, monto, fecha_jugada, fecha_sorteo, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pendiente') RETURNING id, folio`,
      [req.tenant.empresaId, sucursalVenta, folio, req.tenant.usuarioId, sorteo_id, sorteo_id_b || null, tipo_jugada,
        JSON.stringify(numeros), posicion || null, monto, hoy, fechaSorteoFinal]
    );
    const createdJugada = info.rows[0];

    await registrarAuditoria(client, {
      empresaId: req.tenant.empresaId,
      sucursalId: sucursalVenta,
      usuarioId: req.tenant.usuarioId,
      accion: 'JUGADA_CREADA',
      entidad: 'jugadas',
      entidadId: createdJugada.id,
      detalles: { folio, tipo_jugada, numeros, monto, fechaSorteoFinal },
      ipAddress: req.ip
    });

    return createdJugada;
  });
  res.json(result);
}));

app.get('/api/jugadas', authTenant(), asyncHandler(async (req, res) => {
  const { fecha, vendedor_id, estado } = req.query;
  const scope = scopeSucursal(req.tenant);

  let sql = `
    SELECT j.*, u.nombre AS vendedor_nombre, s.nombre AS sorteo_nombre
    FROM jugadas j
    JOIN usuarios u ON u.id = j.vendedor_id
    JOIN sorteos s ON s.id = j.sorteo_id
    WHERE 1=1
  `;
  const params = [];
  if (req.tenant.rol === 'vendedor') {
    params.push(req.tenant.usuarioId);
    sql += ` AND j.vendedor_id = $${params.length}`;
  } else if (scope) {
    params.push(scope);
    sql += ` AND j.sucursal_id = $${params.length}`;
  } else if (vendedor_id) {
    params.push(vendedor_id);
    sql += ` AND j.vendedor_id = $${params.length}`;
  }
  if (fecha) { params.push(fecha); sql += ` AND j.fecha_jugada = $${params.length}`; }
  if (estado) { params.push(estado); sql += ` AND j.estado = $${params.length}`; }
  sql += ' ORDER BY j.creado_en DESC LIMIT 500';

  const { rows } = await withTenant(req.tenant.empresaId, client => client.query(sql, params));
  res.json(rows);
}));

// Anulación de jugadas — solo admin_sucursal y admin_empresa pueden anular.
// Los vendedores NO pueden anular tickets (decisión de negocio confirmada
// por Óscar, 1 ago 2026). El admin_sucursal solo anula jugadas de su
// sucursal; admin_empresa puede anular cualquiera de su empresa.
app.post('/api/jugadas/:id/anular', authTenant(['admin_sucursal', 'admin_empresa']), validate('idParam', 'params'), asyncHandler(async (req, res) => {
  const result = await withTenant(req.tenant.empresaId, async (client) => {
    const jugadaRes = await client.query(`SELECT * FROM jugadas WHERE id=$1`, [req.params.id]);
    const jugada = jugadaRes.rows[0];
    if (!jugada) throw new AppError(404, 'Jugada no encontrada');
    if (req.tenant.rol === 'admin_sucursal' && jugada.sucursal_id !== req.tenant.sucursalId) {
      throw new AppError(403, 'No puede anular jugadas de otra sucursal');
    }
    await client.query(`UPDATE jugadas SET estado='anulado' WHERE id=$1`, [req.params.id]);

    await registrarAuditoria(client, {
      empresaId: req.tenant.empresaId,
      sucursalId: jugada.sucursal_id,
      usuarioId: req.tenant.usuarioId,
      accion: 'JUGADA_ANULADA',
      entidad: 'jugadas',
      entidadId: jugada.id,
      detalles: { folio: jugada.folio, monto: jugada.monto },
      ipAddress: req.ip
    });

    return { ok: true };
  });
  res.json(result);
}));

// Verificación pública de una boleta. El folio es único POR EMPRESA, así que
// la URL debe incluir el código de empresa: /api/verificar/:codigoEmpresa/:folio
app.get('/api/verificar/:codigoEmpresa/:folio', validate('verificarParams', 'params'), asyncHandler(async (req, res) => {
  const empresaRow = await withPlatform(client =>
    client.query(`SELECT id FROM empresas WHERE codigo=$1`, [req.params.codigoEmpresa])
  );
  const empresa = empresaRow.rows[0];
  if (!empresa) throw new AppError(404, 'Empresa no encontrada');

  const { rows } = await withTenant(empresa.id, client =>
    client.query(
      `SELECT j.*, u.nombre AS vendedor_nombre, s.nombre AS sorteo_nombre
       FROM jugadas j
       LEFT JOIN usuarios u ON u.id = j.vendedor_id
       LEFT JOIN sorteos s ON s.id = j.sorteo_id
       WHERE j.folio = $1 ORDER BY j.creado_en DESC LIMIT 1`,
      [req.params.folio]
    )
  );
  if (!rows[0]) throw new AppError(404, 'Folio no encontrado');
  res.json({ ok: true, jugada: rows[0] });
}));

// ============================================================================
// TENANT — RESULTADOS Y LIQUIDACIÓN
// ============================================================================

app.post('/api/resultados', authTenant(['admin_empresa', 'admin_sucursal']), validate('cargarResultado'), asyncHandler(async (req, res) => {
  const { sorteo_id, fecha, num1, num2, num3 } = req.body;

  const resultado = await withTenant(req.tenant.empresaId, async (client) => {
    const existe = await client.query(`SELECT id FROM resultados WHERE sorteo_id=$1 AND fecha=$2`, [sorteo_id, fecha]);
    if (existe.rows[0]) throw new AppError(400, 'Ya existe un resultado para este sorteo y fecha');

    await client.query(
      `INSERT INTO resultados (empresa_id, sorteo_id, fecha, num1, num2, num3) VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.tenant.empresaId, sorteo_id, fecha, num1, num2, num3]
    );

    const jugadasRes = await client.query(
      `SELECT * FROM jugadas 
       WHERE (sorteo_id = $1 OR sorteo_id_b = $1)
         AND fecha_sorteo = $2
         AND estado = 'pendiente'`,
      [sorteo_id, fecha]
    );
    const numerosGanadores = { num1, num2, num3 };
    let totalJugadas = 0, totalGanadoras = 0, totalPremios = 0;

    for (const j of jugadasRes.rows) {
      if (j.tipo_jugada === 'superpale') {
        const resA = await client.query(`SELECT num1 FROM resultados WHERE sorteo_id=$1 AND fecha=$2`, [j.sorteo_id, fecha]);
        const resB = await client.query(`SELECT num1 FROM resultados WHERE sorteo_id=$1 AND fecha=$2`, [j.sorteo_id_b, fecha]);
        
        if (!resA.rows[0] || !resB.rows[0]) {
          // Falta el resultado de alguno de los dos sorteos, mantener pendiente
          continue;
        }

        const numA_1 = resA.rows[0].num1;
        const numB_1 = resB.rows[0].num1;

        const evaluacion = evaluarJugada('superpale', j.numeros, null, { num1: numA_1, num2: numB_1 });
        const premio = await calcularPremio(client, req.tenant.empresaId, j.sucursal_id, 'superpale', Number(j.monto), evaluacion, null);
        await client.query(`UPDATE jugadas SET estado=$1, premio=$2 WHERE id=$3`, [evaluacion.gano ? 'ganado' : 'perdido', premio, j.id]);

        totalJugadas++;
        if (evaluacion.gano) { totalGanadoras++; totalPremios += premio; }
      } else {
        const numeros = j.numeros; // jsonb ya viene parseado por el driver
        const evaluacion = evaluarJugada(j.tipo_jugada, numeros, j.posicion, numerosGanadores);
        const premio = await calcularPremio(client, req.tenant.empresaId, j.sucursal_id, j.tipo_jugada, Number(j.monto), evaluacion, j.posicion);
        await client.query(`UPDATE jugadas SET estado=$1, premio=$2 WHERE id=$3`, [evaluacion.gano ? 'ganado' : 'perdido', premio, j.id]);
        
        totalJugadas++;
        if (evaluacion.gano) { totalGanadoras++; totalPremios += premio; }
      }
    }
    return { liquidadas: totalJugadas, ganadoras: totalGanadoras, totalPremios };
  });
  res.json({ ok: true, ...resultado });
}));

app.get('/api/resultados', authTenant(), asyncHandler(async (req, res) => {
  const { rows } = await withTenant(req.tenant.empresaId, client =>
    client.query(`
      SELECT r.*, s.nombre AS sorteo_nombre FROM resultados r
      JOIN sorteos s ON s.id = r.sorteo_id
      ORDER BY r.fecha DESC, r.creado_en DESC LIMIT 200
    `)
  );
  res.json(rows);
}));

// ============================================================================
// REPORTES
// ============================================================================

app.get('/api/reportes/resumen', authTenant(), asyncHandler(async (req, res) => {
  const f = req.query.fecha || fechaHoyRD();
  const scope = scopeSucursal(req.tenant);
  const params = [f];
  let cond = '';
  if (req.tenant.rol === 'vendedor') { params.push(req.tenant.usuarioId); cond = ` AND vendedor_id = $${params.length}`; }
  else if (scope) { params.push(scope); cond = ` AND sucursal_id = $${params.length}`; }

  const { rows } = await withTenant(req.tenant.empresaId, client =>
    client.query(`
      SELECT
        COUNT(*) AS total_jugadas,
        COALESCE(SUM(monto),0) AS total_vendido,
        COALESCE(SUM(CASE WHEN estado='ganado' THEN premio ELSE 0 END),0) AS total_premiado,
        COALESCE(SUM(CASE WHEN estado='ganado' THEN 1 ELSE 0 END),0) AS total_ganadoras,
        COALESCE(SUM(CASE WHEN estado='anulado' THEN monto ELSE 0 END),0) AS total_anulado
      FROM jugadas WHERE fecha_jugada = $1 ${cond}
    `, params)
  );
  const t = rows[0];
  res.json({ fecha: f, ...t, balance: Number(t.total_vendido) - Number(t.total_premiado) });
}));

app.get('/api/reportes/vendedores', authTenant(['admin_empresa', 'admin_sucursal']), asyncHandler(async (req, res) => {
  const f = req.query.fecha || fechaHoyRD();
  const scope = scopeSucursal(req.tenant);
  const params = [f];
  let cond = '';
  if (scope) { params.push(scope); cond = ` AND u.sucursal_id = $${params.length}`; }

  const { rows } = await withTenant(req.tenant.empresaId, client =>
    client.query(`
      SELECT u.nombre AS vendedor, COUNT(j.id) AS jugadas,
        COALESCE(SUM(j.monto),0) AS vendido,
        COALESCE(SUM(CASE WHEN j.estado='ganado' THEN j.premio ELSE 0 END),0) AS premiado
      FROM usuarios u LEFT JOIN jugadas j ON j.vendedor_id = u.id AND j.fecha_jugada = $1
      WHERE u.rol='vendedor' ${cond}
      GROUP BY u.id ORDER BY vendido DESC
    `, params)
  );
  res.json(rows);
}));

// ============================================================================
// CAJA
// ============================================================================

app.post('/api/caja/cerrar', authTenant(['vendedor', 'admin_sucursal', 'admin_empresa']), validate('cerrarCaja'), asyncHandler(async (req, res) => {
  const f = req.body.fecha || fechaHoyRD();
  const vendedorId = req.tenant.rol === 'vendedor' ? req.tenant.usuarioId : req.body.vendedor_id;
  if (!vendedorId) throw new AppError(400, 'vendedor_id requerido');

  const resultado = await withTenant(req.tenant.empresaId, async (client) => {
    const userRow = await client.query(`SELECT sucursal_id FROM usuarios WHERE id=$1`, [vendedorId]);
    const sucursalId = userRow.rows[0]?.sucursal_id;
    const totales = await client.query(`
      SELECT COALESCE(SUM(monto),0) AS vendido, COALESCE(SUM(CASE WHEN estado='ganado' THEN premio ELSE 0 END),0) AS premiado
      FROM jugadas WHERE fecha_jugada=$1 AND vendedor_id=$2 AND estado != 'anulado'
    `, [f, vendedorId]);
    const t = totales.rows[0];
    const balance = Number(t.vendido) - Number(t.premiado);
    await client.query(`
      INSERT INTO caja_cierres (empresa_id, sucursal_id, vendedor_id, fecha, total_vendido, total_premiado, balance)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (empresa_id, vendedor_id, fecha) DO UPDATE SET
        total_vendido=excluded.total_vendido, total_premiado=excluded.total_premiado,
        balance=excluded.balance, cerrado_en=now()
    `, [req.tenant.empresaId, sucursalId, vendedorId, f, t.vendido, t.premiado, balance]);
    return { vendido: t.vendido, premiado: t.premiado, balance };
  });
  res.json({ ok: true, fecha: f, ...resultado });
}));

app.get('/api/caja/cierres', authTenant(['admin_empresa', 'admin_sucursal']), asyncHandler(async (req, res) => {
  const scope = scopeSucursal(req.tenant);
  const params = [];
  let cond = '';
  if (scope) { params.push(scope); cond = `WHERE c.sucursal_id = $${params.length}`; }
  const { rows } = await withTenant(req.tenant.empresaId, client =>
    client.query(`
      SELECT c.*, u.nombre AS vendedor_nombre FROM caja_cierres c
      JOIN usuarios u ON u.id = c.vendedor_id ${cond} ORDER BY c.fecha DESC LIMIT 100
    `, params)
  );
  res.json(rows);
}));

// ============================================================================
// USUARIOS (gestión dentro del tenant)
// ============================================================================

app.get('/api/usuarios', authTenant(['admin_empresa', 'admin_sucursal']), asyncHandler(async (req, res) => {
  const scope = scopeSucursal(req.tenant);
  const params = [];
  let cond = '';
  if (scope) { params.push(scope); cond = `WHERE sucursal_id = $${params.length}`; }
  const { rows } = await withTenant(req.tenant.empresaId, client =>
    client.query(`SELECT id, nombre, usuario, rol, sucursal_id, activo FROM usuarios ${cond} ORDER BY nombre`, params)
  );
  res.json(rows);
}));

app.post('/api/usuarios', authTenant(['admin_empresa', 'admin_sucursal']), validate('crearUsuario'), asyncHandler(async (req, res) => {
  const { nombre, usuario, password, rol, sucursal_id } = req.body;
  if (rol !== 'admin_empresa' && !sucursal_id && req.tenant.rol !== 'admin_sucursal') {
    throw new AppError(400, 'sucursal_id requerido para este rol');
  }
  const sucursalFinal = req.tenant.rol === 'admin_sucursal' ? req.tenant.sucursalId : (sucursal_id || null);
  if (req.tenant.rol === 'admin_sucursal' && rol !== 'vendedor') {
    throw new AppError(403, 'Un admin de sucursal solo puede crear vendedores');
  }

  const result = await withTenant(req.tenant.empresaId, async (client) => {
    // Generar código corto: V-S01-GG1 (vendedor) o A-S01-PC0 (admin_sucursal)
    let codigoCorto = null;
    if (sucursalFinal && (rol === 'vendedor' || rol === 'admin_sucursal')) {
      // Obtener codigo_corto de la sucursal
      const sucRes = await client.query(`SELECT codigo_corto FROM sucursales WHERE id=$1`, [sucursalFinal]);
      const sucCode = sucRes.rows[0]?.codigo_corto || 'S??';

      // Calcular iniciales del nombre (primeras letras de las primeras 2 palabras)
      const palabras = nombre.trim().split(/\s+/);
      const iniciales = palabras.slice(0, 2).map(p => p[0].toUpperCase()).join('');

      const prefijo = rol === 'admin_sucursal' ? 'A' : 'V';

      if (rol === 'admin_sucursal') {
        // admin_sucursal siempre es n=0 ("el vendedor por defecto" de la sucursal)
        codigoCorto = `${prefijo}-${sucCode}-${iniciales}0`;
      } else {
        // El número final refleja la posición de creación en la sucursal
        // (cuántos vendedores ya existen, independientemente de iniciales).
        // Así Gabriel García (1ro) → V-S01-GG1; Clara García (2da) → V-S01-CG2.
        // Se usa FOR UPDATE para serializar inserciones concurrentes.
        const countRes = await client.query(
          `SELECT COUNT(*)::int AS c FROM usuarios
           WHERE sucursal_id=$1 AND rol='vendedor'
           FOR UPDATE`,
          [sucursalFinal]
        );
        const n = countRes.rows[0].c + 1;
        codigoCorto = `${prefijo}-${sucCode}-${iniciales}${n}`;
      }
    }

    const { rows } = await client.query(
      `INSERT INTO usuarios (empresa_id, sucursal_id, nombre, usuario, password_hash, rol, codigo_corto)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, codigo_corto`,
      [req.tenant.empresaId, sucursalFinal, nombre, usuario, bcrypt.hashSync(password, 12), rol, codigoCorto]
    );
    return rows[0];
  });
  res.json(result);
}));

app.put('/api/usuarios/:id/estado', authTenant(['admin_empresa', 'admin_sucursal']), validate('idParam', 'params'), validate('estadoUsuario'), asyncHandler(async (req, res) => {
  await withTenant(req.tenant.empresaId, client =>
    client.query(`UPDATE usuarios SET activo=$1 WHERE id=$2`, [req.body.activo, req.params.id])
  );
  res.json({ ok: true });
}));

// ============================================================================
// TENANT — REGISTRO DE AUDITORÍA INMUTABLE (Fase 8)
// ============================================================================
app.get('/api/audit-logs', authTenant(['admin_empresa']), asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0, accion } = req.query;
  const { rows } = await withTenant(req.tenant.empresaId, client => {
    let sql = `
      SELECT a.*, u.nombre AS usuario_nombre, s.nombre AS sucursal_nombre
      FROM audit_logs a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      LEFT JOIN sucursales s ON s.id = a.sucursal_id
      WHERE a.empresa_id = $1
    `;
    const params = [req.tenant.empresaId];
    if (accion) {
      params.push(accion);
      sql += ` AND a.accion = $${params.length}`;
    }
    sql += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit), Number(offset));
    return client.query(sql, params);
  });
  res.json(rows);
}));

// ---------- Fallback SPA ----------
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Manejo de errores centralizado — SIEMPRE al final ----------
app.use(errorHandler);

const PORT = process.env.PORT || 3500;
const os = require('os');
function obtenerIPsLocales() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor Banca de Lotería (SaaS) corriendo:`);
  console.log(`  → En esta PC:      http://localhost:${PORT}`);
  obtenerIPsLocales().forEach(ip => console.log(`  → Desde el celular: http://${ip}:${PORT}  (misma red WiFi)`));
});
