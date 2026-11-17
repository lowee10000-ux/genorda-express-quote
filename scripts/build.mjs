// SPDX-License-Identifier: MIT
import { mkdir, copyFile, readdir, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_FILES = ['index.html', 'assets/app.css', 'assets/app.js', 'assets/core.js', 'assets/favicon.svg', 'data/demo-rates.js'];
const out = resolve(root, 'dist');
try {
  const stat = await lstat(out);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('dist 须为普通目录，不可为符号链接。');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(out, { recursive: true });
// Refuse unexpected old output instead of publishing or recursively deleting it.
async function inspectOutput(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = prefix + entry.name;
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('dist 含符号链接或特殊文件：' + file);
    if (entry.isDirectory()) {
      if (!['assets', 'data'].includes(file)) throw new Error('dist 含非公开目录：' + file);
      await inspectOutput(resolve(directory, entry.name), file + '/');
    } else if (!PUBLIC_FILES.includes(file)) throw new Error('dist 存在非公开文件，请先移走：' + file);
  }
}
await inspectOutput(out);
for (const file of PUBLIC_FILES) {
  let cursor = root;
  for (const part of file.split('/')) {
    cursor = resolve(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('公开源文件路径不可含符号链接：' + file);
  }
  if (!(await lstat(resolve(root, file))).isFile()) throw new Error('公开源文件须为普通文件：' + file);
  const target = resolve(out, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, file), target);
}
console.log('构建完成：dist/（' + PUBLIC_FILES.length + ' 个公开静态文件；不含私有运价）');
