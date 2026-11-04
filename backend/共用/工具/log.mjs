// 统一日志：每行带时间、模块名和级别，写进当晚的 run.log，需要时同时打印到控制台。
import fs from 'node:fs';

export function createLogger(file, { console: toConsole = false, module = '总控' } = {}) {
  const write = (level, message) => {
    const line = `${new Date().toISOString()} [${module}] ${level} ${message}`;
    if (file) fs.appendFileSync(file, line + '\n', 'utf8');
    if (toConsole) (level === '错误' ? console.error : console.log)(line);
  };
  return {
    info: message => write('信息', message),
    warn: message => write('警告', message),
    error: message => write('错误', message),
    // 给某个模块用的日志，写进同一个文件，模块名换成它自己的
    child: name => createLogger(file, { console: toConsole, module: name }),
  };
}
