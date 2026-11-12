import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIAS, normalizarComercio, categorizar } from '../js/core/categorias.js';

test('catálogo: ids únicos, sin acentos, incluye otros e ingreso', () => {
  const ids = CATEGORIAS.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('otros') && ids.includes('ingreso'));
  for (const c of CATEGORIAS) {
    assert.match(c.id, /^[a-z_]+$/);
    assert.match(c.color, /^#[0-9a-f]{6}$/i);
    assert.ok(c.nombre && c.icono);
  }
  assert.ok(CATEGORIAS.length >= 14 && CATEGORIAS.length <= 17);
});

// Descripciones sintéticas con el formato de un estado de cuenta.
const CASOS = [
  ['7 ELEVEN REAL CUMBRES', '7-Eleven', 'conveniencia'],
  ['7ELEVEN T2666 AYUCCA', '7-Eleven', 'conveniencia'],
  ['OXXO MEXICO', 'Oxxo', 'conveniencia'],
  ['3745 OXXO GAS MITRAS NORT', 'Oxxo Gas', 'gasolina'],
  ['PETRO7 GAS PASEO DE CU', 'Petro 7', 'gasolina'],
  ['RAPPI RAPPI MEXICO', 'Rappi', 'comida_domicilio'],
  ['RAPPI PRIME MEXICO', 'Rappi Prime', 'suscripciones'],
  ['AMAZON MX MARKETPLACE AMA', 'Amazon', 'compras_linea'],
  ['AMAZON MX AD FREE FOR PRI', 'Amazon Prime', 'suscripciones'],
  ['MERCADO LIBRE', 'Mercado Libre', 'compras_linea'],
  ['MERCADO LIBRE 03M S/INT', 'Mercado Libre', 'compras_linea'],
  ['MERCADOPAGO ASTROS', 'Astros', 'otros'],
  ['DOMINOS PIZZA LINCOLN', "Domino's", 'restaurantes'],
  ['DOMINOS CUMBRES III', "Domino's", 'restaurantes'],
  ['COSTCO MONTERREY III 722', 'Costco', 'supermercado'],
  ['SAMS CUMBRES MONTERREY', "Sam's Club", 'supermercado'],
  ['HEB BOSQUES DE LAS LOMAS', 'HEB', 'supermercado'],
  ['SORIANA PLAZA FIESTA', 'Soriana', 'supermercado'],
  ['SUPERCENTER LAS TORRES', 'Walmart', 'supermercado'],
  ['FARM GUADALAJARA 805', 'Farmacias Guadalajara', 'salud'],
  ['FARMACIAS GDL SUC805', 'Farmacias Guadalajara', 'salud'],
  ['DLO SPOTIFY', 'Spotify', 'suscripciones'],
  ['GOOGLE YOUTUBE CR', 'YouTube Premium', 'suscripciones'],
  ['ANTHROPIC CLAUDE SUB 20.00 USD TC 18.3450', 'Claude', 'suscripciones'],
  ['OPENAI CHATGPT SUBSCR 20.00 USD TC 18.7940', 'ChatGPT', 'suscripciones'],
  ['SHEIN', 'Shein', 'ropa'],
  ['CLIP MX REST LA CURVA', 'La Curva', 'restaurantes'],
  ['REST EL ENCANTO', 'El Encanto', 'restaurantes'],
  ['BILLPOCKET REMAX D0288F5D', 'RE/MAX', 'vivienda'],
  ['SERVIGAZ GONZALITOS', 'Servigaz Gonzalitos', 'gasolina'],
  ['SUPERSERVICIO REPUBLIK', 'Superservicio Republik', 'gasolina'],
  ['PENALIZACION PAGO TARDIO', 'Penalización pago tardío', 'intereses'],
  ['I.V.A. 16%', 'IVA', 'intereses'],
  ['INTERES GRAVABLE', 'Intereses', 'intereses'],
  ['INTERES EXENTO', 'Intereses', 'intereses'],
  ['NETFLIX COM', 'Netflix', 'suscripciones'],
  ['UBER EATS MX', 'Uber Eats', 'comida_domicilio'],
  ['UBER TRIP HELP.UBER.COM', 'Uber', 'transporte'],
  ['CFE SUMINISTRADOR', 'CFE', 'servicios'],
  ['TELCEL PAGO EN LINEA', 'Telcel', 'servicios'],
  ['CINEPOLIS VIP 123', 'Cinépolis', 'entretenimiento'],
];

test('normalización y categoría de descripciones típicas', () => {
  for (const [desc, comercio, categoria] of CASOS) {
    assert.deepEqual(categorizar(desc), { comercio, categoria }, desc);
    assert.equal(normalizarComercio(desc), comercio, desc);
  }
});

test('fallback: quita RFC, sucursal, prefijos y deja formato Título', () => {
  assert.equal(normalizarComercio('PAPELERIA EJEMPLO ABC 010101AB1'), 'Papeleria Ejemplo');
  assert.equal(normalizarComercio('TIENDA FICTICIA DEL NORTE SUC 12'), 'Tienda Ficticia del Norte');
  assert.equal(normalizarComercio('CLIP MX ESTETICA PRUEBA 4455'), 'Estetica Prueba');
  assert.equal(normalizarComercio('D LOCAL SERVICIO DEMO 9.99 USD TC 17.5000'), 'Servicio Demo');
  assert.deepEqual(categorizar('NEGOCIO INVENTADO 778899'), { comercio: 'Negocio Inventado', categoria: 'otros' });
  assert.equal(normalizarComercio('café  ejemplo'), 'Cafe Ejemplo');
  assert.equal(categorizar('').categoria, 'otros');
});

test('todas las categorías devueltas existen en el catálogo', () => {
  const ids = new Set(CATEGORIAS.map(c => c.id));
  for (const [desc] of CASOS) assert.ok(ids.has(categorizar(desc).categoria), desc);
});

test('las reglas del usuario tienen prioridad (match por comercio normalizado)', () => {
  const reglas = [{ comercio: 'oxxo', categoria: 'supermercado' }, { comercio: 'Astros', categoria: 'entretenimiento' }];
  assert.deepEqual(categorizar('OXXO MEXICO', reglas), { comercio: 'Oxxo', categoria: 'supermercado' });
  assert.deepEqual(categorizar('MERCADOPAGO ASTROS', reglas), { comercio: 'Astros', categoria: 'entretenimiento' });
  assert.equal(categorizar('7 ELEVEN CENTRO', reglas).categoria, 'conveniencia');
});
