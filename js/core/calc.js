// Cálculos financieros. Funciones puras: reciben arreglos y no tocan la BD.
// Todos los importes son enteros en centavos.

import { mesDe } from './fmt.js';

/** Fecha local de hoy en ISO 'YYYY-MM-DD'. */
function hoyIso() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'YYYY-MM' + k meses (k puede ser negativo). */
function sumarMeses(mes, k) {
  const [y, m] = mes.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Lista de meses consecutivos de a..b (ambos inclusive, 'YYYY-MM'). */
function rangoMeses(a, b) {
  const out = [];
  for (let m = a; m <= b; m = sumarMeses(m, 1)) out.push(m);
  return out;
}

/** ¿fecha ISO dentro de [desde, hasta]? Acepta límites 'YYYY-MM-DD' o 'YYYY-MM'. */
function enRango(fecha, desde, hasta) {
  if (desde && fecha.slice(0, desde.length) < desde) return false;
  if (hasta && fecha.slice(0, hasta.length) > hasta) return false;
  return true;
}

/** Meses con movimientos, descendente. */
export function mesesDisponibles(movs) {
  const set = new Set();
  for (const m of movs || []) if (m && m.fecha) set.add(mesDe(m.fecha));
  return [...set].sort().reverse();
}

/** Ingresos y gastos de un conjunto de movimientos (pago_tarjeta se ignora). */
function totales(movs) {
  let ingresos = 0, gastos = 0;
  for (const m of movs) {
    if (m.tipo === 'ingreso') ingresos += m.monto;
    else if (m.tipo === 'gasto') gastos += m.monto;
    else if (m.tipo === 'devolucion') gastos -= m.monto;
  }
  return { ingresos, gastos, resultado: ingresos - gastos };
}

/** Estado de resultados de un mes. */
export function estadoResultados(movs, mes) {
  const delMes = (movs || []).filter(m => m && m.fecha && mesDe(m.fecha) === mes);
  const { ingresos, gastos, resultado } = totales(delMes);

  // Gastos por categoría (devoluciones restan de su categoría)
  const cats = new Map();
  const ingr = new Map();
  for (const m of delMes) {
    if (m.tipo === 'gasto' || m.tipo === 'devolucion') {
      const c = cats.get(m.categoria) || { categoria: m.categoria, total: 0, porcentaje: 0, n: 0 };
      c.total += m.tipo === 'gasto' ? m.monto : -m.monto;
      c.n += 1;
      cats.set(m.categoria, c);
    } else if (m.tipo === 'ingreso') {
      const k = m.comercio || m.descripcion || 'Ingreso';
      ingr.set(k, (ingr.get(k) || 0) + m.monto);
    }
  }
  const porCategoria = [...cats.values()]
    .map(c => ({ ...c, porcentaje: gastos > 0 ? c.total / gastos : 0 }))
    .sort((a, b) => b.total - a.total);
  const ingresosDetalle = [...ingr.entries()]
    .map(([comercio, total]) => ({ comercio, total }))
    .sort((a, b) => b.total - a.total);

  return {
    mes, ingresos, gastos, resultado,
    tasaAhorro: ingresos === 0 ? null : resultado / ingresos,
    porCategoria, ingresosDetalle,
  };
}

/**
 * Últimos n meses consecutivos (ascendente) que terminan en el mes más reciente
 * con datos; los meses sin movimientos aparecen en cero.
 */
export function tendencia(movs, n = 6) {
  const meses = mesesDisponibles(movs);
  if (!meses.length || n <= 0) return [];
  const ultimo = meses[0];
  const porMes = new Map();
  for (const m of movs) {
    if (!m || !m.fecha) continue;
    const k = mesDe(m.fecha);
    if (!porMes.has(k)) porMes.set(k, []);
    porMes.get(k).push(m);
  }
  return rangoMeses(sumarMeses(ultimo, -(n - 1)), ultimo)
    .map(mes => ({ mes, ...totales(porMes.get(mes) || []) }));
}

/** Gastos (solo tipo 'gasto') en el rango opcional [desde, hasta]. */
function gastosEnRango(movs, desde, hasta) {
  return (movs || []).filter(m => m && m.tipo === 'gasto' && m.fecha && enRango(m.fecha, desde, hasta));
}

const porVecesYTotal = (a, b) => b.veces - a.veces || b.total - a.total;

/** Comercios más frecuentes → [{ comercio, categoria, veces, total, promedio, meses }]. */
export function topRecurrentes(movs, { desde, hasta, limite = 10 } = {}) {
  const grupos = new Map();
  for (const m of gastosEnRango(movs, desde, hasta)) {
    const k = m.comercio || m.descripcion || 'Sin comercio';
    const g = grupos.get(k) || { comercio: k, veces: 0, total: 0, mesesSet: new Set(), cats: new Map() };
    g.veces += 1;
    g.total += m.monto;
    g.mesesSet.add(mesDe(m.fecha));
    g.cats.set(m.categoria, (g.cats.get(m.categoria) || 0) + 1);
    grupos.set(k, g);
  }
  return [...grupos.values()]
    .map(g => ({
      comercio: g.comercio,
      // categoría más frecuente del comercio
      categoria: [...g.cats.entries()].sort((a, b) => b[1] - a[1])[0][0],
      veces: g.veces,
      total: g.total,
      promedio: Math.round(g.total / g.veces),
      meses: g.mesesSet.size,
    }))
    .sort(porVecesYTotal)
    .slice(0, limite);
}

/** Igual que topRecurrentes pero por categoría → [{ categoria, veces, total }]. */
export function topCategoriasRecurrentes(movs, { desde, hasta, limite = 10 } = {}) {
  const grupos = new Map();
  for (const m of gastosEnRango(movs, desde, hasta)) {
    const g = grupos.get(m.categoria) || { categoria: m.categoria, veces: 0, total: 0 };
    g.veces += 1;
    g.total += m.monto;
    grupos.set(m.categoria, g);
  }
  return [...grupos.values()].sort(porVecesYTotal).slice(0, limite);
}

/**
 * Capital a una fecha: por cada cuenta toma el saldo más reciente ≤ fecha. Una cuenta se
 * identifica por su `fuente` (saldos leídos de screenshots) o, si no tiene, por (clase, nombre).
 * capital = efectivo + inversiones − deuda.
 * La clase 'negocio' (dinero de un negocio, no disponible) se reporta aparte y NO suma al capital.
 */
export function capital(saldos, fecha = hoyIso()) {
  const ultimos = new Map();
  for (const s of saldos || []) {
    if (!s || !s.fecha || s.fecha > fecha) continue;
    const k = s.fuente ? `f\u0000${s.fuente}` : `${s.clase}\u0000${s.nombre}`;
    const prev = ultimos.get(k);
    if (!prev || s.fecha >= prev.fecha) ultimos.set(k, s);
  }
  let efectivo = 0, inversiones = 0, deuda = 0, negocio = 0;
  const detalle = [...ultimos.values()].sort((a, b) =>
    String(a.clase).localeCompare(String(b.clase)) || String(a.nombre).localeCompare(String(b.nombre)));
  for (const s of detalle) {
    if (s.clase === 'efectivo') efectivo += s.monto;
    else if (s.clase === 'inversion') inversiones += s.monto;
    else if (s.clase === 'deuda') deuda += s.monto;
    else if (s.clase === 'negocio') negocio += s.monto;
  }
  return { efectivo, inversiones, deuda, negocio, capital: efectivo + inversiones - deuda, detalle };
}

/** Capital al cierre de cada mes, desde el primer saldo hasta el último (ascendente). */
export function historialCapital(saldos) {
  const fechas = (saldos || []).filter(s => s && s.fecha).map(s => s.fecha).sort();
  if (!fechas.length) return [];
  const desde = mesDe(fechas[0]);
  const hasta = mesDe(fechas[fechas.length - 1]);
  // '${mes}-31' sirve como fin de mes: en comparación de cadenas ISO es ≥ cualquier día del mes.
  return rangoMeses(desde, hasta).map(mes => ({ mes, capital: capital(saldos, `${mes}-31`).capital }));
}
