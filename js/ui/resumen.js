// Pantalla Resumen.
import * as db from '../core/db.js';
import * as calc from '../core/calc.js';
import { moneda, mesLargo } from '../core/fmt.js';
import { esc, catPorId, chipCat, crearGrafica, colorTema, abreviar, desplazarMes, estadoVacio } from './util.js';

const estado = { mes: null, modo: 'comercio', rango: 'mes' };

function rangoFechas(mes) {
  if (estado.rango === 'mes') return { desde: `${mes}-01`, hasta: `${mes}-31` };
  if (estado.rango === '3m') return { desde: `${desplazarMes(mes, -2)}-01`, hasta: `${mes}-31` };
  return {};
}

function segmentado(nombre, opciones, actual) {
  return `<div class="seg" role="group" aria-label="${esc(nombre)}">${opciones
    .map(([v, t]) => `<button type="button" data-${nombre}="${v}" aria-pressed="${v === actual}">${esc(t)}</button>`)
    .join('')}</div>`;
}

function htmlRecurrentes(movs, mes) {
  const f = rangoFechas(mes);
  let filas;
  if (estado.modo === 'comercio') {
    filas = calc.topRecurrentes(movs, { ...f, limite: 8 }).map((r) => ({
      titulo: r.comercio,
      cat: r.categoria,
      veces: r.veces,
      total: r.total,
      promedio: r.promedio,
    }));
  } else {
    filas = calc.topCategoriasRecurrentes(movs, { ...f, limite: 8 }).map((r) => ({
      titulo: catPorId(r.categoria).nombre,
      cat: r.categoria,
      veces: r.veces,
      total: r.total,
      promedio: r.veces ? Math.round(r.total / r.veces) : 0,
    }));
  }
  if (!filas.length) return '<p class="texto-suave">Sin gastos en este rango.</p>';
  return `<ul class="lista">${filas
    .map(
      (r) => `<li class="fila">
      <span class="fila-ico" style="--c:${esc(catPorId(r.cat).color)}" aria-hidden="true">${esc(catPorId(r.cat).icono)}</span>
      <span class="fila-txt"><strong>${esc(r.titulo)}</strong>
        <small>${r.veces} ${r.veces === 1 ? 'vez' : 'veces'} · prom. ${moneda(r.promedio)}</small></span>
      <span class="fila-monto">${moneda(r.total)}</span></li>`
    )
    .join('')}</ul>`;
}

export async function render(el, { refrescar }) {
  const movs = await db.listarMovimientos();
  const saldos = await db.listarSaldos();
  const cap = saldos.length ? calc.capital(saldos) : null;
  const meses = calc.mesesDisponibles(movs);
  if (!meses.length) {
    el.innerHTML = `<header class="cab"><h1>Resumen</h1></header>${estadoVacio({
      icono: '🧾',
      titulo: 'Aún no hay movimientos',
      texto: 'Importa tu primer estado de cuenta en PDF y aquí verás a dónde se va tu dinero. También puedes capturar movimientos a mano.',
      boton: { href: '#importar', texto: 'Importar un PDF' },
    })}`;
    return;
  }
  if (!estado.mes || !meses.includes(estado.mes)) estado.mes = meses[0];
  const mes = estado.mes;
  const i = meses.indexOf(mes);
  const er = calc.estadoResultados(movs, mes);
  const tasa = er.tasaAhorro == null ? '—' : `${Math.round(er.tasaAhorro * 100)}%`;
  const claseRes = er.resultado > 0 ? 'pos' : er.resultado < 0 ? 'neg' : '';

  el.innerHTML = `
    <header class="cab"><h1>Resumen</h1>
      <div class="selector-mes">
        <button type="button" class="btn-icono" data-mes-ant aria-label="Mes anterior"${i === meses.length - 1 ? ' disabled' : ''}>‹</button>
        <label class="sr-only" for="sel-mes">Mes</label>
        <select id="sel-mes">${meses.map((m) => `<option value="${m}"${m === mes ? ' selected' : ''}>${esc(mesLargo(m))}</option>`).join('')}</select>
        <button type="button" class="btn-icono" data-mes-sig aria-label="Mes siguiente"${i === 0 ? ' disabled' : ''}>›</button>
      </div></header>
    <div class="rejilla-2">
      <div class="col">
        ${
          cap
            ? `<section class="tarjetas" aria-label="Capital">
          <a class="tarjeta tarjeta-enlace" href="#capital"><span class="etq">Capital</span><span class="cifra ${cap.capital < 0 ? 'neg' : ''}">${moneda(cap.capital)}</span></a>
          ${cap.negocio > 0 ? `<a class="tarjeta tarjeta-enlace tarjeta-chica" href="#capital"><span class="etq">Negocio</span><span class="cifra">${moneda(cap.negocio)}</span><small class="texto-suave">aparte de tu capital</small></a>` : ''}
        </section>`
            : ''
        }
        <section class="tarjetas" aria-label="Resumen del mes">
          <div class="tarjeta"><span class="etq">Ingresos</span><span class="cifra pos">${moneda(er.ingresos)}</span></div>
          <div class="tarjeta"><span class="etq">Gastos</span><span class="cifra neg">${moneda(er.gastos)}</span></div>
          <div class="tarjeta"><span class="etq">Resultado</span><span class="cifra ${claseRes}">${moneda(er.resultado)}</span></div>
          <div class="tarjeta"><span class="etq">Tasa de ahorro</span><span class="cifra ${claseRes}">${tasa}</span></div>
        </section>
        <section class="panel"><h2>Gastos por categoría</h2>
          ${
            er.porCategoria.length
              ? `<div class="dona"><canvas id="cv-dona" role="img" aria-label="Gastos por categoría"></canvas></div>
            <ul class="lista">${er.porCategoria
              .map((c) => {
                const k = catPorId(c.categoria);
                return `<li><a class="fila fila-enlace" href="#movimientos?mes=${esc(mes)}&amp;categoria=${esc(c.categoria)}">
                  <span class="fila-ico" style="--c:${esc(k.color)}" aria-hidden="true">${esc(k.icono)}</span>
                  <span class="fila-txt"><strong>${esc(k.nombre)}</strong><small>${Math.round(c.porcentaje * 100)}% · ${c.n} mov.</small></span>
                  <span class="fila-monto">${moneda(c.total)}</span></a></li>`;
              })
              .join('')}</ul>`
              : '<p class="texto-suave">Sin gastos este mes.</p>'
          }
        </section>
      </div>
      <div class="col">
        <section class="panel"><h2>Gastos más recurrentes</h2>
          <div class="barra-seg">
            ${segmentado('modo', [['comercio', 'Por comercio'], ['categoria', 'Por categoría']], estado.modo)}
            ${segmentado('rango', [['mes', 'Este mes'], ['3m', 'Últimos 3 meses'], ['todo', 'Todo']], estado.rango)}
          </div>
          <div id="recurrentes">${htmlRecurrentes(movs, mes)}</div>
        </section>
        <section class="panel"><h2>Tendencia, últimos 6 meses</h2>
          <div class="barras"><canvas id="cv-tend" role="img" aria-label="Ingresos contra gastos por mes"></canvas></div>
        </section>
      </div>
    </div>`;

  const repintar = refrescar;
  el.querySelector('#sel-mes').addEventListener('change', (e) => {
    estado.mes = e.target.value;
    repintar();
  });
  el.querySelector('[data-mes-sig]').addEventListener('click', () => {
    estado.mes = meses[i - 1];
    repintar();
  });
  el.querySelector('[data-mes-ant]').addEventListener('click', () => {
    estado.mes = meses[i + 1];
    repintar();
  });
  el.querySelectorAll('[data-modo]').forEach((b) =>
    b.addEventListener('click', () => {
      estado.modo = b.dataset.modo;
      repintar();
    })
  );
  el.querySelectorAll('[data-rango]').forEach((b) =>
    b.addEventListener('click', () => {
      estado.rango = b.dataset.rango;
      repintar();
    })
  );

  // app.js ejecuta lo devuelto cuando el elemento ya está en el DOM.
  return () => dibujar(el, er, movs);
}

function dibujar(el, er, movs) {
  const cvDona = el.querySelector('#cv-dona');
  if (cvDona) {
    crearGrafica('dona', cvDona, {
      type: 'doughnut',
      data: {
        labels: er.porCategoria.map((c) => catPorId(c.categoria).nombre),
        datasets: [
          {
            data: er.porCategoria.map((c) => c.total),
            backgroundColor: er.porCategoria.map((c) => catPorId(c.categoria).color),
            borderColor: colorTema('--superficie', '#161b22'),
            borderWidth: 2,
          },
        ],
      },
      options: {
        cutout: '66%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.label}: ${moneda(c.parsed)}` } },
        },
      },
    });
  }
  const cvT = el.querySelector('#cv-tend');
  if (cvT) {
    const t = calc.tendencia(movs, 6);
    crearGrafica('tendencia', cvT, {
      type: 'bar',
      data: {
        labels: t.map((x) => mesLargo(x.mes).split(' ')[0].slice(0, 3)),
        datasets: [
          { label: 'Ingresos', data: t.map((x) => x.ingresos), backgroundColor: colorTema('--pos', '#4cc38a'), borderRadius: 4 },
          { label: 'Gastos', data: t.map((x) => x.gastos), backgroundColor: colorTema('--neg', '#f0616d'), borderRadius: 4 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: (v) => abreviar(v) }, grid: { color: colorTema('--linea', '#2a313c') } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${moneda(c.parsed.y)}` } },
        },
      },
    });
  }
}
