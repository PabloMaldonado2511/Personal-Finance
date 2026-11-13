// Catálogo de categorías y clasificación automática de movimientos.
// Las descripciones llegan de estados de cuenta Santander México (mayúsculas,
// con sucursales, RFC, importes en USD, prefijos de agregadores de pago, …).

/** Catálogo. Colores de luminosidad media: legibles sobre fondo claro y oscuro. */
export const CATEGORIAS = [
  { id: 'supermercado',     nombre: 'Supermercado',             color: '#22a06b', icono: '🛒' },
  { id: 'restaurantes',     nombre: 'Restaurantes y cafés',     color: '#e8833a', icono: '🍽️' },
  { id: 'comida_domicilio', nombre: 'Comida a domicilio',       color: '#f5a524', icono: '🛵' },
  { id: 'conveniencia',     nombre: 'Tiendas de conveniencia',  color: '#d4a72c', icono: '🏪' },
  { id: 'gasolina',         nombre: 'Gasolina',                 color: '#dc4c4c', icono: '⛽' },
  { id: 'transporte',       nombre: 'Transporte',               color: '#4c8bf5', icono: '🚕' },
  { id: 'compras_linea',    nombre: 'Compras en línea',         color: '#9b6bdf', icono: '📦' },
  { id: 'suscripciones',    nombre: 'Suscripciones',            color: '#d55fb5', icono: '🔁' },
  { id: 'salud',            nombre: 'Salud y farmacia',         color: '#2bb3a6', icono: '💊' },
  { id: 'entretenimiento',  nombre: 'Entretenimiento',          color: '#7d7ff0', icono: '🎬' },
  { id: 'servicios',        nombre: 'Servicios (luz, agua, tel.)', color: '#3aa0d8', icono: '💡' },
  { id: 'vivienda',         nombre: 'Vivienda y hogar',         color: '#a0784f', icono: '🏠' },
  { id: 'ropa',             nombre: 'Ropa y departamentales',   color: '#e0628a', icono: '👕' },
  { id: 'intereses',        nombre: 'Intereses y comisiones',   color: '#b04a4a', icono: '🏦' },
  { id: 'otros',            nombre: 'Otros',                    color: '#8a94a6', icono: '🏷️' },
  { id: 'ingreso',          nombre: 'Ingreso',                  color: '#3fb950', icono: '💰' },
  { id: 'traspaso',         nombre: 'Traspaso entre cuentas',   color: '#6b7a90', icono: '🔄' },
];

/** Mayúsculas, sin acentos, espacios colapsados. Clave de comparación. */
export function clave(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

// Tabla de reglas: el orden importa (la primera que coincide gana).
// comercio: null → se usa la descripción limpia como nombre.
const R = (re, comercio, categoria) => ({ re, comercio, categoria });
const REGLAS = [
  // Cargos del banco
  R(/PENALIZACION|PAGO TARDIO|GASTOS? DE COBRANZA/, 'Penalización pago tardío', 'intereses'),
  R(/^I\.?\s?V\.?\s?A\.?\b/, 'IVA', 'intereses'),
  R(/^INTERES/, 'Intereses', 'intereses'),
  R(/^COMISION/, 'Comisión', 'intereses'),
  R(/^ANUALIDAD|CUOTA ANUAL/, 'Anualidad', 'intereses'),
  R(/^(SU )?PAGO\b|PAGO (RECIBIDO|INTERBANCARIO|POR TRANSFERENCIA)|^GRACIAS POR SU PAGO/, 'Pago a tarjeta', 'otros'),
  R(/^(NOMINA|SUELDO|DEPOSITO DE NOMINA)/, 'Nómina', 'ingreso'),

  // Gasolineras (antes que OXXO por 'OXXO GAS')
  R(/OXXO ?GAS/, 'Oxxo Gas', 'gasolina'),
  R(/PETRO ?7|PETRO SEVEN/, 'Petro 7', 'gasolina'),
  R(/PEMEX/, 'Pemex', 'gasolina'),
  R(/\bSHELL\b/, 'Shell', 'gasolina'),
  R(/^BP\b|\bBP (GAS|SERV)/, 'BP', 'gasolina'),
  R(/\bMOBIL\b/, 'Mobil', 'gasolina'),
  R(/\bG ?500\b/, 'G500', 'gasolina'),
  R(/HIDROSINA/, 'Hidrosina', 'gasolina'),
  R(/\bARCO\b/, 'Arco', 'gasolina'),
  R(/CHEVRON/, 'Chevron', 'gasolina'),
  R(/\bREDCO\b/, 'Redco', 'gasolina'),
  R(/ORSAN/, 'Orsan', 'gasolina'),
  R(/\bGULF\b/, 'Gulf', 'gasolina'),
  R(/TOTAL ?ENERGIES/, 'TotalEnergies', 'gasolina'),
  R(/^SERVIGA[SZ]\b|^SUPER ?SERVICIO\b|GASOLINER|ESTACION DE SERVICIO/, null, 'gasolina'),

  // Conveniencia
  R(/\b7 ?-?ELEVEN\b|SEVEN ELEVEN/, '7-Eleven', 'conveniencia'),
  R(/\bOXXO\b/, 'Oxxo', 'conveniencia'),
  R(/CIRCLE ?K|CIRCULO ?K/, 'Circle K', 'conveniencia'),
  R(/\bKIOSKO\b/, 'Kiosko', 'conveniencia'),
  R(/\bFARMACIAS? ?(GUADALAJARA|GDL)|^FARM GUADALAJARA/, 'Farmacias Guadalajara', 'salud'),
  R(/^(TIENDAS? )?EXTRA\b/, 'Extra', 'conveniencia'),
  R(/^SIX\b|TIENDAS? SIX/, 'Six', 'conveniencia'),

  // Supermercados
  R(/\bH ?E ?B\b/, 'HEB', 'supermercado'),
  R(/SORIANA/, 'Soriana', 'supermercado'),
  R(/WAL ?-?MART|SUPERCENTER|WALMEX/, 'Walmart', 'supermercado'),
  R(/BODEGA ?AURRERA|\bAURRERA\b/, 'Bodega Aurrera', 'supermercado'),
  R(/COSTCO/, 'Costco', 'supermercado'),
  R(/\bSAMS\b|SAM ?S CLUB/, "Sam's Club", 'supermercado'),
  R(/CHEDRAUI/, 'Chedraui', 'supermercado'),
  R(/\bLA COMER\b|CITY ?MARKET|\bFRESKO\b|\bSUMESA\b/, 'La Comer', 'supermercado'),
  R(/SUPERAMA/, 'Superama', 'supermercado'),
  R(/CALIMAX/, 'Calimax', 'supermercado'),
  R(/ALSUPER/, 'Alsuper', 'supermercado'),
  R(/CASA LEY|\bLEY\b/, 'Casa Ley', 'supermercado'),
  R(/\bS ?-?MART\b/, 'S-Mart', 'supermercado'),
  R(/\bMERCO\b/, 'Merco', 'supermercado'),
  R(/TIENDAS? 3B|^3B\b/, 'Tiendas 3B', 'supermercado'),
  R(/\bCITY CLUB\b/, 'City Club', 'supermercado'),

  // Comida a domicilio / suscripciones de apps (las 'PRIME/ONE' antes)
  R(/RAPPI ?PRIME|RAPPI ?PRO\b/, 'Rappi Prime', 'suscripciones'),
  R(/RAPPI/, 'Rappi', 'comida_domicilio'),
  R(/UBER ?ONE/, 'Uber One', 'suscripciones'),
  R(/UBER ?EATS/, 'Uber Eats', 'comida_domicilio'),
  R(/DIDI ?FOOD/, 'DiDi Food', 'comida_domicilio'),
  R(/SIN ?DELANTAL/, 'Sin Delantal', 'comida_domicilio'),
  R(/CORNERSHOP/, 'Cornershop', 'comida_domicilio'),
  R(/\bJUSTO\b/, 'Jüsto', 'comida_domicilio'),

  // Transporte
  R(/\bUBER\b|UBER ?TRIP|UBER ?BV/, 'Uber', 'transporte'),
  R(/\bDIDI\b/, 'DiDi', 'transporte'),
  R(/CABIFY/, 'Cabify', 'transporte'),
  R(/INDRIVE/, 'inDrive', 'transporte'),
  R(/METRORREY|\bMETRO\b|ECOVIA|MI ?MOVILIDAD/, 'Transporte público', 'transporte'),
  R(/VIVA ?AEROBUS|VIVAAEROBUS/, 'Viva Aerobus', 'transporte'),
  R(/VOLARIS/, 'Volaris', 'transporte'),
  R(/AEROMEXICO/, 'Aeroméxico', 'transporte'),
  R(/\bADO\b|ETN TURISTAR|\bSENDA\b|OMNIBUS/, 'Autobús', 'transporte'),
  R(/\bIAVE\b|TELEVIA|PASE URBANO|\bPASE\b.*TAG|CASETA|CAPUFE|AUTOPISTA/, 'Casetas / TAG', 'transporte'),
  R(/ESTACIONAMIENTO|PARKING|PARQUIMETRO/, 'Estacionamiento', 'transporte'),

  // Suscripciones digitales
  R(/AMAZON.*(AD FREE|PRIME)|PRIME ?VIDEO/, 'Amazon Prime', 'suscripciones'),
  R(/SPOTIFY/, 'Spotify', 'suscripciones'),
  R(/NETFLIX/, 'Netflix', 'suscripciones'),
  R(/DISNEY/, 'Disney+', 'suscripciones'),
  R(/\bHBO\b|\bMAX\.COM|HBOMAX|WBD MAX/, 'Max', 'suscripciones'),
  R(/YOUTUBE/, 'YouTube Premium', 'suscripciones'),
  R(/PARAMOUNT/, 'Paramount+', 'suscripciones'),
  R(/\bVIX\b/, 'ViX', 'suscripciones'),
  R(/CRUNCHYROLL/, 'Crunchyroll', 'suscripciones'),
  R(/APPLE ?COM ?BILL|APPLE\.COM|\bITUNES\b|\bICLOUD\b|\bAPPLE\b/, 'Apple', 'suscripciones'),
  R(/ANTHROPIC|\bCLAUDE\b/, 'Claude', 'suscripciones'),
  R(/OPENAI|CHATGPT/, 'ChatGPT', 'suscripciones'),
  R(/MICROSOFT|\bMSFT\b|OFFICE ?365/, 'Microsoft', 'suscripciones'),
  R(/GOOGLE/, 'Google', 'suscripciones'),
  R(/\bCANVA\b/, 'Canva', 'suscripciones'),
  R(/DROPBOX/, 'Dropbox', 'suscripciones'),
  R(/DUOLINGO/, 'Duolingo', 'suscripciones'),

  // Compras en línea
  R(/AMAZON|\bAMZN\b/, 'Amazon', 'compras_linea'),
  R(/MERCADO ?LIBRE/, 'Mercado Libre', 'compras_linea'),
  R(/^MERCADO ?PAGO$/, 'Mercado Pago', 'compras_linea'),
  R(/ALIEXPRESS/, 'AliExpress', 'compras_linea'),
  R(/\bTEMU\b/, 'Temu', 'compras_linea'),
  R(/^PAYPAL$/, 'PayPal', 'compras_linea'),

  // Ropa y departamentales
  R(/SHEIN/, 'Shein', 'ropa'),
  R(/LIVERPOOL/, 'Liverpool', 'ropa'),
  R(/PALACIO DE HIERRO/, 'Palacio de Hierro', 'ropa'),
  R(/\bSEARS\b/, 'Sears', 'ropa'),
  R(/SUBURBIA/, 'Suburbia', 'ropa'),
  R(/COPPEL/, 'Coppel', 'ropa'),
  R(/\bZARA\b/, 'Zara', 'ropa'),
  R(/\bH ?& ?M\b|\bHYM\b/, 'H&M', 'ropa'),
  R(/PULL ?& ?BEAR|PULL AND BEAR/, 'Pull&Bear', 'ropa'),
  R(/BERSHKA/, 'Bershka', 'ropa'),
  R(/\bC ?& ?A\b/, 'C&A', 'ropa'),
  R(/INNOVA ?SPORT/, 'Innovasport', 'ropa'),
  R(/\bMARTI\b/, 'Martí', 'ropa'),
  R(/\bNIKE\b/, 'Nike', 'ropa'),
  R(/ADIDAS/, 'Adidas', 'ropa'),
  R(/PRICE ?SHOES/, 'Price Shoes', 'ropa'),
  R(/CUIDADO CON EL PERRO/, 'Cuidado con el Perro', 'ropa'),
  R(/OLD ?NAVY/, 'Old Navy', 'ropa'),
  R(/AMERICAN EAGLE/, 'American Eagle', 'ropa'),

  // Restaurantes y cafés
  R(/DOMINO ?S?\b|DOMINOS/, "Domino's", 'restaurantes'),
  R(/STARBUCKS/, 'Starbucks', 'restaurantes'),
  R(/MC ?DONALD/, "McDonald's", 'restaurantes'),
  R(/BURGER ?KING/, 'Burger King', 'restaurantes'),
  R(/\bKFC\b/, 'KFC', 'restaurantes'),
  R(/LITTLE ?CAESAR/, 'Little Caesars', 'restaurantes'),
  R(/PIZZA ?HUT/, 'Pizza Hut', 'restaurantes'),
  R(/PAPA ?JOHN/, "Papa John's", 'restaurantes'),
  R(/CARL ?S ?JR|CARLS JR/, "Carl's Jr.", 'restaurantes'),
  R(/SUBWAY/, 'Subway', 'restaurantes'),
  R(/\bVIPS\b/, 'Vips', 'restaurantes'),
  R(/SANBORNS/, 'Sanborns', 'restaurantes'),
  R(/\bTOKS\b/, 'Toks', 'restaurantes'),
  R(/WINGSTOP/, 'Wingstop', 'restaurantes'),
  R(/CHILI ?S\b/, "Chili's", 'restaurantes'),
  R(/APPLEBEE/, "Applebee's", 'restaurantes'),
  R(/P ?F ?CHANG/, "P.F. Chang's", 'restaurantes'),
  R(/SUSHI ?ROLL/, 'Sushi Roll', 'restaurantes'),
  R(/TIM ?HORTONS/, 'Tim Hortons', 'restaurantes'),
  R(/TACO ?BELL/, 'Taco Bell', 'restaurantes'),
  R(/POPEYES/, 'Popeyes', 'restaurantes'),
  R(/POLLO LOCO/, 'El Pollo Loco', 'restaurantes'),
  R(/KRISPY ?KREME/, 'Krispy Kreme', 'restaurantes'),
  R(/CINNABON/, 'Cinnabon', 'restaurantes'),
  R(/ITALIAN ?COFFEE/, 'Italian Coffee', 'restaurantes'),
  R(/TAQUERIA|\bTACOS?\b|PIZZERIA|MARISCOS|\bSUSHI\b|CAFETERIA|\bCAFE\b|COFFEE|BURGER|ALITAS|\bWINGS\b|ASADERO|PARRILLA|CANTINA|\bBAR\b|PANADERIA/, null, 'restaurantes'),

  // Salud y farmacia
  R(/FARMACIAS? DEL AHORRO|FARM(ACIA)? AHORRO|\bFDA\b/, 'Farmacias del Ahorro', 'salud'),
  R(/BENAVIDES/, 'Farmacias Benavides', 'salud'),
  R(/SAN PABLO/, 'Farmacia San Pablo', 'salud'),
  R(/SIMILARES/, 'Farmacias Similares', 'salud'),
  R(/\bYZA\b/, 'Farmacias Yza', 'salud'),
  R(/FARMACIA|\bFARM\b/, null, 'salud'),
  R(/SALUD DIGNA|\bCHOPO\b|LABORATORIO|HOSPITAL|CLINICA|MEDIC|DENTAL|OPTICA|\bDR\b|DOCTOR/, null, 'salud'),
  R(/SMART ?FIT|SPORTS ?WORLD|ANYTIME ?FITNESS|GIMNASIO|\bGYM\b/, null, 'salud'),

  // Entretenimiento
  R(/CINEPOLIS/, 'Cinépolis', 'entretenimiento'),
  R(/CINEMEX/, 'Cinemex', 'entretenimiento'),
  R(/TICKETMASTER/, 'Ticketmaster', 'entretenimiento'),
  R(/ETICKET|SUPER ?BOLETOS|FUNTICKET|BOLETO/, null, 'entretenimiento'),
  R(/STEAM/, 'Steam', 'entretenimiento'),
  R(/PLAYSTATION|\bPSN\b|SONY/, 'PlayStation', 'entretenimiento'),
  R(/\bXBOX\b/, 'Xbox', 'entretenimiento'),
  R(/NINTENDO/, 'Nintendo', 'entretenimiento'),
  R(/SIX FLAGS/, 'Six Flags', 'entretenimiento'),

  // Servicios (luz, agua, gas, telecom)
  R(/\bCFE\b|COMISION FEDERAL DE ELEC/, 'CFE', 'servicios'),
  R(/AGUA Y DRENAJE|\bSADM\b|\bSACMEX\b|\bSIAPA\b/, 'Agua y Drenaje', 'servicios'),
  R(/NATURGY|GAS NATURAL|ENGIE/, 'Gas natural', 'servicios'),
  R(/GAS ?LP|\bGAS ?EXPRESS\b|ZETA GAS|GAS DEL NORTE/, 'Gas LP', 'servicios'),
  R(/TELCEL/, 'Telcel', 'servicios'),
  R(/\bAT ?& ?T\b|\bATT\b/, 'AT&T', 'servicios'),
  R(/MOVISTAR/, 'Movistar', 'servicios'),
  R(/TELMEX/, 'Telmex', 'servicios'),
  R(/\bIZZI\b/, 'izzi', 'servicios'),
  R(/TOTAL ?PLAY/, 'Totalplay', 'servicios'),
  R(/MEGACABLE/, 'Megacable', 'servicios'),
  R(/\bBAIT\b/, 'Bait', 'servicios'),
  R(/\bSKY\b/, 'Sky', 'servicios'),

  // Vivienda y hogar
  R(/\bRE ?\/?MAX\b/, 'RE/MAX', 'vivienda'),
  R(/RENTA|ARRENDAMIENTO|INMOBILIARIA/, null, 'vivienda'),
  R(/HOME ?DEPOT/, 'Home Depot', 'vivienda'),
  R(/\bLOWES?\b/, "Lowe's", 'vivienda'),
  R(/\bIKEA\b/, 'IKEA', 'vivienda'),
  R(/SODIMAC/, 'Sodimac', 'vivienda'),
  R(/BED ?BATH/, 'Bed Bath & Beyond', 'vivienda'),
  R(/MUEBLE|FERRETER|TLAPALERIA|COMEX|\bPPG\b/, null, 'vivienda'),
];

// Prefijos de agregadores/terminales de pago que ocultan al comercio real
// (los '*' ya se convirtieron en espacios en limpiar()).
const PREFIJO_AGREGADOR = /^(CLIP ?MX|CLIP|BILLPOCKET|MERCADO ?PAGO|MP|DLO|D ?LOCAL|PAYPAL|PP|SR ?PAGO|SRPAGO|ZETTLE|IZETTLE|NETPAY|CONEKTA|OPENPAY|STRIPE|SQ|GETNET|PAYU|EVO ?PAYMENTS|SUMUP)\b\s*/;
// Prefijo de restaurante (se quita del nombre y fija la categoría).
const PREFIJO_REST = /^REST(AURANTE|AURANT)?\b\.?\s+/;

const MINUSCULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'E', 'EN', 'CON', 'AL']);

/** Limpia la descripción: RFC, importes extranjeros, MSI, números de sucursal. */
function limpiar(k) {
  let s = ' ' + k + ' ';
  s = s.replace(/\s\d+(\.\d+)?\s?(USD|EUR|CAD|GBP|DLS)\b(\s?TC\s?[\d.]+)?/g, ' ');   // '20.00 USD TC 18.3450'
  s = s.replace(/\s\d{1,2}\s?M\s?(S\/?\s?INT|C\/?\s?INT|SIN INT\w*)\b.*/g, ' ');       // '03M S/INT'
  s = s.replace(/\s\d{1,2}\s?(DE|\/)\s?\d{1,2}\s/g, ' ');                              // '03 DE 12', '03/12'
  s = s.replace(/\s[A-Z&Ñ]{3,4}\s?\d{6}\s?[A-Z0-9]{3}\s/g, ' ');                     // RFC 'SEM 980701STA'
  s = s.replace(/\bS\.?\s?A\.?(\s?P\.?\s?I\.?)?\s?(DE\s?)?C\.?\s?V\.?/g, ' ');         // 'SA DE CV'
  s = s.replace(/\s(SUC|SUCURSAL|TDA|NO)\.?\s?\d+\b/g, ' ');                         // 'SUC 12'
  s = s.replace(/[*#]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s || k;   // si todo era ruido (p. ej. solo un RFC), conserva el original
}

/** Quita tokens de sucursal/número y palabras de relleno al final. */
function quitarRuido(s) {
  const tokens = s.split(' ').filter(t => {
    if (/^\d+$/.test(t)) return false;                    // número suelto
    if (/^(SUC|T|NO|TDA|TIENDA)\.?\d+$/.test(t)) return false;  // 'SUC805', 'T2666'
    if ((t.match(/\d/g) || []).length >= 3) return false; // códigos tipo 'D0288F5D'
    return true;
  });
  // Relleno al final: país, 'MX', 'SUB', 'SUBSCR'
  while (tokens.length > 1 && /^(MEXICO|MX|MEX|SUB|SUBSCR|SUBSCRIPTION|CR)$/.test(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

function titulo(s) {
  return s.split(' ').map((w, i) => {
    if (i > 0 && MINUSCULAS.has(w)) return w.toLowerCase();
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(' ');
}

/** Núcleo: descripción → { comercio, categoria } con reglas integradas. */
function analizar(descripcion) {
  let k = limpiar(clave(descripcion));
  if (!k) return { comercio: 'Sin descripción', categoria: 'otros' };

  // Quita prefijos de agregadores (puede haber varios); nunca deja vacío.
  for (let i = 0; i < 3; i++) {
    const sin = k.replace(PREFIJO_AGREGADOR, '').trim();
    if (sin === k || !sin) break;
    k = sin;
  }

  let categoriaForzada = null;
  if (PREFIJO_REST.test(k)) {
    const sin = k.replace(PREFIJO_REST, '').trim();
    if (sin) { k = sin; categoriaForzada = 'restaurantes'; }
  }

  for (const r of REGLAS) {
    if (r.re.test(k)) {
      return {
        comercio: r.comercio ?? titulo(quitarRuido(k) || k),
        categoria: categoriaForzada ?? r.categoria,
      };
    }
  }
  return { comercio: titulo(quitarRuido(k) || k), categoria: categoriaForzada ?? 'otros' };
}

/** Descripción del estado de cuenta → nombre de comercio normalizado. */
export function normalizarComercio(descripcion) {
  return analizar(descripcion).comercio;
}

/** → { comercio, categoria }. Las reglas del usuario (por comercio) tienen prioridad. */
export function categorizar(descripcion, reglas = []) {
  const res = analizar(descripcion);
  const k = clave(res.comercio);
  const regla = (reglas || []).find(r => r && clave(r.comercio) === k);
  return regla ? { comercio: res.comercio, categoria: regla.categoria } : res;
}
