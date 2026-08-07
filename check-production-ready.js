// check-production-ready.js — Script de auditoría de seguridad y verificación pre-vuelo (Fase 7)
require('dotenv').config();
const { pool } = require('./db');

const INSECURE_SECRETS = ['secreto-super-seguro', 'jwt-secret', 'secret', '123456', 'change_me', 'admin'];

async function runPreflightCheck() {
  console.log('====================================================');
  console.log('  🔍 AUDITORÍA DE SEGURIDAD PRE-DESPLIEGUE (FASE 7)');
  console.log('====================================================\n');

  let errors = 0;
  let warnings = 0;

  // 1. Verificar NODE_ENV
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'production') {
    console.log('✅ NODE_ENV: configurado a "production".');
  } else {
    console.log(`⚠️  NODE_ENV: actualmente "${nodeEnv || 'no definido'}". Debe ser "production" en el servidor real.`);
    warnings++;
  }

  // 2. Verificar JWT_SECRET
  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) {
    console.log('❌ CRÍTICO: JWT_SECRET no está definido.');
    errors++;
  } else if (INSECURE_SECRETS.some(s => jwtSecret.toLowerCase().includes(s)) || jwtSecret.length < 32) {
    console.log(`❌ CRÍTICO: JWT_SECRET es inseguro o muy corto (${jwtSecret.length} caracteres). Genera una clave aleatoria de al menos 32 caracteres.`);
    errors++;
  } else {
    console.log(`✅ JWT_SECRET: seguro (${jwtSecret.length} caracteres).`);
  }

  // 3. Verificar CORS (ALLOWED_ORIGINS)
  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  if (!allowedOrigins || allowedOrigins.includes('*')) {
    console.log('⚠️  CORS: ALLOWED_ORIGINS no está definido o contiene "*". Especifica los dominios exactos del frontend.');
    warnings++;
  } else {
    console.log(`✅ CORS ALLOWED_ORIGINS: ${allowedOrigins}`);
  }

  // 4. Conexión a Base de Datos y Verificación de RLS
  try {
    const client = await pool.connect();
    console.log('\n--- VERIFICACIÓN EN BASE DE DATOS (POSTGRES / NEON) ---');

    // Check RLS status on sensitive tables
    const rlsCheck = await client.query(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      JOIN pg_class ON pg_tables.tablename = pg_class.relname
      WHERE schemaname = 'public'
        AND tablename IN ('jugadas', 'sucursales', 'usuarios', 'resultados', 'tabla_pagos', 'cierre_caja');
    `);

    const disabledRLS = rlsCheck.rows.filter(r => !r.rowsecurity);
    if (disabledRLS.length > 0) {
      console.log(`❌ CRÍTICO: RLS no está activo en las siguientes tablas: ${disabledRLS.map(r => r.tablename).join(', ')}`);
      errors++;
    } else {
      console.log('✅ RLS en Tablas: Activo en todas las tablas sensibles (jugadas, sucursales, usuarios, etc.).');
    }

    // Check DB Role BYPASSRLS status
    const currentUserRes = await client.query(`SELECT current_user;`);
    const dbUser = currentUserRes.rows[0].current_user;

    const roleCheck = await client.query(`
      SELECT rolname, rolbypassrls, rolsuper
      FROM pg_roles
      WHERE rolname = $1;
    `, [dbUser]);

    if (roleCheck.rows.length > 0) {
      const role = roleCheck.rows[0];
      if (role.rolbypassrls || role.rolsuper) {
        console.log(`⚠️  ROL BD ("${dbUser}"): Tiene privilegio BYPASSRLS o SUPERUSER. En producción, la API debe conectar con un usuario de rol restringido (sin BYPASSRLS).`);
        warnings++;
      } else {
        console.log(`✅ ROL BD ("${dbUser}"): Restringido correctamente (rolbypassrls = false).`);
      }
    }

    // Check initial seed data
    const empresasCount = await client.query(`SELECT COUNT(*) FROM empresas;`);
    console.log(`✅ Registro de Tenants: ${empresasCount.rows[0].count} empresa(s) registrada(s).`);

    client.release();
  } catch (dbErr) {
    console.log(`❌ ERROR CONEXIÓN BD: No se pudo conectar a PostgreSQL: ${dbErr.message}`);
    errors++;
  }

  console.log('\n----------------------------------------------------');
  if (errors > 0) {
    console.log(`❌ PREFLIGHT FALLIDO: ${errors} error(es) crítico(s), ${warnings} advertencia(s).`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`⚠️  PREFLIGHT COMPLETADO CON ADVERTENCIAS: 0 errores, ${warnings} advertencia(s).`);
    console.log('   Revisa los mensajes anteriores antes de desplegar a producción.');
  } else {
    console.log('🎉 SISTEMA LISTO PARA PRODUCCIÓN (FASE 7): Todas las verificaciones de seguridad pasaron al 100%.');
  }
  console.log('----------------------------------------------------');
}

runPreflightCheck().catch(err => {
  console.error('Error fatal durante la auditoría:', err);
  process.exit(1);
});
