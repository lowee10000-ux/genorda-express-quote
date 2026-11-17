// SPDX-License-Identifier: MIT
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import core from '../assets/core.js';

// Extract JSON literals only. Never import, eval, or execute an untrusted rates.js.
export function readLiteral(source, name) {
  const match = new RegExp('(?:^|[\\r\\n])\\s*(?:const|let|var)\\s+' + name + '\\s*=\\s*').exec(source);
  if (!match) throw new Error('找不到 ' + name + ' 的 JSON 常量。');
  const start = match.index + match[0].length;
  let depth = 0, inString = false, escaped = false;
  if (!['{', '['].includes(source[start])) throw new Error(name + ' 必须是 JSON 对象或数组。');
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return JSON.parse(source.slice(start, i + 1));
    }
  }
  throw new Error(name + ' JSON 不完整。');
}
export function convert(source) {
  return core.validateRateData({
    schemaVersion: 1,
    metadata: { kind: 'custom', name: '本地私有运价表', currency: 'CNY', effectiveFrom: null, effectiveTo: null, source: '用户提供的本地价表；分区、包装上限、进位规则和适用日期须由维护者确认。' },
    destinations: readLiteral(source, 'ZONE_MAP'), rates: readLiteral(source, 'RATES'),
    rules: { ...core.DEFAULT_RULES, fuelExemptZones: [] }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = process.argv[2];
    if (!input) throw new Error('用法：node scripts/convert-rates.mjs "本地 rates.js 路径"');
    const raw = await readFile(resolve(input), 'utf8');
    if (Buffer.byteLength(raw) > 2_000_000) throw new Error('文件超过 2 MB。');
    const data = convert(raw.replace(/^\uFEFF/, ''));
    const output = resolve(dirname(fileURLToPath(import.meta.url)), '../.private/rates.private.json');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    console.log('转换完成：' + output + '\n仅供本地导入；不会进入构建或公开包。目的地条目：' + data.destinations.length);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
