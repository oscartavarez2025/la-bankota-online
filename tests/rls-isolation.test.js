// tests/rls-isolation.test.js — LA PRUEBA MÁS IMPORTANTE DE TODO EL SISTEMA.
//
// Confirma automáticamente lo que se verificó a mano en la sesión del 29 de
// julio de 2026: que una empresa NUNCA puede leer datos de otra, sin importar
// que ambas vivan en la misma base de datos compartida.
//
// Esta prueba habría detectado en segundos los dos problemas reales que se
// encontraron manualmente ese día:
//   1. Tablas sin FORCE ROW LEVEL SECURITY (el dueño de la tabla bypasea RLS)
//   2. Un rol de conexión con el atributo BYPASSRLS (Neon lo asigna por
//      defecto a roles creados desde su interfaz web — ver DISEÑO-multitenant.md)
//
// REQUISITO: definir TEST_DATABASE_URL en el entorno (o en .env), apuntando
// a una base de PRUEBA — idealmente una rama (branch) separada de Neon, no
// la base de desarrollo/producción, para no ensuciarla con datos de prueba.
// El rol usado en esa cadena de conexión DEBE tener NOBYPASSRLS, igual que
// en producción — si usas el rol "owner" por accidente, esta prueba pasará
// aunque el aislamiento real esté roto (falso positivo). Ver sección 11 de
// db-postgres/schema.sql para cómo crear ese rol correctamente.
//
// Ejecutar: npm run test:rls  (o npm test, que corre todo)

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  console.warn(
    '\n⚠️  TEST_DATABASE_URL no está definida — esta prueba usará DATABASE_URL ' +
    '(tu base normal). Se recomienda una base/rama separada solo para pruebas.\n'
  );
}
require('dotenv').config();
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { pool, withTenant } = require('../db');

let empresaA, empresaB;

before(async () => {
  // Verificación de seguridad de la propia prueba: si el rol conectado
  // puede saltarse RLS, esta prueba no sirve de nada — mejor fallar fuerte.
  const { rows } = await pool.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user');
  if (rows[0]?.rolbypassrls) {
    throw new Error(
      `El rol de conexión actual tiene BYPASSRLS=true. Esta prueba de aislamiento ` +
      `no es válida con ese rol (daría un falso positivo). Usa un rol con NOBYPASSRLS ` +
      `— ver db-postgres/schema.sql sección 11.`
    );
  }

  const a = await pool.query(
    `INSERT INTO empresas (codigo, nombre_comercial) VALUES ($1, $2) RETURNING id`,
    [`test-rls-a-${Date.now()}`, 'Empresa Prueba A']
  );
  const b = await pool.query(
    `INSERT INTO empresas (codigo, nombre_comercial) VALUES ($1, $2) RETURNING id`,
    [`test-rls-b-${Date.now()}`, 'Empresa Prueba B']
  );
  empresaA = a.rows[0].id;
  empresaB = b.rows[0].id;
});

after(async () => {
  // Limpieza: borrar bajo el contexto de tenant correcto (las tablas hijas
  // tienen RLS con FORCE, así que hay que fijar el contexto antes de borrar),
  // y al final borrar las empresas mismas (esa tabla no tiene RLS).
  if (empresaA) {
    await withTenant(empresaA, client => client.query(`DELETE FROM sucursales WHERE empresa_id = $1`, [empresaA]));
    await pool.query(`DELETE FROM empresas WHERE id = $1`, [empresaA]);
  }
  if (empresaB) {
    await withTenant(empresaB, client => client.query(`DELETE FROM sucursales WHERE empresa_id = $1`, [empresaB]));
    await pool.query(`DELETE FROM empresas WHERE id = $1`, [empresaB]);
  }
  await pool.end();
});

test('una empresa puede leer y ver sus propios datos (control positivo)', async () => {
  const creada = await withTenant(empresaA, client =>
    client.query(
      `INSERT INTO sucursales (empresa_id, nombre, codigo) VALUES ($1, 'Sucursal A1', 'TEST-A1') RETURNING id`,
      [empresaA]
    )
  );
  const sucursalId = creada.rows[0].id;

  const propia = await withTenant(empresaA, client =>
    client.query(`SELECT * FROM sucursales WHERE id = $1`, [sucursalId])
  );
  assert.strictEqual(propia.rows.length, 1, 'la empresa debe poder ver su propia sucursal');
});

test('CRÍTICO: una empresa NO puede leer sucursales de otra empresa', async () => {
  const secreta = await withTenant(empresaB, client =>
    client.query(
      `INSERT INTO sucursales (empresa_id, nombre, codigo) VALUES ($1, 'Sucursal Secreta B', 'TEST-B-SECRETA') RETURNING id`,
      [empresaB]
    )
  );
  const sucursalSecretaId = secreta.rows[0].id;

  // La prueba real: consultando TODAS las sucursales visibles desde el
  // contexto de la empresa A, la sucursal secreta de B NUNCA debe aparecer.
  const desdeA = await withTenant(empresaA, client => client.query(`SELECT * FROM sucursales`));
  const fuga = desdeA.rows.find(r => r.id === sucursalSecretaId);

  assert.strictEqual(
    fuga, undefined,
    'FALLO DE SEGURIDAD: la empresa A pudo leer una sucursal de la empresa B. ' +
    'Revisar FORCE ROW LEVEL SECURITY en la tabla y BYPASSRLS del rol de conexión.'
  );
});

test('CRÍTICO: una empresa NO puede leer usuarios de otra empresa', async () => {
  const bcrypt = require('bcryptjs');
  const secreto = await withTenant(empresaB, client =>
    client.query(
      `INSERT INTO usuarios (empresa_id, nombre, usuario, password_hash, rol)
       VALUES ($1, 'Admin Secreto B', 'admin-secreto-b', $2, 'admin_empresa') RETURNING id`,
      [empresaB, bcrypt.hashSync('x', 4)]
    )
  );
  const usuarioSecretoId = secreto.rows[0].id;

  const desdeA = await withTenant(empresaA, client => client.query(`SELECT * FROM usuarios`));
  const fuga = desdeA.rows.find(r => r.id === usuarioSecretoId);

  assert.strictEqual(fuga, undefined, 'FALLO DE SEGURIDAD: la empresa A pudo leer un usuario de la empresa B.');

  // Limpieza específica de este test (fuera del after, porque usuarios no
  // se borra ahí para mantener el after simple y genérico)
  await withTenant(empresaB, client => client.query(`DELETE FROM usuarios WHERE id = $1`, [usuarioSecretoId]));
});

test('sin contexto de tenant (sin SET app.current_empresa_id), no se ve ninguna fila', async () => {
  // Conexión directa sin pasar por withTenant — simula el peor escenario:
  // un desarrollador que olvida envolver una query nueva en withTenant().
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT * FROM sucursales`);
    assert.strictEqual(rows.length, 0, 'sin contexto de tenant fijado, no debe verse ninguna fila (falla cerrado, no abierto)');
  } finally {
    client.release();
  }
});
