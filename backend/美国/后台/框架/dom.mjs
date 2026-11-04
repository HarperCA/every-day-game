// 建一个页面元素：建('div', { class: '…', onclick: fn }, 子元素或文字…)。界面代码都用它，不拼 HTML 字符串。
export function 建(标签, 属性 = {}, ...子) {
  const 元素 = document.createElement(标签);
  for (const [名, 值] of Object.entries(属性)) {
    if (值 == null || 值 === false) continue;
    if (名 === 'class') 元素.className = 值;
    else if (名.startsWith('on')) 元素.addEventListener(名.slice(2), 值);
    else 元素.setAttribute(名, 值 === true ? '' : 值);
  }
  for (const c of 子.flat()) if (c != null && c !== false) 元素.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return 元素;
}
