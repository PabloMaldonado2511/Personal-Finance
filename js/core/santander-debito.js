// Líneas de texto (OCR) → estado de cuenta de DÉBITO (cuenta de cheques) Santander México.
// Función pura. El sentido de cada movimiento (depósito o retiro) se deduce del saldo
// corrido que imprime el propio estado, y al final se valida contra sus totales.

import { fechaIso, centavos } from './santander.js';

const NUM = String.raw`(\d{1,3}(?:,?\d{3})*\.\d{2})`;
// 01-OCT-2026 1256240 PAGO TRANSFERENCIA SPEI HORA 22:33:05   204.47   0.00
const RE_FILA = new RegExp(
  String.raw`^[\s|]*([\d/]{2,3})\s*-\s*([A-Za-z01]{3,4})\s*-\s*(\d{4})\s+(?:(\d{6,8})\s+)?(.+?)\s+${NUM}\s+${NUM}[\s|.]*$`
);
const RE_PERIODO = /DEL\s*(\d{1,2})\s*-\s*([A-Za-z01]{3,4})\s*-\s*(\d{4})\s*AL\s*(\d{1,2})\s*-\s*([A-Za-z01]{3,4})\s*-\s*(\d{4})/i;

const sinAcentos = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
const titulo = (t) => String(t).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function masFrecuente(valores) {
  const n = new Map();
  for (const v of valores) n.set(v, (n.get(v) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** ¿El nombre del destinatario/remitente corresponde al titular de la cuenta? */
function esTitular(nombre, titular) {
  if (!nombre || !titular) return false;
  const a = sinAcentos(nombre).toUpperCase().split(/[^A-Z]+/).filter((p) => p.length > 2);
  const t = new Set(sinAcentos(titular).toUpperCase().split(/[^A-Z]+/).filter((p) => p.length > 2));
  if (a.length < 2) return false;
  return a.every((p) => t.has(p));
}

/**
 * Clasifica un movimiento de débito.
 * @returns {{ tipo: string, comercio: string, categoria: string|null }}
 *   categoria null = que la decidan las reglas generales (gastos a terceros).
 */
function clasificar(encabezado, detalle, esDeposito, titular) {
  const texto = `${encabezado}\n${detalle.join('\n')}`;
  const banco = texto.match(/(?:ENVIADO A|RECIBIDO DE)\s+([A-ZÑ0-9 .&]+?)\s*(?:\n|$)/i)?.[1]?.trim();
  const persona = texto.match(/(?:AL|DEL) CLIENTE\s+([A-ZÑ .]+?)\s*(?:\(\d\)|\n|CLAVE|$)/i)?.[1]?.trim();

  if (/PAGO TARJETA (DE )?CREDITO/i.test(encabezado)) {
    return { tipo: 'traspaso', comercio: 'Pago de tarjeta de crédito', categoria: 'traspaso' };
  }
  if (esDeposito) {
    if (/NOMINA/i.test(texto)) return { tipo: 'ingreso', comercio: 'Nómina', categoria: 'ingreso' };
    if (/CASHBACK/i.test(encabezado)) return { tipo: 'ingreso', comercio: 'Cashback', categoria: 'ingreso' };
    if (/INTERES/i.test(encabezado)) return { tipo: 'ingreso', comercio: 'Intereses', categoria: 'ingreso' };
    if (persona && esTitular(persona, titular)) {
      return { tipo: 'traspaso', comercio: `Desde ${banco ? titulo(banco) : 'cuenta propia'}`, categoria: 'traspaso' };
    }
    if (persona) return { tipo: 'ingreso', comercio: titulo(persona), categoria: 'ingreso' };
    // Abono por transferencia sin remitente identificable (p. ej. retiro de caja de ahorro):
    // se trata como dinero propio que cambia de lugar; el usuario puede marcarlo como ingreso.
    return { tipo: 'traspaso', comercio: 'Transferencia recibida', categoria: 'traspaso' };
  }
  if (persona && esTitular(persona, titular)) {
    return { tipo: 'traspaso', comercio: `A ${banco ? titulo(banco) : 'cuenta propia'}`, categoria: 'traspaso' };
  }
  if (/COMISION|I\.?V\.?A\.?/i.test(encabezado)) return { tipo: 'gasto', comercio: 'Comisión bancaria', categoria: 'intereses' };
  if (/RETIRO.*(CAJERO|EFECTIVO)|DISPOSICION/i.test(encabezado)) return { tipo: 'gasto', comercio: 'Retiro de efectivo', categoria: 'otros' };
  if (persona) return { tipo: 'gasto', comercio: titulo(persona), categoria: 'otros' };
  return { tipo: 'gasto', comercio: null, categoria: null };
}

/**
 * @param {{ numero: number, lineas: string[] }[]} paginas
 * @returns {{ estado: object, movimientos: object[], validacion: object }}
 */
export function parsearSantanderDebito(paginas) {
  const lineas = paginas.flatMap((p) => p.lineas.map((l) => l.replace(/\s+/g, ' ').trim()));
  const todo = lineas.join('\n');
  if (!/santander/i.test(todo) || !/(cuenta de cheques|DEPOSITO.*RETIRO.*SALDO)/i.test(todo)) {
    throw new Error('No reconocí este PDF como un estado de cuenta de débito Santander.');
  }
  const avisos = [];

  // --- Cabecera ------------------------------------------------------------
  const mp = todo.match(RE_PERIODO);
  const periodoInicio = mp ? fechaIso(mp[1], mp[2], mp[3]) : null;
  const periodoFin = mp ? fechaIso(mp[4], mp[5], mp[6]) : null;

  const cuentas = [...todo.matchAll(/\b(\d{2}-\d{8}-\d)\b/g)].map((m) => m[1]);
  const numeroCuenta = masFrecuente(cuentas);
  const ultimos4 = numeroCuenta ? numeroCuenta.replace(/\D/g, '').slice(-4) : null;
  let producto = null;
  if (numeroCuenta) {
    const l = lineas.find((x) => x.includes(numeroCuenta) && /^[A-ZÑ ]{6,}\s+\d{2}-/.test(x));
    producto = l?.match(/^([A-ZÑ ]+?)\s+\d{2}-/)?.[1]?.trim() ?? null;
  }
  producto ??= 'CUENTA DE DEBITO SANTANDER';

  // El titular es la línea previa a «CODIGO DE CLIENTE» (misma línea, a la izquierda).
  const titular = lineas.map((l) => l.match(/^([A-ZÑ ]{8,}?)\s+CODIGO DE CLIENTE/)?.[1]).find(Boolean) ?? null;

  const monto = (re) => {
    for (const l of lineas) {
      const m = l.match(re);
      if (m) return centavos(m[1]);
    }
    return null;
  };
  let saldoInicial = monto(new RegExp(String.raw`Saldo inicial\s+${NUM}`, 'i'))
    ?? monto(new RegExp(String.raw`SALDO FINAL DEL PERIODO ANTERIOR\s*:?\s*\$?\s*${NUM}`, 'i'));
  let totalDepositos = monto(new RegExp(String.raw`\+\s*Dep[oó]sitos\s+${NUM}`, 'i'));
  let totalRetiros = monto(new RegExp(String.raw`-\s*Retiros\s+${NUM}`, 'i'));
  const saldoFinalPdf = monto(new RegExp(String.raw`=\s*Saldo final\s+${NUM}`, 'i'))
    ?? monto(new RegExp(String.raw`SALDO FINAL DEL PERIODO\s*:\s*\$?\s*${NUM}`, 'i'));
  if (totalDepositos == null || totalRetiros == null) {
    const m = todo.match(new RegExp(String.raw`^TOTAL\s+${NUM}\s+${NUM}\s*$`, 'm'));
    if (m) { totalDepositos ??= centavos(m[1]); totalRetiros ??= centavos(m[2]); }
  }

  // --- Movimientos ---------------------------------------------------------
  const anios = new Set([periodoInicio, periodoFin].filter(Boolean).map((f) => f.slice(0, 4)));
  const ajustarAnio = (iso) => (iso && anios.size && !anios.has(iso.slice(0, 4)) ? `${periodoFin.slice(0, 4)}${iso.slice(4)}` : iso);

  const bloques = [];
  let actual = null;
  let enTabla = false;
  for (const l of lineas) {
    if (/FECHA.*FOLIO.*DESCRIPCION/i.test(l)) { enTabla = true; continue; }
    if (/^P[aá]gina \d+ de \d+/i.test(l) || /^TOTAL\s+[\d,]+\.\d{2}/.test(l) || /SALDO FINAL DEL PERIODO:/i.test(l)) {
      enTabla = false; actual = null; continue;
    }
    if (!enTabla) continue;
    const m = l.match(RE_FILA);
    if (m) {
      actual = {
        fecha: ajustarAnio(fechaIso(m[1], m[2], m[3])),
        folio: m[4] ?? null,
        encabezado: m[5].replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim(),
        monto: centavos(m[6]),
        saldoLeido: centavos(m[7]),
        detalle: [],
      };
      bloques.push(actual);
    } else if (actual) {
      if (/^\d{2}\s*-\s*[A-Za-z01]{3,4}\s*-\s*\d{4}/.test(l)) {
        avisos.push(`No pude leer completo este renglón: «${l.slice(0, 80)}»`);
        actual = null;
      } else {
        actual.detalle.push(l.replace(/\s[—–_\-e]{1,3}$/, '').trim());
      }
    }
  }
  if (!bloques.length) throw new Error('Reconocí el estado de débito de Santander, pero no encontré movimientos legibles.');
  if (saldoInicial == null) { saldoInicial = 0; avisos.push('No pude leer el saldo inicial.'); }

  const movimientos = [];
  let saldo = saldoInicial;        // saldo calculado
  let saldoPrevLeido = saldoInicial; // saldo impreso del renglón anterior
  for (const b of bloques) {
    if (!b.fecha || b.monto == null) { avisos.push(`Renglón con fecha o importe ilegible: «${b.encabezado.slice(0, 60)}»`); continue; }
    let esDeposito;
    const bases = [saldo, saldoPrevLeido];
    if (bases.some((s) => s + b.monto === b.saldoLeido)) esDeposito = true;
    else if (bases.some((s) => s - b.monto === b.saldoLeido)) esDeposito = false;
    else esDeposito = /^(ABONO|TU CASHBACK|DEPOSITO|INTERES|DEV)/i.test(b.encabezado); // respaldo
    saldo += esDeposito ? b.monto : -b.monto;
    saldoPrevLeido = b.saldoLeido ?? saldo;

    const c = clasificar(b.encabezado, b.detalle, esDeposito, titular);
    const concepto = b.detalle.map((d) => d.match(/^CONCEPTO\s+(.+)/i)?.[1]).find(Boolean);
    const base = b.encabezado.replace(/\s*HORA \d{2}:\d{2}:\d{2}/i, '').replace(/\s+\d{6,}$/, '').trim();
    movimientos.push({
      fecha: b.fecha,
      fechaCargo: b.fecha,
      descripcion: concepto && !/^transferencia$/i.test(concepto) ? `${base} · ${concepto}` : base,
      monto: b.monto,
      tipo: c.tipo,
      comercio: c.comercio,
      categoria: c.categoria,
      esDeposito,
      msi: false,
    });
  }

  // --- Validación ----------------------------------------------------------
  const suma = (f) => movimientos.filter(f).reduce((s, x) => s + x.monto, 0);
  const depositosLeidos = suma((x) => x.esDeposito);
  const retirosLeidos = suma((x) => !x.esDeposito);
  const saldoFinal = saldoInicial + depositosLeidos - retirosLeidos;
  const hayTotales = totalDepositos != null && totalRetiros != null;
  const cuadra = hayTotales && totalDepositos === depositosLeidos && totalRetiros === retirosLeidos
    && (saldoFinalPdf == null || saldoFinalPdf === saldoFinal);
  if (!hayTotales) avisos.push('No encontré los totales de depósitos y retiros para validar la lectura.');
  else if (!cuadra) avisos.push('La suma de los movimientos leídos no coincide con los totales del PDF. Revisa los importes antes de guardar.');
  if (!ultimos4) avisos.push('No pude leer el número de cuenta.');

  const corte = periodoFin ?? movimientos.map((x) => x.fecha).sort().at(-1);
  const estado = {
    id: `deb-${ultimos4 ?? 'xxxx'}-${corte}`,
    banco: 'Santander',
    tipoCuenta: 'debito',
    producto,
    ultimos4,
    cuenta: `Débito ·${ultimos4 ?? '????'}`,
    periodoInicio,
    periodoFin,
    fechaCorte: corte,
    fechaLimitePago: null,
    pagoNoIntereses: null,
    saldoDeudorTotal: null,
    saldoInicial,
    saldoFinal: saldoFinalPdf != null && cuadra ? saldoFinalPdf : saldoFinal,
    totalCargos: totalRetiros,
    totalAbonos: totalDepositos,
  };

  return {
    estado,
    movimientos,
    validacion: {
      cuadra,
      totalCargosPdf: totalRetiros,
      totalCargosLeidos: retirosLeidos,
      totalAbonosPdf: totalDepositos,
      totalAbonosLeidos: depositosLeidos,
      avisos,
    },
  };
}
