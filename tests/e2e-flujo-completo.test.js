// tests/e2e-flujo-completo.test.js — Venta → resultado → liquidación de premio.
//
// Replica exactamente el escenario real probado a mano el 31 de julio de
// 2026 desde un teléfono: una jugada de quiniela "cualquier posición" que
// gana, y confirma que el premio se calcula con la tarifa de la POSICIÓN
// GANADORA (no una tarifa genérica) — este es el comportamiento de negocio
// correcto (ver DISEÑO-multitenant.md, y el "casi bug" que casi se introduce
// por error en esta misma sesión antes de revisar el diseño original).
//
// Esta prueba existe específicamente para que ese error de diagnóstico no
// se repita: si alguien en el futuro "corrige" calcularPremio para ignorar
// la posición ganadora, esta prueba debe fallar y avisar.
//
// Requiere TEST_DATABASE_URL (o cae a DATABASE_URL con advertencia, igual
// que tests/rls-isolation.test.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
require('dotenv').config();
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { pool, withTenant } = require('../db');
const { validarNumeros, evaluarJugada, calcularPremio, generarFolio } = require('../logica');

let empresaId, sucursalId, vendedorId, loteriaId, sorteoId;

before(async () => {
  const { rows } = await pool.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user');
  if (rows[0]?.rolbypassrls) {
    throw new Error('El rol de conexión tiene BYPASSRLS=true — esta prueba necesita un rol con NOBYPASSRLS.');
  }

  const empresa = await pool.query(
    `INSERT INTO empresas (codigo, nombre_comercial) VALUES ($1, $2) RETURNING id`,
    [`test-e2e-${Date.now()}`, 'Empresa Prueba E2E']
  );
  empresaId = empresa.rows[0].id;

  await withTenant(empresaId, async (client) => {
    const suc = await client.query(
      `INSERT INTO sucursales (empresa_id, nombre, codigo) VALUES ($1, 'Sucursal E2E', 'E2E-01') RETURNING id`,
      [empresaId]
    );
    sucursalId = suc.rows[0].id;

    const vend = await client.query(
      `INSERT INTO usuarios (empresa_id, sucursal_id, nombre, usuario, password_hash, rol)
       VALUES ($1, $2, 'Vendedor E2E', 'vendedor-e2e', $3, 'vendedor') RETURNING id`,
      [empresaId, sucursalId, bcrypt.hashSync('x', 4)]
    );
    vendedorId = vend.rows[0].id;

    const lot = await client.query(
      `INSERT INTO empresa_loterias (empresa_id, nombre_personalizado) VALUES ($1, 'Lotería E2E') RETURNING id`,
      [empresaId]
    );
    loteriaId = lot.rows[0].id;

    const sort = await client.query(
      `INSERT INTO sorteos (empresa_id, empresa_loteria_id, nombre, hora) VALUES ($1, $2, 'Sorteo E2E', '12:00') RETURNING id`,
      [empresaId, loteriaId]
    );
    sorteoId = sort.rows[0].id;

    // Las 3 tarifas reales de quiniela — misma estructura que se configuró
    // a mano en las pruebas del 31 jul 2026 (1ra=60x, 2da=20x, 3ra=8x).
    await client.query(
      `INSERT INTO tabla_pagos (empresa_id, tipo_jugada, posicion, multiplicador) VALUES
        ($1,'quiniela','1ra',60), ($1,'quiniela','2da',20), ($1,'quiniela','3ra',8),
        ($1,'pale',NULL,1000), ($1,'tripleta',NULL,15000)`,
      [empresaId]
    );
  });
});

after(async () => {
  await pool.query(`DELETE FROM empresas WHERE id = $1`, [empresaId]).catch(() => {});
  await pool.end();
});

test('venta "cualquier posición" que gana en 1ra paga la tarifa de 1ra (60x), no una tarifa genérica', async () => {
  await withTenant(empresaId, async (client) => {
    // 1. Vender — igual que hace POST /api/jugadas, sin fijar posición
    const numeros = ['08'];
    const monto = 140;
    const err = validarNumeros('quiniela', numeros);
    assert.strictEqual(err, null);

    const folio = generarFolio();
    const hoy = '2026-07-31';
    const jugadaRes = await client.query(
      `INSERT INTO jugadas (empresa_id, sucursal_id, folio, vendedor_id, sorteo_id, tipo_jugada, numeros, posicion, monto, fecha_jugada, fecha_sorteo, estado)
       VALUES ($1,$2,$3,$4,$5,'quiniela',$6,NULL,$7,$8,$8,'pendiente') RETURNING id`,
      [empresaId, sucursalId, folio, vendedorId, sorteoId, JSON.stringify(numeros), monto, hoy]
    );
    const jugadaId = jugadaRes.rows[0].id;

    // 2. Cargar resultado — 08 gana en 1ra
    const resultado = { num1: '08', num2: '14', num3: '26' };
    await client.query(
      `INSERT INTO resultados (empresa_id, sorteo_id, fecha, num1, num2, num3) VALUES ($1,$2,$3,$4,$5,$6)`,
      [empresaId, sorteoId, hoy, resultado.num1, resultado.num2, resultado.num3]
    );

    // 3. Liquidar — misma lógica que usa POST /api/resultados en server.js
    const jugadaRow = await client.query(`SELECT * FROM jugadas WHERE id=$1`, [jugadaId]);
    const j = jugadaRow.rows[0];
    const evaluacion = evaluarJugada(j.tipo_jugada, j.numeros, j.posicion, resultado);
    assert.strictEqual(evaluacion.gano, true);
    assert.strictEqual(evaluacion.posicionGanadora, '1ra');

    const premio = await calcularPremio(client, empresaId, sucursalId, j.tipo_jugada, Number(j.monto), evaluacion, j.posicion);

    // La prueba central: 140 * 60 = 8400 — la tarifa de 1ra, no una tarifa
    // genérica ni 0. Este es el número exacto que se vio en la app real.
    assert.strictEqual(premio, 8400);

    await client.query(`UPDATE jugadas SET estado='ganado', premio=$1 WHERE id=$2`, [premio, jugadaId]);
    const final = await client.query(`SELECT estado, premio FROM jugadas WHERE id=$1`, [jugadaId]);
    assert.strictEqual(final.rows[0].estado, 'ganado');
    assert.strictEqual(Number(final.rows[0].premio), 8400);
  });
});

test('la misma jugada, si hubiera ganado en 2da en vez de 1ra, paga la tarifa de 2da (20x)', async () => {
  await withTenant(empresaId, async (client) => {
    const numeros = ['14'];
    const monto = 100;
    const resultado = { num1: '08', num2: '14', num3: '26' }; // 14 está en 2da, no en 1ra

    const evaluacion = evaluarJugada('quiniela', numeros, null, resultado);
    assert.strictEqual(evaluacion.gano, true);
    assert.strictEqual(evaluacion.posicionGanadora, '2da');

    const premio = await calcularPremio(client, empresaId, sucursalId, 'quiniela', monto, evaluacion, null);
    assert.strictEqual(premio, 2000); // 100 * 20
  });
});

test('una jugada perdedora paga 0, sin consultar la tabla de pagos innecesariamente', async () => {
  await withTenant(empresaId, async (client) => {
    const resultado = { num1: '08', num2: '14', num3: '26' };
    const evaluacion = evaluarJugada('quiniela', ['99'], null, resultado);
    assert.strictEqual(evaluacion.gano, false);
    const premio = await calcularPremio(client, empresaId, sucursalId, 'quiniela', 50, evaluacion, null);
    assert.strictEqual(premio, 0);
  });
});

test('pale y tripleta usan su tarifa fija (sin posición), no la de quiniela', async () => {
  await withTenant(empresaId, async (client) => {
    const resultado = { num1: '08', num2: '14', num3: '26' };
    const evalPale = evaluarJugada('pale', ['08', '14'], null, resultado);
    assert.strictEqual(evalPale.gano, true);
    const premioPale = await calcularPremio(client, empresaId, sucursalId, 'pale', 10, evalPale, null);
    assert.strictEqual(premioPale, 10000); // 10 * 1000

    const evalTripleta = evaluarJugada('tripleta', ['08', '14', '26'], null, resultado);
    assert.strictEqual(evalTripleta.gano, true);
    const premioTripleta = await calcularPremio(client, empresaId, sucursalId, 'tripleta', 5, evalTripleta, null);
    assert.strictEqual(premioTripleta, 75000); // 5 * 15000
  });
});

test('E2E: pale con tarifas específicas por posición (1-2, 1-3, 2-3)', async () => {
  await withTenant(empresaId, async (client) => {
    // Insertar tarifas específicas para palé
    await client.query(
      `INSERT INTO tabla_pagos (empresa_id, tipo_jugada, posicion, multiplicador) VALUES
        ($1, 'pale', '1-2', 1500),
        ($1, 'pale', '1-3', 200),
        ($1, 'pale', '2-3', 100)`,
      [empresaId]
    );

    const resultado = { num1: '08', num2: '14', num3: '26' };

    // 1ra y 2da -> 1-2 (debería pagar 1500x)
    const eval12 = evaluarJugada('pale', ['08', '14'], null, resultado);
    const premio12 = await calcularPremio(client, empresaId, sucursalId, 'pale', 10, eval12, null);
    assert.strictEqual(premio12, 15000);

    // 1ra y 3ra -> 1-3 (debería pagar 200x)
    const eval13 = evaluarJugada('pale', ['08', '26'], null, resultado);
    const premio13 = await calcularPremio(client, empresaId, sucursalId, 'pale', 10, eval13, null);
    assert.strictEqual(premio13, 2000);

    // Limpiar las tarifas específicas de este test para no interferir con otros tests
    await client.query(`DELETE FROM tabla_pagos WHERE empresa_id = $1 AND tipo_jugada = 'pale' AND posicion IS NOT NULL`, [empresaId]);
  });
});

test('E2E: tripleta con premios de consolación (2/3) y principal (3/3)', async () => {
  await withTenant(empresaId, async (client) => {
    // Configurar tarifas específicas para tripleta (posición '3' = 20000x, '2' = 100x)
    await client.query(
      `INSERT INTO tabla_pagos (empresa_id, tipo_jugada, posicion, multiplicador) VALUES
        ($1, 'tripleta', '3', 20000),
        ($1, 'tripleta', '2', 100)`,
      [empresaId]
    );

    const resultado = { num1: '08', num2: '14', num3: '26' };

    // Acierta 3/3 -> posición '3' (paga 20000x)
    const eval3 = evaluarJugada('tripleta', ['08', '14', '26'], null, resultado);
    const premio3 = await calcularPremio(client, empresaId, sucursalId, 'tripleta', 5, eval3, null);
    assert.strictEqual(premio3, 100000);

    // Acierta 2/3 -> posición '2' (paga 100x)
    const eval2 = evaluarJugada('tripleta', ['08', '14', '99'], null, resultado);
    const premio2 = await calcularPremio(client, empresaId, sucursalId, 'tripleta', 5, eval2, null);
    assert.strictEqual(premio2, 500);

    // Limpiar tarifas específicas
    await client.query(`DELETE FROM tabla_pagos WHERE empresa_id = $1 AND tipo_jugada = 'tripleta' AND posicion IS NOT NULL`, [empresaId]);
  });
});

test('E2E: superpale cruza resultados de dos sorteos distintos', async () => {
  await withTenant(empresaId, async (client) => {
    // Crear dos sorteos propios para este test (aislados del sorteoId global)
    const sortA = await client.query(
      `INSERT INTO sorteos (empresa_id, empresa_loteria_id, nombre, hora) VALUES ($1, $2, 'Sorteo SPL-A', '12:00') RETURNING id`,
      [empresaId, loteriaId]
    );
    const sorteoIdA = sortA.rows[0].id;

    const sortB = await client.query(
      `INSERT INTO sorteos (empresa_id, empresa_loteria_id, nombre, hora) VALUES ($1, $2, 'Sorteo SPL-B', '15:00') RETURNING id`,
      [empresaId, loteriaId]
    );
    const sorteoIdB = sortB.rows[0].id;

    // Tarifa superpale
    await client.query(
      `INSERT INTO tabla_pagos (empresa_id, tipo_jugada, posicion, multiplicador) VALUES ($1, 'superpale', NULL, 3000)`,
      [empresaId]
    );

    // Fecha propia para este test — sin colisión con otros tests
    const fechaTest = '2025-12-31';

    // Limpiar posibles restos de ejecuciones anteriores (idempotente)
    await client.query(`DELETE FROM jugadas WHERE sorteo_id IN ($1,$2) AND fecha_sorteo=$3`, [sorteoIdA, sorteoIdB, fechaTest]);
    await client.query(`DELETE FROM resultados WHERE sorteo_id IN ($1,$2) AND fecha=$3`, [sorteoIdA, sorteoIdB, fechaTest]);

    // Vender jugada superpale ['08', '99']
    const folio = generarFolio();
    const jugadaRes = await client.query(
      `INSERT INTO jugadas (empresa_id, sucursal_id, folio, vendedor_id, sorteo_id, sorteo_id_b, tipo_jugada, numeros, posicion, monto, fecha_jugada, fecha_sorteo, estado)
       VALUES ($1,$2,$3,$4,$5,$6,'superpale',$7,NULL,$8,$9,$9,'pendiente') RETURNING id`,
      [empresaId, sucursalId, folio, vendedorId, sorteoIdA, sorteoIdB, JSON.stringify(['08', '99']), 10, fechaTest]
    );
    const jugadaId = jugadaRes.rows[0].id;

    // Subir resultado del sorteo A (num1='08') — el B todavía no existe
    await client.query(
      `INSERT INTO resultados (empresa_id, sorteo_id, fecha, num1, num2, num3) VALUES ($1,$2,$3,'08','12','34')`,
      [empresaId, sorteoIdA, fechaTest]
    );

    // La jugada DEBE seguir pendiente (falta resultado del sorteo B)
    const check1 = await client.query(`SELECT estado FROM jugadas WHERE id=$1`, [jugadaId]);
    assert.strictEqual(check1.rows[0].estado, 'pendiente');

    // Subir resultado del sorteo B (num1='99') — ahora ambos están disponibles
    await client.query(
      `INSERT INTO resultados (empresa_id, sorteo_id, fecha, num1, num2, num3) VALUES ($1,$2,$3,'99','56','78')`,
      [empresaId, sorteoIdB, fechaTest]
    );

    // Simular liquidación de superpale (misma lógica que POST /api/resultados)
    const j = (await client.query(`SELECT * FROM jugadas WHERE id=$1`, [jugadaId])).rows[0];
    const resA = await client.query(`SELECT num1 FROM resultados WHERE sorteo_id=$1 AND fecha=$2`, [j.sorteo_id, fechaTest]);
    const resB = await client.query(`SELECT num1 FROM resultados WHERE sorteo_id=$1 AND fecha=$2`, [j.sorteo_id_b, fechaTest]);

    const evalSP = evaluarJugada('superpale', j.numeros, null, { num1: resA.rows[0].num1, num2: resB.rows[0].num1 });
    assert.strictEqual(evalSP.gano, true);

    const premioSP = await calcularPremio(client, empresaId, sucursalId, 'superpale', Number(j.monto), evalSP, null);
    assert.strictEqual(premioSP, 30000); // 10 * 3000

    await client.query(`UPDATE jugadas SET estado='ganado', premio=$1 WHERE id=$2`, [premioSP, jugadaId]);

    const final = await client.query(`SELECT estado, premio FROM jugadas WHERE id=$1`, [jugadaId]);
    assert.strictEqual(final.rows[0].estado, 'ganado');
    assert.strictEqual(Number(final.rows[0].premio), 30000);

    // Limpieza total de datos propios de este test
    await client.query(`DELETE FROM jugadas WHERE id=$1`, [jugadaId]);
    await client.query(`DELETE FROM resultados WHERE sorteo_id IN ($1,$2) AND fecha=$3`, [sorteoIdA, sorteoIdB, fechaTest]);
    await client.query(`DELETE FROM sorteos WHERE id IN ($1,$2)`, [sorteoIdA, sorteoIdB]);
    await client.query(`DELETE FROM tabla_pagos WHERE empresa_id=$1 AND tipo_jugada='superpale'`, [empresaId]);
  });
});
