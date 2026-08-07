// db.js — Pool de PostgreSQL + helpers de aislamiento multi-tenant (RLS)
const { Pool } = require('pg');

// Proveedores de Postgres en la nube (Neon, Supabase, Render, RDS, etc.)
// exigen conexión cifrada. La detectamos automáticamente por el host o por
// "sslmode=require" en la cadena de conexión, para que el usuario no tenga
// que configurar nada extra a mano.
const useSSL = /neon\.tech|supabase\.co|render\.com|amazonaws\.com|sslmode=require/i
  .test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  // Errores en clientes inactivos del pool (ej. conexión caída) — no tumbar el proceso
  console.error('[db] Error inesperado en el pool de PostgreSQL:', err.message);
});

/**
 * Ejecuta `fn(client)` dentro de una transacción con el contexto de tenant
 * (empresa_id) fijado para RLS. SIEMPRE usar esto para cualquier query que
 * toque tablas de negocio de una empresa (jugadas, usuarios, sucursales...).
 *
 * Usa SET LOCAL (vía set_config con is_local=true) en vez de SET normal,
 * porque el valor debe revertirse automáticamente al terminar la transacción
 * — si no, con connection pooling una conexión reciclada podría "heredar"
 * el empresa_id de una request anterior de OTRA empresa.
 */
async function withTenant(empresaId, fn) {
  if (!empresaId) throw new Error('withTenant requiere un empresaId');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_empresa_id', empresaId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Para operaciones de PLATAFORMA (super_admin/soporte) sobre tablas que no
 * son de un tenant específico: staff_plataforma, empresas (alta de nuevas
 * empresas), loterias_catalogo, resultados_oficiales. No necesita contexto
 * de empresa porque esas tablas no tienen RLS.
 */
async function withPlatform(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

module.exports = { pool, withTenant, withPlatform };
