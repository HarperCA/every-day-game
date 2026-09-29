// 赛事详情：照小程序 pages/detail 复刻，去掉“设置提醒”。
// 网页上可以直接打开官方报名页，所以比小程序多一个“打开官方报名页面”按钮（复制链接仍保留）。
import { getCompetition } from '../api';
import { isFavorite, toggleFavorite } from '../favorites';
import { track } from '../track';
import { app, confirmDialog, copyText, esc, go, isActive, setPageHandlers, toast } from '../ui';

const state = { item: null as any, loading: true, error: '', favorite: false, recommendationExpanded: false, rulesExpanded: false, officialInfoExpanded: false };

const SOURCE_TYPE_LABELS: Record<string, string> = {
  organizer_website: '主办方官网', official_registration_system: '官方报名系统', organizer_notice: '主办方通知', authority_notice: '主管部门通知',
};

function fold(act: string, title: string, expanded: boolean) {
  return `<div class="fold-heading" data-act="${act}" role="button" aria-expanded="${expanded}"><span>${title}</span><span class="fold-action">${expanded ? '收起 ▲' : '展开 ▼'}</span></div>`;
}

function list(items: string[]) {
  return items.length ? items.map(text => `<div class="bullet">· ${esc(text)}</div>`).join('') : '<div>暂无说明</div>';
}

let viewSeq = 0;

function render() {
  if (!isActive('detail', viewSeq)) return;
  if (state.loading) { app().innerHTML = '<div class="page pg-detail state">正在加载赛事资料…</div>'; return; }
  if (state.error || !state.item) { app().innerHTML = `<div class="page pg-detail state">${esc(state.error || '赛事不存在')}<div style="margin-top:14px"><button class="btn mini" data-act="home">返回找比赛</button></div></div>`; return; }
  const item = state.item;
  const rec = item.recommendation;
  app().innerHTML = `<div class="page pg-detail">
    <div class="summary card">
      <div class="status">${esc(item.registrationStatus)}</div>
      <div class="title">${esc(item.name)}</div>
      <div class="edition-meta"><div><span>赛事年份</span><span>${esc(item.editionYear || '未明确')}</span></div><div><span>第几届</span><span>${esc(item.editionOrdinal || '未明确')}</span></div></div>
      <div class="tag-row"><span>${esc(item.eventLevel)}</span>${(item.objectiveTags || []).map((tag: string) => `<span>${esc(tag)}</span>`).join('')}</div>
      <button class="btn ghost ${state.favorite ? 'favorited' : ''}" data-act="favorite">${state.favorite ? '已收藏 · 点击取消' : '收藏赛事'}</button>
    </div>
    <div class="recommendation card">
      <div class="recommendation-head" data-act="toggle-rec" role="button" aria-expanded="${state.recommendationExpanded}"><span>${esc(item.recommendationLevel)}</span><span class="reference">仅供参考</span><span class="recommendation-toggle">${state.recommendationExpanded ? '收起 ▲' : '展开 ▼'}</span></div>
      ${state.recommendationExpanded ? `<div class="recommendation-body">
        <div class="label">适合对象</div><div>${esc(rec.suitable_for || '暂无说明')}</div>
        <div class="label">推荐理由</div>${list(rec.reasons || [])}
        <div class="label">限制条件</div>${list(rec.limitations || [])}
        <div class="label">准备建议</div><div>${esc(rec.preparation || '暂无说明')}</div>
        <div class="confidence">推荐可信度：${esc(rec.confidence || '待核验')}</div></div>` : ''}
    </div>
    <div class="section-title">关键时间</div>
    <div class="info card"><div><span>报名开始</span><span>${esc(item.registrationStartDate || '待公布')}</span></div><div><span>报名截止</span><span>${esc(item.registrationEndDate || '待公布')}</span></div><div><span>比赛开始</span><span>${esc(item.competitionStartDate || '待公布')}</span></div><div><span>比赛结束</span><span>${esc(item.competitionEndDate || '待公布')}</span></div></div>
    ${item.dataStatus === 'archived' ? `<div class="timing-warning card timing-unverified"><div class="timing-head">这届已归档，报名已截止</div>
      <div class="timing-note">${item.nextEditionEstimateDate ? `按上一届节奏推算，下一届大概 ${esc(item.nextEditionEstimateDate)} 起开始报名——这是推算出来的参考时间，不是官方公布的日期，具体以官方通知为准。` : '暂时没有足够信息推算下一届大概什么时候开始报名。'}</div></div>` : ''}
    ${item.schoolTimingDependent ? `<div class="timing-warning card timing-${esc(item.timingReliability)}"><div class="timing-head">${item.timingReliability === 'school_controlled' ? '以上日期不是你要赶的时间' : '以上日期未经确认'}</div><div class="timing-note">${esc(item.schoolTimingNote)}</div></div>` : ''}
    ${fold('toggle-rules', '参赛与规则', state.rulesExpanded)}
    ${state.rulesExpanded ? `<div class="text-card card"><div class="label">参赛对象与资格</div><div>${esc(item.participants || '待官方资料补充')}</div><div class="label">团队人数</div><div>${esc(item.teamSize || '以具体赛项为准')}</div><div class="label">赛项/组别</div><div>${esc(item.track.name)}</div><div class="label">比赛形式与作品要求</div><div>${esc(item.formatAndRules)}</div><div class="label">报名费及其他费用</div><div>${esc(item.fees)}</div></div>` : ''}
    ${fold('toggle-official', '官方信息', state.officialInfoExpanded)}
    ${state.officialInfoExpanded ? `<div class="text-card card"><div class="label">主办单位</div><div>${esc(item.organizer)}</div><div class="label">官方报名方式</div><div>${esc(item.registrationMethod)}</div>
      <div class="label">官方来源</div>${(item.sources || []).map((source: any) => `<div class="source">${esc(SOURCE_TYPE_LABELS[source.source_type] || source.source_type)} · <a href="${esc(source.url)}" target="_blank" rel="noopener" data-act="source" data-url="${esc(source.url)}">${esc(source.url)}</a></div>`).join('')}
      <div class="label">最后核验时间</div><div>${esc(item.lastVerifiedDate)}</div><div class="notice">该公开记录已通过系统验证和管理员人工复核；请在报名前再次核对主办方最新通知。</div></div>` : ''}
    ${item.registrationUrlUsable
      ? `<a class="btn primary action" href="${esc(item.registrationUrl)}" target="_blank" rel="noopener" data-act="open-registration">打开官方报名页面</a><button class="btn secondary action" data-act="copy">复制官方报名链接</button>`
      : '<button class="btn primary action" disabled>官方报名链接待更新</button>'}
    <button class="btn secondary action" data-act="feedback">信息纠错</button>
    <div class="disclaimer">是否计入综测、保研或校内竞赛认定，请以本校最新文件为准。平台推荐仅供参考，不代表学校、主办单位或官方认定。</div>
  </div>`;
}

const handlers = {
  act: {
    home: () => go('#/'),
    favorite: () => {
      const on = toggleFavorite(state.item.id);
      state.favorite = on;
      track('favorite', { id: state.item.id, name: state.item.name, on });
      render();
      toast(on ? '已收藏' : '已取消收藏');
    },
    'toggle-rec': () => { state.recommendationExpanded = !state.recommendationExpanded; render(); },
    'toggle-rules': () => { state.rulesExpanded = !state.rulesExpanded; render(); },
    'toggle-official': () => { state.officialInfoExpanded = !state.officialInfoExpanded; render(); },
    // 链接本身会在新标签页打开，这里只记一笔
    'open-registration': () => track('open_official', { id: state.item.id, name: state.item.name, target: 'registration' }),
    source: () => track('open_official', { id: state.item.id, name: state.item.name, target: 'source' }),
    copy: async () => {
      const ok = await copyText(state.item.registrationUrl);
      track('copy_link', { id: state.item.id, name: state.item.name });
      if (ok) await confirmDialog('链接已复制', '链接已复制，请在浏览器中打开并核对主办单位。', '知道了');
      else toast('复制失败，请手动复制');
    },
    feedback: () => go(`#/feedback/${encodeURIComponent(state.item.id)}`),
  },
};

export async function renderDetail(id: string, seq: number) {
  viewSeq = seq;
  setPageHandlers(handlers);
  Object.assign(state, { item: null, loading: true, error: '', recommendationExpanded: false, rulesExpanded: false, officialInfoExpanded: false });
  window.scrollTo(0, 0);
  render();
  try {
    state.item = await getCompetition(id);
    state.favorite = isFavorite(id);
    document.title = `${state.item.name} · 竞赛雷达`;
    track('view_detail', { id, name: state.item.name });
  } catch (error) {
    state.error = error instanceof Error ? error.message : '加载失败';
  }
  state.loading = false;
  render();
}
