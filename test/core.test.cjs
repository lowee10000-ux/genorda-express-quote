/* SPDX-License-Identifier: MIT */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../assets/core.js');

// Every amount here is synthetic test data, unrelated to a carrier tariff.
function rawFixture() {
  const destination = (cn, en, zone, disabled = false) => ({
    cn, en, zh: cn, ip: zone, ie: zone, ipe: zone,
    ipNA: disabled, ieNA: disabled, ipeNA: disabled
  });
  const rates = {};
  for (const service of Q.SERVICES) {
    const piece = { Package: {}, Pak: {}, Envelope: {} };
    const perkg = {};
    for (const zone of ['2', 'J']) {
      piece.Package[zone] = { '0.5': 80, '1.0': 100, '2.0': 120, '2.5': 140, '20.5': 880 };
      piece.Pak[zone] = { '0.5': 50, '1.0': 65, '2.5': 110 };
      piece.Envelope[zone] = { ENV: 60 };
      perkg[zone] = [[21, 44, 17], [45, 70, 15], [71, 99, 13], [100, 199, 11]];
    }
    rates[service] = { piece, perkg };
  }
  return {
    schemaVersion: 1,
    metadata: { kind: 'demo', name: 'Synthetic test tariff', currency: 'CNY', effectiveFrom: null, effectiveTo: null, source: 'Unit test fixture' },
    destinations: [
      destination('示例国', 'Example Country', '2'),
      destination('示例J区', 'Example J', 'J'),
      destination('重名地区', 'Duplicate East', '2'),
      destination('重名地区', 'Duplicate West', 'J'),
      destination('不可用地区', 'Unavailable', '2', true)
    ],
    rates,
    rules: { ...Q.DEFAULT_RULES, fuelExemptZones: [] }
  };
}
function fixture() { return Q.validateRateData(rawFixture()); }
function request(data, overrides = {}) {
  return { service: 'IP', pack: 'Package', weight: 0.5, isDG: false, destination: data.destinations[0], ...overrides };
}
function settings(overrides = {}) {
  return Q.normalizeSettings({ company: 'Example business', fuel: 10, dg: 75, cross: 2, crossMin: 25, margin: 0, days: 5, ...overrides });
}
function rejectsData(mutator) {
  const raw = rawFixture(); mutator(raw);
  assert.throws(() => Q.validateRateData(raw), Q.QuoteError);
}

test('a complete synthetic rate bundle validates and default rules fill missing values', () => {
  const raw = rawFixture(); delete raw.rules;
  const data = Q.validateRateData(raw);
  assert.equal(data.rules.bulkStep, 1);
  assert.equal(data.rules.envelopeMaxWeight, 0.5);
  assert.equal(data.metadata.kind, 'demo');
  assert.equal(data.destinations.length, 5);
});

test('invalid metadata and malformed destination data are rejected', async t => {
  const cases = {
    'unsupported schema': d => { d.schemaVersion = 2; },
    'missing metadata': d => { delete d.metadata; },
    'unidentified tariff kind': d => { d.metadata.kind = 'official'; },
    'empty name': d => { d.metadata.name = ' '; },
    'unsupported currency': d => { d.metadata.currency = 'USD'; },
    'invalid calendar date': d => { d.metadata.effectiveFrom = '2026-02-30'; },
    'reversed validity dates': d => { d.metadata.effectiveFrom = '2026-12-01'; d.metadata.effectiveTo = '2026-01-01'; },
    'no destinations': d => { d.destinations = []; },
    'duplicate combined label': d => { d.destinations.push({ ...d.destinations[0] }); },
    'invalid zone key': d => { d.destinations[0].ip = '__proto__'; },
    'non-boolean service availability': d => { d.destinations[0].ieNA = 'false'; }
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, () => rejectsData(mutate));
});

test('malformed prices, overlapping bands and unsafe rules are rejected', async t => {
  const cases = {
    'missing service': d => { delete d.rates.IE; },
    'unknown packaging': d => { d.rates.IP.piece.Crate = {}; },
    'negative price': d => { d.rates.IP.piece.Package['2']['0.5'] = -1; },
    'non-finite price': d => { d.rates.IP.piece.Package['2']['0.5'] = Infinity; },
    'string price': d => { d.rates.IP.piece.Package['2']['0.5'] = '80'; },
    'invalid envelope rate key': d => { d.rates.IP.piece.Envelope['2'] = { '0.5': 60 }; },
    'overlapping bulk bands': d => { d.rates.IP.perkg['2'] = [[21, 44, 17], [44, 70, 15]]; },
    'backwards bulk band': d => { d.rates.IP.perkg['2'] = [[44, 21, 17]]; },
    'empty bulk bands': d => { d.rates.IP.perkg['2'] = []; },
    'zero weight step': d => { d.rules.bulkStep = 0; },
    'bulk threshold overlaps piece': d => { d.rules.bulkMinimum = 20.5; },
    'envelope beyond piece range': d => { d.rules.envelopeMaxWeight = 21; },
    'invalid exempt-zone format': d => { d.rules.fuelExemptZones = ['../J']; }
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, () => rejectsData(mutate));
});

test('exact destination selection accepts unique names and refuses fragments or ambiguity', () => {
  const data = fixture();
  assert.equal(Q.findDestination(' 示例国 ', data.destinations), data.destinations[0]);
  assert.equal(Q.findDestination('example country', data.destinations), data.destinations[0]);
  assert.equal(Q.findDestination('重名地区', data.destinations), null);
  assert.equal(Q.findDestination('重名地区 / Duplicate West', data.destinations), data.destinations[3]);
  for (const query of ['', '示', 'Example', 'United', '美', '中国', 'not listed']) assert.equal(Q.findDestination(query, data.destinations), null);
  assert.throws(() => Q.lookupFreight(data, request(data, { destination: { ...data.destinations[0] } })), /精确选定/);
});

test('piece rates round up by half a kilogram without interpolating missing rates', () => {
  const data = fixture();
  assert.deepEqual(Q.lookupFreight(data, request(data, { weight: 0.01 })), { freight: 80, chargeableWeight: 0.5, zone: '2' });
  assert.equal(Q.lookupFreight(data, request(data, { weight: 0.5001 })).freight, 100);
  assert.equal(Q.lookupFreight(data, request(data, { weight: 1 })).chargeableWeight, 1);
  assert.throws(() => Q.lookupFreight(data, request(data, { weight: 1.1 })), /未覆盖进位后的重量档/);
});

test('a 0.3 kg step does not over-round an exact 2.1 kg tariff boundary', () => {
  const raw = rawFixture();
  raw.rules.pieceStep = 0.3;
  raw.rates.IP.piece.Package['2'] = { '2.1': 151, '2.4': 169 };
  const data = Q.validateRateData(raw);
  const result = Q.lookupFreight(data, request(data, { weight: 2.1 }));
  assert.equal(result.chargeableWeight, 2.1);
  assert.equal(result.freight, 151);
});

test('a 0.01 kg step does not over-round an exact 0.07 kg tariff boundary', () => {
  const raw = rawFixture();
  raw.rules.pieceStep = 0.01;
  raw.rates.IP.piece.Package['2'] = { '0.07': 43, '0.08': 47 };
  const data = Q.validateRateData(raw);
  const result = Q.lookupFreight(data, request(data, { weight: 0.07 }));
  assert.equal(result.chargeableWeight, 0.07);
  assert.equal(result.freight, 43);
});

test('request weights with more than six decimal places are rejected rather than rounded silently', () => {
  const data = fixture();
  for (const weight of [0.1234567, 2.0000001, 20.5000001, 44.1000001]) {
    assert.throws(() => Q.lookupFreight(data, request(data, { weight })), Q.QuoteError);
  }
  assert.equal(Q.lookupFreight(data, request(data, { weight: 0.123456 })).chargeableWeight, 0.5);
});

test('weight rules with more than six decimal places are rejected', async t => {
  const values = {
    pieceMaxWeight: 20.5000001,
    pieceStep: 0.5000001,
    bulkMinimum: 21.0000001,
    bulkStep: 1.0000001,
    pakMaxWeight: 2.5000001,
    envelopeMaxWeight: 0.5000001
  };
  for (const [key, value] of Object.entries(values)) {
    await t.test(key, () => rejectsData(d => { d.rules[key] = value; }));
  }
});

test('piece and bulk boundary selects the correct tariff at 20.5, 20.5001 and 21 kg', () => {
  const data = fixture();
  const piece = Q.lookupFreight(data, request(data, { weight: 20.5 }));
  assert.equal(piece.chargeableWeight, 20.5); assert.equal(piece.freight, 880);
  for (const weight of [20.5001, 20.9, 21]) {
    const bulk = Q.lookupFreight(data, request(data, { weight }));
    assert.equal(bulk.chargeableWeight, 21); assert.equal(bulk.freight, 357);
  }
});

test('bulk rounding resolves integer-band transitions and is configurable', () => {
  const data = fixture();
  for (const [weight, charged, price] of [[44, 44, 17], [44.1, 45, 15], [45, 45, 15], [70, 70, 15], [70.1, 71, 13], [71, 71, 13], [99.1, 100, 11]]) {
    const result = Q.lookupFreight(data, request(data, { weight }));
    assert.equal(result.chargeableWeight, charged);
    assert.equal(result.freight, charged * price);
  }
  const custom = rawFixture(); custom.rules.bulkStep = 0.5;
  const halfStepData = Q.validateRateData(custom);
  assert.equal(Q.lookupFreight(halfStepData, request(halfStepData, { weight: 21.1 })).chargeableWeight, 21.5);
  assert.throws(() => Q.lookupFreight(halfStepData, request(halfStepData, { weight: 44.1 })), /缺失重量带/);
  assert.throws(() => Q.lookupFreight(data, request(data, { weight: 199.1 })), /超出价表范围/);
});

test('packaging caps apply before piece or bulk rate lookup', () => {
  const data = fixture();
  assert.equal(Q.lookupFreight(data, request(data, { pack: 'Envelope', weight: 0.5 })).freight, 60);
  assert.equal(Q.lookupFreight(data, request(data, { pack: 'Pak', weight: 2.5 })).freight, 110);
  for (const weight of [0.5001, 20.5, 20.5001, 21]) assert.throws(() => Q.lookupFreight(data, request(data, { pack: 'Envelope', weight })), /文件封上限/);
  for (const weight of [2.5001, 20.5, 20.5001, 21]) assert.throws(() => Q.lookupFreight(data, request(data, { pack: 'Pak', weight })), /快递袋上限/);
});

test('IE restrictions, DG packaging and unavailable services cannot be bypassed', () => {
  const data = fixture();
  for (const pack of ['Envelope', 'Pak']) assert.throws(() => Q.lookupFreight(data, request(data, { service: 'IE', pack })), /IE 服务仅支持 Package/);
  for (const pack of ['Envelope', 'Pak']) assert.throws(() => Q.lookupFreight(data, request(data, { pack, isDG: true })), /危险品试算请使用 Package/);
  assert.equal(Q.lookupFreight(data, request(data, { isDG: true })).freight, 80);
  for (const service of Q.SERVICES) assert.throws(() => Q.lookupFreight(data, request(data, { service, destination: data.destinations[4] })), /未启用/);
});

test('invalid requests fail instead of generating non-finite or negative estimates', () => {
  const data = fixture();
  for (const weight of [0, -1, NaN, Infinity, '1', 1000001]) assert.throws(() => Q.lookupFreight(data, request(data, { weight })), Q.QuoteError);
  assert.throws(() => Q.lookupFreight(data, request(data, { service: 'UNKNOWN' })), /有效服务/);
  assert.throws(() => Q.lookupFreight(data, request(data, { pack: 'Crate' })), /有效包装/);
  assert.throws(() => Q.calculateQuote(data, request(data, { isDG: 'yes' }), settings()), /货物属性无效/);
});

test('DG surcharge is included once before fuel, cross minimum and markup', () => {
  const data = fixture();
  const result = Q.calculateQuote(data, request(data, { isDG: true }), settings({ margin: 10 }));
  assert.deepEqual(result.lines.map(l => l.cents), [8800, 8250, 1705, 2750]);
  assert.equal(result.totalCents, 21505);
  assert.equal(result.totalCents, result.lines.reduce((sum, line) => sum + line.cents, 0));
  const bulk = Q.calculateQuote(data, request(data, { weight: 21 }), settings());
  assert.equal(bulk.lines.find(l => l.label === '内地至香港衔接费').cents, 4200);
});

test('fuel exemption depends only on the explicitly configured tariff zones', () => {
  const data = fixture();
  const ordinaryJ = Q.calculateQuote(data, request(data, { destination: data.destinations[1] }), settings());
  assert.equal(ordinaryJ.lines.find(l => l.label === '燃油附加费').cents, 800);
  const exempt = rawFixture(); exempt.rules.fuelExemptZones = ['J'];
  const customData = Q.validateRateData(exempt);
  const exemptJ = Q.calculateQuote(customData, request(customData, { destination: customData.destinations[1] }), settings());
  assert.equal(exemptJ.lines.find(l => l.label === '燃油附加费').cents, 0);
  const nonexempt = Q.calculateQuote(customData, request(customData), settings());
  assert.equal(nonexempt.lines.find(l => l.label === '燃油附加费').cents, 800);
});

test('display-line cents always sum exactly to the total after markup rounding', () => {
  const data = fixture();
  for (const margin of [0, 0.1, 7.37, 33.333]) {
    const result = Q.calculateQuote(data, request(data, { weight: 21, isDG: true }), settings({ fuel: 13.37, dg: 17.43, cross: 1.013, crossMin: 0, margin }));
    assert.ok(result.lines.every(l => Number.isSafeInteger(l.cents)));
    assert.equal(result.totalCents, result.lines.reduce((sum, l) => sum + l.cents, 0));
  }
});

test('settings validate numeric boundaries and retain legitimate zero values', () => {
  const zero = settings({ fuel: 0, dg: 0, cross: 0, crossMin: 0, margin: 0 });
  assert.equal(zero.dg, 0); assert.equal(zero.crossMin, 0);
  for (const key of ['fuel', 'dg', 'cross', 'crossMin', 'margin']) {
    for (const bad of [-1, Infinity, NaN, '0']) assert.throws(() => settings({ [key]: bad }), Q.QuoteError);
  }
  for (const days of [0, -1, 1.1, 366, Infinity, '5']) assert.throws(() => settings({ days }), Q.QuoteError);
  assert.throws(() => settings({ company: ' ' }), /抬头/);
  assert.throws(() => Q.normalizeSettings(null), /参数格式/);
});

test('corrupt or invalid stored settings recover safely without interrupting startup', () => {
  for (const raw of ['{broken', 'null', '[]', '"text"', '{"fuel":-1}', '{"days":0}']) {
    const result = Q.loadSettings(raw);
    assert.equal(result.recovered, true);
    assert.deepEqual(result.settings, Q.DEFAULT_SETTINGS);
  }
  assert.equal(Q.loadSettings(null).recovered, false);
  const valid = Q.loadSettings('{"company":"Saved local title","fuel":0,"dg":0}');
  assert.equal(valid.recovered, false); assert.equal(valid.settings.fuel, 0); assert.equal(valid.settings.dg, 0);
});

test('company text remains data, and the engine preserves demo provenance', () => {
  const data = fixture();
  const title = '<img src=x onerror=alert(1)>';
  const quote = Q.calculateQuote(data, request(data), settings({ company: title }));
  assert.equal(quote.company, title);
  assert.equal(quote.kind, 'demo');
  assert.equal(quote.rateName, 'Synthetic test tariff');
});
