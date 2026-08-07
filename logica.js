// logica.js — Reglas del juego: validación de números y cálculo de premios
// Idéntico en su matemática a la v1; lo que cambia es que calcularPremio
// ahora consulta Postgres (async) y resuelve el override empresa/sucursal.
const crypto = require('crypto');

function esNumeroValido(n) {
  return /^[0-9]{2}$/.test(n);
}

function validarNumeros(tipo_jugada, numeros) {
  if (!Array.isArray(numeros)) return 'Los números deben ser una lista';
  const cantidadEsperada = { quiniela: 1, pale: 2, tripleta: 3, superpale: 2 }[tipo_jugada];
  if (!cantidadEsperada) return 'Tipo de jugada inválido';
  if (numeros.length !== cantidadEsperada) {
    return `La jugada de ${tipo_jugada} requiere exactamente ${cantidadEsperada} número(s)`;
  }
  for (const n of numeros) {
    if (!esNumeroValido(n)) return `Número inválido: "${n}". Debe ser 00-99 (dos dígitos)`;
  }
  if (new Set(numeros).size !== numeros.length) {
    return 'No se pueden repetir números en la misma jugada';
  }
  return null;
}

function evaluarJugada(tipo_jugada, numerosJugados, posicion, resultado) {
  const ganadores = [resultado.num1, resultado.num2, resultado.num3];

  if (tipo_jugada === 'quiniela') {
    const [n] = numerosJugados;
    if (posicion) {
      const idx = { '1ra': 0, '2da': 1, '3ra': 2 }[posicion];
      const gano = ganadores[idx] === n;
      return { gano, aciertos: gano ? 1 : 0, detalle: gano ? `Acertó en ${posicion}` : 'No acertó' };
    } else {
      for (const [pos, idx] of [['1ra', 0], ['2da', 1], ['3ra', 2]]) {
        if (ganadores[idx] === n) {
          return { gano: true, aciertos: 1, detalle: `Acertó en ${pos}`, posicionGanadora: pos };
        }
      }
      return { gano: false, aciertos: 0, detalle: 'No acertó' };
    }
  }

  if (tipo_jugada === 'pale') {
    const idx1 = ganadores.indexOf(numerosJugados[0]);
    const idx2 = ganadores.indexOf(numerosJugados[1]);
    const gano = idx1 !== -1 && idx2 !== -1;
    if (gano) {
      const indices = [idx1, idx2].sort((a, b) => a - b);
      const posGanadora = `${indices[0] + 1}-${indices[1] + 1}`;
      return { gano: true, aciertos: 2, detalle: `Acertó ${posGanadora}`, posicionGanadora: posGanadora };
    }
    const aciertos = (idx1 !== -1 ? 1 : 0) + (idx2 !== -1 ? 1 : 0);
    return { gano: false, aciertos, detalle: `${aciertos}/2 números acertados` };
  }

  if (tipo_jugada === 'tripleta') {
    const aciertos = numerosJugados.filter(n => ganadores.includes(n)).length;
    if (aciertos === 3) {
      return { gano: true, aciertos: 3, detalle: '3/3 números acertados', posicionGanadora: '3' };
    } else if (aciertos === 2) {
      return { gano: true, aciertos: 2, detalle: '2/3 números acertados (Consolación)', posicionGanadora: '2' };
    }
    return { gano: false, aciertos, detalle: `${aciertos}/3 números acertados` };
  }

  if (tipo_jugada === 'superpale') {
    const [n1, n2] = numerosJugados;
    // En superpale: resultado tiene num1 (1ra de Sorteo A) y num2 (1ra de Sorteo B)
    const gano = (n1 === resultado.num1 && n2 === resultado.num2) || (n2 === resultado.num1 && n1 === resultado.num2);
    return { gano, aciertos: gano ? 2 : 0, detalle: gano ? 'Acertó Super Palé' : 'No acertó' };
  }

  return { gano: false, aciertos: 0, detalle: 'Tipo desconocido' };
}

/**
 * Calcula el premio. `client` debe ser el cliente de una transacción abierta
 * con withTenant() (para que RLS ya tenga el empresa_id correcto).
 * Resuelve primero el override de la sucursal; si no existe, cae al default
 * de la empresa.
 */
async function calcularPremio(client, empresaId, sucursalId, tipo_jugada, monto, evaluacion, posicionJugada) {
  if (!evaluacion.gano) return 0;
  let posicion = posicionJugada || evaluacion.posicionGanadora || null;

  let { rows } = await client.query(
    `SELECT multiplicador FROM tabla_pagos
     WHERE empresa_id = $1
       AND tipo_jugada = $2
       AND COALESCE(posicion, '') = COALESCE($3, '')
       AND (sucursal_id = $4 OR sucursal_id IS NULL)
     ORDER BY sucursal_id NULLS LAST
     LIMIT 1`,
    [empresaId, tipo_jugada, posicion, sucursalId]
  );

  // Fallback para tripleta (si se busca '3' pero está configurado como NULL)
  if (!rows.length && tipo_jugada === 'tripleta' && posicion === '3') {
    const res = await client.query(
      `SELECT multiplicador FROM tabla_pagos
       WHERE empresa_id = $1
         AND tipo_jugada = $2
         AND posicion IS NULL
         AND (sucursal_id = $3 OR sucursal_id IS NULL)
       ORDER BY sucursal_id NULLS LAST
       LIMIT 1`,
      [empresaId, tipo_jugada, sucursalId]
    );
    rows = res.rows;
  }

  // Fallback para pale (si se busca '1-2', '1-3', '2-3' pero está configurado como NULL)
  if (!rows.length && tipo_jugada === 'pale') {
    const res = await client.query(
      `SELECT multiplicador FROM tabla_pagos
       WHERE empresa_id = $1
         AND tipo_jugada = $2
         AND posicion IS NULL
         AND (sucursal_id = $3 OR sucursal_id IS NULL)
       ORDER BY sucursal_id NULLS LAST
       LIMIT 1`,
      [empresaId, tipo_jugada, sucursalId]
    );
    rows = res.rows;
  }

  return rows.length ? monto * Number(rows[0].multiplicador) : 0;
}

function generarFolio() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `T-${ts}-${rand}`;
}

module.exports = { esNumeroValido, validarNumeros, evaluarJugada, calcularPremio, generarFolio };
