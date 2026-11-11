// 测试用：扫描文件夹里的 .mjs，找出每个文件引用了哪些本地文件。ai、db、pipeline 的“引用规矩”测试都用它。
import fs from 'node:fs';
import path from 'node:path';

// 不扫的文件夹：测试本身、装好的库、运行数据
export const SKIP_DIRS = ['test', 'node_modules', 'Environment', '日志', '数据'];

export function walk(dir, skip = SKIP_DIRS) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return skip.includes(entry.name) ? [] : walk(full, skip);
    return entry.name.endsWith('.mjs') ? [full] : [];
  });
}

// 一个文件引用的本地文件（以 . 开头的），返回绝对路径；注释里的不算
export function importsOf(file) {
  const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const specs = [...code.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"`]([^'"`]+)['"`]\s*\)/g)].map(m => m[1] || m[2]);
  return specs.filter(spec => spec.startsWith('.')).map(spec => path.resolve(path.dirname(file), spec));
}

// 相对路径，统一用 / 分隔
export const relTo = (base, file) => path.relative(base, file).split(path.sep).join('/');
