// seed-bankota.js — Siembra datos de LA BANKOTA (empresa única, loterías oficiales RD + extranjeras)
require('dotenv').config();
const { pool, withPlatform, withTenant } = require('./db');
const bcrypt = require('bcryptjs');

const LOTERIAS_CATALOGO = [
  // ── Dominicanas ──
  { nombre: 'Lotería Nacional',      pais: 'DO' },
  { nombre: 'Gana Más',              pais: 'DO' },
  { nombre: 'Quiniela Leidsa',       pais: 'DO' },
  { nombre: 'Quiniela Real',         pais: 'DO' },
  { nombre: 'Quiniela Loteka',       pais: 'DO' },
  { nombre: 'LoteDom',               pais: 'DO' },
  { nombre: 'La Primera Día',        pais: 'DO' },
  { nombre: 'Primera Noche',         pais: 'DO' },
  { nombre: 'La Suerte Día',         pais: 'DO' },
  { nombre: 'La Suerte Tarde',       pais: 'DO' },
  // ── Extranjeras ──
  { nombre: 'Anguila 10:00 AM',      pais: 'AI' },
  { nombre: 'New York Tarde',        pais: 'US' },
  { nombre: 'New York Noche',        pais: 'US' },
  { nombre: 'Florida Día',           pais: 'US' },
  { nombre: 'Florida Noche',         pais: 'US' },
];

// Horarios oficiales por nombre de lotería
// Nota: Lotería Nacional y Quiniela Leidsa tienen horarios diferentes L-S vs Domingo
// Para simplificar, usamos el horario más frecuente (L-S) y anotamos el de domingo
const SORTEOS = {
  'Lotería Nacional':      { hora: '21:00', nota: 'Domingo 18:00' },
  'Gana Más':              { hora: '14:30' },
  'Quiniela Leidsa':       { hora: '20:55', nota: 'Domingo 15:55' },
  'Quiniela Real':         { hora: '13:00' },
  'Quiniela Loteka':       { hora: '19:55' },
  'LoteDom':               { hora: '21:00', inhabilitado: true },
  'La Primera Día':        { hora: '12:00' },
  'Primera Noche':         { hora: '20:00' },
  'La Suerte Día':         { hora: '12:30' },
  'La Suerte Tarde':       { hora: '18:00' },
  'Anguila 10:00 AM':      { hora: '10:00' },
  'New York Tarde':        { hora: '14:30' },
  'New York Noche':        { hora: '22:30' },
  'Florida Día':           { hora: '13:30' },
  'Florida Noche':         { hora: '21:45' },
};

async function seedBankota() {
  console.log('===========================================================');
  console.log(' 🌱 SEMBRANDO DATOS DE LA BANKOTA');
  console.log('===========================================================\n');

  try {
    // ─── 1. Catálogo global de loterías ───
    console.log('1. Catálogo global de loterías...');
    const lotMap = {}; // nombre → id
    await withPlatform(async (client) => {
      for (const l of LOTERIAS_CATALOGO) {
        const existe = await client.query('SELECT id FROM loterias_catalogo WHERE nombre = $1', [l.nombre]);
        if (existe.rows.length === 0) {
          const res = await client.query(
            'INSERT INTO loterias_catalogo (nombre, pais) VALUES ($1, $2) RETURNING id', [l.nombre, l.pais]
          );
          lotMap[l.nombre] = res.rows[0].id;
          console.log(`   ✓ ${l.nombre}`);
        } else {
          lotMap[l.nombre] = existe.rows[0].id;
          console.log(`   · ${l.nombre} (ya existía)`);
        }
      }
    });

    // ─── 2. Empresa LA BANKOTA ───
    console.log('\n2. Empresa LA BANKOTA...');
    let empresaId;
    await withPlatform(async (client) => {
      const existe = await client.query("SELECT id FROM empresas WHERE codigo = 'la-bankota'");
      if (existe.rows.length === 0) {
        const res = await client.query(
          "INSERT INTO empresas (codigo, nombre_comercial, plan) VALUES ('la-bankota', 'LA BANKOTA', 'pro') RETURNING id"
        );
        empresaId = res.rows[0].id;
        console.log('   ✓ Empresa creada');
      } else {
        empresaId = existe.rows[0].id;
        console.log('   · Ya existía');
      }
    });

    // ─── 3. Admin, Sucursales S01-S02, Vendedores, Loterías, Sorteos, Pagos ───
    console.log('\n3. Datos del tenant...');
    await withTenant(empresaId, async (client) => {

      // Admin empresa
      const adminCheck = await client.query(
        "SELECT id FROM usuarios WHERE rol = 'admin_empresa' AND empresa_id = $1", [empresaId]
      );
      if (adminCheck.rows.length === 0) {
        await client.query(
          `INSERT INTO usuarios (empresa_id, nombre, usuario, password_hash, rol)
           VALUES ($1, 'Oscar Admin', 'oscar', $2, 'admin_empresa')`,
          [empresaId, bcrypt.hashSync('clave12345', 12)]
        );
        console.log('   ✓ Admin: oscar / clave12345');
      }

      // Sucursales S01 y S02
      const sucursales = [
        { nombre: 'LICEY_GABI-CLARA', codigo: 'LGC-01', corto: 'S01' },
        { nombre: 'CIRUELITOS_POLANCO', codigo: 'CRP-02', corto: 'S02' },
      ];
      const sucIds = {};
      for (const s of sucursales) {
        const existe = await client.query('SELECT id FROM sucursales WHERE codigo_corto = $1 AND empresa_id = $2', [s.corto, empresaId]);
        if (existe.rows.length === 0) {
          const res = await client.query(
            `INSERT INTO sucursales (empresa_id, nombre, codigo, codigo_corto) VALUES ($1,$2,$3,$4) RETURNING id`,
            [empresaId, s.nombre, s.codigo, s.corto]
          );
          sucIds[s.corto] = res.rows[0].id;
          console.log(`   ✓ Sucursal ${s.corto}: ${s.nombre}`);
        } else {
          sucIds[s.corto] = existe.rows[0].id;
          console.log(`   · Sucursal ${s.corto} ya existía`);
        }
      }

      // Admin sucursal S01
      const adminS01 = await client.query("SELECT id FROM usuarios WHERE codigo_corto = 'A-S01-PC0'");
      if (adminS01.rows.length === 0) {
        await client.query(
          `INSERT INTO usuarios (empresa_id, sucursal_id, nombre, usuario, password_hash, rol, codigo_corto)
           VALUES ($1, $2, 'Pedro Cruz', 'pedro', $3, 'admin_sucursal', 'A-S01-PC0')`,
          [empresaId, sucIds['S01'], bcrypt.hashSync('clave12345', 12)]
        );
        console.log('   ✓ Admin S01: pedro / clave12345 (A-S01-PC0)');
      }

      // Vendedores S01
      const vendedores = [
        { nombre: 'Gabriel García', usuario: 'gabriel', corto: 'V-S01-GG1', suc: 'S01' },
        { nombre: 'Clara García', usuario: 'clara', corto: 'V-S01-CG2', suc: 'S01' },
      ];
      for (const v of vendedores) {
        const existe = await client.query('SELECT id FROM usuarios WHERE codigo_corto = $1', [v.corto]);
        if (existe.rows.length === 0) {
          await client.query(
            `INSERT INTO usuarios (empresa_id, sucursal_id, nombre, usuario, password_hash, rol, codigo_corto)
             VALUES ($1, $2, $3, $4, $5, 'vendedor', $6)`,
            [empresaId, sucIds[v.suc], v.nombre, v.usuario, bcrypt.hashSync('clave12345', 12), v.corto]
          );
          console.log(`   ✓ Vendedor ${v.corto}: ${v.usuario} / clave12345`);
        }
      }

      // Suscribir a loterías y crear sorteos
      const subsCheck = await client.query('SELECT id FROM empresa_loterias WHERE empresa_id = $1', [empresaId]);
      if (subsCheck.rows.length === 0) {
        for (const l of LOTERIAS_CATALOGO) {
          const cfg = SORTEOS[l.nombre];
          const activo = !cfg?.inhabilitado;
          const empLotRes = await client.query(
            `INSERT INTO empresa_loterias (empresa_id, loteria_catalogo_id, nombre_personalizado, activo)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [empresaId, lotMap[l.nombre], l.nombre, activo]
          );
          const elId = empLotRes.rows[0].id;
          if (cfg && !cfg.inhabilitado) {
            await client.query(
              `INSERT INTO sorteos (empresa_id, empresa_loteria_id, nombre, hora, hora_cierre, activo)
               VALUES ($1, $2, $3, $4, $4, true)`,
              [empresaId, elId, l.nombre, cfg.hora]
            );
          }
          console.log(`   ${activo ? '✓' : '✗'} ${l.nombre} ${cfg?.hora || ''} ${cfg?.inhabilitado ? '(INHABILITADO)' : ''}`);
        }
      } else {
        console.log('   · Loterías ya configuradas');
      }

      // Tabla de pagos
      const pagosCheck = await client.query('SELECT id FROM tabla_pagos WHERE empresa_id = $1', [empresaId]);
      if (pagosCheck.rows.length === 0) {
        await client.query(
          `INSERT INTO tabla_pagos (empresa_id, tipo_jugada, posicion, multiplicador) VALUES
           ($1, 'quiniela', '1ra', 60),
           ($1, 'quiniela', '2da', 20),
           ($1, 'quiniela', '3ra', 8),
           ($1, 'pale', NULL, 1000),
           ($1, 'tripleta', NULL, 15000),
           ($1, 'superpale', NULL, 3000)`,
          [empresaId]
        );
        console.log('   ✓ Tabla de pagos estándar');
      }
    });

    console.log('\n===========================================================');
    console.log(' ✅ LA BANKOTA LISTA');
    console.log('===========================================================');
    console.log('\n  Empresa: la-bankota');
    console.log('  Sucursales: S01 (LICEY_GABI-CLARA), S02 (CIRUELITOS_POLANCO)');
    console.log('\n  Login (App):');
    console.log('    Sucursal S01 → gabriel / clave12345  (V-S01-GG1)');
    console.log('    Sucursal S01 → clara   / clave12345  (V-S01-CG2)');
    console.log('    Sucursal S01 → pedro   / clave12345  (A-S01-PC0, admin)');
    console.log('    (todas las sucursales) → oscar / clave12345 (admin empresa)');
    console.log('===========================================================\n');

  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    pool.end();
  }
}

seedBankota();
