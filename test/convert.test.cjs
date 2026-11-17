/* SPDX-License-Identifier: MIT */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const demo = require('../data/demo-rates.js');

let readLiteral, convert;
test.before(async () => {
  ({ readLiteral, convert } = await import('../scripts/convert-rates.mjs'));
});

function legacySource(rates = demo.rates, destinations = demo.destinations) {
  return 'const RATES = ' + JSON.stringify(rates) + ';\nconst ZONE_MAP = ' + JSON.stringify(destinations) + ';\n';
}

test('JSON literal extraction handles quoted braces, escapes and nested arrays', () => {
  const expected = {
    note: '引号 " 与反斜杠 \\，字符串中的 } ] { [ 不影响边界',
    escaped: '\\" text \\ end',
    newline: 'first\nsecond',
    list: [{ nested: ['[', '}', ']', '{', '"', '\\'] }, null, true, 2]
  };
  const source = 'const RATES = ' + JSON.stringify(expected) + ';\nconst AFTER = {"unused":true};';
  assert.deepEqual(readLiteral(source, 'RATES'), expected);
  assert.deepEqual(readLiteral('\n let ZONE_MAP = [ {"label":"escaped \\\" } ]"} ];\n', 'ZONE_MAP'), [{ label: 'escaped " } ]' }]);
});

test('literal extraction accepts standard variable declarations without executing surrounding code', () => {
  for (const declaration of ['const', 'let', 'var']) {
    const source = 'globalThis.__GENORDA_CONVERTER_SIDE_EFFECT__ = true;\n' + declaration + ' RATES = {"sample":[1,2]};\nglobalThis.__GENORDA_CONVERTER_SIDE_EFFECT__ = "after";';
    delete globalThis.__GENORDA_CONVERTER_SIDE_EFFECT__;
    assert.deepEqual(readLiteral(source, 'RATES'), { sample: [1, 2] });
    assert.equal(globalThis.__GENORDA_CONVERTER_SIDE_EFFECT__, undefined);
  }
});

test('non-JSON expressions are rejected rather than evaluated', async t => {
  const expressions = {
    'function call': 'loadRates()',
    'parenthesized expression': '({"sample":1})',
    'unquoted property': '{sample:1}',
    'JavaScript function value': '{"sample": function () { return 1; }}',
    'getter expression': '{get sample() { return 1; }}',
    'single-quoted string': "{'sample':1}",
    'undefined value': '{"sample":undefined}',
    'trailing comma': '{"sample":1,}'
  };
  for (const [name, expression] of Object.entries(expressions)) {
    await t.test(name, () => assert.throws(() => readLiteral('const RATES = ' + expression + ';', 'RATES')));
  }
});

test('missing declarations and syntactically incomplete JSON fail clearly', async t => {
  const sources = {
    'absent target constant': 'const OTHER = {};',
    'unfinished object': 'const RATES = {"nested": [1, 2]',
    'unfinished quoted string': 'const RATES = {"text": "unterminated } ]',
    'mismatched nesting': 'const RATES = {"nested": [1, 2}',
    'empty declaration': 'const RATES = ;'
  };
  for (const [name, source] of Object.entries(sources)) {
    await t.test(name, () => assert.throws(() => readLiteral(source, 'RATES')));
  }
  assert.throws(() => convert('const RATES = {};'), /ZONE_MAP/);
  assert.throws(() => convert('const ZONE_MAP = [];'), /RATES/);
});

test('conversion preserves public demo amounts as custom data without adding fuel exemptions', () => {
  const source = 'const FUEL_EXEMPT_ZONES = ["J"];\n' + legacySource();
  const converted = convert(source);
  assert.equal(converted.schemaVersion, 1);
  assert.equal(converted.metadata.kind, 'custom');
  assert.equal(converted.metadata.currency, 'CNY');
  assert.equal(converted.metadata.effectiveFrom, null);
  assert.equal(converted.metadata.effectiveTo, null);
  assert.deepEqual(converted.destinations, demo.destinations);
  assert.deepEqual(converted.rates, demo.rates);
  assert.deepEqual(converted.rules.fuelExemptZones, []);
  assert.equal(demo.metadata.kind, 'demo');
});

test('conversion does not execute any supplied JavaScript before or after valid JSON constants', () => {
  delete globalThis.__GENORDA_CONVERTER_SIDE_EFFECT__;
  const source = 'globalThis.__GENORDA_CONVERTER_SIDE_EFFECT__ = "before";\n' + legacySource()
    + 'globalThis.__GENORDA_CONVERTER_SIDE_EFFECT__ = "after";\nthrow new Error("must not execute");\n';
  const converted = convert(source);
  assert.equal(converted.metadata.kind, 'custom');
  assert.equal(globalThis.__GENORDA_CONVERTER_SIDE_EFFECT__, undefined);
});

test('conversion rejects semantically incomplete or invalid tariff data', () => {
  assert.throws(() => convert(legacySource({}, demo.destinations)), /运价结构无效/);
  assert.throws(() => convert(legacySource(demo.rates, [])), /目的地列表无效/);
  const missingService = structuredClone(demo.rates); delete missingService.IP;
  assert.throws(() => convert(legacySource(missingService)), /IP 运价结构无效/);
  const invalidDestination = structuredClone(demo.destinations);
  delete invalidDestination[0].ieNA;
  assert.throws(() => convert(legacySource(demo.rates, invalidDestination)), /可用标记无效/);
});
