// Persistencia en IndexedDB (API nativa, sin librerías).
// Las operaciones dentro de una transacción usan callbacks (no await) para que
// la transacción no se cierre antes de tiempo en Safari.

import { mesDe } from './fmt.js';
import { clave } from './categorias.js';

const NOMBRE_BD = 'finanzas-personales';
const VERSION_BD = 1;
const STORES = ['movimientos', 'estados', 'reglas', 'saldos'];

let conexion = null;   // Promise<IDBDatabase>

// ---------- utilidades ----------

/** Id único: crypto.randomUUID con respaldo. */
function nuevoId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** IDBRequest → Promise. */
function pedir(req) {
  return new Promise((ok, mal) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  });
}

/** Promise que se resuelve al completar la transacción. */
function terminada(tx) {
  return new Promise((ok, mal) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => mal(tx.error);
    tx.onabort = () => mal(tx.error || new Error('Transacción abortada'));
  });
}

/** Normaliza para búsqueda: minúsculas y sin acentos. */
function sinAcentos(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Borra con cursor todos los movimientos de un estado; llama a fin() al acabar. */
function borrarMovsDeEstado(storeMovs, estadoId, fin) {
  const req = storeMovs.index('estadoId').openCursor(IDBKeyRange.only(estadoId));
  req.onsuccess = () => {
    const cur = req.result;
    if (cur) { cur.delete(); cur.continue(); }
    else if (fin) fin();
  };
}

/** Abre la BD y crea la transacción en el mismo paso (las peticiones se hacen enseguida). */
async function tx(stores, modo = 'readonly') {
  return (await abrir()).transaction(stores, modo);
}

// ---------- apertura ----------

export function abrir() {
  if (conexion) return conexion;
  conexion = new Promise((ok, mal) => {
    if (!globalThis.indexedDB) { mal(new Error('Este navegador no soporta IndexedDB')); return; }
    const req = indexedDB.open(NOMBRE_BD, VERSION_BD);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('movimientos')) {
        const s = db.createObjectStore('movimientos', { keyPath: 'id' });
        s.createIndex('fecha', 'fecha');
        s.createIndex('estadoId', 'estadoId');
      }
      if (!db.objectStoreNames.contains('estados')) db.createObjectStore('estados', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('reglas')) db.createObjectStore('reglas', { keyPath: 'comercio' });
      if (!db.objectStoreNames.contains('saldos')) db.createObjectStore('saldos', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); conexion = null; };
      ok(db);
    };
    req.onerror = () => { conexion = null; mal(req.error); };
    req.onblocked = () => { conexion = null; mal(new Error('Cierra otras pestañas de la app e intenta de nuevo')); };
  });
  return conexion;
}

// ---------- movimientos ----------

/** filtro: { mes, desde, hasta, categoria, cuenta, tipo, texto } → Movimiento[] por fecha desc. */
export async function listarMovimientos(filtro = {}) {
  const { mes, desde, hasta, categoria, cuenta, tipo, texto } = filtro || {};
  // Rango por índice de fecha ('~' es mayor que cualquier dígito: cubre todo el mes/día)
  let lo = desde || null, hi = hasta ? hasta + '~' : null;
  if (mes) {
    if (!lo || lo < mes) lo = mes;
    if (!hi || hi > mes + '~') hi = mes + '~';
  }
  let rango = null;
  if (lo && hi) { if (lo > hi) return []; rango = IDBKeyRange.bound(lo, hi); }
  else if (lo) rango = IDBKeyRange.lowerBound(lo);
  else if (hi) rango = IDBKeyRange.upperBound(hi);

  const t = await tx('movimientos');
  let movs = await pedir(t.objectStore('movimientos').index('fecha').getAll(rango));

  if (mes) movs = movs.filter(m => mesDe(m.fecha) === mes);
  if (categoria) movs = movs.filter(m => m.categoria === categoria);
  if (cuenta) movs = movs.filter(m => m.cuenta === cuenta);
  if (tipo) movs = movs.filter(m => m.tipo === tipo);
  if (texto && texto.trim()) {
    const q = sinAcentos(texto.trim());
    movs = movs.filter(m => sinAcentos(m.descripcion).includes(q) || sinAcentos(m.comercio).includes(q));
  }
  // Fecha desc; desempate estable por id
  return movs.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : String(a.id).localeCompare(String(b.id))));
}

/** Crea o actualiza; genera id si falta. Devuelve el movimiento guardado. */
export async function guardarMovimiento(mov) {
  const m = { ...mov, id: mov.id || nuevoId() };
  if (m.origen === undefined) m.origen = 'manual';
  if (m.estadoId === undefined) m.estadoId = null;
  const t = await tx('movimientos', 'readwrite');
  t.objectStore('movimientos').put(m);
  await terminada(t);
  return m;
}

export async function borrarMovimiento(id) {
  const t = await tx('movimientos', 'readwrite');
  t.objectStore('movimientos').delete(id);
  await terminada(t);
}

/**
 * Cambia la categoría de un movimiento. Si recordar, guarda la Regla
 * { comercio, categoria } y la aplica a todos los movimientos del mismo comercio.
 * Devuelve { movimiento, actualizados } (actualizados incluye al propio movimiento).
 */
export async function reclasificar(id, categoria, { recordar = true } = {}) {
  const t = await tx(['movimientos', 'reglas'], 'readwrite');
  const movs = t.objectStore('movimientos');
  let movimiento = null, actualizados = 0, error = null;

  const req = movs.get(id);
  req.onsuccess = () => {
    movimiento = req.result;
    if (!movimiento) { error = new Error('Movimiento no encontrado'); t.abort(); return; }
    movimiento.categoria = categoria;
    movs.put(movimiento);
    actualizados = 1;
    if (!recordar || !movimiento.comercio) return;

    t.objectStore('reglas').put({ comercio: movimiento.comercio, categoria });
    const k = clave(movimiento.comercio);
    const cur = movs.openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      const m = c.value;
      if (m.id !== id && clave(m.comercio) === k && m.categoria !== categoria) {
        m.categoria = categoria;
        c.update(m);
        actualizados++;
      }
      c.continue();
    };
  };

  try { await terminada(t); } catch (e) { throw error || e; }
  return { movimiento, actualizados };
}

// ---------- estados de cuenta ----------

/** Estados ordenados por fecha de corte desc. */
export async function listarEstados() {
  const t = await tx('estados');
  const lista = await pedir(t.objectStore('estados').getAll());
  return lista.sort((a, b) => String(b.fechaCorte).localeCompare(String(a.fechaCorte)));
}

export async function existeEstado(id) {
  const t = await tx('estados');
  return (await pedir(t.objectStore('estados').count(id))) > 0;
}

/**
 * Guarda estado + movimientos en una sola transacción. Si el estado ya existía,
 * primero borra sus movimientos. Registra el Saldo de deuda 'deuda-<estadoId>'.
 * Devuelve { estadoId, movimientos } (número de movimientos guardados).
 */
export async function guardarImportacion(importacion) {
  const estado = importacion && importacion.estado;
  if (!estado || !estado.id) throw new Error('Importación sin estado de cuenta');
  const est = { ...estado, importadoEl: estado.importadoEl || new Date().toISOString() };
  const nuevos = (importacion.movimientos || []).map(m => ({
    ...m,
    id: m.id || nuevoId(),
    origen: m.origen || 'pdf',
    estadoId: est.id,
    cuenta: m.cuenta || est.cuenta,
  }));

  const t = await tx(['movimientos', 'estados', 'saldos'], 'readwrite');
  const storeMovs = t.objectStore('movimientos');
  t.objectStore('estados').put(est);
  t.objectStore('saldos').put({
    id: 'deuda-' + est.id,
    fecha: est.fechaCorte,
    clase: 'deuda',
    nombre: est.cuenta,
    monto: est.saldoDeudorTotal,
  });
  // Inserta solo cuando el cursor terminó de borrar (si no, borraría los nuevos)
  borrarMovsDeEstado(storeMovs, est.id, () => {
    for (const m of nuevos) storeMovs.put(m);
  });
  await terminada(t);
  return { estadoId: est.id, movimientos: nuevos.length };
}

/** Borra el estado, sus movimientos y su saldo de deuda. */
export async function borrarEstado(id) {
  const t = await tx(['movimientos', 'estados', 'saldos'], 'readwrite');
  t.objectStore('estados').delete(id);
  t.objectStore('saldos').delete('deuda-' + id);
  borrarMovsDeEstado(t.objectStore('movimientos'), id);
  await terminada(t);
}

// ---------- reglas ----------

export async function listarReglas() {
  const t = await tx('reglas');
  const lista = await pedir(t.objectStore('reglas').getAll());
  return lista.sort((a, b) => String(a.comercio).localeCompare(String(b.comercio)));
}

export async function borrarRegla(comercio) {
  const t = await tx('reglas', 'readwrite');
  t.objectStore('reglas').delete(comercio);
  await terminada(t);
}

// ---------- saldos ----------

/** Saldos por fecha desc. */
export async function listarSaldos() {
  const t = await tx('saldos');
  const lista = await pedir(t.objectStore('saldos').getAll());
  return lista.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

/** Crea o actualiza; genera id si falta. Devuelve el saldo guardado. */
export async function guardarSaldo(saldo) {
  const s = { ...saldo, id: saldo.id || nuevoId() };
  const t = await tx('saldos', 'readwrite');
  t.objectStore('saldos').put(s);
  await terminada(t);
  return s;
}

export async function borrarSaldo(id) {
  const t = await tx('saldos', 'readwrite');
  t.objectStore('saldos').delete(id);
  await terminada(t);
}

// ---------- respaldo ----------

/** → { version: 1, exportadoEl, movimientos, estados, reglas, saldos } */
export async function exportarTodo() {
  const t = await tx(STORES);
  const [movimientos, estados, reglas, saldos] = await Promise.all(
    STORES.map(s => pedir(t.objectStore(s).getAll())));
  return { version: 1, exportadoEl: new Date().toISOString(), movimientos, estados, reglas, saldos };
}

/** Valida la forma del respaldo; lanza Error legible si no es válido. */
function validarRespaldo(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('El archivo no es un respaldo válido');
  if (obj.version !== 1) throw new Error(`Versión de respaldo no soportada: ${obj.version}`);
  for (const s of STORES) {
    if (!Array.isArray(obj[s])) throw new Error(`Respaldo inválido: falta la lista «${s}»`);
  }
  const conId = (lista, nombre) => lista.forEach((x, i) => {
    if (!x || typeof x !== 'object' || x.id === undefined || x.id === null || x.id === '') {
      throw new Error(`Respaldo inválido: ${nombre} #${i + 1} sin id`);
    }
  });
  conId(obj.movimientos, 'movimiento');
  conId(obj.estados, 'estado');
  conId(obj.saldos, 'saldo');
  obj.reglas.forEach((r, i) => {
    if (!r || typeof r.comercio !== 'string' || !r.comercio) throw new Error(`Respaldo inválido: regla #${i + 1} sin comercio`);
  });
  obj.movimientos.forEach((m, i) => {
    if (!Number.isInteger(m.monto) || typeof m.fecha !== 'string') {
      throw new Error(`Respaldo inválido: movimiento #${i + 1} con monto o fecha incorrectos`);
    }
  });
  obj.saldos.forEach((s, i) => {
    if (!Number.isInteger(s.monto) || typeof s.fecha !== 'string') {
      throw new Error(`Respaldo inválido: saldo #${i + 1} con monto o fecha incorrectos`);
    }
  });
}

/** Reemplaza todo el contenido por el del respaldo, en una sola transacción. */
export async function importarTodo(obj) {
  validarRespaldo(obj);
  const t = await tx(STORES, 'readwrite');
  for (const s of STORES) {
    const store = t.objectStore(s);
    store.clear();
    for (const x of obj[s]) store.put(x);
  }
  await terminada(t);
  return Object.fromEntries(STORES.map(s => [s, obj[s].length]));
}

export async function borrarTodo() {
  const t = await tx(STORES, 'readwrite');
  for (const s of STORES) t.objectStore(s).clear();
  await terminada(t);
}
