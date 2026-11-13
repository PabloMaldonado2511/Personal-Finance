// Parser de débito con texto sintético (ningún dato real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsearSantanderDebito } from '../js/core/santander-debito.js';

const P1 = [
  'Santander',
  'JUAN PEREZ PRUEBA CODIGO DE CLIENTE NO. 00000000',
  'PERIODO DEL 01-ENE-2031 AL31-ENE-2031',
  'CUENTA EJEMPLO BASICA 11-22223333-4 CUENTA CLABE: 000000000000000000',
  'Saldo promedio 100.00 Saldo inicial 1,000.00',
  'Tasa bruta de interés anual 0.0000% +Depósitos 5,600.00',
  'Días del periodo 31 - Retiros 4,150.50',
  'Saldo promedio mínimo 0.00 = Saldo final 2,449.50',
  'Página 1 de 3.',
];
const P2 = [
  'JUAN PEREZ PRUEBA CODIGO DE CLIENTE NO. 00000000',
  'Detalle de movimientos cuenta de cheques.',
  'SALDO FINAL DEL PERIODO ANTERIOR: $1,000.00',
  'FECHA | FOLIO | DESCRIPCION DEPOSITO | RETIRO SALDO',
  '02-ENE-2031 0000000 CARGO PAGO TARJETA CREDITO 900.00 100.00',
  '03-ENE-2031 1111111 ABONO NOMINA TEF PAGO DE NOMINA 9999999 5,000.00 5,100.00',
  'DEL CLIENTE EMPRESA EJEMPLO SA DE CV',
  '05-ENE-2031 2222222 PAGO TRANSFERENCIA SPEI HORA 10:00:00 2,000.00 3,100.00',
  'ENVIADO A BANCO DOS',
  'AL CLIENTE JUAN PEREZ (1)',
  'CONCEPTO AHORRO',
  '06-ENE-2031 3333333 PAGO TRANSFERENCIA SPEI HORA 11:00:00 1,250.50 1,849.50',
  'ENVIADO A BANCO TRES',
  'AL CLIENTE MARIA LOPEZ ARRENDADORA (1)',
  'CONCEPTO RENTA ENERO',
  '10-ENE-2031 4444444 ABONO PAGO POR TRANSFERENCIA REF0001 600.00 2,449.80',
  'TOTAL 5,600.00 4,150.50',
  'Página 2 de 3.',
];
const paginas = [{ numero: 1, lineas: P1 }, { numero: 2, lineas: P2 }];

test('cabecera y validación de débito', () => {
  const { estado, validacion } = parsearSantanderDebito(paginas);
  assert.equal(estado.tipoCuenta, 'debito');
  assert.equal(estado.ultimos4, '3334');
  assert.equal(estado.cuenta, 'Débito ·3334');
  assert.equal(estado.producto, 'CUENTA EJEMPLO BASICA');
  assert.equal(estado.periodoInicio, '2031-01-01');
  assert.equal(estado.fechaCorte, '2031-01-31');
  assert.equal(estado.saldoInicial, 100000);
  assert.equal(estado.saldoFinal, 244950);
  assert.equal(validacion.cuadra, true);          // aunque el último saldo impreso se leyó mal
  assert.equal(validacion.totalCargosLeidos, 415050);
  assert.equal(validacion.totalAbonosLeidos, 560000);
});

test('clasifica nómina, traspasos propios y pagos a terceros', () => {
  const { movimientos: m } = parsearSantanderDebito(paginas);
  assert.equal(m.length, 5);
  assert.deepEqual([m[0].tipo, m[0].categoria], ['traspaso', 'traspaso']);   // pago de tarjeta
  assert.deepEqual([m[1].tipo, m[1].comercio, m[1].fecha], ['ingreso', 'Nómina', '2031-01-03']);
  assert.deepEqual([m[2].tipo, m[2].comercio], ['traspaso', 'A Banco Dos']);  // cuenta propia
  assert.deepEqual([m[3].tipo, m[3].comercio], ['gasto', 'Maria Lopez Arrendadora']);
  assert.match(m[3].descripcion, /RENTA ENERO/);
  assert.deepEqual([m[4].tipo, m[4].esDeposito], ['traspaso', true]);         // abono sin remitente
});

test('rechaza documentos que no son de débito Santander', () => {
  assert.throws(() => parsearSantanderDebito([{ numero: 1, lineas: ['Otro banco'] }]), /No reconocí/);
});
