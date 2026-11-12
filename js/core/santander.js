// Líneas de texto (salida del OCR) → estado de cuenta de tarjeta de crédito Santander México.
// Función pura: no toca el DOM ni la base de datos, así se puede probar con Node.

const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };

const dos = (n) => String(n).padStart(2, '0');

/** '12', 'Oct' | '0ct' | 'OCT', '2026' → '2026-10-12' (o null) */
function fechaIso(dia, mes, anio) {
  // El OCR confunde O/0 y a veces duplica: '0ct', '0Oct', 'N0v'.
  const txt = String(mes).toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l');
  const m = MESES[txt.slice(0, 3)] ?? (txt.length === 4 ? MESES[txt.slice(1)] : undefined);
  // '2/7' (diagonal espuria) → 27 ; '2/' (el 7 leído como diagonal) → 27
  let dTxt = String(dia).replace(/\//g, '');
  if (dTxt.length === 1 && String(dia).includes('/')) dTxt = String(dia).replace('/', '7');
  const d = Number(dTxt);
  let a = Number(anio);
  if (a < 100) a += 2000;
  if (!m || !(d >= 1 && d <= 31) || !(a >= 2000 && a <= 2100)) return null;
  return `${a}-${dos(m)}-${dos(d)}`;
}

/** '$ 1,234.56' | '3376.34' → 123456 (centavos) o null */
function centavos(texto) {
  const m = String(texto).replace(/\s/g, '').match(/^\$?(\d{1,3}(?:,?\d{3})*)\.(\d{2})$/);
  if (!m) return null;
  return Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]);
}

const IMPORTE = String.raw`\$\s*(\d{1,3}(?:,?\d{3})*\.\d{2})`;
const FECHA = String.raw`([\d/]{2,3})\s*-\s*([A-Za-z01]{3,4})\s*-\s*(\d{4})`;
const RUIDO = String.raw`[\s|—–\-.,:;_]*`;

// 09-Oct-2026 12-Oct-2026 DESCRIPCION ...  +  $ 1,234.56
const RE_MOV = new RegExp(
  // tras el importe puede quedar un dígito o símbolo espurio ('$ 177.600', '$ 84.10.')
  String.raw`^${RUIDO}${FECHA}${RUIDO}${FECHA}\s*\|?\s*(.+?)\s*\|?\s*([+\-–—])?\s*\|?\s*${IMPORTE}\d?${RUIDO}$`
);
const RE_PERIODO = new RegExp(String.raw`Del\s+(\d{1,2})\s*-\s*([A-Za-z01]{3,4})\s*-\s*(\d{4})\s+al\s+(\d{1,2})\s*-\s*([A-Za-z01]{3,4})\s*-\s*(\d{4})`, 'i');
const RE_FECHA_LIBRE = /(\d{1,2})\s*-\s*([A-Za-z01]{3})\s*-\s*(\d{2,4})/;

function primerImporte(linea) {
  const m = linea.match(new RegExp(IMPORTE));
  return m ? centavos(m[1]) : null;
}
function ultimoImporte(linea) {
  const todos = [...linea.matchAll(new RegExp(IMPORTE, 'g'))];
  return todos.length ? centavos(todos[todos.length - 1][1]) : null;
}

function masFrecuente(valores) {
  const cuenta = new Map();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) || 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function nombreCorto(producto) {
  if (/AMERICAN\s*EXPRESS|AMEX/i.test(producto)) return 'AMEX';
  if (/LIKE\s*U/i.test(producto)) return 'LikeU';
  const resto = producto.replace(/SANTANDER/i, '').trim().split(/\s+/).slice(0, 2).join(' ');
  if (!resto) return 'Santander';
  return resto.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/**
 * @param {{ numero: number, lineas: string[] }[]} paginas
 * @returns {{ estado: object, movimientos: object[], validacion: object }}
 *   Los movimientos salen sin `comercio` ni `categoria` (los pone importar.js).
 */
export function parsearSantander(paginas) {
  const crudas = paginas.flatMap((p) => p.lineas.map((l) => l.trim()));
  const lineas = crudas.map((l) => l.replace(/\s+/g, ' '));
  const todo = lineas.join('\n');

  if (!/santander/i.test(todo) || !/(DESGLOSE DE MOVIMIENTOS|COMPRAS REGULARES|PAGO REQUERIDO ESTE PERIODO)/i.test(todo)) {
    throw new Error('No reconocí este PDF como un estado de cuenta de tarjeta de crédito Santander.');
  }

  const avisos = [];

  // --- Periodo -------------------------------------------------------------
  let periodoInicio = null;
  let periodoFin = null;
  const mp = todo.match(RE_PERIODO);
  if (mp) {
    periodoInicio = fechaIso(mp[1], mp[2], mp[3]);
    periodoFin = fechaIso(mp[4], mp[5], mp[6]);
  }

  // --- Tarjeta y producto --------------------------------------------------
  const candidatos = [];
  for (const l of lineas) {
    let m = l.match(/N[uú]mero de (?:cuenta|tarjeta)\s*:?\s*([\d\s]{13,22})/i);
    if (m) candidatos.push(m[1].replace(/\D/g, ''));
    m = l.match(/Tarjeta titular\s*(\d{15,16})/i);
    if (m) candidatos.push(m[1]);
  }
  const tarjeta = masFrecuente(candidatos.filter((c) => c.length === 15 || c.length === 16));
  const ultimos4 = tarjeta ? tarjeta.slice(-4) : null;

  let producto = null;
  for (let i = 0; i < lineas.length && !producto; i++) {
    if (/Numero de tarjeta|N[uú]mero de tarjeta/i.test(lineas[i])) {
      for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
        // se usa la línea sin colapsar: el producto termina donde empieza la otra columna
        const m = crudas[k].match(/^(SANTANDER(?: [A-ZÑ0-9]+)+)(?=\s{2,}|$)/);
        if (m) { producto = m[1].trim(); break; }
      }
    }
  }
  producto ??= 'SANTANDER TARJETA DE CREDITO';

  // --- Fechas y montos de cabecera -----------------------------------------
  let fechaLimitePago = null;
  let pagoNoIntereses = null;
  let saldoDeudorTotal = null;
  let fechaCorte = null;
  for (const l of lineas) {
    if (!fechaLimitePago && /(l[ií]mite de pago|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s*,?/i.test(l)) {
      const m = l.match(/(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s*,?\s*(\d{1,2})\s*-\s*([A-Za-z01]{3})\s*-\s*(\d{2,4})/i);
      if (m) fechaLimitePago = fechaIso(m[1], m[2], m[3]);
    }
    if (!fechaCorte && /Fecha de corte/i.test(l)) {
      const m = l.replace(/Fecha de corte\s*:?/i, '').match(RE_FECHA_LIBRE);
      if (m) fechaCorte = fechaIso(m[1], m[2], m[3]);
    }
    if (pagoNoIntereses == null && /^\|?\s*PAGO PARA\b/i.test(l)) pagoNoIntereses = ultimoImporte(l) ?? primerImporte(l);
    if (saldoDeudorTotal == null && /Saldo deudor total/i.test(l)) saldoDeudorTotal = ultimoImporte(l);
  }
  if (pagoNoIntereses == null) {
    const l = lineas.find((x) => /Pago para no generar intereses/i.test(x) && primerImporte(x) != null && !/veces|m[ií]nimo/i.test(x));
    if (l) pagoNoIntereses = ultimoImporte(l);
  }
  // La fecha de corte es el último día del periodo; el OCR de ese renglón suele fallar.
  if (periodoFin) fechaCorte = periodoFin;

  // --- Movimientos ---------------------------------------------------------
  const movimientos = [];
  let seccion = null; // 'msi' | 'regular'
  let tarjetaActual = tarjeta;
  let esAdicional = false;
  let totalCargos = null;
  let totalAbonos = null;
  const anios = new Set([periodoInicio, periodoFin].filter(Boolean).map((f) => f.slice(0, 4)));

  const ajustarAnio = (iso) => {
    // Si el OCR leyó mal el año (p. ej. 2028), se corrige con el del periodo.
    if (!iso || !anios.size || anios.has(iso.slice(0, 4))) return iso;
    const mes = iso.slice(5, 7);
    const anio = periodoFin && mes <= periodoFin.slice(5, 7) ? periodoFin.slice(0, 4) : (periodoInicio ?? periodoFin).slice(0, 4);
    return `${anio}${iso.slice(4)}`;
  };

  for (const l of lineas) {
    if (/DIFERIDOS A MESES/i.test(l) && !/^\d{2}\s*-/.test(l) && !/SALDO|Por |De compras|pago/i.test(l)) { seccion = 'msi'; continue; }
    if (/COMPRAS REGULARES\s*\(?NO A/i.test(l) && /CARGOS/i.test(l) && !/CUANTO|PAGAR/i.test(l)) { seccion = 'regular'; continue; }
    let m = l.match(/Tarjeta (titular|adicional)\s*(\d{12,16})/i);
    if (m) { tarjetaActual = m[2]; esAdicional = /adicional/i.test(m[1]); continue; }

    m = l.match(new RegExp(String.raw`Total de cargos.*?${IMPORTE}`, 'i'));
    if (m) { totalCargos = centavos(m[1]); seccion = null; continue; }
    m = l.match(new RegExp(String.raw`Total de abonos.*?${IMPORTE}`, 'i'));
    if (m) { totalAbonos = centavos(m[1]); seccion = null; continue; }

    if (seccion !== 'regular') continue;
    m = l.match(RE_MOV);
    if (!m) {
      // Cualquier renglón de la tabla con importe que no se pudo interpretar se avisa.
      const esEncabezado = /Fecha de|operaci[oó]n|Descripci[oó]n|^Notas|P[aá]gina|N[uú]mero de cuenta/i.test(l);
      if (!esEncabezado && (/^[\s|]*[\d/]{2,3}\s*-\s*[A-Za-z01]{3,4}/.test(l) || new RegExp(IMPORTE + String.raw`\d?[\s|.]*$`).test(l))) {
        avisos.push(`No pude leer completo este renglón: «${l.slice(0, 80)}»`);
      }
      continue;
    }
    const fecha = ajustarAnio(fechaIso(m[1], m[2], m[3]));
    const fechaCargo = ajustarAnio(fechaIso(m[4], m[5], m[6]));
    const monto = centavos(m[9]);
    let descripcion = m[7].replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
    // El signo a veces queda pegado al final de la descripción.
    let signo = m[8] || null;
    const cola = descripcion.match(/\s([+\-–—])$/);
    if (!signo && cola) { signo = cola[1]; descripcion = descripcion.slice(0, -2).trim(); }
    if (!fecha || monto == null) {
      avisos.push(`Renglón con fecha o importe ilegible: «${l.slice(0, 80)}»`);
      continue;
    }
    const pareceAbono = /^(PAGO POR|SU PAGO|PAGO |ABONO|BONIFICACION|DEVOLUCION|REEMBOLSO)/i.test(descripcion);
    const esAbono = signo ? signo !== '+' : pareceAbono;
    const esPago = /^(PAGO POR|SU PAGO|PAGO\b|ABONO)/i.test(descripcion);
    movimientos.push({
      fecha,
      fechaCargo,
      descripcion,
      monto,
      tipo: esAbono ? (esPago ? 'pago_tarjeta' : 'devolucion') : 'gasto',
      msi: /\b\d{2}\s*(?:M|DE)\s*\d{0,2}\s*S\/INT|MESES SIN/i.test(descripcion),
      tarjeta: tarjetaActual ? tarjetaActual.slice(-4) : ultimos4,
      adicional: esAdicional,
      signoLeido: Boolean(signo),
    });
  }

  if (!movimientos.length) {
    throw new Error('Reconocí el estado de cuenta de Santander, pero no encontré movimientos legibles.');
  }
  if (!ultimos4) avisos.push('No pude leer el número de tarjeta; revisa a qué tarjeta corresponde.');
  if (!periodoFin) avisos.push('No pude leer el periodo del estado de cuenta.');

  // --- Validación contra los totales impresos ------------------------------
  const suma = (f) => movimientos.filter(f).reduce((s, x) => s + x.monto, 0);
  const totalCargosLeidos = suma((x) => x.tipo === 'gasto');
  const totalAbonosLeidos = suma((x) => x.tipo !== 'gasto');
  const cuadra = totalCargos != null && totalAbonos != null
    && totalCargos === totalCargosLeidos && totalAbonos === totalAbonosLeidos;
  if (totalCargos == null || totalAbonos == null) {
    avisos.push('No encontré los renglones «Total de cargos / Total de abonos» para validar la lectura.');
  } else if (!cuadra) {
    avisos.push('La suma de los movimientos leídos no coincide con los totales del PDF. Revisa los importes antes de guardar.');
  }
  if (periodoInicio && periodoFin) {
    const fuera = movimientos.filter((x) => x.fecha > periodoFin).length;
    if (fuera) avisos.push(`${fuera} movimiento(s) tienen fecha posterior al corte; revisa sus fechas.`);
  }

  const corte = fechaCorte ?? periodoFin ?? movimientos.map((x) => x.fecha).sort().at(-1);
  const estado = {
    id: `${ultimos4 ?? 'xxxx'}-${corte}`,
    banco: 'Santander',
    producto,
    ultimos4,
    cuenta: `${nombreCorto(producto)} ·${ultimos4 ?? '????'}`,
    periodoInicio,
    periodoFin,
    fechaCorte: corte,
    fechaLimitePago,
    pagoNoIntereses,
    saldoDeudorTotal: saldoDeudorTotal ?? pagoNoIntereses,
    totalCargos,
    totalAbonos,
  };

  return {
    estado,
    movimientos,
    validacion: {
      cuadra,
      totalCargosPdf: totalCargos,
      totalCargosLeidos,
      totalAbonosPdf: totalAbonos,
      totalAbonosLeidos,
      avisos,
    },
  };
}
