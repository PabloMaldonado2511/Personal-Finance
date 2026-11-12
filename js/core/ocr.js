// PDF → líneas de texto. Los estados de cuenta de Santander no traen capa de texto
// (cada renglón es una imagen), así que se renderiza cada página con pdf.js y se lee
// con Tesseract.js. Todo ocurre en el navegador; el archivo nunca sale del dispositivo.

// Las librerías van incluidas en el repo (carpeta vendor/) con versión fija:
// pdf.js 4.10.38 (legacy), Tesseract.js 7.0.0 y datos de español «best_int».
const v = (ruta) => new URL(`../../vendor/${ruta}`, import.meta.url).href;
const LIBS = {
  pdfjs: v('pdfjs/pdf.min.mjs'),
  pdfjsWorker: v('pdfjs/pdf.worker.min.mjs'),
  tesseract: v('tesseract/tesseract.esm.min.js'),
  tesseractWorker: v('tesseract/worker.min.js'),
  tesseractCore: v('tesseract-core'),
  idiomas: v('lang'),
};

const DPI = 300; // los renglones del PDF están rasterizados a 300 ppp
const ESCALA = DPI / 72;

let pdfjsListo = null;
function cargarPdfjs() {
  pdfjsListo ??= import(/* @vite-ignore */ LIBS.pdfjs).then((m) => {
    m.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
    return m;
  });
  return pdfjsListo;
}

let tesseractListo = null;
function cargarTesseract() {
  tesseractListo ??= import(/* @vite-ignore */ LIBS.tesseract).then((m) => m.default ?? m);
  return tesseractListo;
}

async function renderizar(pagina) {
  const viewport = pagina.getViewport({ scale: ESCALA });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pagina.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/**
 * Limpia el bitmap para el OCR:
 *  1. Encabezados rojos con texto blanco → texto negro sobre blanco.
 *  2. Borra las líneas de las tablas (corridas largas de pixeles oscuros), que al tocar
 *     el texto hacen que el OCR confunda dígitos.
 */
export function limpiar(canvas, minimo = 150) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = canvas;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  // 1. Bandas rojas
  const HUECO = 70; // separación máxima entre trazos rojos para considerarlo letra blanca
  for (let y = 0; y < H; y++) {
    const base = y * W * 4;
    let rojos = 0;
    for (let x = 0, p = base; x < W; x++, p += 4) {
      if (d[p] > 170 && d[p + 1] < 110 && d[p + 2] < 110) rojos++;
    }
    if (rojos < W * 0.15) continue;
    let ultimoRojo = -1;
    for (let x = 0, p = base; x < W; x++, p += 4) {
      const rojo = d[p] > 170 && d[p + 1] < 110 && d[p + 2] < 110;
      if (!rojo) continue;
      if (ultimoRojo >= 0 && x - ultimoRojo > 1 && x - ultimoRojo <= HUECO) {
        for (let k = ultimoRojo + 1, q = base + k * 4; k < x; k++, q += 4) {
          // lo claro entre rojos es letra: se pinta de negro (marcado con alfa 254)
          if (d[q] + d[q + 1] + d[q + 2] > 480) { d[q] = d[q + 1] = d[q + 2] = 0; d[q + 3] = 254; }
        }
      }
      ultimoRojo = x;
    }
    for (let x = 0, p = base; x < W; x++, p += 4) {
      if (d[p + 3] === 254) { d[p + 3] = 255; continue; }
      if (d[p] > 150 && d[p + 1] < 140 && d[p + 2] < 140) d[p] = d[p + 1] = d[p + 2] = 255;
    }
  }

  // 2. Líneas de tabla
  const oscuro = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < oscuro.length; i++, p += 4) {
    oscuro[i] = d[p] + d[p + 1] + d[p + 2] < 384 ? 1 : 0;
  }
  const borrar = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let ini = -1;
    for (let x = 0; x <= W; x++) {
      const o = x < W && oscuro[y * W + x];
      if (o && ini < 0) ini = x;
      else if (!o && ini >= 0) {
        if (x - ini >= minimo) for (let k = ini; k < x; k++) borrar[y * W + k] = 1;
        ini = -1;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let ini = -1;
    for (let y = 0; y <= H; y++) {
      const o = y < H && oscuro[y * W + x];
      if (o && ini < 0) ini = y;
      else if (!o && ini >= 0) {
        if (y - ini >= minimo) for (let k = ini; k < y; k++) borrar[k * W + x] = 1;
        ini = -1;
      }
    }
  }
  for (let i = 0, p = 0; i < borrar.length; i++, p += 4) {
    if (borrar[i]) d[p] = d[p + 1] = d[p + 2] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Lee un PDF y devuelve el texto por página.
 * @param {File|Blob|ArrayBuffer} archivo
 * @param {(p: {etapa: string, pagina: number, total: number, fraccion: number}) => void} [onProgreso]
 * @param {{ detenerEn?: (lineas: string[]) => boolean }} [opciones]
 *        detenerEn: si devuelve true tras leer una página, ya no se leen las siguientes.
 * @returns {Promise<{ paginas: { numero: number, lineas: string[] }[], totalPaginas: number }>}
 */
export async function leerPdf(archivo, onProgreso = () => {}, opciones = {}) {
  const avisar = (etapa, pagina, total, fraccion) => {
    try { onProgreso({ etapa, pagina, total, fraccion }); } catch { /* la UI no debe romper la lectura */ }
  };

  avisar('Preparando lector', 0, 0, 0);
  const [pdfjs, Tesseract] = await Promise.all([cargarPdfjs(), cargarTesseract()]);

  const datos = archivo instanceof ArrayBuffer ? archivo : await archivo.arrayBuffer();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(datos) }).promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new Error('El PDF está protegido con contraseña.');
    throw new Error('No se pudo abrir el archivo. ¿Es un PDF válido?');
  }
  const total = doc.numPages;

  let pagActual = 0;
  const worker = await Tesseract.createWorker('spa', 1, {
    workerPath: LIBS.tesseractWorker,
    corePath: LIBS.tesseractCore,
    langPath: LIBS.idiomas,
    logger: (m) => {
      if (m.status === 'recognizing text' && pagActual) {
        avisar('Leyendo página', pagActual, total, (pagActual - 1 + m.progress) / total);
      } else if (!pagActual) {
        avisar('Descargando motor de lectura', 0, total, 0);
      }
    },
  });

  const paginas = [];
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '6', // bloque uniforme: conserva cada renglón de la tabla
      preserve_interword_spaces: '1',
      user_defined_dpi: String(DPI),
    });
    for (let n = 1; n <= total; n++) {
      pagActual = n;
      avisar('Leyendo página', n, total, (n - 1) / total);
      const pagina = await doc.getPage(n);
      const canvas = limpiar(await renderizar(pagina));
      if (opciones.depurar) opciones.depurar(n, canvas);
      const { data } = await worker.recognize(canvas);
      canvas.width = canvas.height = 0; // libera memoria (importante en iPhone)
      pagina.cleanup();
      const lineas = data.text.split('\n').map((l) => l.trim()).filter(Boolean);
      paginas.push({ numero: n, lineas });
      if (opciones.detenerEn?.(lineas)) break;
    }
  } finally {
    await worker.terminate();
    await doc.destroy();
  }
  avisar('Listo', paginas.length, total, 1);
  return { paginas, totalPaginas: total };
}
