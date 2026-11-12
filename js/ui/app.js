// Punto de entrada: abre la base de datos y enruta por hash.
import * as db from '../core/db.js';
import { esc, destruirGraficas } from './util.js';
import * as resumen from './resumen.js';
import * as movimientos from './movimientos.js';
import * as importar from './importar.js';
import * as capital from './capital.js';
import * as ajustes from './ajustes.js';

const RUTAS = { resumen, movimientos, importar, capital, ajustes };
const vista = document.getElementById('vista');
let listo = false;
let ficha = 0;

function leerHash() {
  const [nombre, consulta = ''] = location.hash.slice(1).split('?');
  return { ruta: RUTAS[nombre] ? nombre : 'resumen', params: new URLSearchParams(consulta) };
}

async function pintar() {
  if (!listo) return;
  const { ruta, params } = leerHash();
  const mia = ++ficha;
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.ruta === ruta) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  destruirGraficas();
  let post = null;
  const el = document.createElement('div');
  el.className = `pantalla pantalla-${ruta}`;
  try {
    post = await RUTAS[ruta].render(el, { params, refrescar: pintar });
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="aviso aviso-error" role="alert"><strong>Algo salió mal.</strong>
      <p>${esc(err && err.message ? err.message : String(err))}</p></div>`;
  }
  if (mia !== ficha) return; // llegó una navegación más reciente
  vista.replaceChildren(el);
  if (typeof post === 'function') post();
}

let rutaPrevia = null;
window.addEventListener('hashchange', () => {
  const { ruta } = leerHash();
  if (ruta !== rutaPrevia) window.scrollTo(0, 0);
  rutaPrevia = ruta;
  pintar();
});

// Re-pintar al cambiar el tema (los colores de gráficas se leen del CSS).
window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => pintar());

async function iniciar() {
  try {
    await db.abrir();
  } catch (err) {
    console.error(err);
    vista.innerHTML = `<div class="aviso aviso-error" role="alert">
      <strong>No se pudo abrir la base de datos del navegador.</strong>
      <p>${esc(err && err.message ? err.message : String(err))}</p>
      <p class="texto-suave">Si usas navegación privada, prueba en una ventana normal.</p></div>`;
    return;
  }
  listo = true;
  rutaPrevia = leerHash().ruta;
  pintar();
}

iniciar();
