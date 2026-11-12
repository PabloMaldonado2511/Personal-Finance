// Pantalla Capital.
import * as db from '../core/db.js';
import * as calc from '../core/calc.js';
import { moneda, aCentavos, fechaCorta, mesLargo } from '../core/fmt.js';
import { esc, abrirHoja, confirmar, toast, hoyISO, centavosATexto, crearGrafica, colorTema, abreviar } from './util.js';

const CLASES = { efectivo: 'Efectivo', inversion: 'Inversiones', deuda: 'Deuda de tarjetas' };

function abrirSaldo(s, refrescar) {
  const nuevo = !s;
  const v = s || { clase: 'efectivo', nombre: '', monto: 0, fecha: hoyISO() };
  const h = abrirHoja({
    titulo: nuevo ? 'Nuevo saldo' : 'Editar saldo',
    cuerpo: `<form id="f-saldo" novalidate>
      <label class="campo"><span>Clase</span><select id="s-clase">${Object.entries(CLASES)
        .map(([k, t]) => `<option value="${k}"${k === v.clase ? ' selected' : ''}>${esc(t)}</option>`)
        .join('')}</select></label>
      <label class="campo"><span>Nombre</span><input id="s-nombre" type="text" value="${esc(v.nombre)}" placeholder="Cuenta débito, GBM…" autocomplete="off"></label>
      <label class="campo"><span>Monto</span><input id="s-monto" inputmode="decimal" value="${nuevo ? '' : esc(centavosATexto(v.monto))}" placeholder="0.00"></label>
      <label class="campo"><span>Fecha</span><input id="s-fecha" type="date" value="${esc(v.fecha)}"></label>
      <p class="error-form" id="s-error" role="alert" hidden></p>
      <div class="acciones">${nuevo ? '' : '<button type="button" class="btn btn-peligro" id="s-borrar">Borrar</button>'}
        <button type="submit" class="btn btn-primario">Guardar</button></div></form>`,
  });
  const q = (x) => h.el.querySelector(x);
  const error = (t) => { q('#s-error').textContent = t; q('#s-error').hidden = false; };
  q('#f-saldo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const monto = aCentavos(q('#s-monto').value);
    const nombre = q('#s-nombre').value.trim();
    if (!nombre) return error('Escribe un nombre.');
    if (monto == null || monto < 0) return error('Escribe un monto válido.');
    if (!q('#s-fecha').value) return error('Indica la fecha.');
    try {
      await db.guardarSaldo({ ...v, clase: q('#s-clase').value, nombre, monto, fecha: q('#s-fecha').value });
      h.cerrar();
      toast('Saldo guardado', 'ok');
      refrescar();
    } catch (err) { error(err.message || 'No se pudo guardar.'); }
  });
  const b = q('#s-borrar');
  if (b) {
    b.addEventListener('click', async () => {
      const ok = await confirmar({ titulo: 'Borrar saldo', mensaje: `Se borrará «${v.nombre}» de ${fechaCorta(v.fecha)}.`, textoOk: 'Borrar', peligro: true });
      if (!ok) return;
      try { await db.borrarSaldo(v.id); h.cerrar(); toast('Saldo borrado', 'ok'); refrescar(); }
      catch (err) { error(err.message || 'No se pudo borrar.'); }
    });
  }
}

export async function render(el, { refrescar }) {
  const saldos = await db.listarSaldos();
  const c = calc.capital(saldos);
  const hist = calc.historialCapital(saldos);
  const clase = c.capital > 0 ? 'pos' : c.capital < 0 ? 'neg' : '';
  const grupo = (k) => c.detalle.filter((d) => d.clase === k);

  el.innerHTML = `
    <header class="cab"><h1>Capital</h1>
      <button type="button" class="btn btn-primario" id="nuevo-saldo">Agregar saldo</button></header>
    <section class="hero"><span class="etq">Capital total</span>
      <span class="hero-cifra ${clase}">${moneda(c.capital)}</span>
      <div class="desglose">
        <div><span class="etq">Efectivo</span><strong>${moneda(c.efectivo)}</strong></div>
        <div><span class="etq">Inversiones</span><strong>${moneda(c.inversiones)}</strong></div>
        <div><span class="etq">Deuda de tarjetas</span><strong class="neg">−${moneda(c.deuda)}</strong></div>
      </div>
      <p class="texto-suave">La deuda de tarjetas se actualiza sola al importar estados de cuenta.</p></section>
    <div class="rejilla-2"><div class="col">
      ${Object.entries(CLASES)
        .map(([k, t]) => {
          const g = grupo(k);
          return `<section class="panel"><h2>${esc(t)}</h2>${
            g.length
              ? `<ul class="lista">${g
                  .map(
                    (d) => `<li><button type="button" class="fila fila-enlace" data-saldo="${esc(d.id)}">
                <span class="fila-txt"><strong>${esc(d.nombre)}</strong><small>al ${esc(fechaCorta(d.fecha))}</small></span>
                <span class="fila-monto ${k === 'deuda' ? 'neg' : ''}">${k === 'deuda' ? '−' : ''}${moneda(d.monto)}</span></button></li>`
                  )
                  .join('')}</ul>`
              : '<p class="texto-suave">Sin saldos registrados.</p>'
          }</section>`;
        })
        .join('')}
    </div><div class="col">
      <section class="panel"><h2>Historial de capital</h2>
        ${hist.length ? '<div class="linea"><canvas id="cv-cap" role="img" aria-label="Capital por mes"></canvas></div>' : '<p class="texto-suave">Agrega saldos para ver la evolución.</p>'}
      </section></div></div>`;

  el.querySelector('#nuevo-saldo').addEventListener('click', () => abrirSaldo(null, refrescar));
  el.querySelectorAll('[data-saldo]').forEach((b) =>
    b.addEventListener('click', () => abrirSaldo(saldos.find((s) => s.id === b.dataset.saldo), refrescar))
  );

  return () => {
    const cv = el.querySelector('#cv-cap');
    if (!cv) return;
    crearGrafica('capital', cv, {
      type: 'line',
      data: {
        labels: hist.map((x) => mesLargo(x.mes)),
        datasets: [{
          label: 'Capital', data: hist.map((x) => x.capital), borderColor: colorTema('--acento', '#d9c7a0'),
          backgroundColor: 'transparent', tension: 0.25, pointRadius: 3,
        }],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: (v) => abreviar(v) }, grid: { color: colorTema('--linea', '#2a313c') } },
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => ` ${moneda(x.parsed.y)}` } } },
      },
    });
  };
}
