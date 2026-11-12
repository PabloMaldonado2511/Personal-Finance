import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneda, aCentavos, fechaCorta, mesLargo, mesDe } from '../js/core/fmt.js';

test('moneda', () => {
  assert.equal(moneda(123456), '$1,234.56');
  assert.equal(moneda(-123456), '-$1,234.56');
  assert.equal(moneda(0), '$0.00');
  assert.equal(moneda(5), '$0.05');
  assert.equal(moneda(100), '$1.00');
  assert.equal(moneda(123456789012), '$1,234,567,890.12');
  assert.equal(moneda(99999), '$999.99');
});

test('aCentavos: formatos válidos', () => {
  assert.equal(aCentavos('1,234.56'), 123456);
  assert.equal(aCentavos('$ 1,234.56'), 123456);
  assert.equal(aCentavos('$ 1234.5'), 123450);
  assert.equal(aCentavos('1234'), 123400);
  assert.equal(aCentavos('  12.30  '), 1230);
  assert.equal(aCentavos('0.29'), 29);       // 0.29*100 con floats daría 28.999…
  assert.equal(aCentavos('1,005.15'), 100515);
  assert.equal(aCentavos('.5'), 50);
  assert.equal(aCentavos('-45.10'), -4510);
  assert.equal(aCentavos('$1,000,000.00'), 100000000);
  assert.equal(aCentavos(12.34), 1234);
});

test('aCentavos: inválidos → null', () => {
  for (const t of ['', '   ', 'abc', '1.234', '1,23', '12,34.56', '1.2.3', '$', null, undefined, '12a', NaN]) {
    assert.equal(aCentavos(t), null, `entrada: ${t}`);
  }
});

test('fechas y meses', () => {
  assert.equal(fechaCorta('2026-10-12'), '12 oct 2026');
  assert.equal(fechaCorta('2026-01-05'), '5 ene 2026');
  assert.equal(fechaCorta('basura'), '');
  assert.equal(mesLargo('2026-10'), 'octubre 2026');
  assert.equal(mesLargo('2026-09'), 'septiembre 2026');
  assert.equal(mesLargo('2026-13'), '');
  assert.equal(mesDe('2026-10-12'), '2026-10');
});
