// 信息纠错：照小程序 pages/feedback 的表单。网页测试版没有登录，
// 提交内容作为匿名统计里的一条“纠错”发给服务器，在后台“测试版统计”里查看；本机只留一份提交记录。
import { getCompetition } from '../api';
import { addFeedbackRecord, getFeedbackRecords } from '../favorites';
import { track } from '../track';
import { app, esc, go, localTime, setPageHandlers, toast } from '../ui';

const categories = [
  { value: 'time', label: '时间信息' },
  { value: 'registration_link', label: '报名链接' },
  { value: 'eligibility', label: '参赛资格' },
  { value: 'rules', label: '比赛规则' },
  { value: 'other', label: '其他问题' },
];
const MAX_LENGTH = 400;   // 服务器单条上限 500，留出类别和证据链接的位置

let editionId = '';
let competitionName = '';

function render() {
  const records = getFeedbackRecords();
  app().innerHTML = `<div class="page pg-feedback">
    <div class="notice">纠错内容会进入管理员审核，不会由 AI 自动改写赛事信息。</div>
    <form class="card" data-form="feedback">
      ${editionId
        ? `<div class="competition"><span>纠错赛事</span><strong>${esc(competitionName || '加载中…')}</strong></div>`
        : '<div class="field"><span>纠错赛事</span><div class="picker picker-empty">请从赛事详情页点击“信息纠错”进入</div></div>'}
      <label class="field"><span>问题类型</span><select name="category" class="picker">${categories.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}</select></label>
      <label class="field"><span>问题说明 <i>必填</i></span><textarea name="content" maxlength="${MAX_LENGTH}" placeholder="请说明哪里有误，以及你认为正确的信息。不要填写身份证号、密码等敏感信息。"></textarea><small data-count>0 / ${MAX_LENGTH}</small></label>
      <label class="field"><span>证据链接 <i>选填</i></span><input type="text" name="evidence" placeholder="https:// 主办方通知或官网页面"></label>
      <button class="btn submit primary" type="submit" ${editionId ? '' : 'disabled'}>提交纠错</button>
    </form>
    <div class="records card"><div class="records-head">我的纠错${records.length ? `<span>${records.length} 条</span>` : ''}</div>
      ${records.length ? records.map(record => `<div class="record"><div class="record-top"><strong>${esc(record.competitionName)}</strong><span class="status status-pending_ai_review">已提交</span></div>
        <div class="record-meta">${esc(record.category)} · ${esc(localTime(record.createdAt))}</div><div class="record-content">${esc(record.content)}</div></div>`).join('')
        : '<div class="records-empty">你还没有提交过纠错。</div>'}
    </div>
  </div>`;
  const area = app().querySelector('textarea');
  area?.addEventListener('input', () => { app().querySelector('[data-count]')!.textContent = `${area.value.length} / ${MAX_LENGTH}`; });
}

const handlers = {
  submit: (form: HTMLFormElement) => {
    const data = new FormData(form);
    const content = String(data.get('content') || '').trim();
    const evidence = String(data.get('evidence') || '').trim();
    const category = categories.find(c => c.value === data.get('category'))?.label || '其他问题';
    if (!editionId) return;
    if (content.length < 5) { toast('请至少写 5 个字说明问题'); return; }
    if (evidence && !/^https?:\/\//i.test(evidence)) { toast('证据链接需以 http:// 或 https:// 开头'); return; }
    track('feedback', { id: editionId, name: competitionName, text: `【${category}】${content}${evidence ? ` 证据：${evidence}` : ''}` });
    addFeedbackRecord({ editionId, competitionName, category, content, createdAt: new Date().toISOString() });
    toast('已提交，感谢纠错');
    render();
  },
  act: { home: () => go('#/') },
};

export async function renderFeedback(id: string) {
  setPageHandlers(handlers);
  document.title = '信息纠错 · 竞赛雷达';
  editionId = id; competitionName = '';
  render();
  if (!id) return;
  try { competitionName = (await getCompetition(id)).name; } catch { competitionName = '赛事'; }
  if (location.hash.startsWith('#/feedback/')) render();
}
