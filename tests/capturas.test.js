// Reconocimiento de screenshots con texto sintético (ningún dato real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconocerCaptura, combinarCapturas } from '../js/core/capturas.js';

const resumen = ['1:00', 'Mi fondo <v', '<- BKX00001 74', 'Valor actual lO)', '$12,345 as', 'Rendimiento de hoy'];
const portafolio = [
  'Mi fondo <', 'BKX00001', 'Mi portafolio o',
  '90% Mercado de Capitales Global (SIC) (A)',
  'é ABCD* 2 e $12,000.00MXN :',
  'EMPRESA EJEMPLO INC. 7 10.00% e $100.00',
  '" XYZ 14 9 e $30010MXN :',
  '0.5% Liquidez (A)',
  'Mismo día $45.67', '24h $0.00', 'Total $45.67',
];

test('GBM: valor actual con centavos de la relectura y cruce contra posiciones', () => {
  const r = reconocerCaptura(resumen, [{ id: 'valor-centavos', texto: '.77' }]);
  assert.equal(r.fuente, 'gbm-BKX00001');
  assert.equal(r.nombre, 'GBM · Mi fondo');
  assert.equal(r.monto, 1234577);
  const p = reconocerCaptura(portafolio);
  assert.deepEqual(p.posiciones.map((x) => [x.nombre, x.titulos, x.monto]), [
    ['ABCD', 2, 1200000], ['XYZ 14', 9, 30010], ['Liquidez', null, 4567],
  ]);
  const [s] = combinarCapturas([{ archivo: 'a.png', lectura: r }, { archivo: 'b.png', lectura: p }], '2031-01-01');
  assert.equal(s.monto, 1234577);
  assert.equal(s.validacion.cuadra, true);
  assert.equal(s.id, 'gbm-BKX00001-2031-01-01');
  assert.equal(s.posiciones.length, 3);
});

test('GBM: avisa si el valor no coincide con las posiciones o faltan centavos', () => {
  const r = reconocerCaptura(resumen, []);
  assert.equal(r.monto, 1234500);
  assert.ok(r.avisos.length);
  const [s] = combinarCapturas([{ archivo: 'a', lectura: r }, { archivo: 'b', lectura: reconocerCaptura(portafolio) }], '2031-01-01');
  assert.equal(s.validacion.cuadra, false);
});

test('DiDi, Nu Cajita y Cetesdirecto', () => {
  const d = reconocerCaptura(['< DiDi Cuenta', 'Saldo (MXn$) O', '1,250.75>', 'Mis Ahorros (MXN$)', 'a', '100.00 e']);
  assert.deepEqual([d.fuente, d.monto], ['didi', 135075]);
  const n = reconocerCaptura(['Cajita Turbo 7', 'Saldo total', '$2,000.10', 'Saldo disponible siempre']);
  assert.deepEqual([n.fuente, n.nombre, n.monto], ['nu-cajita', 'Nu · Cajita Turbo', 200010]);
  const c = reconocerCaptura(['e) NOMBRE', '5.00% Total: 987.65', 'Límite de ingresos del mes', 'E BONDDIA']);
  assert.deepEqual([c.fuente, c.monto], ['cetes', 98765]);
});

test('devuelve null si no hay identificador conocido', () => {
  assert.equal(reconocerCaptura(['Hola', 'Saldo total', '$10.00']), null);
});
