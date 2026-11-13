// Pantalla Importar: PDF y screenshots → revisión → guardar.
import * as db from '../core/db.js';
import { importarPdf, importarCapturas, guardarCapturas } from '../core/importar.js';
import { moneda, aCentavos, fechaCorta } from '../core/fmt.js';
import { esc, chipCat, catPorId, opcionesCategoria, opcionesTipo, toast, confirmar, centavosATexto } from './util.js';

// Estado del módulo: sobrevive a cambios de pestaña mientras se procesa.
const est = {
  procesando: false,
  progreso: null, // { archivo, i, n, etapa, pagina, total, fraccion }
  revisiones: [], // Importacion | ImportacionSaldos pendientes de confirmar
  errores: [], // { archivo, mensaje }
  filtro: 'todos', // 'todos' | 'otros'
  abierta: null, // índice de la fila desplegada
  refrescar: null,
};


function textoProgreso() {
  const p = est.progreso;
  if (!p) return '';
  if (p.modo === 'img') return `Leyendo imagen ${p.pagina || 1} de ${p.total || p.nImg}`;
  const etapa = p.etapa || 'Procesando';
  const pag = p.pagina > 0 && p.total ? ` · página ${p.pagina} de ${p.total}` : '';
  const arch = p.n > 1 && p.modo !== 'img' ? `Archivo ${p.i} de ${p.n}: ` : '';
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

const esImagen = (f) => (f.type || '').startsWith('image/') || /\.(png|jpe?g|heic|heif|webp)$/i.test(f.name || '');

async function procesar(archivos) {
  const imagenes = archivos.filter(esImagen);
  const pdfs = archivos.filter((f) => !esImagen(f));
  est.procesando = true;
  est.errores = [];
  est.refrescar();
  for (let i = 0; i < pdfs.length; i++) {
    const f = pdfs[i];
    est.progreso = { archivo: f.name, i: i + 1, n: pdfs.length, etapa: 'Preparando lector', fraccion: 0 };
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
  if (imagenes.length) {
    est.progreso = { modo: 'img', nImg: imagenes.length, pagina: 1, total: imagenes.length, fraccion: 0 };
    pintarProgreso();
    try {
      const res = await importarCapturas(imagenes, (p) => {
        est.progreso = { ...est.progreso, ...p, modo: 'img' };
        pintarProgreso();
      });
      est.revisiones.push({ ...res, tipo: 'saldos' });
    } catch (err) {
      console.error(err);
      est.errores.push({ archivo: 'Screenshots', mensaje: err && err.message ? err.message : String(err) });
    }
  }
  est.procesando = false;
  est.progreso = null;
  est.refrescar();
}

const esSinClasificar = (m) => m.categoria === 'otros' && m.tipo !== 'traspaso' && m.tipo !== 'ingreso';

/** Ajusta la categoría cuando cambia el tipo. */
function aplicarTipo(m, tipo) {
  m.tipo = tipo;
  if (tipo === 'ingreso') m.categoria = 'ingreso';
  else if (tipo === 'traspaso') m.categoria = 'traspaso';
  else if (tipo === 'gasto' && (m.categoria === 'ingreso' || m.categoria === 'traspaso')) m.categoria = 'otros';
}

function htmlFila(m, i) {
  const k = catPorId(m.categoria);
  const sinClas = esSinClasificar(m);
  const pos = m.tipo === 'ingreso' || m.tipo === 'devolucion';
  const montoHtml =
    m.tipo === 'pago_tarjeta' || m.tipo === 'traspaso'
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
    .filter(({ m }) => est.filtro !== 'otros' || esSinClasificar(m))
    .map(({ m, i }) => htmlFila(m, i))
    .join('');
  return filas || '<li class="texto-suave rev-vacio">No hay movimientos para mostrar.</li>';
}

function htmlFiltro(imp) {
  const n = imp.movimientos.filter(esSinClasificar).length;
  return `<div class="seg" role="group" aria-label="Filtro de movimientos">
    <button type="button" data-filtro="todos" aria-pressed="${est.filtro === 'todos'}">Todos</button>
    <button type="button" data-filtro="otros" aria-pressed="${est.filtro === 'otros'}">Sin clasificar (${n})</button></div>`;
}

function htmlRevision(imp) {
  const e = imp.estado;
  const v = imp.validacion;
  const debito = e.tipoCuenta === 'debito';
  const periodo = `${esc(fechaCorta(e.periodoInicio))} – ${esc(fechaCorta(e.periodoFin))}`;
  const datos = debito
    ? [['Producto', esc(e.producto)], ['Cuenta', esc(e.cuenta)], ['Periodo', periodo], ['Saldo inicial', moneda(e.saldoInicial)], ['Saldo final', moneda(e.saldoFinal)]]
    : [
        ['Producto', esc(e.producto)], ['Cuenta', esc(e.cuenta)], ['Periodo', periodo],
        ['Fecha de corte', esc(fechaCorta(e.fechaCorte))], ['Fecha límite de pago', esc(fechaCorta(e.fechaLimitePago))],
        ['Pago para no generar intereses', moneda(e.pagoNoIntereses)],
      ];
  const [nCargos, nAbonos] = debito ? ['Retiros', 'Depósitos'] : ['Cargos', 'Abonos'];
  return `<section class="panel revision" aria-label="Revisión de importación">
    <h2>Revisa antes de guardar${est.revisiones.length > 1 ? ` <small>(${est.revisiones.length} pendientes)</small>` : ''}</h2>
    <dl class="datos">${datos.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>
    <div class="aviso ${v.cuadra ? 'aviso-ok' : 'aviso-warn'}" role="status">
      <strong>${v.cuadra ? '✓ Cuadra con el PDF' : '⚠ No cuadra'}</strong>
      <table class="tabla-val">
        <thead><tr><th></th><th>Leído</th><th>Impreso</th><th>Dif.</th></tr></thead>
        <tbody>
          <tr><th>${nCargos}</th><td>${moneda(v.totalCargosLeidos)}</td><td>${moneda(v.totalCargosPdf)}</td><td>${moneda(v.totalCargosLeidos - v.totalCargosPdf)}</td></tr>
          <tr><th>${nAbonos}</th><td>${moneda(v.totalAbonosLeidos)}</td><td>${moneda(v.totalAbonosPdf)}</td><td>${moneda(v.totalAbonosLeidos - v.totalAbonosPdf)}</td></tr>
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

const CLASES_SALDO = { efectivo: 'Efectivo', inversion: 'Inversión', negocio: 'Negocio (no cuenta en tu capital)', deuda: 'Deuda' };

function htmlSaldo(sd, i) {
  const val = sd.validacion;
  const chip =
    val && val.cuadra === true
      ? `<span class="chip chip-ok">Cuadra</span>`
      : val && val.cuadra === false
        ? `<span class="chip chip-warn">Revisar</span>`
        : '';
  const pos = Array.isArray(sd.posiciones) ? sd.posiciones : [];
  return `<li class="saldo-card" data-s="${i}">
    <div class="saldo-cab"><span><strong>${esc(sd.etiquetaFuente || sd.nombre)}</strong>
      <small class="mov-desc">${esc((sd.archivos || []).join(', '))}</small></span>
      <button type="button" class="btn-icono" data-s-quitar="${i}" aria-label="Quitar este saldo">🗑</button></div>
    ${chip ? `<div class="saldo-val">${chip}${val.mensaje ? `<small>${esc(val.mensaje)}</small>` : ''}</div>` : ''}
    ${(sd.avisos || []).length ? `<ul class="avisos">${sd.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="rev-campos saldo-campos">
      <label class="campo"><span>Nombre</span><input data-s-nombre="${i}" type="text" value="${esc(sd.nombre)}" autocomplete="off"></label>
      <label class="campo"><span>Clase</span><select data-s-clase="${i}">${Object.entries(CLASES_SALDO)
        .map(([k, t]) => `<option value="${k}"${k === sd.clase ? ' selected' : ''}>${esc(t)}</option>`)
        .join('')}</select></label>
      <label class="campo"><span>Monto</span><input data-s-monto="${i}" inputmode="decimal" value="${esc(centavosATexto(sd.monto))}"></label>
      <label class="campo"><span>Fecha</span><input data-s-fecha="${i}" type="date" value="${esc(sd.fecha)}"></label>
    </div>
    ${
      pos.length
        ? `<details class="posiciones"><summary>Ver posiciones (${pos.length})</summary><ul class="lista">${pos
            .map(
              (x) => `<li class="fila"><span class="fila-txt"><strong>${esc(x.nombre)}</strong>
              <small>${esc(x.titulos)} títulos</small></span><span class="fila-monto">${moneda(x.monto)}</span></li>`
            )
            .join('')}</ul></details>`
        : ''
    }</li>`;
}

function htmlNoReconocidas(imp) {
  const nr = imp.noReconocidas || [];
  if (!nr.length) return '';
  return `<div class="aviso aviso-warn"><strong>No reconocí estas imágenes</strong>
    <ul class="avisos">${nr.map((x) => `<li><strong>${esc(x.archivo)}</strong>: ${esc(x.motivo)}</li>`).join('')}</ul></div>`;
}

function htmlSaldos(imp) {
  if (!imp.saldos.length) {
    return `<section class="panel revision sin-barra"><h2>Screenshots</h2>${htmlNoReconocidas(imp) || '<p class="texto-suave">No se encontró ningún saldo.</p>'}
      <div class="acciones"><button type="button" class="btn btn-primario" id="entendido">Entendido</button></div></section>`;
  }
  return `<section class="panel revision" aria-label="Revisión de saldos">
    <h2>Saldos detectados (${imp.saldos.length})${est.revisiones.length > 1 ? ` <small>(${est.revisiones.length} pendientes)</small>` : ''}</h2>
    <ul class="lista saldos-lista">${imp.saldos.map(htmlSaldo).join('')}</ul>
    ${htmlNoReconocidas(imp)}
    <div class="barra-fija"><div class="barra-fija-in">
      <button type="button" class="btn" id="descartar">Descartar</button>
      <button type="button" class="btn btn-primario" id="guardar">Guardar</button>
    </div></div></section>`;
}

function enlazarSaldos(el, imp, refrescar) {
  const saldos = imp.saldos;
  const sacar = () => { est.revisiones.shift(); };
  el.querySelector('#entendido')?.addEventListener('click', () => { sacar(); refrescar(); });
  el.querySelectorAll('[data-s-quitar]').forEach((b) =>
    b.addEventListener('click', () => { saldos.splice(+b.dataset.sQuitar, 1); refrescar(); })
  );
  el.querySelectorAll('.saldo-card').forEach((card) => {
    const i = +card.dataset.s;
    card.querySelector('[data-s-nombre]').addEventListener('change', (e) => { saldos[i].nombre = e.target.value.trim(); });
    card.querySelector('[data-s-clase]').addEventListener('change', (e) => { saldos[i].clase = e.target.value; });
    card.querySelector('[data-s-fecha]').addEventListener('change', (e) => { if (e.target.value) saldos[i].fecha = e.target.value; });
    card.querySelector('[data-s-monto]').addEventListener('change', (e) => {
      const c = aCentavos(e.target.value);
      if (c == null || c < 0) {
        toast('Monto inválido', 'error');
        e.target.value = centavosATexto(saldos[i].monto);
        return;
      }
      saldos[i].monto = c;
      e.target.value = centavosATexto(c);
    });
  });
  el.querySelector('#descartar')?.addEventListener('click', async () => {
    const ok = await confirmar({ titulo: 'Descartar saldos', mensaje: 'No se guardará nada de estos screenshots.', textoOk: 'Descartar', peligro: true });
    if (!ok) return;
    sacar();
    refrescar();
  });
  el.querySelector('#guardar')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (saldos.some((x) => !x.nombre)) return toast('Todos los saldos necesitan nombre.', 'error');
    btn.disabled = true;
    try {
      await guardarCapturas(saldos);
      sacar();
      toast('Saldos guardados', 'ok');
      refrescar();
    } catch (err) {
      btn.disabled = false;
      toast(err.message || 'No se pudo guardar', 'error');
    }
  });
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
            <p class="texto-suave">Leer un PDF o una imagen toma varios segundos. Puedes cambiar de pestaña; el proceso continúa.</p></section>`
        : `<section class="panel zona">
            <label class="zona-pdf" for="pdf">
              <span class="zona-ico" aria-hidden="true">📄</span>
              <strong>Elegir PDFs o screenshots</strong>
              <small>PDF: tarjetas de crédito y cuenta de débito Santander · Screenshots: GBM, DiDi Cuenta, Nu Cajita, Cetesdirecto</small>
            </label>
            <input id="pdf" class="sr-only" type="file" accept="application/pdf,image/*" multiple>
            <p class="privacidad">🔒 Los archivos se procesan en tu dispositivo y no se suben a ningún servidor.</p></section>`
    }
    ${est.errores.map((x) => `<div class="aviso aviso-error" role="alert"><strong>No se pudo leer ${esc(x.archivo)}</strong><p>${esc(x.mensaje)}</p></div>`).join('')}
    ${imp ? (imp.tipo === 'saldos' ? htmlSaldos(imp) : htmlRevision(imp)) : ''}
    <section class="panel"><h2>Estados importados</h2>
      ${
        estados.length
          ? `<ul class="lista">${estados
              .map(
                (s) => `<li class="fila"><span class="fila-txt"><strong>${esc(s.cuenta)}</strong>
                <small>${esc(s.producto)} · corte ${esc(fechaCorta(s.fechaCorte))}</small></span>
                <span class="fila-monto">${moneda(s.tipoCuenta === 'debito' ? s.saldoFinal : s.saldoDeudorTotal)}</span>
                <button type="button" class="btn-icono" data-borrar-estado="${esc(s.id)}" aria-label="Borrar estado ${esc(s.cuenta)} ${esc(s.fechaCorte)}">🗑</button></li>`
              )
              .join('')}</ul>`
          : '<p class="texto-suave">Todavía no has importado ningún estado.</p>'
      }
    </section>`;

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
  if (imp.tipo === 'saldos') return enlazarSaldos(el, imp, refrescar);
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
    else if (t.dataset.tipo !== undefined) {
      aplicarTipo(mov[+t.dataset.tipo], t.value);
      repintar();
      return;
    }
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
    if (est.filtro === 'otros' && t.dataset.cat !== undefined && !esSinClasificar(mov[i])) { est.abierta = null; repintar(); }
    else if (fila) {
      const nueva = document.createElement('div');
      nueva.innerHTML = htmlFila(mov[i], i);
      fila.querySelector('.rev-resumen').replaceWith(nueva.querySelector('.rev-resumen'));
      fila.classList.toggle('sin-clasificar', esSinClasificar(mov[i]));
      el.querySelector('#rev-filtro').innerHTML = htmlFiltro(imp);
      enlazarFiltro();
    }
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
