// Orquesta la importación de un PDF: OCR → parser del banco → categorías sugeridas.
// No guarda nada: devuelve una Importacion para que el usuario la revise.

import { leerPdf } from './ocr.js';
import { parsearSantander } from './santander.js';
import { categorizar } from './categorias.js';
import { listarReglas, existeEstado } from './db.js';

/**
 * @param {File} file
 * @param {(p: {etapa: string, pagina: number, total: number, fraccion: number}) => void} [onProgreso]
 * @returns {Promise<object>} Importacion (ver docs/ARQUITECTURA.md)
 */
export async function importarPdf(file, onProgreso = () => {}) {
  if (file?.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) {
    throw new Error('El archivo no es un PDF.');
  }

  // Los movimientos terminan en «Total de abonos»; lo que sigue son notas legales.
  const { paginas } = await leerPdf(file, onProgreso, {
    detenerEn: (lineas) => lineas.some((l) => /Total de abonos/i.test(l)),
  });

  onProgreso({ etapa: 'Clasificando movimientos', pagina: paginas.length, total: paginas.length, fraccion: 1 });
  const { estado, movimientos, validacion } = parsearSantander(paginas);

  const reglas = await listarReglas();
  estado.importadoEl = new Date().toISOString();

  const listos = movimientos.map((m, i) => {
    const { comercio, categoria } = categorizar(m.descripcion, reglas);
    const tarjetaDistinta = m.tarjeta && m.tarjeta !== estado.ultimos4;
    return {
      id: `${estado.id}-${String(i + 1).padStart(3, '0')}`,
      origen: 'pdf',
      estadoId: estado.id,
      cuenta: estado.cuenta,
      fecha: m.fecha,
      fechaCargo: m.fechaCargo,
      descripcion: m.descripcion,
      comercio,
      categoria,
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
