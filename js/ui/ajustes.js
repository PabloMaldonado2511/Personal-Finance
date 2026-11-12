// Pantalla Ajustes.
import * as db from '../core/db.js';
import { esc, confirmar, toast, hoyISO, catPorId } from './util.js';

export async function render(el, { refrescar }) {
  const reglas = await db.listarReglas();
  el.innerHTML = `
    <header class="cab"><h1>Ajustes</h1></header>
    <div class="rejilla-2"><div class="col">
      <section class="panel"><h2>Respaldo</h2>
        <p class="texto-suave">Tus datos viven solo en este navegador. Descarga un respaldo de vez en cuando.</p>
        <div class="acciones acciones-izq">
          <button type="button" class="btn btn-primario" id="exportar">Exportar respaldo</button>
          <label class="btn" for="imp-resp">Importar respaldo</label>
          <input id="imp-resp" class="sr-only" type="file" accept="application/json,.json">
        </div></section>
      <section class="panel"><h2>Privacidad</h2>
        <p class="texto-suave">Los estados de cuenta se leen en tu dispositivo y nunca se suben a ningún servidor. Los datos se guardan en el almacenamiento local del navegador (IndexedDB). Borrar los datos del sitio en Safari los elimina.</p></section>
      <section class="panel peligro"><h2>Zona de peligro</h2>
        <p class="texto-suave">Elimina movimientos, estados, saldos y reglas de este dispositivo.</p>
        <button type="button" class="btn btn-peligro" id="borrar-todo">Borrar todos los datos</button></section>
    </div><div class="col">
      <section class="panel"><h2>Reglas aprendidas</h2>
        ${
          reglas.length
            ? `<ul class="lista">${reglas
                .map(
                  (r) => `<li class="fila"><span class="fila-txt"><strong>${esc(r.comercio)}</strong>
              <small>→ ${esc(catPorId(r.categoria).icono)} ${esc(catPorId(r.categoria).nombre)}</small></span>
              <button type="button" class="btn-icono" data-regla="${esc(r.comercio)}" aria-label="Borrar regla de ${esc(r.comercio)}">🗑</button></li>`
                )
                .join('')}</ul>`
            : '<p class="texto-suave">Cuando cambies la categoría de un comercio y marques «Recordar», aparecerá aquí.</p>'
        }</section></div></div>`;

  el.querySelector('#exportar').addEventListener('click', async () => {
    try {
      const datos = await db.exportarTodo();
      const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finanzas-respaldo-${hoyISO()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Respaldo descargado', 'ok');
    } catch (err) { toast(err.message || 'No se pudo exportar', 'error'); }
  });

  const input = el.querySelector('#imp-resp');
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch { return toast('El archivo no es un respaldo válido (JSON).', 'error'); }
    const ok = await confirmar({
      titulo: 'Importar respaldo',
      mensaje: 'Esto reemplazará TODOS los datos actuales por los del respaldo.',
      textoOk: 'Reemplazar datos',
      peligro: true,
    });
    if (!ok) return;
    try { await db.importarTodo(obj); toast('Respaldo importado', 'ok'); refrescar(); }
    catch (err) { toast(err.message || 'No se pudo importar el respaldo', 'error'); }
  });

  el.querySelectorAll('[data-regla]').forEach((b) =>
    b.addEventListener('click', async () => {
      try { await db.borrarRegla(b.dataset.regla); toast('Regla borrada', 'ok'); refrescar(); }
      catch (err) { toast(err.message || 'No se pudo borrar', 'error'); }
    })
  );

  el.querySelector('#borrar-todo').addEventListener('click', async () => {
    const uno = await confirmar({ titulo: 'Borrar todos los datos', mensaje: 'Se eliminarán movimientos, estados, saldos y reglas. Considera exportar un respaldo antes.', textoOk: 'Continuar', peligro: true });
    if (!uno) return;
    const dos = await confirmar({ titulo: 'Confirmación final', mensaje: 'Esta acción no se puede deshacer.', textoOk: 'Borrar todo', peligro: true, escribir: 'BORRAR' });
    if (!dos) return;
    try { await db.borrarTodo(); toast('Datos borrados', 'ok'); refrescar(); }
    catch (err) { toast(err.message || 'No se pudo borrar', 'error'); }
  });
}
