# Finanzas Personales

App web personal para llevar las finanzas a partir de estados de cuenta en PDF. Lee el PDF
directamente en el navegador, clasifica los gastos y genera:

- Estado de resultados mensual (ingresos, gastos, resultado y tasa de ahorro).
- Gastos recurrentes, por comercio y por categoría.
- Capital: efectivo + inversiones − deuda de tarjetas, con historial.

## Privacidad

- Todo se procesa y se guarda en el navegador del dispositivo (IndexedDB).
- El repositorio solo contiene código. No hay datos reales en él.
- Nunca subas estados de cuenta, respaldos ni archivos con datos personales al repositorio.
  Los patrones `*.pdf` y `finanzas-respaldo-*.json` están en `.gitignore` como protección extra,
  pero la responsabilidad de no subirlos es del usuario.

## Cómo usarla

1. Abre la página de la app.
2. Ve a **Importar**, elige el PDF, revisa los movimientos detectados y guarda.
3. Haz respaldos periódicos desde **Ajustes** (exportar JSON).

En iPhone: en Safari, toca **Compartir → Añadir a pantalla de inicio** para usarla como app.

## Bancos soportados

- Santander México (tarjetas de crédito).
- Más bancos por venir.

## Desarrollo local

```sh
python3 -m http.server
```

Luego abre `http://localhost:8000` en el navegador.

Pruebas (solo con datos sintéticos):

```sh
npm test
```

## Estructura

```
index.html        pantalla única con navegación inferior
css/              estilos
js/ui/            interfaz (pantallas, componentes, gráficas)
js/core/          fmt, db (IndexedDB), calc, categorías, OCR, lectura de Santander, importación
tests/            pruebas (npm test)
docs/             arquitectura y notas de diseño
icons/            ícono de la app (SVG y PNG)
```

Detalles de diseño en `docs/ARQUITECTURA.md`.

## Hoja de ruta

- Lectura de screenshots de movimientos.
- Nómina en PDF.
- Cuenta de débito.
- Sincronización entre dispositivos.
