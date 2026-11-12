import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mesesDisponibles, estadoResultados, tendencia, topRecurrentes,
  topCategoriasRecurrentes, capital, historialCapital,
} from '../js/core/calc.js';

// Movimientos sintéticos
let n = 0;
const mv = (fecha, comercio, categoria, monto, tipo = 'gasto') =>
  ({ id: `m${++n}`, fecha, comercio, descripcion: comercio.toUpperCase(), categoria, monto, tipo });

const MOVS = [
  mv('2026-08-03', 'Oxxo', 'conveniencia', 5000),
  mv('2026-09-01', 'Empresa Demo', 'ingreso', 2000000, 'ingreso'),
  mv('2026-09-02', 'Oxxo', 'conveniencia', 3000),
  mv('2026-09-10', 'Super Ficticio', 'supermercado', 150000),
  mv('2026-10-01', 'Empresa Demo', 'ingreso', 2000000, 'ingreso'),
  mv('2026-10-15', 'Proyecto Extra', 'ingreso', 500000, 'ingreso'),
  mv('2026-10-02', 'Oxxo', 'conveniencia', 4500),
  mv('2026-10-05', 'Oxxo', 'conveniencia', 2500),
  mv('2026-10-06', 'Super Ficticio', 'supermercado', 200000),
  mv('2026-10-07', 'Super Ficticio', 'supermercado', 30000, 'devolucion'),
  mv('2026-10-20', 'Tienda Online', 'compras_linea', 100000),
  mv('2026-10-25', 'Pago a tarjeta', 'otros', 900000, 'pago_tarjeta'),
];

test('mesesDisponibles: únicos y descendente', () => {
  assert.deepEqual(mesesDisponibles(MOVS), ['2026-10', '2026-09', '2026-08']);
  assert.deepEqual(mesesDisponibles([]), []);
});

test('estadoResultados', () => {
  const r = estadoResultados(MOVS, '2026-10');
  assert.equal(r.mes, '2026-10');
  assert.equal(r.ingresos, 2500000);
  // 4500 + 2500 + 200000 − 30000 + 100000 ; el pago a tarjeta se ignora
  assert.equal(r.gastos, 277000);
  assert.equal(r.resultado, 2223000);
  assert.equal(r.tasaAhorro, 2223000 / 2500000);
  assert.deepEqual(r.porCategoria.map(c => [c.categoria, c.total, c.n]), [
    ['supermercado', 170000, 2],
    ['compras_linea', 100000, 1],
    ['conveniencia', 7000, 2],
  ]);
  assert.equal(r.porCategoria[0].porcentaje, 170000 / 277000);
  const suma = r.porCategoria.reduce((s, c) => s + c.porcentaje, 0);
  assert.ok(Math.abs(suma - 1) < 1e-9);
  assert.deepEqual(r.ingresosDetalle, [
    { comercio: 'Empresa Demo', total: 2000000 },
    { comercio: 'Proyecto Extra', total: 500000 },
  ]);
});

test('estadoResultados: sin ingresos → tasaAhorro null; mes vacío', () => {
  const r = estadoResultados(MOVS, '2026-08');
  assert.equal(r.ingresos, 0);
  assert.equal(r.tasaAhorro, null);
  assert.equal(r.resultado, -5000);
  const v = estadoResultados(MOVS, '2025-01');
  assert.deepEqual([v.ingresos, v.gastos, v.porCategoria.length], [0, 0, 0]);
});

test('tendencia: últimos n meses consecutivos, ascendente, con huecos en cero', () => {
  const t = tendencia(MOVS, 4);
  assert.deepEqual(t.map(x => x.mes), ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(t[0], { mes: '2026-07', ingresos: 0, gastos: 0, resultado: 0 });
  assert.deepEqual(t[2], { mes: '2026-09', ingresos: 2000000, gastos: 153000, resultado: 1847000 });
  assert.equal(t[3].gastos, 277000);
  assert.equal(tendencia(MOVS).length, 6);
  assert.deepEqual(tendencia([]), []);
  // cruce de año
  const y = tendencia([mv('2027-01-10', 'X', 'otros', 100)], 3);
  assert.deepEqual(y.map(x => x.mes), ['2026-11', '2026-12', '2027-01']);
});

test('topRecurrentes: solo gastos, orden por veces y total, meses distintos', () => {
  const top = topRecurrentes(MOVS);
  assert.deepEqual(top[0], { comercio: 'Oxxo', categoria: 'conveniencia', veces: 4, total: 15000, promedio: 3750, meses: 3 });
  assert.deepEqual(top.map(x => x.comercio), ['Oxxo', 'Super Ficticio', 'Tienda Online']);
  assert.equal(top[1].veces, 2);       // la devolución no cuenta
  assert.equal(top[1].total, 350000);
  assert.ok(!top.some(x => x.comercio === 'Empresa Demo' || x.comercio === 'Pago a tarjeta'));

  const rango = topRecurrentes(MOVS, { desde: '2026-10-01', hasta: '2026-10-31', limite: 1 });
  assert.deepEqual(rango, [{ comercio: 'Oxxo', categoria: 'conveniencia', veces: 2, total: 7000, promedio: 3500, meses: 1 }]);
  const porMes = topRecurrentes(MOVS, { desde: '2026-09', hasta: '2026-09' });
  assert.equal(porMes.length, 2);
});

test('topCategoriasRecurrentes', () => {
  assert.deepEqual(topCategoriasRecurrentes(MOVS), [
    { categoria: 'conveniencia', veces: 4, total: 15000 },
    { categoria: 'supermercado', veces: 2, total: 350000 },
    { categoria: 'compras_linea', veces: 1, total: 100000 },
  ]);
  assert.equal(topCategoriasRecurrentes(MOVS, { limite: 2 }).length, 2);
});

// Saldos sintéticos
const SALDOS = [
  { id: 's1', fecha: '2026-08-31', clase: 'efectivo', nombre: 'Cuenta débito', monto: 1000000 },
  { id: 's2', fecha: '2026-09-30', clase: 'efectivo', nombre: 'Cuenta débito', monto: 1200000 },
  { id: 's3', fecha: '2026-09-15', clase: 'inversion', nombre: 'Broker Demo', monto: 5000000 },
  { id: 's4', fecha: '2026-09-15', clase: 'deuda', nombre: 'Tarjeta ·0000', monto: 300000 },
  { id: 's5', fecha: '2026-10-15', clase: 'deuda', nombre: 'Tarjeta ·0000', monto: 250000 },
  { id: 's6', fecha: '2026-11-20', clase: 'efectivo', nombre: 'Cuenta débito', monto: 1500000 },
];

test('capital: saldo más reciente ≤ fecha por (clase, nombre)', () => {
  const c = capital(SALDOS, '2026-10-31');
  assert.equal(c.efectivo, 1200000);
  assert.equal(c.inversiones, 5000000);
  assert.equal(c.deuda, 250000);
  assert.equal(c.capital, 1200000 + 5000000 - 250000);
  assert.deepEqual(c.detalle.map(s => s.id).sort(), ['s2', 's3', 's5']);

  const antes = capital(SALDOS, '2026-08-01');
  assert.deepEqual([antes.capital, antes.detalle.length], [0, 0]);
  assert.equal(capital(SALDOS, '2099-01-01').efectivo, 1500000);
});

test('historialCapital: un punto por mes, ascendente', () => {
  assert.deepEqual(historialCapital(SALDOS), [
    { mes: '2026-08', capital: 1000000 },
    { mes: '2026-09', capital: 1200000 + 5000000 - 300000 },
    { mes: '2026-10', capital: 1200000 + 5000000 - 250000 },
    { mes: '2026-11', capital: 1500000 + 5000000 - 250000 },
  ]);
  assert.deepEqual(historialCapital([]), []);
});
