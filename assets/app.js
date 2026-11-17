/* SPDX-License-Identifier: MIT */
(function () {
  'use strict';
  const core = globalThis.GenordaQuote;
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'genorda-quote-settings-v1';
  const SITE = 'https://www.genorda-logistics.hk/';
  const SERVICE_NAME = { IP: 'FedEx IP 国际优先', IE: 'FedEx IE 国际经济', IPE: 'FedEx IPE' };
  const PACK_NAME = { Package: 'Package 包裹', Pak: 'Pak 快递袋', Envelope: 'Envelope 文件封' };
  const DISCLAIMER = '本结果仅为费用估算，不含关税、目的地税费、偏远地区、高风险、超尺寸及其他未配置收费；最终金额须人工复核。所有安排按本票货物、包装、数量、路线和承运人当期条件逐票评估，不保证承运人接受或运输结果。';
  let data, settings, quoteText = '', hasQuote = false, toastTimer;
  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }
  function money(value) { return '¥' + (value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function today() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }
  function service() { return document.querySelector('input[name="service"]:checked').value; }
  function showToast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200);
  }
  function invalidate() {
    if (hasQuote) $('result').replaceChildren(element('p', 'stale', '信息已修改，请重新生成费用估算。'));
    hasQuote = false; quoteText = '';
  }
  function failure(message) { $('result').replaceChildren(element('p', 'error-message', message)); hasQuote = false; quoteText = ''; }
  function populateDestinations() {
    $('destList').replaceChildren(...data.destinations.map(destination => {
      const option = document.createElement('option'); option.value = core.destinationLabel(destination); return option;
    }));
  }
  function updateDestination() {
    const destination = core.findDestination($('dest').value, data.destinations);
    const key = service().toLowerCase();
    $('zoneView').textContent = destination ? 'Zone ' + destination[key] + (destination[key + 'NA'] ? ' · 此价表未启用' : '') : '—';
    $('destinationNote').textContent = destination?.note || '';
    $('destinationNote').hidden = !destination?.note;
    return destination;
  }
  function renderDataStatus() {
    const demo = data.metadata.kind === 'demo';
    $('dataStatus').classList.toggle('custom', !demo);
    $('dataStatus').replaceChildren(element('b', '', demo ? '演示模式' : '本地价表'), element('span', '', demo ? '使用合成金额，仅供功能演示，不可用于实际报价。' : '使用已导入的本地价表；价表和结果须人工复核，刷新后恢复演示模式。'));
    const dates = [data.metadata.effectiveFrom ? '自 ' + data.metadata.effectiveFrom : '', data.metadata.effectiveTo ? '至 ' + data.metadata.effectiveTo : ''].filter(Boolean).join(' ');
    $('rateInfo').textContent = data.metadata.name + ' · ' + data.destinations.length + ' 个目的地示例条目' + (dates ? ' · ' + dates : '');
    const r = data.rules;
    $('rulesSummary').textContent = '当前价表规则：件价至 ' + r.pieceMaxWeight + ' kg，每 ' + r.pieceStep + ' kg 向上进位；大货最低 ' + r.bulkMinimum + ' kg，每 ' + r.bulkStep + ' kg 向上进位；文件封上限 ' + r.envelopeMaxWeight + ' kg、快递袋上限 ' + r.pakMaxWeight + ' kg。以上为可配置的价表计算规则，非承运人统一接受条件。';
  }
  function buildQuote(quote, destination) {
    const date = today();
    const suffix = globalThis.crypto?.randomUUID ? crypto.randomUUID().slice(0, 6).toUpperCase() : String(Math.floor(Math.random() * 900000) + 100000);
    const no = 'EST' + date.replaceAll('-', '') + '-' + suffix;
    const mode = quote.kind === 'demo' ? '演示数据 · 合成金额，不可用于实际报价' : '本地价表费用估算 · 须人工复核，不代表承运批准';
    const doc = element('article', 'quote-doc');
    const header = element('div', 'quote-head');
    const title = element('div'); title.append(element('div', 'quote-company', quote.company), element('div', 'quote-sub', '费用估算单 · ESTIMATE'));
    const identifier = element('div', 'quote-number'); identifier.append(element('div', '', no), element('div', '', date));
    header.append(title, identifier); doc.append(header, element('div', 'quote-mode', mode));
    const meta = element('div', 'quote-meta');
    for (const [label, value] of [['目的地 / 价表分区', destination.cn + ' · Zone ' + quote.zone], ['服务类型', SERVICE_NAME[quote.service]], ['输入重 / 计费重', quote.weight + ' / ' + quote.chargeableWeight + ' kg'], ['包装 / 货物属性', PACK_NAME[quote.pack] + (quote.isDG ? ' · DG 费用试算' : ' · 未勾选 DG')]]) {
      const cell = element('div', '', label); cell.append(element('b', '', value)); meta.append(cell);
    }
    doc.append(meta);
    const lines = element('div', 'quote-lines');
    for (const line of quote.lines) {
      const row = element('div', 'quote-line'); row.append(element('span', '', line.label), element('b', '', money(line.cents))); lines.append(row);
    }
    const total = element('div', 'quote-total');
    const totalLabel = element('div', 'quote-total-label', '估算合计 · 人民币'); totalLabel.append(element('div', 'quote-days', '配置的估算参考期限 ' + quote.days + ' 天，仍须人工确认'));
    total.append(totalLabel, element('div', 'quote-amount', money(quote.totalCents))); doc.append(lines, total);
    const actions = element('div', 'quote-actions');
    const copy = element('button', '', '复制估算单'); copy.type = 'button'; copy.addEventListener('click', copyQuote);
    const print = element('button', '', '打印 / 保存 PDF'); print.type = 'button'; print.addEventListener('click', () => window.print());
    actions.append(copy, print); doc.append(actions);
    const notes = element('div', 'quote-notes');
    notes.append(element('p', '', '价表：' + quote.rateName + '。' + (destination.note || '')));
    if (quote.isDG) notes.append(element('p', '', 'DG 提醒：须逐票核对分类、包装、数量、文件、路线及承运条件；本工具不判断 EQ 或小包装优惠的适用性。'));
    notes.append(element('p', '', DISCLAIMER));
    notes.append(element('p', '', '服务名称或规则引用不代表 GENORDA 获得承运人认证、授权或保证结果。'));
    const companyLink = element('a', '', 'GENORDA 官方网站 · genorda-logistics.hk'); companyLink.href = SITE; companyLink.target = '_blank'; companyLink.rel = 'noopener noreferrer';
    const linkLine = element('p'); linkLine.append(companyLink); notes.append(linkLine); doc.append(notes);
    const resultNodes = [];
    if (quote.weight > data.rules.pieceMaxWeight) resultNodes.push(element('p', 'quote-warning', '大货按当前价表的进位与重量带规则试算；实际计费、特殊包装及渠道条件请人工核对。'));
    if (data.metadata.kind !== 'demo' && !data.metadata.effectiveFrom && !data.metadata.effectiveTo) resultNodes.push(element('p', 'quote-warning', '导入价表未填写适用日期，请维护者确认本次报价使用的版本。'));
    $('result').replaceChildren(...resultNodes, doc);
    const texts = [mode, quote.company + ' · 费用估算单', '编号：' + no + '　日期：' + date, '目的地：' + core.destinationLabel(destination), '服务：' + SERVICE_NAME[quote.service] + '　分区：' + quote.zone, '包装：' + PACK_NAME[quote.pack], '输入重量：' + quote.weight + ' kg　计费重量：' + quote.chargeableWeight + ' kg', '货物属性：' + (quote.isDG ? 'DG 费用试算，承运须核对' : '未勾选 DG；不代表普通货物分类结论'), '--------------------', ...quote.lines.map(line => line.label + '：' + money(line.cents)), '合计：' + money(quote.totalCents) + ' CNY', '配置的估算参考期限：' + quote.days + ' 天（仍须人工确认）', '价表：' + quote.rateName];
    if (destination.note) texts.push(destination.note);
    if (quote.isDG) texts.push('DG 须逐票核对分类、包装、数量、文件、路线和承运条件；不自动判断 EQ 或小包装优惠。');
    texts.push(DISCLAIMER, '引用服务名称或规则不代表 GENORDA 获得认证、授权或保证结果。', 'GENORDA 官方网站：' + SITE);
    quoteText = texts.join('\n'); hasQuote = true;
  }
  function calculate(event) {
    event?.preventDefault();
    try {
      const destination = updateDestination();
      if (!destination) throw new Error('请从列表中精确选定目的地；简称、模糊名称或重名条目不能自动确定分区。');
      const currentDate = today();
      if (data.metadata.effectiveFrom && currentDate < data.metadata.effectiveFrom) throw new Error('该价表尚未到生效日期，请导入适用的价表。');
      if (data.metadata.effectiveTo && currentDate > data.metadata.effectiveTo) throw new Error('该价表已超过截止日期，请更新后再试算。');
      const raw = $('weight').value.trim();
      const quote = core.calculateQuote(data, { destination, service: service(), pack: $('pack').value, weight: raw ? Number(raw) : NaN, isDG: $('dg').checked }, settings);
      buildQuote(quote, destination);
    } catch (error) { failure(error.message); }
  }
  function fillExample() {
    const destination = data.destinations.find(d => d.en === 'U.S. (Rest of Country)') || data.destinations.find(d => !d.ipNA);
    if (!destination) { showToast('当前价表没有可用的 IP 示例，请自行选择。'); return; }
    $('dest').value = core.destinationLabel(destination); $('weight').value = '1'; $('pack').value = 'Package'; $('dg').checked = false;
    document.querySelector('input[name="service"][value="IP"]').checked = true;
    updateService(); updateDestination(); $('dgNote').hidden = true; invalidate();
    showToast('示例已填入，点击“生成费用估算”查看结果。');
  }
  function updateService() {
    const ie = service() === 'IE';
    for (const option of $('pack').options) option.disabled = ie && option.value !== 'Package';
    if (ie) $('pack').value = 'Package';
    updateDestination();
  }
  function populateSettings() {
    for (const key of ['company', 'fuel', 'dg', 'cross', 'crossMin', 'margin', 'days']) $('settingsForm').elements[key].value = settings[key];
    $('settingsError').hidden = true;
  }
  function saveSettings(event) {
    event.preventDefault();
    try {
      const form = $('settingsForm');
      const next = { company: form.elements.company.value.trim() };
      for (const key of ['fuel', 'dg', 'cross', 'crossMin', 'margin', 'days']) next[key] = form.elements[key].value.trim() === '' ? NaN : Number(form.elements[key].value);
      settings = core.normalizeSettings(next);
      let stored = true;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (_) { stored = false; }
      invalidate(); $('settingsDialog').close();
      showToast(stored ? '参数已保存到当前浏览器。' : '参数已应用；浏览器未允许持久保存。');
    } catch (error) { $('settingsError').textContent = error.message; $('settingsError').hidden = false; }
  }
  async function importRate(event) {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('价表文件不能超过 2 MB。');
      const next = core.validateRateData(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
      data = next; $('dest').value = ''; populateDestinations(); updateDestination(); renderDataStatus(); invalidate();
      $('importStatus').textContent = '价表已导入当前页面内存，未上传；请核对计费规则和本地参数。';
      showToast('价表已在本地导入。');
    } catch (error) { $('importStatus').textContent = '导入失败：' + error.message; }
    event.target.value = '';
  }
  async function copyQuote() {
    if (!quoteText) { showToast('请先生成估算单。'); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(quoteText); showToast('估算单已复制，包含演示标识与适用边界。');
    } catch (_) {
      $('copyText').value = quoteText; $('copyDialog').showModal(); $('copyText').focus(); $('copyText').select();
    }
  }
  try {
    data = core.validateRateData(globalThis.GENORDA_RATE_DATA);
    let raw = null, storageAvailable = true;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (_) { storageAvailable = false; }
    const loaded = core.loadSettings(raw); settings = loaded.settings;
    populateDestinations(); renderDataStatus();
    $('quoteForm').addEventListener('submit', calculate);
    $('quoteForm').addEventListener('input', () => { updateDestination(); invalidate(); });
    document.querySelectorAll('input[name="service"]').forEach(input => input.addEventListener('change', () => { updateService(); invalidate(); }));
    $('dg').addEventListener('change', () => { $('dgNote').hidden = !$('dg').checked; invalidate(); });
    $('loadExample').addEventListener('click', fillExample); $('emptyExample').addEventListener('click', fillExample);
    $('openSettings').addEventListener('click', () => { populateSettings(); $('settingsDialog').showModal(); });
    $('closeSettings').addEventListener('click', () => $('settingsDialog').close());
    $('settingsForm').addEventListener('submit', saveSettings);
    $('rateFile').addEventListener('change', importRate);
    $('restoreDemo').addEventListener('click', () => {
      data = core.validateRateData(globalThis.GENORDA_RATE_DATA); $('dest').value = ''; populateDestinations(); updateDestination(); renderDataStatus(); invalidate();
      $('importStatus').textContent = '已恢复合成演示价表；本地参数保持当前设置。';
    });
    $('resetSettings').addEventListener('click', () => {
      for (const key of ['company', 'fuel', 'dg', 'cross', 'crossMin', 'margin', 'days']) $('settingsForm').elements[key].value = core.DEFAULT_SETTINGS[key];
      $('settingsError').hidden = true;
      showToast('已填回示例参数，请点击保存后应用。');
    });
    $('closeCopy').addEventListener('click', () => $('copyDialog').close());
    if (loaded.recovered) showToast('本地参数格式损坏，已恢复示例参数。');
    else if (!storageAvailable) showToast('浏览器存储不可用，参数仅在本页生效。');
  } catch (error) {
    failure('工具初始化失败：' + error.message); $('quoteForm').querySelector('button[type="submit"]').disabled = true;
  }
})();
