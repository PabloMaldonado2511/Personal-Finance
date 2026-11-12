// Pantalla Movimientos: lista filtrable, edición y captura manual.
import * as db from '../core/db.js';
import * as calc from '../core/calc.js';
import { categorizar } from '../core/categorias.js';
import { moneda, aCentavos, fechaCorta, mesLargo } from '../core/fmt.js';
import {
  esc, chipCat, opcionesCategoria, opcionesTipo, abrirHoja, toast, hoyISO, centavosATexto, estadoVacio,
} from './util.js';

const filtros = { mes: undefined, categoria: '', cuenta: '', texto: '' };

function monto(m) {
  if (m.tipo === 'pago_tarjeta') return `<span class="fila-monto tenue">${moneda(m.monto)}</span>`;
  const pos = m.tipo === 'ingreso' || m.tipo === 'devolucion';
  return `<span class="fila-monto ${pos ? 'pos' : 'neg'}">${pos ? '+' : '−'}${moneda(m.monto)}</span>`;
}

function htmlLista(movs) {
  if (!movs.length) return '<p class="texto-suave vacio-lista">Ningún movimiento coincide con los filtros.</p>';
  const porDia = new Map();
  for (const m of movs) {
    if (!porDia.has(m.fecha)) porDia.set(m.fecha, []);
    porDia.get(m.fecha).push(m);
  }
  return [...porDia.keys()]
    .sort()
    .reverse()
    .map(
      (dia) => `<section class="dia"><h3>${esc(fechaCorta(dia))}</h3><ul class="lista">${porDia
        .get(dia)
        .map(
          (m) => `<li><button type="button" class="mov${m.tipo === 'pago_tarjeta' ? ' atenuado' : ''}" data-id="${esc(m.id)}">
            <span class="mov-main">
              <strong>${esc(m.comercio || m.descripcion)}</strong>
              ${m.descripcion && m.descripcion !== m.comercio ? `<small class="mov-desc">${esc(m.descripcion)}</small>` : ''}
              <span class="mov-meta"><span class="cuenta">${esc(m.cuenta)}</span>${
                m.tipo === 'pago_tarjeta'
                  ? '<span class="etiqueta">Pago de tarjeta (no cuenta como gasto)</span>'
                  : chipCat(m.categoria)
              }${m.msi ? '<span class="etiqueta">MSI</span>' : ''}${m.tipo === 'devolucion' ? '<span class="etiqueta">Devolución</span>' : ''}</span>
              ${m.nota ? `<small class="mov-nota">${esc(m.nota)}</small>` : ''}
            </span>${monto(m)}</button></li>`
        )
        .join('')}</ul></section>`
    )
    .join('');
}

function consulta() {
  const f = {};
  if (filtros.mes) f.mes = filtros.mes;
  if (filtros.categoria) f.categoria = filtros.categoria;
  if (filtros.cuenta) f.cuenta = filtros.cuenta;
  if (filtros.texto.trim()) f.texto = filtros.texto.trim();
  return f;
}

export async function render(el, { params, refrescar }) {
  if ([...params.keys()].length) {
    filtros.mes = params.get('mes') || '';
    filtros.categoria = params.get('categoria') || '';
    filtros.cuenta = params.get('cuenta') || '';
    filtros.texto = params.get('texto') || '';
  }
  const todos = await db.listarMovimientos();
  const meses = calc.mesesDisponibles(todos);
  if (filtros.mes === undefined) filtros.mes = meses[0] || '';
  const cuentas = [...new Set(todos.map((m) => m.cuenta))].sort();

  el.innerHTML = `
    <header class="cab"><h1>Movimientos</h1></header>
    <form class="filtros" onsubmit="return false" role="search">
      <label class="campo"><span>Mes</span><select id="f-mes"><option value="">Todos</option>${meses
        .map((m) => `<option value="${m}"${m === filtros.mes ? ' selected' : ''}>${esc(mesLargo(m))}</option>`)
        .join('')}</select></label>
      <label class="campo"><span>Categoría</span><select id="f-cat"><option value="">Todas</option>${opcionesCategoria(filtros.categoria)}</select></label>
      <label class="campo"><span>Cuenta</span><select id="f-cuenta"><option value="">Todas</option>${cuentas
        .map((c) => `<option value="${esc(c)}"${c === filtros.cuenta ? ' selected' : ''}>${esc(c)}</option>`)
        .join('')}</select></label>
      <label class="campo campo-texto"><span>Buscar</span><input id="f-texto" type="search" placeholder="Comercio o descripción" value="${esc(filtros.texto)}" autocomplete="off"></label>
    </form>
    <div id="lista-mov"></div>
    <button type="button" class="fab" id="nuevo" aria-label="Agregar movimiento manual">+</button>`;

  let seq = 0;
  const lista = el.querySelector('#lista-mov');
  async function pintarLista() {
    const mia = ++seq;
    const movs = await db.listarMovimientos(consulta());
    if (mia !== seq) return;
    if (!todos.length) {
      lista.innerHTML = estadoVacio({
        icono: '🗂️',
        titulo: 'Sin movimientos todavía',
        texto: 'Importa un estado de cuenta o agrega un ingreso o gasto con el botón «+».',
      });
      return;
    }
    lista.innerHTML = htmlLista(movs);
    lista.querySelectorAll('.mov').forEach((b) =>
      b.addEventListener('click', () => abrirEdicion(movs.find((m) => m.id === b.dataset.id), refrescar))
    );
  }
  el.querySelector('#f-mes').addEventListener('change', (e) => { filtros.mes = e.target.value; pintarLista(); });
  el.querySelector('#f-cat').addEventListener('change', (e) => { filtros.categoria = e.target.value; pintarLista(); });
  el.querySelector('#f-cuenta').addEventListener('change', (e) => { filtros.cuenta = e.target.value; pintarLista(); });
  let t;
  el.querySelector('#f-texto').addEventListener('input', (e) => {
    filtros.texto = e.target.value;
    clearTimeout(t);
    t = setTimeout(pintarLista, 200);
  });
  el.querySelector('#nuevo').addEventListener('click', () => abrirCaptura(refrescar, cuentas));
  await pintarLista();
}

// ---------- Edición ----------
function abrirEdicion(m, refrescar) {
  if (!m) return;
  const h = abrirHoja({
    titulo: 'Editar movimiento',
    cuerpo: `
      <div class="resumen-mov"><strong>${esc(m.comercio || m.descripcion)}</strong>
        <small>${esc(m.descripcion)} · ${esc(m.cuenta)}</small></div>
      <form id="f-edit" novalidate>
        <label class="campo"><span>Categoría</span><select id="e-cat">${opcionesCategoria(m.categoria)}</select></label>
        <label class="casilla"><input type="checkbox" id="e-recordar" checked> Recordar para este comercio</label>
        <div class="dos-col">
          <label class="campo"><span>Tipo</span><select id="e-tipo">${opcionesTipo(m.tipo)}</select></label>
          <label class="campo"><span>Monto</span><input id="e-monto" inputmode="decimal" value="${esc(centavosATexto(m.monto))}"></label>
        </div>
        <label class="campo"><span>Fecha</span><input id="e-fecha" type="date" value="${esc(m.fecha)}"></label>
        <label class="campo"><span>Nota</span><input id="e-nota" type="text" value="${esc(m.nota || '')}" autocomplete="off"></label>
        <p class="error-form" id="e-error" role="alert" hidden></p>
        <div class="acciones">
          <button type="button" class="btn btn-peligro" id="e-borrar">Borrar</button>
          <button type="submit" class="btn btn-primario">Guardar</button>
        </div>
      </form>`,
  });
  const q = (s) => h.el.querySelector(s);
  const error = (t) => { q('#e-error').textContent = t; q('#e-error').hidden = false; };
  const ocultarRecordar = () => {
    q('.casilla').hidden = q('#e-cat').value === m.categoria;
  };
  q('#e-cat').addEventListener('change', ocultarRecordar);
  ocultarRecordar();

  q('#f-edit').addEventListener('submit', async (e) => {
    e.preventDefault();
    const centavos = aCentavos(q('#e-monto').value);
    if (centavos == null || centavos <= 0) return error('Escribe un monto válido mayor a cero.');
    if (!q('#e-fecha').value) return error('Indica la fecha.');
    const tipo = q('#e-tipo').value;
    let categoria = q('#e-cat').value;
    if (tipo === 'ingreso') categoria = 'ingreso';
    try {
      await db.guardarMovimiento({ ...m, tipo, monto: centavos, fecha: q('#e-fecha').value, nota: q('#e-nota').value.trim() });
      if (categoria !== m.categoria) {
        await db.reclasificar(m.id, categoria, { recordar: q('#e-recordar').checked && tipo !== 'ingreso' });
      }
      h.cerrar();
      toast('Movimiento actualizado', 'ok');
      refrescar();
    } catch (err) {
      error(err.message || 'No se pudo guardar.');
    }
  });
  q('#e-borrar').addEventListener('click', () => {
    const b = q('#e-borrar');
    if (!b.dataset.seguro) {
      b.dataset.seguro = '1';
      b.textContent = 'Toca otra vez para borrar';
      return;
    }
    db.borrarMovimiento(m.id)
      .then(() => { h.cerrar(); toast('Movimiento borrado', 'ok'); refrescar(); })
      .catch((err) => error(err.message || 'No se pudo borrar.'));
  });
}

// ---------- Captura manual ----------
function abrirCaptura(refrescar, cuentasExistentes) {
  const base = ['Débito', 'Efectivo'];
  const h = abrirHoja({
    titulo: 'Nuevo movimiento',
    cuerpo: `
      <form id="f-nuevo" novalidate>
        <div class="seg seg-ancho" role="group" aria-label="Tipo">
          <button type="button" data-t="gasto" aria-pressed="true">Gasto</button>
          <button type="button" data-t="ingreso" aria-pressed="false">Ingreso</button>
        </div>
        <label class="campo"><span>Monto</span><input id="n-monto" inputmode="decimal" placeholder="0.00" autocomplete="off"></label>
        <label class="campo"><span>Fecha</span><input id="n-fecha" type="date" value="${hoyISO()}"></label>
        <label class="campo"><span>Descripción</span><input id="n-desc" type="text" placeholder="Renta, sueldo, tianguis…" autocomplete="off"></label>
        <label class="campo" id="n-cat-campo"><span>Categoría</span><select id="n-cat">${opcionesCategoria('', {
          conIngreso: false,
          extra: '<option value="">Automática</option>',
        })}</select></label>
        <label class="campo"><span>Cuenta</span><select id="n-cuenta">${base
          .map((c) => `<option>${esc(c)}</option>`)
          .join('')}<option value="__otra">Otra…</option></select></label>
        <label class="campo" id="n-otra-campo" hidden><span>Nombre de la cuenta</span><input id="n-otra" type="text" autocomplete="off"></label>
        <label class="campo"><span>Nota (opcional)</span><input id="n-nota" type="text" autocomplete="off"></label>
        <p class="error-form" id="n-error" role="alert" hidden></p>
        <div class="acciones"><button type="submit" class="btn btn-primario btn-ancho">Guardar</button></div>
      </form>`,
  });
  const q = (s) => h.el.querySelector(s);
  let tipo = 'gasto';
  const error = (t) => { q('#n-error').textContent = t; q('#n-error').hidden = false; };
  h.el.querySelectorAll('[data-t]').forEach((b) =>
    b.addEventListener('click', () => {
      tipo = b.dataset.t;
      h.el.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      q('#n-cat-campo').hidden = tipo === 'ingreso';
    })
  );
  q('#n-cuenta').addEventListener('change', (e) => {
    q('#n-otra-campo').hidden = e.target.value !== '__otra';
  });
  q('#f-nuevo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const centavos = aCentavos(q('#n-monto').value);
    if (centavos == null || centavos <= 0) return error('Escribe un monto válido mayor a cero.');
    const desc = q('#n-desc').value.trim();
    if (!desc) return error('Escribe una descripción.');
    if (!q('#n-fecha').value) return error('Indica la fecha.');
    let cuenta = q('#n-cuenta').value;
    if (cuenta === '__otra') cuenta = q('#n-otra').value.trim();
    if (!cuenta) return error('Indica el nombre de la cuenta.');
    try {
      let categoria = 'ingreso';
      let comercio = desc;
      if (tipo === 'gasto') {
        categoria = q('#n-cat').value;
        if (!categoria) {
          const r = categorizar(desc, await db.listarReglas());
          categoria = r.categoria;
          comercio = r.comercio || desc;
        }
      }
      await db.guardarMovimiento({
        origen: 'manual', estadoId: null, cuenta, fecha: q('#n-fecha').value, fechaCargo: null,
        descripcion: desc, comercio, categoria, monto: centavos, tipo, msi: false, nota: q('#n-nota').value.trim(),
      });
      h.cerrar();
      toast('Movimiento guardado', 'ok');
      refrescar();
    } catch (err) {
      error(err.message || 'No se pudo guardar.');
    }
  });
}
