/**
 * run-migrations-owner.js — Aplica las migraciones de Fase A y Fase B a Neon.
 *
 * REQUIERE ejecutarse con la URL del usuario OWNER de Neon (no app_banca2),
 * porque las migraciones incluyen ALTER TABLE que requieren ser dueño de la tabla.
 *
 * Uso:
 *   OWNER_DATABASE_URL="postgresql://neondb_owner:PASS@host/neondb?sslmode=require" node run-migrations-owner.js
 *
 * O bien: define OWNER_DATABASE_URL en tu .env local (¡no lo subas al repo!)
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.OWNER_DATABASE_URL;
if (!connectionString) {
  console.error('\n[ERROR] Define OWNER_DATABASE_URL con la URL del owner de Neon antes de correr este script.');
  console.error('Ejemplo: OWNER_DATABASE_URL="postgresql://neondb_owner:PASS@host/neondb?sslmode=require" node run-migrations-owner.js\n');
  process.exit(1);
}

const useSSL = /neon\.tech|supabase\.co|render\.com|amazonaws\.com|sslmode=require/i.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
});

async function run() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = [
    '001_fase_a_permisos_codigos_hora_cierre.sql',
    '002_fase_b_rediseño_pagos_spl.sql',
    '003_audit_logs.sql',
  ];

  for (const file of files) {
    console.log(`\n▶ Ejecutando migración: ${file}...`);
    let sqlPath = path.join(migrationsDir, file);
    if (!fs.existsSync(sqlPath)) {
      sqlPath = path.join(__dirname, '../db-postgres/migrations', file);
    }
    if (!fs.existsSync(sqlPath)) {
      console.error(`  ✗ Archivo no encontrado: ${sqlPath}`);
      process.exit(1);
    }
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`  ✓ ${file} completada.`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  ✗ Error en ${file}:`, err.message);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log('\n✅ Todas las migraciones completadas exitosamente.\n');
}

run().catch(console.error);
