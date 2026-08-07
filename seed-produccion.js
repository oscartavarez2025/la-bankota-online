require('dotenv').config();
const { pool, withPlatform, withTenant } = require('./db');
const bcrypt = require('bcryptjs');

async function seedProduccion() {
  console.log('===========================================================');
  console.log(' 🌱 SEMBRANDO DATOS PILOTO REALES DE PRODUCCIÓN');
  console.log('===========================================================\n');

  try {
    // 1. Sembrar Catálogo Global de Loterías
    console.log('1. Creando catálogo global de loterías...');
    const loteriasInsertadas = [];
    await withPlatform(async (client) => {
      const loterias = [
        { nombre: 'Nacional Noche', pais: 'DO' },
        { nombre: 'Gana Más (Nacional)', pais: 'DO' },
        { nombre: 'Lotería Real', pais: 'DO' },
        { nombre: 'Leidsa', pais: 'DO' },
        { nombre: 'Loteka', pais: 'DO' },
        { nombre: 'New York Tarde', pais: 'US' },
        { nombre: 'New York Noche', pais: 'US' },
        { nombre: 'Quiniela Suiza', pais: 'CH' }
      ];

      for (const l of loterias) {
        // Verificar si ya existe para no duplicar
        const existe = await client.query('SELECT id FROM loterias_catalogo WHERE nombre = $1', [l.nombre]);
        if (existe.rows.length === 0) {
          const res = await client.query(
            `INSERT INTO loterias_catalogo (nombre, pais) VALUES ($1, $2) RETURNING id, nombre`,
            [l.nombre, l.pais]
          );
          loteriasInsertadas.push(res.rows[0]);
          console.log(`   ✓ Creada: ${l.nombre}`);
        } else {
          loteriasInsertadas.push({ id: existe.rows[0].id, nombre: l.nombre });
        }
      }
    });

    // 2. Crear Empresa Piloto y Administrador
    console.log('\n2. Creando Empresa Piloto y Administrador...');
    let empresaId, sucursalId, vendedorId;
    await withPlatform(async (client) => {
      // Empresa
      const codEmpresa = 'piloto-1';
      const existeEmpresa = await client.query('SELECT id FROM empresas WHERE codigo = $1', [codEmpresa]);
      
      if (existeEmpresa.rows.length === 0) {
        const empRes = await client.query(
          `INSERT INTO empresas (codigo, nombre_comercial, plan) VALUES ($1, $2, $3) RETURNING id`,
          [codEmpresa, 'Bancas La Suerte SRL', 'pro']
        );
        empresaId = empRes.rows[0].id;
        console.log(`   ✓ Empresa "Bancas La Suerte SRL" (piloto-1) creada.`);
        
        // Admin creation moved to withTenant block below to satisfy RLS
      } else {
        empresaId = existeEmpresa.rows[0].id;
        console.log(`   ✓ La empresa piloto-1 ya existe. Usando esa empresa.`);
      }
    });

    // 3. Configurar Datos Específicos de la Empresa (Tenant)
    console.log('\n3. Configurando Loterías, Sorteos, Sucursal y Tabla de Pagos...');
    await withTenant(empresaId, async (client) => {
      // 3x. Crear el Admin de la Empresa
      const adminCheck = await client.query('SELECT id FROM usuarios WHERE rol = $1 AND empresa_id = $2', ['admin_empresa', empresaId]);
      if (adminCheck.rows.length === 0) {
        const passwordHash = bcrypt.hashSync('admin123', 12);
        await client.query(
          `INSERT INTO usuarios (empresa_id, nombre, usuario, password_hash, rol) 
           VALUES ($1, $2, $3, $4, 'admin_empresa')`,
          [empresaId, 'Administrador Piloto', 'adminpiloto', passwordHash]
        );
        console.log(`   ✓ Usuario "adminpiloto" creado con rol admin_empresa.`);
      } else {
        console.log(`   ✓ Usuario admin_empresa ya existe.`);
      }

      // 3a. Sucursal
      const sucCheck = await client.query('SELECT id FROM sucursales WHERE empresa_id = $1 LIMIT 1', [empresaId]);
      if (sucCheck.rows.length === 0) {
        const sucRes = await client.query(
          `INSERT INTO sucursales (empresa_id, nombre, codigo, codigo_corto) VALUES ($1, $2, $3, $4) RETURNING id`,
          [empresaId, 'Sucursal Central', 'CEN-01', 'S01']
        );
        sucursalId = sucRes.rows[0].id;
        console.log(`   ✓ Sucursal "Sucursal Central" (S01) creada.`);
        
        // Vendedor para probar
        const passwordHashVend = bcrypt.hashSync('vend123', 12);
        const vendRes = await client.query(
          `INSERT INTO usuarios (empresa_id, sucursal_id, nombre, usuario, password_hash, rol, codigo_corto) 
           VALUES ($1, $2, $3, $4, $5, 'vendedor', 'V-S01-JP1') RETURNING id`,
          [empresaId, sucursalId, 'Juan Perez', 'vendedor1', passwordHashVend]
        );
        vendedorId = vendRes.rows[0].id;
        console.log(`   ✓ Usuario "vendedor1" creado con rol vendedor.`);
      } else {
        sucursalId = sucCheck.rows[0].id;
        console.log(`   ✓ Sucursal ya existe.`);
      }

      // 3b. Suscribirse a Loterías
      const subsCheck = await client.query('SELECT id FROM empresa_loterias WHERE empresa_id = $1', [empresaId]);
      if (subsCheck.rows.length === 0) {
        for (const lot of loteriasInsertadas) {
          const empLotRes = await client.query(
            `INSERT INTO empresa_loterias (empresa_id, loteria_catalogo_id, nombre_personalizado, activo) 
             VALUES ($1, $2, $3, true) RETURNING id`,
            [empresaId, lot.id, lot.nombre]
          );
          const empresaLoteriaId = empLotRes.rows[0].id;
          
          // 3c. Crear al menos un sorteo base para cada lotería
          let hora = '20:00'; // Hora por defecto
          if (lot.nombre.includes('Tarde') || lot.nombre.includes('Gana Más')) hora = '14:30';
          if (lot.nombre.includes('Real')) hora = '13:00';

          await client.query(
            `INSERT INTO sorteos (empresa_id, empresa_loteria_id, nombre, hora, activo)
             VALUES ($1, $2, $3, $4, true)`,
            [empresaId, empresaLoteriaId, `Sorteo ${lot.nombre}`, hora]
          );
        }
        console.log(`   ✓ Empresa suscrita a las loterías y sorteos base creados.`);
      }

      // 3d. Tabla de Pagos
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
        console.log(`   ✓ Tabla de pagos estándar configurada (Quinielas 60/20/8, Palé 1000, Tripleta 15000, SPL 3000).`);
      } else {
        console.log(`   ✓ Tabla de pagos ya estaba configurada.`);
      }
    });

    console.log('\n===========================================================');
    console.log(' ✅ DATOS PILOTO SEMBRADOS EXITOSAMENTE');
    console.log('===========================================================');
    console.log('\nCredenciales para probar en el App / Panel de Empresa:');
    console.log('   👤 Admin Empresa:  adminpiloto / admin123');
    console.log('   👤 Vendedor:       vendedor1   / vend123');
    console.log('\n===========================================================');

  } catch (error) {
    console.error('\n❌ Error sembrando datos:', error);
  } finally {
    pool.end();
  }
}

seedProduccion();
