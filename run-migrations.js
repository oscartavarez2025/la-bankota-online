require('dotenv').config();
const { pool } = require('./db');
const fs = require('fs');
const path = require('path');

async function run() {
  const migrationsDir = path.join(__dirname, '../db-postgres/migrations');
  const files = [
    '001_fase_a_permisos_codigos_hora_cierre.sql',
    '002_fase_b_rediseño_pagos_spl.sql'
  ];

  for (const file of files) {
    console.log(`Running migration: ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query(sql);
      console.log(`Migration ${file} completed successfully.`);
    } catch (err) {
      console.error(`Error running migration ${file}:`, err);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log('All migrations completed!');
}

run().catch(console.error);
