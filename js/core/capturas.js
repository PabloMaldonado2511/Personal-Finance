// Screenshots de apps financieras → saldos. Funciones puras sobre el texto del OCR.
//
// Cada app se reconoce por un IDENTIFICADOR que aparece en la pantalla:
//   GBM (resumen)      contrato «BKX00000» + «Valor actual»
//   GBM (portafolio)   contrato «BKX00000» + «Mi portafolio»
//   DiDi Cuenta        «DiDi Cuenta» + «Saldo (MXN$)»
//   Nu Cajita          «Cajita» + «Saldo total»
//   Cetesdirecto       «BONDDIA» o «Límite de ingresos del mes» + «Total:»

import { centavos } from './santander.js';

const IMPORTE = String.raw`(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)`;

/** '$13,205.80' | '6792' (punto perdido) → centavos */
function aCentavos(txt, { puntoPerdido = false } = {}) {
  const limpio = String(txt).replace(/[$\s]/g, '');
  const c = centavos(limpio);
  if (c != null) return c;
  const soloDigitos = limpio.replace(/,/g, '');
  if (!/^\d+$/.test(soloDigitos)) return null;
  // GBM siempre muestra dos decimales: si el OCR perdió el punto, los dos últimos son centavos.
  return puntoPerdido && soloDigitos.length >= 3 ? Number(soloDigitos) : Number(soloDigitos) * 100;
}

const titulo = (t) => String(t).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/**
 * Zonas del screenshot que conviene releer ampliadas (cifras en letra pequeña).
 * @param {{ texto: string, caja: {x0:number,y0:number,x1:number,y1:number} }[]} renglones
 */
export function zonasDeInteres(renglones) {
  const i = renglones.findIndex((r) => /Valor actual/i.test(r.texto));
  if (i < 0 || !renglones[i + 1] || !/\$\s*\d/.test(renglones[i + 1].texto)) return [];
  const c = renglones[i + 1].caja;
  return [{ id: 'valor-centavos', x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, extraDerecha: 160 }];
}

function contratoGbm(lineas) {
  for (const l of lineas) {
    const m = l.match(/\b(BKX\s?\d{5})\b/i);
    if (m) return m[1].replace(/\s/g, '').toUpperCase();
  }
  return null;
}

function nombrePortafolioGbm(lineas) {
  const i = lineas.findIndex((l) => /BKX\s?\d{5}/i.test(l));
  for (let k = i - 1; k >= 0 && k >= i - 2; k--) {
    const l = lineas[k].replace(/\s*[<>«»‹›∨vV]{1,3}\s*$/, '').replace(/^[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/, '').trim();
    if (/[A-Za-z]{3}/.test(l) && !/^\d{1,2}:\d{2}/.test(lineas[k])) return l;
  }
  return null;
}

function gbmResumen(lineas, zonas) {
  const contrato = contratoGbm(lineas);
  const avisos = [];
  const i = lineas.findIndex((l) => /Valor actual/i.test(l));
  const siguiente = lineas[i + 1] ?? '';
  const entero = siguiente.match(/\$\s*(\d{1,3}(?:,\d{3})*|\d+)/)?.[1];
  if (!entero) return null;
  // Los centavos van en letra pequeña: se toman de la relectura ampliada.
  const zona = zonas.find((z) => z.id === 'valor-centavos')?.texto ?? '';
  let dec = zona.replace(/\D/g, '');
  if (dec.length !== 2) {
    dec = siguiente.match(/\.\s?(\d{2})\b/)?.[1] ?? '';
    if (dec.length === 2) avisos.push('Revisa los centavos del valor actual: no pude confirmarlos.');
    else { dec = '00'; avisos.push('No pude leer los centavos del valor actual; quedó en .00.'); }
  }
  const monto = Number(entero.replace(/,/g, '')) * 100 + Number(dec);
  const nombre = nombrePortafolioGbm(lineas);
  return {
    tipo: 'gbm-resumen',
    fuente: `gbm-${contrato}`,
    etiquetaFuente: `GBM · contrato ${contrato}`,
    clase: 'inversion',
    nombre: nombre ? `GBM · ${nombre}` : `GBM ${contrato}`,
    monto,
    avisos,
  };
}

function gbmPortafolio(lineas) {
  const contrato = contratoGbm(lineas);
  const posiciones = [];
  // «AAPL *   2 • $13,205.80 MXN»  (la viñeta sale como e, », -, *, etc.)
  const re = /^(.*?)\s+(\d{1,6})\s*\S{0,2}\s*\$\s*([\d,]*\.?\d+)\s*MXN/;
  for (const l of lineas) {
    const m = l.match(re);
    if (!m) continue;
    const monto = aCentavos(m[3], { puntoPerdido: true });
    if (monto == null) continue;
    // Antes del nombre suele quedar basura del logotipo («é», «mm», «=<»): se descartan
    // las palabras iniciales que no parezcan una clave de emisora.
    const palabras = m[1].replace(/[*★]\s*$/, '').trim().split(/\s+/);
    while (palabras.length > 1 && !/^[A-Z0-9][A-Z0-9&.\-]+$/.test(palabras[0])) palabras.shift();
    const nombre = palabras.join(' ').replace(/[*★]$/, '').trim();
    posiciones.push({ nombre: nombre || 'Posición', titulos: Number(m[2]), monto });
  }
  if (!posiciones.length) return null;

  // Liquidez: «Total $x» si se ve completo; si no, lo que alcance a verse.
  const iLiq = lineas.findIndex((l) => /Liquidez/i.test(l));
  let liquidez = 0;
  let liquidezCompleta = false;
  if (iLiq >= 0) {
    const cola = lineas.slice(iLiq + 1);
    const total = cola.map((l) => l.match(/^Total\s+\$\s*([\d,]+\.\d{2})/i)?.[1]).find(Boolean);
    if (total) { liquidez = aCentavos(total); liquidezCompleta = true; }
    else {
      for (const l of cola) {
        const m = l.match(/^(?:Mismo d[ií]a|24\s?h|48\s?h|Mayor a 48\s?h)\s+\$\s*([\d,]+\.\d{2})/i);
        if (m) liquidez += aCentavos(m[1]);
      }
    }
  }
  if (liquidez > 0) posiciones.push({ nombre: 'Liquidez', titulos: null, monto: liquidez });

  const nombre = nombrePortafolioGbm(lineas);
  return {
    tipo: 'gbm-portafolio',
    fuente: `gbm-${contrato}`,
    etiquetaFuente: `GBM · contrato ${contrato}`,
    clase: 'inversion',
    nombre: nombre ? `GBM · ${nombre}` : `GBM ${contrato}`,
    posiciones,
    sumaPosiciones: posiciones.reduce((s, p) => s + p.monto, 0),
    liquidezCompleta,
    avisos: [],
  };
}

function didi(lineas) {
  const leer = (re) => {
    const i = lineas.findIndex((l) => re.test(l));
    if (i < 0) return null;
    for (let k = i + 1; k <= i + 2 && k < lineas.length; k++) {
      const m = lineas[k].match(new RegExp(String.raw`^\D{0,3}${IMPORTE}`));
      if (m) return aCentavos(m[1]);
    }
    return null;
  };
  const saldo = leer(/Saldo\s*\(MX/i);
  if (saldo == null) return null;
  const ahorros = leer(/Mis Ahorros/i) ?? 0;
  return {
    tipo: 'didi',
    fuente: 'didi',
    etiquetaFuente: 'DiDi Cuenta',
    clase: 'inversion',
    nombre: 'DiDi Cuenta',
    monto: saldo + ahorros,
    avisos: ahorros ? ['Incluye «Mis Ahorros».'] : [],
  };
}

function nuCajita(lineas) {
  const i = lineas.findIndex((l) => /Saldo total/i.test(l));
  const m = (lineas[i + 1] ?? '').match(/\$\s*([\d,]+\.\d{2})/);
  if (i < 0 || !m) return null;
  const nombre = lineas.find((l) => /Cajita/i.test(l))?.match(/Cajita(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,})?/i)?.[0] ?? 'Cajita';
  return {
    tipo: 'nu-cajita',
    fuente: 'nu-cajita',
    etiquetaFuente: `Nu · ${titulo(nombre)}`,
    clase: 'inversion',
    nombre: `Nu · ${titulo(nombre)}`,
    monto: aCentavos(m[1]),
    avisos: [],
  };
}

function cetes(lineas) {
  for (const l of lineas) {
    const m = l.match(/Total\s*:\s*\$?\s*([\d,]+\.\d{2})/i);
    if (m) {
      return {
        tipo: 'cetes',
        fuente: 'cetes',
        etiquetaFuente: 'Cetesdirecto',
        clase: 'inversion',
        nombre: 'Cetesdirecto',
        monto: aCentavos(m[1]),
        avisos: [],
      };
    }
  }
  return null;
}

/**
 * Reconoce de qué app es un screenshot y extrae su saldo.
 * @param {string[]} lineas  texto del OCR
 * @param {{id: string, texto: string}[]} [zonas]  relecturas ampliadas
 * @returns {object|null} lectura, o null si no se reconoce
 */
export function reconocerCaptura(lineas, zonas = []) {
  const todo = lineas.join('\n');
  if (/BKX\s?\d{5}/i.test(todo)) {
    if (/Valor actual/i.test(todo)) return gbmResumen(lineas, zonas);
    if (/Mi portafolio|Mercado de Capitales|Liquidez/i.test(todo)) return gbmPortafolio(lineas);
    return null;
  }
  if (/Di[DdPp]i\s*Cuenta/i.test(todo) && /Saldo\s*\(MX/i.test(todo)) return didi(lineas);
  if (/Cajita/i.test(todo) && /Saldo total/i.test(todo)) return nuCajita(lineas);
  if (/BONDDIA|L[ií]mite de ingresos del mes/i.test(todo)) return cetes(lineas);
  return null;
}

const TOLERANCIA = 10; // centavos: GBM redondea cada posición

/**
 * Une las lecturas de varios screenshots en saldos propuestos (uno por cuenta).
 * En GBM cruza el «Valor actual» contra la suma de posiciones del portafolio.
 * @param {{ archivo: string, lectura: object }[]} lecturas
 * @param {string} fecha  ISO
 */
export function combinarCapturas(lecturas, fecha) {
  const porFuente = new Map();
  for (const { archivo, lectura } of lecturas) {
    const g = porFuente.get(lectura.fuente) ?? { lecturas: [], archivos: [] };
    g.lecturas.push(lectura);
    g.archivos.push(archivo);
    porFuente.set(lectura.fuente, g);
  }

  const saldos = [];
  for (const [fuente, g] of porFuente) {
    const base = g.lecturas[0];
    const avisos = g.lecturas.flatMap((l) => l.avisos ?? []);
    let monto = null;
    let posiciones;
    let validacion = { cuadra: null, mensaje: '' };

    if (fuente.startsWith('gbm-')) {
      const resumenes = g.lecturas.filter((l) => l.tipo === 'gbm-resumen');
      const portafolio = g.lecturas.find((l) => l.tipo === 'gbm-portafolio');
      const valores = [...new Set(resumenes.map((r) => r.monto))];
      if (valores.length > 1) avisos.push('Los screenshots muestran valores actuales distintos; se tomó el primero.');
      if (valores.length) monto = valores[0];
      if (portafolio) {
        posiciones = portafolio.posiciones;
        if (monto != null) {
          const dif = Math.abs(portafolio.sumaPosiciones - monto);
          if (dif <= TOLERANCIA) validacion = { cuadra: true, mensaje: 'El valor actual coincide con la suma de las posiciones.' };
          else if (!portafolio.liquidezCompleta && portafolio.sumaPosiciones < monto) {
            validacion = { cuadra: null, mensaje: 'El screenshot del portafolio no muestra toda la liquidez; no se pudo cruzar.' };
          } else {
            validacion = { cuadra: false, mensaje: 'El valor actual no coincide con la suma de las posiciones. Revisa el monto.' };
          }
        } else {
          monto = portafolio.sumaPosiciones;
          avisos.push('Monto calculado sumando las posiciones (falta el screenshot con «Valor actual»).');
        }
      }
    } else {
      const valores = [...new Set(g.lecturas.map((l) => l.monto))];
      monto = valores[0];
      if (valores.length > 1) avisos.push('Los screenshots muestran montos distintos; se tomó el primero.');
    }
    if (monto == null) continue;

    saldos.push({
      id: `${fuente}-${fecha}`,
      fecha,
      clase: base.clase,
      nombre: g.lecturas.find((l) => l.nombre)?.nombre ?? base.etiquetaFuente,
      monto,
      fuente,
      origen: 'captura',
      ...(posiciones ? { posiciones } : {}),
      etiquetaFuente: base.etiquetaFuente,
      archivos: g.archivos,
      validacion,
      avisos: [...new Set(avisos)],
    });
  }
  return saldos;
}
