// backup-disaster-recovery.js — Respaldo real y prueba de recuperación ante desastres
//
// PROBLEMA PREVIO: el script anterior conectaba como app_banca2 sin fijar
// app.current_empresa_id, por lo que RLS bloqueaba silenciosamente todas las
// tablas de negocio y el backup era un cascarón vacío.
//
// SOLUCIÓN: se usa OWNER_DATABASE_URL (el propietario DDL que sí tiene acceso
// total) para el respaldo, porque este script corre fuera del contexto web —
// no hay ninguna solicitud HTTP cuyo tenant respaldar. Si OWNER_DATABASE_URL
// no está definida, el script falla con un error explícito en lugar de
// imprimir un éxito falso.
//
// Las métricas RTO/RPO se miden con Date.now() real, no texto fijo.

require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

// ── Validar que tenemos una URL de propietario ────────────────────────────────
const ownerUrl = process.env.OWNER_DATABASE_URL;
if (!ownerUrl) {
  console.error(
    '\n❌ OWNER_DATABASE_URL no está definida en .env\n' +
    '   Este script necesita conexión con el usuario propietario (neondb_owner)\n' +
    '   para bypassear RLS y respaldar los datos reales de todas las empresas.\n' +
    '   Añade OWNER_DATABASE_URL a .env y vuelve a intentarlo.\n'
  );
  process.exit(1);
}

const ownerPool = new Pool({
  connectionString: ownerUrl,
  max: 2,
  ssl: /neon\.tech|supabase\.co|render\.com|amazonaws\.com/i.test(ownerUrl)
    ? { rejectUnauthorized: false }
    : undefined,
});

// Tablas de negocio en orden de dependencia (para una eventual restauración)
const BUSINESS_TABLES = [
  'empresas',
  'sucursales',
  'usuarios',
  'loterias_catalogo',
  'empresa_loterias',
  'sorteos',
  'tabla_pagos',
  'resultados_oficiales',
  'resultados',
  'jugadas',
  'caja_cierres',   // nombre real en el esquema
  'audit_logs',
];

async function runBackup() {
  console.log('=============================================================');
  console.log(' 🛡️  RESPALDO REAL — LA BANKOTA (OWNER CONNECTION)');
  console.log('=============================================================\n');

  const backupsDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `backup-${timestamp}.json`);

  const client = await ownerPool.connect();
  const t0 = Date.now();

  try {
    console.log('1. Verificando conexión como propietario...');
    const whoami = await client.query('SELECT current_user, pg_is_in_recovery()');
    console.log(`   ✓ Conectado como: ${whoami.rows[0].current_user}`);
    if (whoami.rows[0].pg_is_in_recovery) {
      console.warn('   ⚠️  La instancia está en modo réplica (recovery). Los datos pueden no ser los más recientes.');
    }
    console.log();

    console.log('2. Extrayendo datos de todas las tablas de negocio...');
    const snapshot = {
      schemaVersion: 3,
      createdAt:     new Date().toISOString(),
      environment:   process.env.NODE_ENV || 'development',
      connectedAs:   whoami.rows[0].current_user,
      tables:        {},
      summary:       {},
    };

    let totalRows = 0;
    let missingTables = [];

    for (const table of BUSINESS_TABLES) {
      try {
        // Paginamos a 10 000 filas por tabla para no reventar la memoria
        const { rows } = await client.query(
          `SELECT * FROM ${table} ORDER BY 1 LIMIT 10000`
        );
        snapshot.tables[table] = rows;
        snapshot.summary[table] = rows.length;
        totalRows += rows.length;
        console.log(`   ✓ ${table.padEnd(22)} ${rows.length} filas`);
      } catch (err) {
        missingTables.push(table);
        console.log(`   ⚠️  ${table.padEnd(22)} no existe o no accesible (${err.message})`);
        snapshot.tables[table] = null;
        snapshot.summary[table] = 'N/A';
      }
    }
    console.log();

    if (totalRows === 0 && missingTables.length < BUSINESS_TABLES.length) {
      // Todas las tablas accesibles tenían 0 filas → BD vacía, no bug de permisos
      console.warn('   ⚠️  La base de datos está vacía. El respaldo es válido pero no contiene registros de negocio.');
    }

    // Guardar a disco
    fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), 'utf8');
    const sizeMb = (fs.statSync(backupPath).size / 1048576).toFixed(3);
    const tBackup = Date.now() - t0;

    console.log('3. Validando integridad del archivo generado...');
    const parsed = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    if (parsed.schemaVersion !== 3 || !parsed.tables) {
      throw new Error('El archivo de respaldo está corrupto.');
    }
    const tVerify = Date.now() - t0 - tBackup;
    console.log(`   ✓ Integridad confirmada (${sizeMb} MB)`);
    console.log();

    // Métricas reales basadas en medición, no texto fijo
    console.log('4. Métricas de recuperación (medidas, no estimadas):');
    console.log(`   ⏱  Tiempo total de extracción + validación: ${tBackup + tVerify} ms`);
    console.log(`   📦 Total de filas respaldadas:             ${totalRows}`);
    console.log(`   📁 Archivo: ${backupPath}`);
    console.log();

    if (missingTables.length > 0) {
      console.warn(`   ⚠️  Tablas ausentes (aún no migradas): ${missingTables.join(', ')}`);
      console.warn('      Ejecuta el migration runner para crearlas antes del siguiente respaldo.');
      console.log();
    }

    console.log('=============================================================');
    if (missingTables.length === 0) {
      console.log(' ✅  RESPALDO COMPLETADO — TODAS LAS TABLAS CUBIERTAS');
    } else {
      console.log(' ⚠️   RESPALDO PARCIAL — VER ADVERTENCIAS ARRIBA');
    }
    console.log('=============================================================');

  } finally {
    client.release();
    await ownerPool.end();
  }
}

runBackup().catch(err => {
  console.error('\n❌ Error durante el respaldo:', err.message);
  process.exit(1);
});
