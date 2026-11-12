// Pruebas del parser con texto sintético (ningún dato real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsearSantander } from '../js/core/santander.js';

const pagina = (lineas) => ({ numero: 1, lineas });

const BASE = [
  'Santander',
  'TU PAGO REQUERIDO ESTE PERIODO',
  'JUAN PEREZ PRUEBA                 Periodo:       Del 05 - Ene - 2031 al 04 - Feb - 2031',
  'SANTANDER LIKEU ORO     Fecha límite de pago:   |   Lunes, 24-feb-2031',
  'Numero de tarjeta: 1111 2222 3333 4444',
  'PAGO PARA       =       $ 1,150.50',
  'Saldo deudor total:       $ 1,150.50',
  'Número de cuenta: 1111 2222 3333 4444      Página 3 de 8',
  'DESGLOSE DE MOVIMIENTOS',
  'CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)',
  'Tarjeta titular 1111222233334444',
  'Fecha de la   Fecha de   Descripción del movimiento   Monto',
  '06-Ene-2031 07-Ene-2031 TIENDA UNO CENTRO      +      $ 1,000.00',
  '10-Ene-2031 | 11-0Ene-2031 | CAFE DOS      XAX 010101AAA      +      $ 50.50',
  '2/7-Ene-2031 — 28-Ene-2038 TIENDA TRES      +      $ 99.990',
  '30-Ene-2031 30-Ene-2031 PAGO POR TRANSFERENCIA      -      $3,000.00',
  '01-Feb-2031 02-Feb-2031 DEVOLUCION TIENDA UNO      —      $ 20.00',
  'CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)',
  'Tarjeta adicional 9999888877776666',
  '03-Feb-2031 04-Feb-2031 SERVICIO EXTRANJERO 10.00 USD TC 20.0000    + |    $ 200.00',
  '|     Total de cargos | + |      $ 1,350.49 |',
  '|     Total de abonos | - |      $ 3020.00 |',
];

test('detecta tarjeta, producto y periodo', () => {
  const { estado } = parsearSantander([pagina(BASE)]);
  assert.equal(estado.ultimos4, '4444');
  assert.equal(estado.producto, 'SANTANDER LIKEU ORO');
  assert.equal(estado.cuenta, 'LikeU ·4444');
  assert.equal(estado.periodoInicio, '2031-01-05');
  assert.equal(estado.periodoFin, '2031-02-04');
  assert.equal(estado.fechaCorte, '2031-02-04');
  assert.equal(estado.fechaLimitePago, '2031-02-24');
  assert.equal(estado.pagoNoIntereses, 115050);
  assert.equal(estado.id, '4444-2031-02-04');
});

test('lee movimientos con ruido de OCR y cuadra contra los totales', () => {
  const { movimientos, validacion } = parsearSantander([pagina(BASE)]);
  assert.equal(movimientos.length, 6);
  assert.equal(validacion.cuadra, true);
  assert.deepEqual(validacion.avisos, []);
  const [a, b, c, pago, dev, extra] = movimientos;
  assert.deepEqual([a.fecha, a.monto, a.tipo], ['2031-01-06', 100000, 'gasto']);
  assert.equal(b.fechaCargo, '2031-01-11');           // '0Ene' → Ene
  assert.equal(b.descripcion, 'CAFE DOS XAX 010101AAA');
  assert.equal(c.fecha, '2031-01-27');                 // '2/7' → 27
  assert.equal(c.fechaCargo, '2031-01-28');            // año 2038 corregido con el periodo
  assert.equal(c.monto, 9999);                         // '$ 99.990' → 99.99
  assert.equal(pago.tipo, 'pago_tarjeta');
  assert.equal(dev.tipo, 'devolucion');
  assert.equal(extra.tarjeta, '6666');
  assert.equal(extra.adicional, true);
});

test('avisa cuando no cuadra o hay renglones ilegibles', () => {
  const lineas = BASE.map((l) => (l.includes('CAFE DOS') ? '10-Ene-2031 11-Ene-2031 CAFE DOS + $ 5O.50' : l));
  const { validacion } = parsearSantander([pagina(lineas)]);
  assert.equal(validacion.cuadra, false);
  assert.ok(validacion.avisos.some((a) => a.includes('CAFE DOS')));
  assert.equal(validacion.totalCargosPdf - validacion.totalCargosLeidos, 5050);
});

test('rechaza documentos que no son de Santander', () => {
  assert.throws(() => parsearSantander([pagina(['Otro banco', 'Estado de cuenta'])]), /No reconocí/);
});
