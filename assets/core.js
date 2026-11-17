/* SPDX-License-Identifier: MIT */
(function (root) {
  'use strict';
  const SERVICES = ['IP', 'IE', 'IPE'];
  const PACKAGES = ['Package', 'Pak', 'Envelope'];
  const DEFAULT_RULES = Object.freeze({
    pieceMaxWeight: 20.5, pieceStep: 0.5, bulkMinimum: 21, bulkStep: 1,
    pakMaxWeight: 2.5, envelopeMaxWeight: 0.5, fuelExemptZones: []
  });
  const DEFAULT_SETTINGS = Object.freeze({
    company: 'GENORDA 国际物流', fuel: 12, dg: 200, cross: 3,
    crossMin: 30, margin: 0, days: 7
  });
  class QuoteError extends Error {
    constructor(message) { super(message); this.name = 'QuoteError'; }
  }
  function ensure(condition, message) { if (!condition) throw new QuoteError(message); }
  function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function number(value, name, min = 0, max = 1e9) {
    ensure(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, name + '无效。');
    return value;
  }
  function text(value, name, max = 160) {
    ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= max, name + '无效。');
    return value.trim();
  }
  function zoneName(value) { return typeof value === 'string' && /^[A-Z0-9]{1,5}$/.test(value); }
  function weightUnits(value, name = '重量') {
    const units = Math.round(value * 1e6);
    ensure(Math.abs(value - units / 1e6) <= Math.max(1e-12, Number.EPSILON * value * 4), name + '最多支持 6 位小数。');
    return units;
  }
  function date(value, name) {
    if (value == null || value === '') return null;
    ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), name + '须为 YYYY-MM-DD。');
    const parsed = new Date(value + 'T00:00:00Z');
    ensure(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, name + '无效。');
    return value;
  }
  function validateRateData(data) {
    ensure(record(data) && data.schemaVersion === 1, '不支持的价表格式；请导入 schemaVersion 为 1 的 JSON。');
    ensure(record(data.metadata) && ['demo', 'custom'].includes(data.metadata.kind), '价表须标明 demo 或 custom。');
    text(data.metadata.name, '价表名称');
    ensure(data.metadata.currency === 'CNY', '当前仅支持人民币（CNY）价表。');
    if (data.metadata.source != null) text(data.metadata.source, '价表来源', 1000);
    const from = date(data.metadata.effectiveFrom, '生效日期');
    const to = date(data.metadata.effectiveTo, '截止日期');
    ensure(!from || !to || from <= to, '价表起止日期顺序无效。');
    ensure(Array.isArray(data.destinations) && data.destinations.length > 0 && data.destinations.length <= 1000, '目的地列表无效。');
    const labels = new Set();
    for (const d of data.destinations) {
      ensure(record(d), '目的地条目无效。');
      text(d.cn, '目的地中文名'); text(d.en, '目的地英文名');
      if (d.zh != null) text(d.zh, '目的地别名');
      if (d.note != null) text(d.note, '目的地说明', 1000);
      const label = destinationLabel(d).toLowerCase();
      ensure(!labels.has(label), '目的地中英文组合重复：' + d.cn); labels.add(label);
      for (const service of SERVICES) {
        const key = service.toLowerCase();
        ensure(zoneName(d[key]) && typeof d[key + 'NA'] === 'boolean', d.cn + ' 的服务分区或可用标记无效。');
      }
    }
    ensure(record(data.rates), '缺少运价数据。');
    for (const service of SERVICES) {
      const r = data.rates[service];
      ensure(record(r) && record(r.piece) && record(r.perkg), service + ' 运价结构无效。');
      for (const [pack, zones] of Object.entries(r.piece)) {
        ensure(PACKAGES.includes(pack) && record(zones), '包装价表无效。');
        for (const [zone, prices] of Object.entries(zones)) {
          ensure(zoneName(zone) && record(prices) && Object.keys(prices).length > 0, '分区件价无效。');
          for (const [weight, price] of Object.entries(prices)) {
            ensure(pack === 'Envelope' ? weight === 'ENV' : /^\d+(\.\d+)?$/.test(weight) && Number(weight) > 0, '重量档名称无效。');
            number(price, '件价');
          }
        }
      }
      ensure(Object.keys(r.perkg).length > 0, service + ' 缺少大货价表。');
      for (const [zone, bands] of Object.entries(r.perkg)) {
        ensure(zoneName(zone) && Array.isArray(bands) && bands.length > 0 && bands.length <= 100, '大货重量带无效。');
        let end = -1;
        for (const b of bands) {
          ensure(Array.isArray(b) && b.length === 3, '重量带须为 [起重, 止重, 单价]。');
          number(b[0], '重量带起重', 0.000001, 1e6); number(b[1], '重量带止重', b[0], 1e6); number(b[2], '大货单价');
          ensure(b[0] > end, '重量带存在重叠或顺序错误。'); end = b[1];
        }
      }
    }
    const rules = { ...DEFAULT_RULES, ...(record(data.rules) ? data.rules : {}) };
    for (const key of ['pieceMaxWeight', 'pieceStep', 'bulkMinimum', 'bulkStep', 'pakMaxWeight', 'envelopeMaxWeight']) { number(rules[key], key, 0.000001, 1e6); weightUnits(rules[key], key); }
    ensure(rules.bulkMinimum > rules.pieceMaxWeight, '大货最低计费重须高于件价上限。');
    ensure(rules.pieceStep <= rules.pieceMaxWeight && rules.envelopeMaxWeight <= rules.pieceMaxWeight && rules.pakMaxWeight <= rules.pieceMaxWeight, '包装或进位规则超出件价范围。');
    ensure(Array.isArray(rules.fuelExemptZones) && rules.fuelExemptZones.every(zoneName), '免燃油分区须为分区名称数组。');
    return { ...data, rules };
  }
  function normalizeSettings(settings = {}) {
    ensure(record(settings), '参数格式无效。');
    const s = { ...DEFAULT_SETTINGS, ...settings };
    s.company = text(s.company, '报价单抬头', 120);
    const names = { fuel: '燃油附加费率', dg: '危险品操作费', cross: '每公斤衔接费', crossMin: '衔接费最低收费', margin: '加价率' };
    for (const key of ['fuel', 'dg', 'cross', 'crossMin', 'margin']) number(s[key], names[key], 0, key === 'fuel' || key === 'margin' ? 1000 : 1e7);
    number(s.days, '参考期限', 1, 365); ensure(Number.isInteger(s.days), '参考期限须为整数天。');
    return s;
  }
  function loadSettings(raw) {
    try { return { settings: normalizeSettings(raw ? JSON.parse(raw) : {}), recovered: false }; }
    catch (_) { return { settings: { ...DEFAULT_SETTINGS }, recovered: true }; }
  }
  function destinationLabel(d) { return d.cn + ' / ' + d.en; }
  function findDestination(query, destinations) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    const exactLabel = destinations.filter(d => destinationLabel(d).toLowerCase() === q);
    if (exactLabel.length === 1) return exactLabel[0];
    const exactName = destinations.filter(d => [d.cn, d.en, d.zh].some(v => typeof v === 'string' && v.trim().toLowerCase() === q));
    return exactName.length === 1 ? exactName[0] : null;
  }
  function roundWeight(weight, step) { return Math.ceil(weightUnits(weight) / weightUnits(step, '进位步长')) * weightUnits(step, '进位步长') / 1e6; }
  function cents(value) { return Math.round((value + Number.EPSILON) * 100); }
  function lookupFreight(data, { service, weight, pack, isDG = false, destination }) {
    ensure(SERVICES.includes(service), '请选择有效服务。');
    ensure(PACKAGES.includes(pack), '请选择有效包装。');
    number(weight, '计费重量', 0.000001, 1e6);
    weightUnits(weight, '计费重量');
    ensure(data.destinations.includes(destination), '请从列表中精确选定目的地。');
    const key = service.toLowerCase();
    ensure(!destination[key + 'NA'], '当前价表未启用该目的地的 ' + service + ' 服务，请更换服务或人工核对。');
    ensure(service !== 'IE' || pack === 'Package', '当前价表的 IE 服务仅支持 Package 包裹。');
    const r = data.rules;
    ensure(pack !== 'Envelope' || weight <= r.envelopeMaxWeight, '当前价表文件封上限为 ' + r.envelopeMaxWeight + ' kg，请改用 Package。');
    ensure(pack !== 'Pak' || weight <= r.pakMaxWeight, '当前价表快递袋上限为 ' + r.pakMaxWeight + ' kg，请改用 Package。');
    ensure(!isDG || pack === 'Package', '危险品试算请使用 Package；实际包装与承运接受须逐票核对。');
    const zone = destination[key];
    let chargeableWeight, freight;
    if (weight <= r.pieceMaxWeight) {
      chargeableWeight = roundWeight(weight, r.pieceStep);
      ensure(chargeableWeight <= r.pieceMaxWeight, '进位后的重量超出件价范围，请核对价表规则。');
      const table = data.rates[service].piece[pack]?.[zone];
      ensure(record(table), '价表未覆盖该服务、包装和分区组合。');
      const rateKey = pack === 'Envelope' ? 'ENV' : Object.keys(table).find(k => Number(k) === chargeableWeight);
      freight = table[rateKey];
      ensure(typeof freight === 'number' && Number.isFinite(freight), '价表未覆盖进位后的重量档，请人工查询。');
    } else {
      ensure(pack === 'Package', '大货试算仅支持 Package。');
      chargeableWeight = roundWeight(Math.max(weight, r.bulkMinimum), r.bulkStep);
      const band = data.rates[service].perkg[zone]?.find(b => chargeableWeight >= b[0] && chargeableWeight <= b[1]);
      ensure(band, '进位后的重量超出价表范围或落入缺失重量带，请人工查询。');
      freight = band[2] * chargeableWeight;
    }
    return { freight, chargeableWeight, zone };
  }
  function calculateQuote(data, input, settings = DEFAULT_SETTINGS) {
    const s = normalizeSettings(settings);
    ensure(typeof input.isDG === 'boolean', '货物属性无效。');
    const { freight, chargeableWeight, zone } = lookupFreight(data, input);
    const dg = input.isDG ? s.dg : 0;
    const fuel = data.rules.fuelExemptZones.includes(zone) ? 0 : (freight + dg) * s.fuel / 100;
    const cross = Math.max(s.crossMin, chargeableWeight * s.cross);
    const factor = 1 + s.margin / 100;
    const rawLines = [['国际快递运费', freight], ...(input.isDG ? [['危险品操作费', dg]] : []), ['燃油附加费', fuel], ['内地至香港衔接费', cross]];
    const lines = rawLines.map(([label, amount]) => ({ label, cents: cents(amount * factor) }));
    const totalCents = lines.reduce((sum, line) => sum + line.cents, 0);
    ensure(Number.isSafeInteger(totalCents), '计算金额过大，请检查参数。');
    return { ...input, zone, chargeableWeight, lines, totalCents, company: s.company, days: s.days, kind: data.metadata.kind, rateName: data.metadata.name };
  }
  const api = Object.freeze({ SERVICES, PACKAGES, DEFAULT_RULES, DEFAULT_SETTINGS, QuoteError, validateRateData, normalizeSettings, loadSettings, destinationLabel, findDestination, lookupFreight, calculateQuote });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GenordaQuote = api;
})(globalThis);
