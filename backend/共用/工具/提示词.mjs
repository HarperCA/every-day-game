// 读提示词：各处文件夹里的 prompt.md，第一行写版本号（<!-- 版本：v3 -->），把 {{变量}} 换成实际内容。
// 版本号交给 AI 总管随调用记账，改提示词后能对照前后效果。寻找流程的模块、程序审核都用，所以放在 共用/工具/。
//
// 接口：loadPrompt(promptFile, variables) → { version, text }；没写版本号、少给变量都报错
import fs from 'node:fs';

export function loadPrompt(promptFile, variables = {}) {
  const raw = fs.readFileSync(promptFile, 'utf8');
  const head = raw.match(/^<!--\s*版本：\s*(\S+?)\s*-->\r?\n?/);
  if (!head) throw new Error(`${promptFile} 第一行没写版本号（<!-- 版本：xxx -->）`);
  const text = raw.slice(head[0].length).replace(/\{\{(.+?)\}\}/g, (_, name) => {
    if (!Object.hasOwn(variables, name)) throw new Error(`提示词 ${promptFile} 少给了变量 ${name}`);
    return String(variables[name]);
  });
  return { version: head[1], text: text.trim() };
}
