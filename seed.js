// seed.js — Crea el primer usuario super_admin de la PLATAFORMA (no de un tenant).
// Es idempotente: si ya existe un staff con ese usuario, no hace nada.
// Se ejecuta una sola vez, después de correr schema.sql: `npm run seed`
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function main() {
  const usuario = process.env.SEED_SUPERADMIN_USUARIO;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;

  if (!usuario || !password) {
    console.error('Define SEED_SUPERADMIN_USUARIO y SEED_SUPERADMIN_PASSWORD en tu .env antes de correr el seed.');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('SEED_SUPERADMIN_PASSWORD debe tener al menos 12 caracteres.');
    process.exit(1);
  }

  const existe = await pool.query('SELECT id FROM staff_plataforma WHERE usuario = $1', [usuario]);
  if (existe.rows[0]) {
    console.log(`Ya existe un staff de plataforma con usuario "${usuario}". No se hizo ningún cambio.`);
    process.exit(0);
  }

  const hash = bcrypt.hashSync(password, 12);
  await pool.query(
    `INSERT INTO staff_plataforma (nombre, usuario, password_hash, rol) VALUES ($1,$2,$3,'super_admin')`,
    ['Super Admin', usuario, hash]
  );
  console.log(`Super admin de plataforma creado: usuario="${usuario}"`);
  console.log('IMPORTANTE: ahora borra o cambia SEED_SUPERADMIN_PASSWORD en tu .env; ya cumplió su función.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Error al correr el seed:', e.message);
  process.exit(1);
});
