// tests/logica.test.js — Pruebas unitarias de logica.js.
// No tocan la base de datos: corren en milisegundos, sin configuración.
// Ejecutar: npm run test:unit  (o npm test, que corre todo)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarNumeros, evaluarJugada, calcularPremio, generarFolio } = require('../logica');

// ---------- validarNumeros ----------
test('validarNumeros: quiniela acepta exactamente 1 número de 2 dígitos', () => {
  assert.strictEqual(validarNumeros('quiniela', ['47']), null);
});

test('validarNumeros: quiniela rechaza 2 números', () => {
  assert.match(validarNumeros('quiniela', ['47', '12']), /1 número/);
});

test('validarNumeros: pale requiere exactamente 2 números', () => {
  assert.strictEqual(validarNumeros('pale', ['12', '34']), null);
  assert.match(validarNumeros('pale', ['12']), /2 número/);
});

test('validarNumeros: tripleta requiere exactamente 3 números', () => {
  assert.strictEqual(validarNumeros('tripleta', ['12', '34', '56']), null);
  assert.match(validarNumeros('tripleta', ['12', '34']), /3 número/);
});

test('validarNumeros: rechaza números fuera de rango o mal formados', () => {
  assert.match(validarNumeros('quiniela', ['100']), /inválido/);
  assert.match(validarNumeros('quiniela', ['abc']), /inválido/);
  assert.match(validarNumeros('quiniela', ['5']), /inválido/);
});

test('validarNumeros: rechaza números repetidos en la misma jugada', () => {
  assert.match(validarNumeros('pale', ['47', '47']), /repetir/);
});

test('validarNumeros: rechaza tipo de jugada desconocido', () => {
  assert.match(validarNumeros('bingo', ['47']), /inválido/);
});

// ---------- evaluarJugada ----------
test('evaluarJugada: quiniela con posición específica gana si coincide exacto', () => {
  const r = evaluarJugada('quiniela', ['47'], '1ra', { num1: '47', num2: '10', num3: '20' });
  assert.strictEqual(r.gano, true);
});

test('evaluarJugada: quiniela con posición específica pierde si no coincide esa posición', () => {
  const r = evaluarJugada('quiniela', ['47'], '1ra', { num1: '10', num2: '47', num3: '20' });
  assert.strictEqual(r.gano, false);
});

test('evaluarJugada: quiniela sin posición gana en cualquiera de las 3', () => {
  const r = evaluarJugada('quiniela', ['47'], null, { num1: '10', num2: '47', num3: '20' });
  assert.strictEqual(r.gano, true);
  assert.strictEqual(r.posicionGanadora, '2da');
});

test('evaluarJugada: pale gana con 2/2 aciertos y devuelve la posicion correcta', () => {
  // Acierto en 1ra y 2da
  const r12 = evaluarJugada('pale', ['47', '10'], null, { num1: '47', num2: '10', num3: '99' });
  assert.strictEqual(r12.gano, true);
  assert.strictEqual(r12.posicionGanadora, '1-2');

  // Acierto en 1ra y 3ra
  const r13 = evaluarJugada('pale', ['47', '99'], null, { num1: '47', num2: '10', num3: '99' });
  assert.strictEqual(r13.gano, true);
  assert.strictEqual(r13.posicionGanadora, '1-3');

  // Acierto en 2da y 3ra
  const r23 = evaluarJugada('pale', ['10', '99'], null, { num1: '47', num2: '10', num3: '99' });
  assert.strictEqual(r23.gano, true);
  assert.strictEqual(r23.posicionGanadora, '2-3');

  // Pierde con 1/2
  const pierde = evaluarJugada('pale', ['47', '55'], null, { num1: '47', num2: '10', num3: '99' });
  assert.strictEqual(pierde.gano, false);
  assert.strictEqual(pierde.aciertos, 1);
});

test('evaluarJugada: tripleta gana con 3/3 aciertos (principal) o 2/3 (consolación)', () => {
  // 3/3
  const r3 = evaluarJugada('tripleta', ['47', '10', '99'], null, { num1: '47', num2: '10', num3: '99' });
  assert.strictEqual(r3.gano, true);
  assert.strictEqual(r3.posicionGanadora, '3');

  // 2/3
  const r2 = evaluarJugada('tripleta', ['47', '10', '11'], null, { num1: '47', num2: '10', num3: '99' });
  assert.strictEqual(r2.gano, true);
  assert.strictEqual(r2.posicionGanadora, '2');

  // 1/3 (pierde)
  const pierde = evaluarJugada('tripleta', ['47', '11', '12'], null, { num1: '47', num2: '10', num3: '99' });
  assert.strictEqual(pierde.gano, false);
  assert.strictEqual(pierde.aciertos, 1);
});

test('evaluarJugada: superpale gana si coincide el primer premio de ambos sorteos', () => {
  // Gana
  const gana = evaluarJugada('superpale', ['47', '10'], null, { num1: '47', num2: '10' });
  assert.strictEqual(gana.gano, true);

  // Gana en orden inverso
  const ganaInv = evaluarJugada('superpale', ['10', '47'], null, { num1: '47', num2: '10' });
  assert.strictEqual(ganaInv.gano, true);

  // Pierde si uno no es 1er premio
  const pierde = evaluarJugada('superpale', ['47', '99'], null, { num1: '47', num2: '10' });
  assert.strictEqual(pierde.gano, false);
});

// ---------- calcularPremio ----------
// Se usa un "client" simulado (sin base de datos real) para probar la lógica
// de cálculo en aislamiento. La resolución empresa/sucursal en SQL real se
// prueba en tests/rls-isolation.test.js.
test('calcularPremio: retorna 0 si la jugada no ganó, sin consultar la tabla de pagos', async () => {
  let consultada = false;
  const fakeClient = { query: async () => { consultada = true; return { rows: [] }; } };
  const premio = await calcularPremio(fakeClient, 'emp1', 'suc1', 'quiniela', 100, { gano: false });
  assert.strictEqual(premio, 0);
  assert.strictEqual(consultada, false, 'no debería consultar la tabla de pagos si no ganó');
});

test('calcularPremio: multiplica el monto por el multiplicador encontrado', async () => {
  const fakeClient = { query: async () => ({ rows: [{ multiplicador: '5.5' }] }) };
  const premio = await calcularPremio(fakeClient, 'emp1', 'suc1', 'quiniela', 100, { gano: true }, '1ra');
  assert.strictEqual(premio, 550);
});

test('calcularPremio: retorna 0 si ganó pero no hay multiplicador configurado', async () => {
  const fakeClient = { query: async () => ({ rows: [] }) };
  const premio = await calcularPremio(fakeClient, 'emp1', 'suc1', 'pale', 100, { gano: true });
  assert.strictEqual(premio, 0);
});

// ---------- generarFolio ----------
test('generarFolio: genera folios únicos en llamadas consecutivas', () => {
  const folios = new Set();
  for (let i = 0; i < 1000; i++) folios.add(generarFolio());
  assert.strictEqual(folios.size, 1000, 'no debería haber folios duplicados');
});

test('generarFolio: sigue el formato T-<timestamp>-<random>', () => {
  assert.match(generarFolio(), /^T-[A-Z0-9]+-[A-F0-9]{10}$/);
});
