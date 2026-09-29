// 页面共用的小工具：转义、提示、跳转、弹窗。
export const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const app = () => document.getElementById('app')!;

export function go(hash: string) { location.hash = hash; }

let toastTimer: number | undefined;
export function toast(text: string) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 1800);
}

// 代替小程序的 wx.showModal：返回用户是否点了确认。
export function confirmDialog(title: string, content: string, confirmText = '确定'): Promise<boolean> {
  return new Promise(resolve => {
    const mask = document.createElement('div');
    mask.className = 'dialog-mask';
    mask.innerHTML = `<div class="dialog" role="dialog" aria-modal="true"><div class="dialog-title">${esc(title)}</div><div class="dialog-content">${esc(content)}</div>
      <div class="dialog-actions"><button data-r="0">取消</button><button data-r="1" class="dialog-ok">${esc(confirmText)}</button></div></div>`;
    mask.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest('[data-r]') as HTMLElement | null;
      if (!target && event.target !== mask) return;
      mask.remove();
      resolve(target?.dataset.r === '1');
    });
    document.body.appendChild(mask);
  });
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const area = document.createElement('textarea');
    area.value = text; document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy'); area.remove();
    return ok;
  }
}

// 事件委托：所有页面渲染在同一个 #app 里，点击、提交、选择统一在这里监听，
// 只交给“当前页面”登记的处理函数，页面之间不会串。
export interface PageHandlers {
  act?: Record<string, (el: HTMLElement, event: Event) => void>;
  change?: (el: HTMLElement, event: Event) => void;
  submit?: (form: HTMLFormElement, event: Event) => void;
}
let current: PageHandlers = {};
export function setPageHandlers(handlers: PageHandlers) { current = handlers; }

export function installRootHandlers() {
  const root = app();
  root.addEventListener('click', event => {
    const el = (event.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el || !root.contains(el)) return;
    const handler = current.act?.[el.dataset.act!];
    if (handler) handler(el, event);
  });
  root.addEventListener('change', event => {
    const el = (event.target as HTMLElement).closest('[data-change]') as HTMLElement | null;
    if (el) current.change?.(el, event);
  });
  root.addEventListener('submit', event => {
    const form = event.target as HTMLFormElement;
    event.preventDefault();
    current.submit?.(form, event);
  });
}

export const BASE = '/app/';

// 本地时间（北京时间）的“2026-09-29 18:58”，withTime=false 时只要日期
export function localTime(iso: string, withTime = true) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

// 当前显示的是哪个页面、第几次进入。异步加载回来时如果用户已经切走了，就不要再往 #app 里画。
let activeView = { name: '', seq: 0 };
export function enterView(name: string) { activeView = { name, seq: activeView.seq + 1 }; return activeView.seq; }
export const isActive = (name: string, seq?: number) => activeView.name === name && (seq === undefined || activeView.seq === seq);
