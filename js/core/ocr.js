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

/**
 * Prepara un screenshot para el OCR: escala de grises y, si el fondo es oscuro
 * (apps en modo oscuro), lo invierte para dejar texto oscuro sobre fondo claro.
 */
function prepararImagen(bitmap, escala = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let suma = 0;
  for (let p = 0; p < d.length; p += 4) {
    const g = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000;
    d[p] = d[p + 1] = d[p + 2] = g;
    suma += g;
  }
  const oscuro = suma / (d.length / 4) < 110;
  if (oscuro) for (let p = 0; p < d.length; p += 4) d[p] = d[p + 1] = d[p + 2] = 255 - d[p];
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Dentro de un renglón con letra grande seguida de letra pequeña (p. ej. «$13,919» y
 * «.33» en GBM), localiza la parte pequeña del extremo derecho.
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
function colaPequena(canvas, z) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const alto = z.y1 - z.y0;
  const x0 = Math.max(0, z.x0 - 10);
  const y0 = Math.max(0, z.y0 - Math.round(alto * 0.2));
  const w = Math.min(canvas.width, z.x1 + (z.extraDerecha ?? 0)) - x0;
  const h = Math.min(canvas.height, z.y1 + Math.round(alto * 0.2)) - y0;
  if (w <= 0 || h <= 0) return null;
  const d = ctx.getImageData(x0, y0, w, h).data;
  const tope = new Int32Array(w).fill(-1);
  const fondo = new Int32Array(w).fill(-1);
  let arriba = h, abajo = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (d[(y * w + x) * 4] < 150) {
        if (tope[x] < 0) tope[x] = y;
        fondo[x] = y;
      }
    }
    if (tope[x] >= 0) { arriba = Math.min(arriba, tope[x]); abajo = Math.max(abajo, fondo[x]); }
  }
  const H = abajo - arriba;
  if (H <= 0) return null;
  const limite = arriba + H * 0.3; // lo que empieza por debajo de esto es letra pequeña
  let fin = -1, ini = -1, blancos = 0;
  for (let x = w - 1; x >= 0; x--) {
    if (tope[x] < 0) {
      if (fin >= 0 && ++blancos > H * 0.5) break; // hueco grande: terminó el grupo
      continue;
    }
    if (tope[x] < limite) break; // llegó a la letra grande
    blancos = 0;
    if (fin < 0) fin = x;
    ini = x;
  }
  if (fin < 0 || fin - ini < 4) return null;
  const m = Math.round(H * 0.12);
  const rx = Math.max(0, ini - m);
  return { x: x0 + rx, y: y0 + Math.max(0, Math.round(limite) - m), w: Math.min(w, fin + m) - rx, h: Math.min(h, abajo + m) - Math.max(0, Math.round(limite) - m) };
}

/**
 * Lee un screenshot (PNG/JPG) y devuelve sus líneas de texto.
 * @param {File|Blob} archivo
 * @param {(p: {etapa: string, pagina: number, total: number, fraccion: number}) => void} [onProgreso]
 * @returns {Promise<{ lineas: string[], zonas: {id: string, texto: string}[], ancho: number, alto: number }>}
 */
export async function leerImagen(archivo, onProgreso = () => {}, opciones = {}) {
  const avisar = (etapa, fraccion) => {
    try { onProgreso({ etapa, pagina: 0, total: 0, fraccion }); } catch { /* sin efecto */ }
  };
  avisar('Preparando lector', 0);
  const Tesseract = await cargarTesseract();
  let bitmap;
  try {
    bitmap = await createImageBitmap(archivo);
  } catch {
    throw new Error('No se pudo abrir la imagen.');
  }
  // Los screenshots de iPhone miden ~1200 px de ancho; se normaliza a ese tamaño.
  const escala = opciones.escala ?? Math.min(2, Math.max(0.5, 1290 / bitmap.width));
  const canvas = prepararImagen(bitmap, escala);
  const ancho = bitmap.width;
  const alto = bitmap.height;
  bitmap.close?.();

  const worker = await Tesseract.createWorker('spa', 1, {
    workerPath: LIBS.tesseractWorker,
    corePath: LIBS.tesseractCore,
    langPath: LIBS.idiomas,
    logger: (m) => { if (m.status === 'recognizing text') avisar('Leyendo imagen', m.progress); },
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: String(opciones.psm ?? 6),
      preserve_interword_spaces: '1',
    });
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const renglones = [];
    for (const b of data.blocks ?? []) {
      for (const par of b.paragraphs ?? []) {
        for (const l of par.lines ?? []) {
          const texto = (l.text || '').trim();
          if (texto) renglones.push({ texto, caja: l.bbox });
        }
      }
    }
    const lineas = renglones.length
      ? renglones.map((r) => r.texto)
      : data.text.split('\n').map((l) => l.trim()).filter(Boolean);

    // Segunda pasada: zonas con cifras en letra pequeña (p. ej. los centavos en GBM)
    // se recortan, se amplían y se leen como un solo renglón.
    const zonas = [];
    const pedidas = opciones.zonas?.(renglones) ?? [];
    if (pedidas.length) {
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789.' });
      for (const z of pedidas) {
        const r = colaPequena(canvas, z);
        if (!r) { zonas.push({ id: z.id, texto: '' }); continue; }
        const f = 4;
        const rec = document.createElement('canvas');
        rec.width = r.w * f + 120;
        rec.height = r.h * f + 120;
        const rc = rec.getContext('2d');
        rc.fillStyle = '#fff';
        rc.fillRect(0, 0, rec.width, rec.height);
        rc.imageSmoothingQuality = 'high';
        rc.drawImage(canvas, r.x, r.y, r.w, r.h, 60, 60, r.w * f, r.h * f);
        const res = await worker.recognize(rec);
        zonas.push({ id: z.id, texto: res.data.text.trim() });
        rec.width = rec.height = 0;
      }
    }
    canvas.width = canvas.height = 0;
    avisar('Listo', 1);
    return { lineas, zonas, ancho, alto };
  } finally {
    await worker.terminate();
  }
}
