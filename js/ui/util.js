// Utilidades de interfaz: escape de HTML, toasts, hojas/modales, gráficas.
import { CATEGORIAS } from '../core/categorias.js';

const MAPA_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => MAPA_ESC[c]);
}

const dos = (n) => String(n).padStart(2, '0');

export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Desplaza un mes 'YYYY-MM' n meses (entero, puede ser negativo). */
export function desplazarMes(mes, n) {
  const [y, m] = mes.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${dos((idx % 12) + 1)}`;
}

/** Centavos enteros → texto editable '1234.56' (sin floats). */
export function centavosATexto(c) {
  const n = Math.abs(Math.trunc(c || 0));
  return `${c < 0 ? '-' : ''}${Math.trunc(n / 100)}.${dos(n % 100)}`;
}

export function catPorId(id) {
  return (
    CATEGORIAS.find((c) => c.id === id) ||
    CATEGORIAS.find((c) => c.id === 'otros') || { id, nombre: String(id), color: '#888888', icono: '•' }
  );
}

export function chipCat(id) {
  const c = catPorId(id);
  return `<span class="chip" style="--c:${esc(c.color)}"><span class="chip-ico" aria-hidden="true">${esc(c.icono)}</span>${esc(c.nombre)}</span>`;
}

export function opcionesCategoria(seleccionada, { conIngreso = true, extra = '' } = {}) {
  const lista = CATEGORIAS.filter((c) => conIngreso || c.id !== 'ingreso');
  return (
    extra +
    lista
      .map((c) => `<option value="${esc(c.id)}"${c.id === seleccionada ? ' selected' : ''}>${esc(c.icono)} ${esc(c.nombre)}</option>`)
      .join('')
  );
}

export const ETIQUETA_TIPO = {
  gasto: 'Gasto',
  devolucion: 'Devolución',
  ingreso: 'Ingreso',
  pago_tarjeta: 'Pago de tarjeta',
  traspaso: 'Traspaso',
};

export function opcionesTipo(seleccionado) {
  return Object.entries(ETIQUETA_TIPO)
    .map(([v, t]) => `<option value="${v}"${v === seleccionado ? ' selected' : ''}>${esc(t)}</option>`)
    .join('');
}

// ---------- Toasts ----------
export function toast(mensaje, tipo = 'info') {
  let cont = document.getElementById('toasts');
  if (!cont) {
    cont = document.createElement('div');
    cont.id = 'toasts';
    cont.setAttribute('aria-live', 'polite');
    document.body.appendChild(cont);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.textContent = mensaje;
  cont.appendChild(t);
  setTimeout(() => {
    t.classList.add('saliendo');
    setTimeout(() => t.remove(), 300);
  }, tipo === 'error' ? 6000 : 3000);
}

// ---------- Hojas inferiores y modales ----------
let hojaAbierta = null;

/**
 * Abre una hoja inferior (o modal centrado). Devuelve { el, cerrar }.
 * `cuerpo` es HTML ya escapado por quien llama.
 */
export function abrirHoja({ titulo, cuerpo, modal = false, alCerrar } = {}) {
  if (hojaAbierta) hojaAbierta.cerrar();
  const previo = document.activeElement;
  const fondo = document.createElement('div');
  fondo.className = 'fondo' + (modal ? ' fondo-modal' : '');
  fondo.innerHTML = `
    <div class="hoja" role="dialog" aria-modal="true" aria-label="${esc(titulo || 'Diálogo')}" tabindex="-1">
      <div class="hoja-asa" aria-hidden="true"></div>
      <div class="hoja-cab"><h2>${esc(titulo || '')}</h2>
        <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">✕</button></div>
      <div class="hoja-cuerpo">${cuerpo}</div>
    </div>`;
  document.body.appendChild(fondo);
  document.body.classList.add('sin-scroll');
  const hoja = fondo.querySelector('.hoja');
  let cerrada = false;
  const cerrar = (valor) => {
    if (cerrada) return;
    cerrada = true;
    document.removeEventListener('keydown', teclas);
    fondo.classList.add('saliendo');
    setTimeout(() => fondo.remove(), 180);
    document.body.classList.remove('sin-scroll');
    if (hojaAbierta && hojaAbierta.el === hoja) hojaAbierta = null;
    if (previo && previo.focus) previo.focus();
    if (alCerrar) alCerrar(valor);
  };
  const teclas = (e) => {
    if (e.key === 'Escape') cerrar();
  };
  document.addEventListener('keydown', teclas);
  fondo.addEventListener('mousedown', (e) => {
    if (e.target === fondo) cerrar();
  });
  fondo.querySelector('[data-cerrar]').addEventListener('click', () => cerrar());
  hojaAbierta = { el: hoja, cerrar };
  requestAnimationFrame(() => {
    const primero = hoja.querySelector('input:not([type=hidden]), select, textarea');
    (primero && !modal ? hoja : primero || hoja).focus({ preventScroll: true });
  });
  return { el: hoja, cerrar };
}

/** Diálogo de confirmación propio. Resuelve true/false. Con `escribir` exige teclear esa palabra. */
export function confirmar({ titulo, mensaje, textoOk = 'Aceptar', peligro = false, escribir = null }) {
  return new Promise((resolve) => {
    let resultado = false;
    const h = abrirHoja({
      titulo,
      modal: true,
      alCerrar: () => resolve(resultado),
      cuerpo: `
        <p class="texto-suave">${esc(mensaje)}</p>
        ${escribir ? `<label class="campo"><span>Escribe «${esc(escribir)}» para continuar</span>
          <input type="text" data-palabra autocomplete="off" autocapitalize="characters"></label>` : ''}
        <div class="acciones">
          <button type="button" class="btn" data-no>Cancelar</button>
          <button type="button" class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}" data-si${escribir ? ' disabled' : ''}>${esc(textoOk)}</button>
        </div>`,
    });
    const si = h.el.querySelector('[data-si]');
    const palabra = h.el.querySelector('[data-palabra]');
    if (palabra) {
      palabra.addEventListener('input', () => {
        si.disabled = palabra.value.trim().toUpperCase() !== escribir.toUpperCase();
      });
    }
    h.el.querySelector('[data-no]').addEventListener('click', () => h.cerrar());
    si.addEventListener('click', () => {
      resultado = true;
      h.cerrar();
    });
  });
}

// ---------- Gráficas (Chart.js UMD global) ----------
const graficas = new Map();

export function destruirGraficas() {
  graficas.forEach((g) => g.destroy());
  graficas.clear();
}

export function colorTema(nombre, respaldo) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return v || respaldo;
}

/** Crea (y registra) una gráfica. Si Chart.js no cargó, muestra un aviso en su lugar. */
export function crearGrafica(clave, canvas, config) {
  if (graficas.has(clave)) {
    graficas.get(clave).destroy();
    graficas.delete(clave);
  }
  if (!window.Chart) {
    canvas.insertAdjacentHTML('afterend', '<p class="texto-suave">No se pudo cargar la librería de gráficas (¿sin conexión?).</p>');
    canvas.remove();
    return null;
  }
  const texto = colorTema('--texto-suave', '#9aa3b2');
  window.Chart.defaults.color = texto;
  window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const g = new window.Chart(canvas, config);
  graficas.set(clave, g);
  return g;
}

/** Abrevia un importe en centavos para ejes: 1500000 → '$15k' (solo presentación). */
export function abreviar(centavos) {
  const pesos = Math.round(centavos / 100);
  const a = Math.abs(pesos);
  const signo = pesos < 0 ? '-' : '';
  if (a >= 1000000) return `${signo}$${Math.round(a / 100000) / 10}M`;
  if (a >= 1000) return `${signo}$${Math.round(a / 100) / 10}k`.replace('.0k', 'k');
  return `${signo}$${a}`;
}

export function estadoVacio({ icono = '📄', titulo, texto, boton }) {
  return `<div class="vacio">
    <div class="vacio-ico" aria-hidden="true">${icono}</div>
    <h2>${esc(titulo)}</h2><p>${esc(texto)}</p>
    ${boton ? `<a class="btn btn-primario" href="${esc(boton.href)}">${esc(boton.texto)}</a>` : ''}
  </div>`;
}
