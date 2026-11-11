// 登录框（浏览器里跑，2026-11-03）：取数据时服务器回“要先登录”，弹出这个框输口令；登录成功服务器发会话 cookie，框关掉后接着取。
// 同时只弹一个框，几个请求一起等它。网络请求只在 请求.mjs 里发：它把“交口令”的函数传进来。
//   要登录(交口令) → 登录成功后 resolve；交口令(口令) 成功就 resolve，失败抛出原因
import { 建 } from './dom.mjs';

let 等着 = null;

export function 要登录(交口令) {
  if (等着) return 等着;
  等着 = new Promise(好 => {
    const 输入 = 建('input', { type: 'password', name: '口令', autocomplete: 'current-password', required: true });
    const 出错 = 建('div', { class: '状态 出错', hidden: true });
    const 按钮 = 建('button', { type: 'submit', class: '主要' }, '登录');
    const 框 = 建('dialog', { class: '编辑框' });
    框.addEventListener('cancel', e => e.preventDefault());   // 不登录关不掉
    框.append(建('form', { method: 'dialog', onsubmit: async e => {
      e.preventDefault();
      按钮.disabled = true; 出错.hidden = true;
      try {
        await 交口令(输入.value);
        框.close(); 框.remove(); 等着 = null; 好();
      } catch (错误) {
        出错.textContent = String(错误?.message || 错误); 出错.hidden = false; 按钮.disabled = false; 输入.select();
      }
    } },
    建('h3', {}, '登录新后台'),
    建('p', { class: '次要' }, '口令和旧后台一样。登录后 12 小时内不用再输。'),
    建('label', {}, '口令', 输入),
    出错,
    建('div', { class: '按钮行' }, 按钮)));
    document.body.append(框);
    框.showModal();
    输入.focus();
  });
  return 等着;
}
