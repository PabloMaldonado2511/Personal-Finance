// Orquesta la importación: OCR → lector del documento → categorías sugeridas.
// No guarda nada hasta que el usuario confirma en la pantalla de revisión.

import { leerPdf, leerImagen } from './ocr.js';
import { parsearSantander } from './santander.js';
import { parsearSantanderDebito } from './santander-debito.js';
import { reconocerCaptura, combinarCapturas, zonasDeInteres } from './capturas.js';
import { categorizar } from './categorias.js';
import { listarReglas, existeEstado, listarSaldos, guardarSaldo } from './db.js';

const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Lee un estado de cuenta en PDF (tarjeta de crédito o cuenta de débito Santander).
 * @param {File} file
 * @param {(p: {etapa: string, pagina: number, total: number, fraccion: number}) => void} [onProgreso]
 * @returns {Promise<object>} Importacion (ver docs/ARQUITECTURA.md)
 */
export async function importarPdf(file, onProgreso = () => {}) {
  if (file?.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) {
    throw new Error('El archivo no es un PDF.');
  }

  // Los movimientos terminan en los totales; lo que sigue son notas legales.
  const { paginas } = await leerPdf(file, onProgreso, {
    detenerEn: (lineas) => lineas.some((l) => /Total de abonos|^TOTAL\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/i.test(l)),
  });

  onProgreso({ etapa: 'Clasificando movimientos', pagina: paginas.length, total: paginas.length, fraccion: 1 });
  const texto = paginas.flatMap((p) => p.lineas).join('\n');
  const esDebito = /cuenta de cheques|DEPOSITO\s*\|?\s*RETIRO/i.test(texto) && !/COMPRAS REGULARES/i.test(texto);
  const { estado, movimientos, validacion } = esDebito ? parsearSantanderDebito(paginas) : parsearSantander(paginas);
  estado.tipoCuenta ??= 'credito';

  const reglas = await listarReglas();
  estado.importadoEl = new Date().toISOString();

  const listos = movimientos.map((m, i) => {
    // El lector de débito ya trae comercio/categoría para lo que reconoce (nómina, traspasos…).
    const sugerido = m.categoria ? null : categorizar(m.comercio || m.descripcion, reglas);
    const tarjetaDistinta = m.tarjeta && m.tarjeta !== estado.ultimos4;
    return {
      id: `${estado.id}-${String(i + 1).padStart(3, '0')}`,
      origen: 'pdf',
      estadoId: estado.id,
      cuenta: estado.cuenta,
      fecha: m.fecha,
      fechaCargo: m.fechaCargo,
      descripcion: m.descripcion,
      comercio: m.comercio || sugerido?.comercio || m.descripcion,
      categoria: m.categoria || sugerido.categoria,
      monto: m.monto,
      tipo: m.tipo,
      msi: m.msi,
      nota: tarjetaDistinta ? `Tarjeta adicional ·${m.tarjeta}` : '',
    };
  });

  return {
    estado,
    movimientos: listos,
    validacion,
    duplicado: await existeEstado(estado.id),
  };
}

/**
 * Lee uno o varios screenshots y propone los saldos que contienen.
 * @param {File[]} files
 * @param {(p: {etapa: string, pagina: number, total: number, fraccion: number}) => void} [onProgreso]
 * @returns {Promise<object>} ImportacionSaldos
 */
export async function importarCapturas(files, onProgreso = () => {}) {
  const lista = [...files];
  const lecturas = [];
  const noReconocidas = [];
  let fecha = hoyIso();

  for (let i = 0; i < lista.length; i++) {
    const f = lista[i];
    const avance = (p) => onProgreso({
      etapa: p.etapa === 'Listo' ? 'Leyendo imagen' : p.etapa,
      pagina: i + 1,
      total: lista.length,
      fraccion: (i + (p.fraccion ?? 0)) / lista.length,
    });
    try {
      const { lineas, zonas } = await leerImagen(f, avance, { zonas: zonasDeInteres });
      const lectura = reconocerCaptura(lineas, zonas);
      if (lectura) lecturas.push({ archivo: f.name || `imagen ${i + 1}`, lectura });
      else {
        noReconocidas.push({
          archivo: f.name || `imagen ${i + 1}`,
          motivo: 'No encontré un identificador conocido (GBM, DiDi Cuenta, Nu Cajita o Cetesdirecto).',
        });
      }
    } catch (e) {
      noReconocidas.push({ archivo: f.name || `imagen ${i + 1}`, motivo: e?.message || 'No se pudo leer la imagen.' });
    }
  }
  onProgreso({ etapa: 'Listo', pagina: lista.length, total: lista.length, fraccion: 1 });

  const saldos = combinarCapturas(lecturas, fecha);

  // Si esa cuenta ya se había guardado, se respetan la clase y el nombre que eligió el usuario.
  const previos = new Map();
  for (const s of await listarSaldos()) {
    if (!s.fuente) continue;
    const p = previos.get(s.fuente);
    if (!p || s.fecha >= p.fecha) previos.set(s.fuente, s);
  }
  for (const s of saldos) {
    const p = previos.get(s.fuente);
    if (p) { s.clase = p.clase; s.nombre = p.nombre; }
  }

  return { tipo: 'saldos', saldos, noReconocidas };
}

/** Guarda los saldos propuestos (ya revisados por el usuario). */
export async function guardarCapturas(saldosPropuestos) {
  const guardados = [];
  for (const s of saldosPropuestos) {
    const { etiquetaFuente, archivos, validacion, avisos, ...saldo } = s; // campos solo de revisión
    saldo.id = saldo.fuente ? `${saldo.fuente}-${saldo.fecha}` : saldo.id;
    saldo.origen ??= 'captura';
    guardados.push(await guardarSaldo(saldo));
  }
  return guardados;
}
