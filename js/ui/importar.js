// Pantalla Importar: PDF → revisión → guardar.
import * as db from '../core/db.js';
import { importarPdf } from '../core/importar.js';
import { moneda, aCentavos, fechaCorta } from '../core/fmt.js';
import { esc, chipCat, catPorId, opcionesCategoria, opcionesTipo, toast, confirmar, centavosATexto } from './util.js';

// Estado del módulo: sobrevive a cambios de pestaña mientras se procesa.
const est = {
  procesando: false,
  progreso: null, // { archivo, i, n, etapa, pagina, total, fraccion }
  revisiones: [], // Importacion[] pendientes de confirmar
  errores: [], // { archivo, mensaje }
  filtro: 'todos', // 'todos' | 'otros'
  abierta: null, // índice de la fila desplegada
  refrescar: null,
};


function textoProgreso() {
  const p = est.progreso;
  if (!p) return '';
  const etapa = p.etapa || 'Procesando';
  const pag = p.pagina > 0 && p.total ? ` · página ${p.pagina} de ${p.total}` : '';
  const arch = p.n > 1 ? `Archivo ${p.i} de ${p.n}: ` : '';
  return `${arch}${etapa}${pag}`;
}

function pintarProgreso() {
  const t = document.getElementById('prog-texto');
  const b = document.getElementById('prog-barra');
  if (!t || !b) return;
  const f = Math.max(0, Math.min(1, est.progreso?.fraccion || 0));
  t.textContent = textoProgreso();
  b.value = Math.round(f * 100);
  b.setAttribute('aria-valuetext', `${Math.round(f * 100)}%`);
}

async function procesar(archivos) {
  est.procesando = true;
  est.errores = [];
  est.refrescar();
  for (let i = 0; i < archivos.length; i++) {
    const f = archivos[i];
    est.progreso = { archivo: f.name, i: i + 1, n: archivos.length, etapa: 'Preparando lector', fraccion: 0 };
    pintarProgreso();
    try {
      const imp = await importarPdf(f, (p) => {
        est.progreso = { ...est.progreso, ...p };
        pintarProgreso();
      });
      est.revisiones.push(imp);
    } catch (err) {
      console.error(err);
      est.errores.push({ archivo: f.name, mensaje: err && err.message ? err.message : String(err) });
    }
  }
  est.procesando = false;
  est.progreso = null;
  est.refrescar();
}

function htmlFila(m, i) {
  const k = catPorId(m.categoria);
  const sinClas = m.categoria === 'otros';
  const pos = m.tipo === 'ingreso' || m.tipo === 'devolucion';
  const montoHtml =
    m.tipo === 'pago_tarjeta'
      ? `<span class="fila-monto tenue">${moneda(m.monto)}</span>`
      : `<span class="fila-monto ${pos ? 'pos' : 'neg'}">${pos ? '+' : '−'}${moneda(m.monto)}</span>`;
  const abierta = est.abierta === i;
  return `<li class="rev-fila${abierta ? ' abierta' : ''}${sinClas ? ' sin-clasificar' : ''}" data-i="${i}">
    <button type="button" class="rev-resumen" data-abrir="${i}" aria-expanded="${abierta}">
      <span class="fila-ico" style="--c:${esc(k.color)}" aria-hidden="true">${esc(k.icono)}</span>
      <span class="rev-txt"><strong>${esc(m.comercio || m.descripcion)}</strong>
        <small>${esc(fechaCorta(m.fecha))} · ${esc(m.descripcion)}</small></span>
      <span class="rev-der">${montoHtml}${
        sinClas ? '<span class="chip chip-warn">Sin clasificar</span>' : chipCat(m.categoria)
      }</span></button>
    ${
      abierta
        ? `<div class="rev-editor">
      <label class="campo"><span>Categoría</span><select data-cat="${i}">${opcionesCategoria(m.categoria)}</select></label>
      <div class="dos-col">
        <label class="campo"><span>Tipo</span><select data-tipo="${i}">${opcionesTipo(m.tipo)}</select></label>
        <label class="campo"><span>Monto</span><input data-monto="${i}" inputmode="decimal" value="${esc(centavosATexto(m.monto))}"></label>
      </div>
      <button type="button" class="btn btn-peligro" data-borrar="${i}">Eliminar movimiento</button></div>`
        : ''
    }</li>`;
}

function htmlFilas(imp) {
  const filas = imp.movimientos
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => est.filtro !== 'otros' || m.categoria === 'otros')
    .map(({ m, i }) => htmlFila(m, i))
    .join('');
  return filas || '<li class="texto-suave rev-vacio">No hay movimientos para mostrar.</li>';
}

function htmlFiltro(imp) {
  const n = imp.movimientos.filter((m) => m.categoria === 'otros').length;
  return `<div class="seg" role="group" aria-label="Filtro de movimientos">
    <button type="button" data-filtro="todos" aria-pressed="${est.filtro === 'todos'}">Todos</button>
    <button type="button" data-filtro="otros" aria-pressed="${est.filtro === 'otros'}">Sin clasificar (${n})</button></div>`;
}

function htmlRevision(imp) {
  const e = imp.estado;
  const v = imp.validacion;
  return `<section class="panel revision" aria-label="Revisión de importación">
    <h2>Revisa antes de guardar${est.revisiones.length > 1 ? ` <small>(${est.revisiones.length} pendientes)</small>` : ''}</h2>
    <dl class="datos">
      <div><dt>Producto</dt><dd>${esc(e.producto)}</dd></div>
      <div><dt>Cuenta</dt><dd>${esc(e.cuenta)}</dd></div>
      <div><dt>Periodo</dt><dd>${esc(fechaCorta(e.periodoInicio))} – ${esc(fechaCorta(e.periodoFin))}</dd></div>
      <div><dt>Fecha de corte</dt><dd>${esc(fechaCorta(e.fechaCorte))}</dd></div>
      <div><dt>Fecha límite de pago</dt><dd>${esc(fechaCorta(e.fechaLimitePago))}</dd></div>
      <div><dt>Pago para no generar intereses</dt><dd>${moneda(e.pagoNoIntereses)}</dd></div>
    </dl>
    <div class="aviso ${v.cuadra ? 'aviso-ok' : 'aviso-warn'}" role="status">
      <strong>${v.cuadra ? '✓ Cuadra con el PDF' : '⚠ No cuadra'}</strong>
      <table class="tabla-val">
        <thead><tr><th></th><th>Leído</th><th>Impreso</th><th>Dif.</th></tr></thead>
        <tbody>
          <tr><th>Cargos</th><td>${moneda(v.totalCargosLeidos)}</td><td>${moneda(v.totalCargosPdf)}</td><td>${moneda(v.totalCargosLeidos - v.totalCargosPdf)}</td></tr>
          <tr><th>Abonos</th><td>${moneda(v.totalAbonosLeidos)}</td><td>${moneda(v.totalAbonosPdf)}</td><td>${moneda(v.totalAbonosLeidos - v.totalAbonosPdf)}</td></tr>
        </tbody></table>
      ${(v.avisos || []).length ? `<ul class="avisos">${v.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      ${!v.cuadra ? '<p class="texto-suave">Corrige las filas que veas mal (monto, tipo o categoría) o quita las que sobren.</p>' : ''}
    </div>
    ${imp.duplicado ? '<div class="aviso aviso-warn" role="status"><strong>Ya lo habías importado;</strong> se reemplazará.</div>' : ''}
    <div class="rev-barra"><h3 id="rev-cuenta">${imp.movimientos.length} movimientos</h3><div id="rev-filtro">${htmlFiltro(imp)}</div></div>
    <ul class="lista rev-lista" id="rev-lista">${htmlFilas(imp)}</ul>
    <div class="barra-fija"><div class="barra-fija-in">
      <button type="button" class="btn" id="descartar">Descartar</button>
      <button type="button" class="btn btn-primario" id="guardar">Guardar</button>
    </div></div></section>`;
}

export async function render(el, { refrescar }) {
  est.refrescar = refrescar;
  const estados = (await db.listarEstados()).slice().sort((a, b) => (a.fechaCorte < b.fechaCorte ? 1 : -1));
  const imp = est.revisiones[0];

  el.innerHTML = `
    <header class="cab"><h1>Importar</h1></header>
    ${
      est.procesando
        ? `<section class="panel"><h2>Procesando…</h2>
            <p id="prog-texto" class="texto-suave"></p>
            <progress id="prog-barra" max="100" value="0" aria-label="Progreso de lectura"></progress>
            <p class="texto-suave">Leer un PDF escaneado toma varios segundos por página. Puedes cambiar de pestaña; el proceso continúa.</p></section>`
        : `<section class="panel zona">
            <label class="zona-pdf" for="pdf">
              <span class="zona-ico" aria-hidden="true">📄</span>
              <strong>Elegir estados de cuenta en PDF</strong>
              <small>Puedes seleccionar varios; se procesan uno por uno.</small>
            </label>
            <input id="pdf" class="sr-only" type="file" accept="application/pdf" multiple>
            <p class="privacidad">🔒 El archivo se procesa en tu dispositivo y no se sube a ningún servidor.</p></section>`
    }
    ${est.errores.map((x) => `<div class="aviso aviso-error" role="alert"><strong>No se pudo leer ${esc(x.archivo)}</strong><p>${esc(x.mensaje)}</p></div>`).join('')}
    ${imp ? htmlRevision(imp) : ''}
    <section class="panel"><h2>Estados importados</h2>
      ${
        estados.length
          ? `<ul class="lista">${estados
              .map(
                (s) => `<li class="fila"><span class="fila-txt"><strong>${esc(s.cuenta)}</strong>
                <small>${esc(s.producto)} · corte ${esc(fechaCorta(s.fechaCorte))}</small></span>
                <span class="fila-monto">${moneda(s.saldoDeudorTotal)}</span>
                <button type="button" class="btn-icono" data-borrar-estado="${esc(s.id)}" aria-label="Borrar estado ${esc(s.cuenta)} ${esc(s.fechaCorte)}">🗑</button></li>`
              )
              .join('')}</ul>`
          : '<p class="texto-suave">Todavía no has importado ningún estado.</p>'
      }
    </section>
    <section class="panel deshabilitada" aria-disabled="true"><h2>Screenshots <span class="etiqueta">próximamente</span></h2>
      <p class="texto-suave">Pronto podrás importar movimientos desde capturas de pantalla.</p></section>`;

  if (est.procesando) pintarProgreso();

  const input = el.querySelector('#pdf');
  if (input) {
    input.addEventListener('change', () => {
      const archivos = [...input.files];
      input.value = '';
      if (archivos.length) procesar(archivos);
    });
  }

  el.querySelectorAll('[data-borrar-estado]').forEach((b) =>
    b.addEventListener('click', async () => {
      const ok = await confirmar({
        titulo: 'Borrar estado',
        mensaje: 'Se borrará el estado y todos sus movimientos. Esta acción no se puede deshacer.',
        textoOk: 'Borrar',
        peligro: true,
      });
      if (!ok) return;
      try {
        await db.borrarEstado(b.dataset.borrarEstado);
        toast('Estado borrado', 'ok');
        refrescar();
      } catch (err) {
        toast(err.message || 'No se pudo borrar', 'error');
      }
    })
  );

  if (!imp) return;
  const mov = imp.movimientos;
  const lista = el.querySelector('#rev-lista');
  function repintar() {
    lista.innerHTML = htmlFilas(imp);
    el.querySelector('#rev-filtro').innerHTML = htmlFiltro(imp);
    el.querySelector('#rev-cuenta').textContent = `${mov.length} movimientos`;
    enlazarFiltro();
  }
  function enlazarFiltro() {
    el.querySelectorAll('[data-filtro]').forEach((b) =>
      b.addEventListener('click', () => {
        est.filtro = b.dataset.filtro;
        est.abierta = null;
        repintar();
      })
    );
  }
  enlazarFiltro();
  // Delegación: una sola fila abierta a la vez; cambios se reflejan sin perder el scroll.
  lista.addEventListener('click', (e) => {
    const ab = e.target.closest('[data-abrir]');
    if (ab) {
      const i = +ab.dataset.abrir;
      est.abierta = est.abierta === i ? null : i;
      repintar();
      lista.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const bo = e.target.closest('[data-borrar]');
    if (bo) {
      mov.splice(+bo.dataset.borrar, 1);
      est.abierta = null;
      repintar();
    }
  });
  lista.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.cat !== undefined) mov[+t.dataset.cat].categoria = t.value;
    else if (t.dataset.tipo !== undefined) mov[+t.dataset.tipo].tipo = t.value;
    else if (t.dataset.monto !== undefined) {
      const i = +t.dataset.monto;
      const c = aCentavos(t.value);
      if (c == null || c <= 0) {
        toast('Monto inválido', 'error');
        t.value = centavosATexto(mov[i].monto);
        return;
      }
      mov[i].monto = c;
      t.value = centavosATexto(c);
    } else return;
    // Actualiza la fila (chip, signo) y el contador sin cerrar el editor.
    const i = +(t.dataset.cat ?? t.dataset.tipo ?? t.dataset.monto);
    const fila = lista.querySelector(`[data-i="${i}"]`);
    const activo = t.dataset.cat !== undefined ? 'cat' : t.dataset.tipo !== undefined ? 'tipo' : 'monto';
    if (est.filtro === 'otros' && t.dataset.cat !== undefined) { est.abierta = null; repintar(); }
    else if (fila) {
      const nueva = document.createElement('div');
      nueva.innerHTML = htmlFila(mov[i], i);
      fila.querySelector('.rev-resumen').replaceWith(nueva.querySelector('.rev-resumen'));
      fila.classList.toggle('sin-clasificar', mov[i].categoria === 'otros');
      el.querySelector('#rev-filtro').innerHTML = htmlFiltro(imp);
      enlazarFiltro();
    }
    void activo;
  });
  est.filtro = est.filtro || 'todos';
  el.querySelector('#descartar').addEventListener('click', async () => {
    const ok = await confirmar({ titulo: 'Descartar importación', mensaje: 'No se guardará nada de este PDF.', textoOk: 'Descartar', peligro: true });
    if (!ok) return;
    est.revisiones.shift(); est.abierta = null; est.filtro = 'todos';
    refrescar();
  });
  el.querySelector('#guardar').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await db.guardarImportacion(imp);
      est.revisiones.shift(); est.abierta = null; est.filtro = 'todos';
      toast('Importación guardada', 'ok');
      refrescar();
    } catch (err) {
      e.currentTarget.disabled = false;
      toast(err.message || 'No se pudo guardar', 'error');
    }
  });
}
