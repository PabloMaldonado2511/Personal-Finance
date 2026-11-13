# Arquitectura — Finanzas Personales

App web estática (GitHub Pages), **sin build**: HTML + CSS + JavaScript con módulos ES nativos.
Todo el procesamiento y los datos viven en el navegador del usuario (IndexedDB). El repositorio es
público: **nunca** se suben datos reales (estados de cuenta, números de tarjeta, montos, nombres).

## Reglas generales

- Idioma de la interfaz y de los identificadores de dominio: español (México). Moneda: MXN.
- **Todo importe es un entero en centavos** (`1234.56` → `123456`). Nunca floats para dinero.
  Para mostrar se usa `fmt.moneda(centavos)`.
- Fechas: cadenas ISO `YYYY-MM-DD`. Meses: `YYYY-MM`.
- Los importes se guardan siempre **positivos**; el sentido lo da `tipo`.
- Librerías externas incluidas en `vendor/` con versión fija (sin CDN): pdf.js 4.10.38, Tesseract.js 7.0.0 + datos de español, Chart.js 4.4.9.
- Mobile-first (se usa sobre todo desde iPhone/Safari), también debe verse bien en escritorio.
- Rutas siempre relativas (`./js/...`): la página se sirve desde `/Personal-Finance/`.

## Estructura

```
index.html
css/app.css
js/ui/…            interfaz (pantallas, componentes, gráficas)
js/core/fmt.js     formato de moneda/fechas
js/core/db.js      persistencia IndexedDB
js/core/calc.js    cálculos (estado de resultados, recurrentes, capital)
js/core/categorias.js  catálogo y reglas de clasificación
js/core/ocr.js     PDF → líneas de texto (pdf.js + Tesseract.js)
js/core/santander.js   líneas de texto → estado de cuenta estructurado
js/core/importar.js    orquesta ocr + santander + categorías
tests/             pruebas con `npm test` (solo datos sintéticos)
vendor/            librerías de terceros
```

## Tipos

```js
/** Estado de cuenta de tarjeta de crédito */
Estado = {
  id,                // `${ultimos4}-${fechaCorte}`  (evita duplicados al re-subir)
  banco,             // 'Santander'
  producto,          // p. ej. 'SANTANDER LIKEU ORO'
  ultimos4,          // últimos 4 dígitos de la tarjeta titular
  cuenta,            // etiqueta corta para UI, p. ej. 'LikeU ·1234'
  periodoInicio, periodoFin, fechaCorte, fechaLimitePago,   // ISO
  pagoNoIntereses,   // centavos
  saldoDeudorTotal,  // centavos
  totalCargos, totalAbonos,   // centavos, tal como vienen impresos en el PDF
  importadoEl        // ISO datetime
}

Movimiento = {
  id,                // string único
  origen,            // 'pdf' | 'manual'
  estadoId,          // id del Estado, o null si es manual
  cuenta,            // etiqueta: 'LikeU ·1234', 'Débito', 'Efectivo', …
  fecha,             // ISO, fecha de la operación (define el mes)
  fechaCargo,        // ISO o null
  descripcion,       // texto original
  comercio,          // nombre normalizado, p. ej. '7-Eleven'
  categoria,         // id de categoría
  monto,             // centavos, positivo
  tipo,              // 'gasto' | 'devolucion' | 'pago_tarjeta' | 'ingreso'
  msi,               // boolean, mensualidad de compra a meses
  nota               // string opcional
}
// 'gasto'        suma a gastos
// 'devolucion'   resta de gastos (abono de un comercio)
// 'pago_tarjeta' NO es gasto ni ingreso (el gasto ya son los cargos); se excluye de resultados
// 'ingreso'      sueldo, extras

Saldo = {            // foto de un saldo en una fecha, para el cálculo de capital
  id, fecha,         // ISO
  clase,             // 'efectivo' | 'inversion' | 'deuda'
  nombre,            // 'Cuenta débito', 'GBM', 'LikeU ·1234', …
  monto              // centavos, positivo (las deudas restan en el cálculo)
}

Regla = { comercio, categoria }   // reclasificación aprendida del usuario

Importacion = {      // resultado de leer un PDF, AÚN NO guardado
  estado,            // Estado
  movimientos,       // Movimiento[] con categoría sugerida
  validacion: {
    cuadra,          // boolean: lo leído coincide con los totales impresos
    totalCargosPdf, totalCargosLeidos, totalAbonosPdf, totalAbonosLeidos,  // centavos
    avisos           // string[] mensajes para el usuario
  },
  duplicado          // boolean: ya existe un Estado con ese id
}
```

## API de módulos

### `js/core/fmt.js`
```js
export function moneda(centavos)            // '$1,234.56' ; negativos '-$1,234.56'
export function aCentavos(texto)            // '1,234.56' | '$ 1234.5' → 123456 ; inválido → null
export function fechaCorta(iso)             // '12 oct 2026'
export function mesLargo(mes)               // '2026-10' → 'octubre 2026'
export function mesDe(iso)                  // '2026-10-12' → '2026-10'
```

### `js/core/categorias.js`
```js
export const CATEGORIAS   // [{ id, nombre, color, icono }]  (icono = emoji), incluye 'otros' e 'ingreso'
export function normalizarComercio(descripcion)        // → 'Rappi', '7-Eleven', 'Amazon', …
export function categorizar(descripcion, reglas = [])  // → { comercio, categoria }  (reglas del usuario ganan)
```

### `js/core/db.js`  (todas async)
```js
export function abrir()
export function listarMovimientos(filtro = {})   // { mes, desde, hasta, categoria, cuenta, tipo, texto }
export function guardarMovimiento(mov)           // crea o actualiza (genera id si falta)
export function borrarMovimiento(id)
export function reclasificar(id, categoria, { recordar = true } = {})
      // cambia la categoría; si recordar, guarda Regla y la aplica a los demás movimientos del mismo comercio
export function listarEstados()
export function existeEstado(id)
export function guardarImportacion(importacion)  // guarda estado + movimientos (reemplaza si ya existía)
                                                 // y registra un Saldo clase 'deuda' con saldoDeudorTotal
export function borrarEstado(id)                 // borra el estado y sus movimientos
export function listarReglas() / borrarRegla(comercio)
export function listarSaldos() / guardarSaldo(saldo) / borrarSaldo(id)
export function exportarTodo()                   // → objeto JSON con todo
export function importarTodo(obj)                // reemplaza todo
export function borrarTodo()
```

### `js/core/calc.js`  (funciones puras; reciben arreglos, no tocan la BD)
```js
export function mesesDisponibles(movs)                 // ['2026-11','2026-10',…] descendente
export function estadoResultados(movs, mes)
  // → { mes, ingresos, gastos, resultado, tasaAhorro,   (tasaAhorro: 0..1 o null si ingresos=0)
  //     porCategoria: [{ categoria, total, porcentaje, n }] desc,
  //     ingresosDetalle: [{ comercio, total }] }
  // gastos = Σ gasto − Σ devolucion ; pago_tarjeta se ignora
export function tendencia(movs, n = 6)                 // [{ mes, ingresos, gastos, resultado }] asc, últimos n meses
export function topRecurrentes(movs, { desde, hasta, limite = 10 } = {})
  // gastos agrupados por comercio → [{ comercio, categoria, veces, total, promedio, meses }]
  // ordenado por veces desc, luego total desc
export function topCategoriasRecurrentes(movs, opts)   // igual pero por categoría: [{ categoria, veces, total }]
export function capital(saldos, fecha = hoy)
  // usa el saldo más reciente (≤ fecha) de cada (clase, nombre)
  // → { efectivo, inversiones, deuda, capital, detalle: [Saldo] }   capital = efectivo + inversiones − deuda
export function historialCapital(saldos)               // [{ mes, capital }] asc
```

### `js/core/importar.js`
```js
export async function importarPdf(file /* File */, onProgreso /* ({ etapa, pagina, total, fraccion }) */)
  // → Importacion   (lanza Error con mensaje legible si el PDF no se reconoce)
```
Los PDF de Santander no traen texto (son imágenes), por eso se leen con OCR en el navegador;
tarda varios segundos por página → la UI debe mostrar progreso.
La validación compara lo leído contra «Total de cargos» y «Total de abonos» impresos.

## Pantallas (navegación inferior)

1. **Resumen** — selector de mes; ingresos, gastos, resultado y tasa de ahorro; gastos por
   categoría (gráfica + lista); top de gastos recurrentes (por comercio y por categoría);
   tendencia de los últimos meses.
2. **Movimientos** — lista filtrable (mes, categoría, cuenta, texto); tocar un movimiento para
   reclasificar/editar/borrar; botón para captura manual (ingreso, gasto en débito como la renta, etc.).
3. **Importar** — subir PDF; progreso; pantalla de revisión con tarjeta y periodo detectados,
   indicador «cuadra / no cuadra» contra los totales del PDF, lista editable; confirmar para guardar.
   Estados ya importados (con opción de borrar). Lugar reservado «Screenshots (próximamente)».
4. **Capital** — efectivo + inversiones − deuda de tarjetas; alta/edición de saldos; historial.
5. **Ajustes** — exportar/importar respaldo JSON, reglas aprendidas, borrar todo.

## Ampliación: cuenta de débito, traspasos y saldos desde screenshots

### Cambios en tipos

```js
Movimiento.tipo   // se añade 'traspaso': dinero que se mueve entre cuentas propias
                  // (pago de tarjeta desde débito, envío a otra cuenta propia, retiro de caja de
                  // ahorro). NO es ingreso ni gasto: se excluye de resultados igual que 'pago_tarjeta'.
                  // Categoría asociada: 'traspaso'.

Estado.tipoCuenta // 'credito' | 'debito'
// En débito: saldoInicial y saldoFinal (centavos); totalCargos = retiros, totalAbonos = depósitos;
// fechaLimitePago, pagoNoIntereses y saldoDeudorTotal son null.
// Al guardar un estado de débito se registra un Saldo clase 'efectivo' con saldoFinal.

Saldo = {
  id, fecha, clase, nombre, monto,
  // clase: 'efectivo' | 'inversion' | 'deuda' | 'negocio'
  //   'negocio' = dinero de un negocio; se muestra aparte y NO suma al capital.
  fuente,      // opcional: identificador estable de la cuenta leída de un screenshot
               //   ('didi', 'nu-cajita', 'cetes', 'gbm-<contrato>'). Agrupa el historial
               //   aunque el usuario cambie el nombre.
  origen,      // opcional: 'manual' | 'captura'
  posiciones,  // opcional: [{ nombre, titulos, monto }]  (portafolio GBM)
  nota         // opcional
}

ImportacionSaldos = {          // resultado de leer uno o varios screenshots, AÚN NO guardado
  tipo: 'saldos',
  saldos: [SaldoPropuesto],
  noReconocidas: [{ archivo, motivo }]
}
SaldoPropuesto = Saldo + {
  etiquetaFuente,   // texto para mostrar: 'GBM · contrato BKX00000', 'DiDi Cuenta', …
  archivos,         // string[] nombres de los screenshots de donde salió
  validacion,       // { cuadra: true | false | null, mensaje }  (null = no hay con qué validar)
  avisos            // string[]
}
```

### API

```js
// js/core/importar.js
importarPdf(file, onProgreso)            // ahora reconoce tarjeta de crédito Y cuenta de débito Santander
importarCapturas(files, onProgreso)      // File[] de imágenes → ImportacionSaldos
                                         // onProgreso({ etapa, pagina: i (1..n), total: n, fraccion })
guardarCapturas(saldosPropuestos)        // guarda la lista (ya editada por el usuario) como Saldos

// js/core/calc.js
capital(saldos, fecha)                   // añade `negocio` al resultado; capital NO lo incluye
```
Al leer un screenshot, clase y nombre se proponen así: si ya existe un Saldo guardado con la misma
`fuente`, se reutilizan su clase y su nombre (lo que el usuario eligió la vez anterior).
