// 首页“找比赛”：照小程序 pages/index 复刻。筛选项、字段转换与小程序共用同一份代码。
import { listCompetitions, type Query } from '../api';
import { getFavoriteIds, toggleFavorite } from '../favorites';
import { track } from '../track';
import { app, BASE, esc, go, isActive, setPageHandlers, toast } from '../ui';
import {
  statusOptions, levelOptions, participationFormatOptions, teamSizeOptions, feeTypeOptions, registrationOrganizationOptions,
  registrationWithinOptions, registrationWithinValues, sortByOptions, sortByValues, sortOrderOptions, sortOrderValues, PROFESSION_CATEGORIES,
} from '../../../miniprogram/services/filterOptions';

const professionOptions = ['全部适合专业', ...PROFESSION_CATEGORIES];
const MORE_KINDS = ['participationFormat', 'teamSizeCategory', 'feeType', 'registrationOrganization', 'registrationWithin', 'sortBy', 'sortOrder'] as const;
type MoreKind = typeof MORE_KINDS[number];

// 页面状态放在模块里：从详情页返回时，筛选条件和已加载的列表都还在（和小程序一致）。
const state = {
  keyword: '', statusIndex: 0, levelIndex: 0, professionIndex: 0,
  more: { participationFormat: '', teamSizeCategory: '', feeType: '', registrationOrganization: '', registrationWithin: '', sortBy: '', sortOrder: '' } as Record<MoreKind, string>,
  draft: {} as Record<MoreKind, string>,
  items: [] as any[], total: 0, page: 1, hasMore: false, loading: false, error: '', loaded: false,
  sheetOpen: false, previewCount: 0, scrollY: 0,
};

function query(page: number, more = state.more, pageSize = 8): Query {
  return {
    keyword: state.keyword,
    registrationStatus: state.statusIndex ? statusOptions[state.statusIndex] : '',
    eventLevel: state.levelIndex ? levelOptions[state.levelIndex] : '',
    profession: state.professionIndex ? professionOptions[state.professionIndex] : '',
    ...more, page, pageSize,
  };
}

function selectedConditions() {
  const list: Array<{ kind: string; label: string }> = [];
  if (state.statusIndex) list.push({ kind: 'status', label: statusOptions[state.statusIndex] });
  if (state.levelIndex) list.push({ kind: 'level', label: levelOptions[state.levelIndex] });
  if (state.professionIndex) list.push({ kind: 'profession', label: professionOptions[state.professionIndex] });
  const m = state.more;
  if (m.participationFormat) list.push({ kind: 'participationFormat', label: `参赛形式：${m.participationFormat}` });
  if (m.teamSizeCategory) list.push({ kind: 'teamSizeCategory', label: `队伍人数：${m.teamSizeCategory}` });
  if (m.feeType) list.push({ kind: 'feeType', label: `报名费用：${m.feeType}` });
  if (m.registrationOrganization) list.push({ kind: 'registrationOrganization', label: `报名组织：${m.registrationOrganization}` });
  if (m.registrationWithin) list.push({ kind: 'registrationWithin', label: `距离报名：${registrationWithinOptions[registrationWithinValues.indexOf(m.registrationWithin)]}` });
  if (m.sortBy || m.sortOrder) {
    const by = m.sortBy ? sortByOptions[sortByValues.indexOf(m.sortBy)] : '推荐排序';
    const order = m.sortOrder ? `·${sortOrderOptions[sortOrderValues.indexOf(m.sortOrder)]}` : '';
    list.push({ kind: 'sort', label: `排序：${by}${order}` });
  }
  return list;
}

const moreCount = () => MORE_KINDS.filter(kind => state.more[kind]).length;

function cardHtml(item: any) {
  const deadline = item.dataStatus === 'archived'
    ? `<div class="deadline archived-hint">${item.nextEditionEstimateDate ? `已归档 · 按上届节奏推算，下一届约 ${esc(item.nextEditionEstimateDate)} 起报名（仅供参考）` : '已归档 · 下一届时间暂无法推算'}</div>`
    : `<div class="deadline">${item.registrationEndDate ? `报名截止 ${esc(item.registrationEndDate)}` : '报名时间待官方公布'}</div>`;
  return `<div class="competition card" data-act="open" data-id="${esc(item.id)}">
    <div class="card-head"><span class="status ${esc(item.statusClass)}">${esc(item.registrationStatus)}</span>
      <div class="card-meta"><span class="verified">核验 ${esc(item.lastVerifiedDate)}</span>
      <span class="favorite-button ${item.isFavorite ? 'favorite-active' : ''}" data-act="fav" data-id="${esc(item.id)}" role="button" aria-label="收藏">${item.isFavorite ? '★' : '☆'}</span></div></div>
    <div class="competition-name">${esc(item.name)}</div>
    <div class="tags"><span class="tag">${esc(item.eventLevel)}</span>${item.displayProfessions.map((p: string) => `<span class="tag">${esc(p)}</span>`).join('')}</div>
    <div class="recommendation"><span>${esc(item.recommendationLevel)}</span><span class="reference">仅供参考</span></div>
    <div class="reason">${esc(item.recommendationReasons[0] || '')}</div>
    ${deadline}
  </div>`;
}

function selectHtml(act: string, options: string[], index: number) {
  return `<label class="filter"><select data-change="${act}" aria-label="${esc(options[0])}">${options.map((o, i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select><span>${esc(options[index])}⌄</span></label>`;
}

function optionGroup(title: string, kind: MoreKind, labels: string[], values: string[] = labels, tip = '') {
  return `<div class="filter-group"><div class="group-title">${title}</div><div class="option-list">${labels.map((label, i) =>
    `<div class="option-chip ${state.draft[kind] === values[i] ? 'option-active' : ''}" data-act="pick" data-kind="${kind}" data-value="${esc(values[i])}">${esc(label)}</div>`).join('')}</div>${tip}</div>`;
}

function sheetHtml() {
  if (!state.sheetOpen) return '';
  return `<div class="filter-mask" data-act="close-sheet"><div class="filter-sheet" data-act="noop">
    <div class="sheet-handle"></div>
    <div class="sheet-head"><span class="sheet-title">更多筛选</span><span class="sheet-close" data-act="close-sheet">×</span></div>
    <div class="sheet-scroll">
      ${optionGroup('参赛形式', 'participationFormat', participationFormatOptions)}
      ${optionGroup('队伍人数', 'teamSizeCategory', teamSizeOptions)}
      ${optionGroup('报名费用', 'feeType', feeTypeOptions)}
      ${optionGroup('报名组织方式', 'registrationOrganization', registrationOrganizationOptions)}
      ${optionGroup('距离报名时间', 'registrationWithin', registrationWithinOptions, registrationWithinValues, '<div class="source-tip">"已截止"的赛事若已经归档，这里能按推算的下一届时间找到它们。</div>')}
      <div class="filter-group"><div class="group-title">排序方式</div>
        <div class="option-list">${sortByOptions.map((label, i) => `<div class="option-chip ${state.draft.sortBy === sortByValues[i] ? 'option-active' : ''}" data-act="pick" data-kind="sortBy" data-value="${sortByValues[i]}">${label}</div>`).join('')}</div>
        <div class="option-list" style="margin-top:7px">${sortOrderOptions.map((label, i) => `<div class="option-chip ${state.draft.sortOrder === sortOrderValues[i] ? 'option-active' : ''}" data-act="pick" data-kind="sortOrder" data-value="${sortOrderValues[i]}">${label}</div>`).join('')}</div>
      </div>
      <div class="source-tip">只展示资料明确内容；未明确的信息不会由 AI 推断。</div>
    </div>
    <div class="sheet-actions"><button class="btn reset-button" data-act="reset-more">重置</button><button class="btn primary apply-button" data-act="apply-more">查看${state.previewCount}场赛事</button></div>
  </div></div>`;
}

function listHtml() {
  if (state.loading && !state.items.length) return [1, 2, 3].map(() => '<div class="skeleton card"><div></div><div></div><div></div></div>').join('');
  if (state.error) return `<div class="state card"><div>${esc(state.error)}</div><button class="btn mini" data-act="retry">重新加载</button></div>`;
  if (!state.items.length) return '<div class="state card"><div class="state-title">没有匹配的比赛</div><div class="muted">试试清除部分筛选条件或更换关键词。</div></div>';
  return state.items.map(cardHtml).join('') +
    `<div class="load-more muted">${state.hasMore ? `<button class="btn mini" data-act="more" ${state.loading ? 'disabled' : ''}>${state.loading ? '加载中…' : '加载更多'}</button>` : '已显示全部结果'}</div>`;
}

function render() {
  if (!isActive('index')) return;
  const conditions = selectedConditions();
  const count = moreCount();
  app().innerHTML = `<div class="page pg-index">
    <div class="hero"><div class="hero-brand"><img class="brand-logo" src="${BASE}logo.svg" alt=""><span>竞赛雷达</span></div>
      <form class="search-row" data-submit="search"><input name="keyword" value="${esc(state.keyword)}" placeholder="赛事、别名、主办单位或关键词" enterkeyhint="search"><button class="btn mini" type="submit">搜索</button></form></div>
    <div class="filters card">
      ${selectHtml('status', statusOptions, state.statusIndex)}${selectHtml('level', levelOptions, state.levelIndex)}${selectHtml('profession', professionOptions, state.professionIndex)}
      <div class="filter more-filter ${count ? 'filter-active' : ''}" data-act="open-sheet">${count ? `更多筛选·${count}` : '更多筛选'}</div>
    </div>
    ${conditions.length ? `<div class="selected-panel card"><div class="selected-head"><span>已选条件</span><span class="clear" data-act="clear">全部清空</span></div>
      <div class="selected-list">${conditions.map(c => `<div class="selected-chip" data-act="remove" data-kind="${c.kind}"><span>${esc(c.label)}</span><span class="chip-close">×</span></div>`).join('')}</div></div>` : ''}
    <div class="result-meta"><span>找到 ${state.total} 场</span><span class="clear" data-act="clear">清空条件</span></div>
    <div>${listHtml()}</div>
    ${sheetHtml()}
  </div>`;
}

async function load(reset: boolean) {
  const page = reset ? 1 : state.page + 1;
  state.loading = true; state.error = '';
  render();
  try {
    const result = await listCompetitions(query(page));
    const favorites = new Set(getFavoriteIds());
    state.items = result.items.map((item: any) => ({ ...item, isFavorite: favorites.has(item.id) }));
    state.total = result.total; state.hasMore = result.hasMore; state.page = page; state.loaded = true;
    if (reset && state.keyword) track('search', { keyword: state.keyword, resultCount: result.total });
  } catch (error) {
    state.error = error instanceof Error ? error.message : '加载失败，请重试';
  }
  state.loading = false;
  render();
}

async function refreshPreview() {
  try {
    const result = await listCompetitions(query(1, state.draft, 1000));
    if (state.sheetOpen) { state.previewCount = result.total; render(); }
  } catch {
    if (state.sheetOpen) { state.previewCount = 0; render(); }
  }
}

export function renderIndex() {
  document.title = '竞赛雷达 · 找比赛';
  setPageHandlers(handlers);
  if (!state.loaded && !state.loading) void load(true);
  else {
    const favorites = new Set(getFavoriteIds());
    state.items = state.items.map(item => ({ ...item, isFavorite: favorites.has(item.id) }));
    render();
    window.scrollTo(0, state.scrollY);
  }
}

const handlers = {
  submit: (form: HTMLFormElement) => {
    state.keyword = String(new FormData(form).get('keyword') || '').trim();
    void load(true);
  },
  change: (el: HTMLElement) => {
    const index = Number((el as HTMLSelectElement).value);
    const act = el.dataset.change;
    if (act === 'status') state.statusIndex = index;
    if (act === 'level') state.levelIndex = index;
    if (act === 'profession') state.professionIndex = index;
    const options = act === 'status' ? statusOptions : act === 'level' ? levelOptions : professionOptions;
    track('filter', { kind: act, value: index ? options[index] : '' });
    void load(true);
  },
  act: {
    open: (el: HTMLElement) => { state.scrollY = window.scrollY; go(`#/detail/${encodeURIComponent(el.dataset.id!)}`); },
    fav: (el: HTMLElement) => {
      const id = el.dataset.id!;
      const on = toggleFavorite(id);
      const item = state.items.find(entry => entry.id === id);
      track('favorite', { id, name: item?.name, on });
      state.items = state.items.map(entry => entry.id === id ? { ...entry, isFavorite: on } : entry);
      render();
      toast(on ? '已收藏' : '已取消收藏');
    },
    more: () => { if (state.hasMore && !state.loading) void load(false); },
    retry: () => void load(true),
    clear: () => {
      state.keyword = ''; state.statusIndex = 0; state.levelIndex = 0; state.professionIndex = 0;
      for (const kind of MORE_KINDS) state.more[kind] = '';
      void load(true);
    },
    remove: (el: HTMLElement) => {
      const kind = el.dataset.kind!;
      if (kind === 'status') state.statusIndex = 0;
      else if (kind === 'level') state.levelIndex = 0;
      else if (kind === 'profession') state.professionIndex = 0;
      else if (kind === 'sort') { state.more.sortBy = ''; state.more.sortOrder = ''; }
      else if (kind in state.more) state.more[kind as MoreKind] = '';
      void load(true);
    },
    'open-sheet': () => { state.draft = { ...state.more }; state.sheetOpen = true; render(); void refreshPreview(); },
    // 遮罩和右上角 × 关闭；面板本身标了 noop，点里面不会关
    'close-sheet': () => { state.sheetOpen = false; render(); },
    noop: () => undefined,
    pick: (el: HTMLElement) => {
      const kind = el.dataset.kind as MoreKind;
      state.draft[kind] = state.draft[kind] === el.dataset.value ? '' : el.dataset.value!;
      render(); void refreshPreview();
    },
    'reset-more': () => { for (const kind of MORE_KINDS) state.draft[kind] = ''; render(); void refreshPreview(); },
    'apply-more': () => {
      for (const kind of MORE_KINDS) if (state.draft[kind] !== state.more[kind]) track('filter', { kind, value: state.draft[kind] });
      state.more = { ...state.draft }; state.sheetOpen = false;
      void load(true);
    },
  },
};
