// Formato de moneda y fechas. Implementación manual (sin Intl) para que el
// resultado sea idéntico en todos los navegadores y en Node.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul',
  'ago', 'sep', 'oct', 'nov', 'dic'];

/** Centavos (entero) → '$1,234.56' ; negativos '-$1,234.56'. */
export function moneda(centavos) {
  const n = Math.round(Number(centavos) || 0);
  const signo = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const enteros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = String(abs % 100).padStart(2, '0');
  return `${signo}$${enteros}.${dec}`;
}

/**
 * Texto → centavos (entero). Acepta '$ 1,234.56', '1234.5', '1234', '-12.30'.
 * Parsea enteros y decimales por separado para no depender de floats.
 * Inválido → null.
 */
export function aCentavos(texto) {
  if (typeof texto === 'number') {
    if (!Number.isFinite(texto)) return null;
    texto = texto.toFixed(2);
  }
  if (typeof texto !== 'string') return null;
  let s = texto.replace(/[\s $]/g, '').replace(/MXN|MN/gi, '');
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negativo = !negativo; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  // Parte entera con o sin separador de miles, decimales opcionales (1-2 dígitos).
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?$/.exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const ent = parseInt((m[1] || '0').replace(/,/g, ''), 10);
  const dec = m[2] === undefined ? 0 : parseInt(m[2].padEnd(2, '0'), 10);
  const total = ent * 100 + dec;
  if (!Number.isSafeInteger(total)) return null;
  return negativo ? -total : total;
}

/** '2026-10-12' → '12 oct 2026'. */
export function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m || !MESES_CORTOS[parseInt(m[2], 10) - 1]) return '';
  return `${parseInt(m[3], 10)} ${MESES_CORTOS[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

/** '2026-10' → 'octubre 2026'. */
export function mesLargo(mes) {
  const m = /^(\d{4})-(\d{2})/.exec(mes || '');
  if (!m || !MESES[parseInt(m[2], 10) - 1]) return '';
  return `${MESES[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

/** '2026-10-12' → '2026-10'. */
export function mesDe(iso) {
  return typeof iso === 'string' ? iso.slice(0, 7) : '';
}
