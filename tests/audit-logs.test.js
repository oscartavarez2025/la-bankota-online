// audit-logs.test.js — Pruebas del Registro de Auditoría Inmutable (Fase 8)
//
// CORRECCIONES respecto a la versión anterior:
// 1. empresaId era el entero literal 1, pero el sistema usa UUIDs. Ahora
//    se consulta el UUID real de la primera empresa antes de cada test.
// 2. Los tests ya no se "saltan" en silencio si la tabla no existe —
//    la omisión silenciosa hace que parezcan exitosos sin haber probado nada.
//    Si la tabla falta, el test falla con un mensaje claro que indica que
//    hay que correr la migración 003_audit_logs.sql primero.
require('dotenv').config();
const test   = require('node:test');
const assert = require('node:assert');
const { pool, withTenant } = require('../db');
const { registrarAuditoria } = require('../audit');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Obtiene el UUID real de la primera empresa del sistema. */
async function obtenerEmpresaUUID(client) {
  const r = await client.query(`SELECT id FROM empresas LIMIT 1`);
  if (!r.rows.length) throw new Error('No hay ninguna empresa en la BD — crea al menos una antes de correr estos tests.');
  return r.rows[0].id; // UUID
}

/** Falla explícitamente si audit_logs no existe (no se salta en silencio). */
async function exigirTablaAuditLogs(client) {
  const r = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name   = 'audit_logs'
    ) AS existe
  `);
  if (!r.rows[0].existe) {
    throw new Error(
      'La tabla "audit_logs" no existe en la BD.\n' +
      'Corre primero: node run-migrations-owner.js\n' +
      '(necesitas OWNER_DATABASE_URL definida en .env)'
    );
  }
}

// ── Test 1: inserción real ─────────────────────────────────────────────────

test('Auditoría: registrarAuditoria inserta un evento real en audit_logs', async () => {
  // Obtener UUIDs reales sin context de tenant (pool directo) para no
  // depender de RLS para la consulta de setup.
  const setup = await pool.connect();
  let empresaId, sucursalId, usuarioId;
  try {
    const emp = await setup.query(`SELECT id FROM empresas LIMIT 1`);
    if (!emp.rows.length) throw new Error('No hay empresas en la BD.');
    empresaId = emp.rows[0].id;

    const suc = await setup.query(`SELECT id FROM sucursales WHERE empresa_id=$1 LIMIT 1`, [empresaId]);
    sucursalId = suc.rows[0]?.id ?? null;

    const usr = await setup.query(`SELECT id FROM usuarios WHERE empresa_id=$1 LIMIT 1`, [empresaId]);
    usuarioId = usr.rows[0]?.id ?? null;
  } finally {
    setup.release();
  }

  await withTenant(empresaId, async (client) => {
    // Fallar explícitamente si la tabla no existe
    await exigirTablaAuditLogs(client);

    const accion    = 'TEST_AUDIT_INSERCION';
    const entidadId = `TEST-${Date.now()}`;

    await registrarAuditoria(client, {
      empresaId,
      sucursalId,
      usuarioId,
      accion,
      entidad:   'jugadas',
      entidadId,
      detalles:  { motivo: 'Prueba unitaria — inserción real' },
      ipAddress: '127.0.0.1',
    });

    const res = await client.query(
      `SELECT * FROM audit_logs WHERE accion=$1 AND entidad_id=$2 AND empresa_id=$3`,
      [accion, entidadId, empresaId]
    );

    assert.strictEqual(res.rows.length, 1, 'Se esperaba exactamente 1 fila insertada');
    assert.strictEqual(res.rows[0].accion, accion);
    assert.strictEqual(res.rows[0].entidad, 'jugadas');
    assert.strictEqual(
      res.rows[0].detalles.motivo,
      'Prueba unitaria — inserción real',
      'El campo JSONB detalles no coincide'
    );

    // Limpieza — con conexión de owner (app_banca2 no puede borrar de audit_logs)
    if (process.env.OWNER_DATABASE_URL) {
      const { Pool } = require('pg');
      const ownerPool = new Pool({
        connectionString: process.env.OWNER_DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      const cleanup = await ownerPool.connect();
      try {
        await cleanup.query(`DELETE FROM audit_logs WHERE id=$1`, [res.rows[0].id]);
      } finally {
        cleanup.release();
        await ownerPool.end();
      }
    }
  });
});

// ── Test 2: aislamiento RLS entre empresas ─────────────────────────────────

test('Auditoría RLS: empresa_2 no puede leer eventos de empresa_1', async () => {
  // Necesitamos al menos 2 empresas para probar aislamiento real
  const setup = await pool.connect();
  let empresa1Id, empresa2Id;
  try {
    const emps = await setup.query(`SELECT id FROM empresas ORDER BY id LIMIT 2`);
    if (emps.rows.length < 2) {
      throw new Error(
        'Se necesitan al menos 2 empresas en la BD para probar el aislamiento RLS.\n' +
        'Crea una segunda empresa y vuelve a correr este test.'
      );
    }
    empresa1Id = emps.rows[0].id;
    empresa2Id = emps.rows[1].id;
  } finally {
    setup.release();
  }

  // Insertar un evento bajo empresa_1
  const accion = `AUDIT_RLS_ISO_${Date.now()}`;
  await withTenant(empresa1Id, async (client1) => {
    await exigirTablaAuditLogs(client1);
    await registrarAuditoria(client1, {
      empresaId: empresa1Id,
      accion,
      entidad:   'jugadas',
      entidadId: `ISO-${Date.now()}`,
      detalles:  { privado: true },
    });
  });

  // Leer desde empresa_2 — debe devolver 0 filas
  await withTenant(empresa2Id, async (client2) => {
    const res = await client2.query(
      `SELECT id FROM audit_logs WHERE accion=$1`, [accion]
    );
    assert.strictEqual(
      res.rows.length, 0,
      '🔴 CRÍTICO: empresa_2 pudo leer un evento de auditoría de empresa_1 — RLS roto'
    );
  });

  // Limpieza (con pool directo para no depender de RLS)
  if (process.env.OWNER_DATABASE_URL) {
    const { Pool } = require('pg');
    const ownerPool = new Pool({
      connectionString: process.env.OWNER_DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    const cleanup = await ownerPool.connect();
    try {
      await cleanup.query(`DELETE FROM audit_logs WHERE accion=$1`, [accion]);
    } finally {
      cleanup.release();
      await ownerPool.end();
    }
  }
});
