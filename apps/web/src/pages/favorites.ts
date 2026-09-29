// 我的收藏：照小程序 pages/favorites 复刻。收藏存在当前浏览器里。
import { getCompetition } from '../api';
import { getFavoriteRecords, toggleFavorite } from '../favorites';
import { track } from '../track';
import { app, confirmDialog, esc, go, isActive, localTime, setPageHandlers, toast } from '../ui';

let items: any[] = [];
let loading = true;
let viewSeq = 0;

function card(item: any) {
  if (item.unavailable) {
    return `<div class="favorite-card card"><div class="competition-name">${esc(item.name)}</div>
      <div class="muted">该收藏仍保留，赛事资料目前无法打开。可稍后刷新，或自行取消收藏。</div>
      <div class="favorite-date">收藏于 ${esc(item.favoriteAt)}</div><button class="btn mini cancel-button" data-act="cancel" data-id="${esc(item.id)}">取消收藏</button></div>`;
  }
  return `<div class="favorite-card card" data-act="open" data-id="${esc(item.id)}">
    <div class="card-head"><div class="status-row"><span class="status ${esc(item.statusClass)}">${esc(item.registrationStatus)}</span>${item.isEnded ? '<span class="ended-mark">已结束</span>' : ''}</div><span class="verified">核验 ${esc(item.lastVerifiedDate)}</span></div>
    <div class="competition-name">${esc(item.name)}</div>
    <div class="edition">${esc(item.editionName)}</div>
    <div class="tags"><span class="tag">${esc(item.eventLevel)}</span>${item.displayProfessions.map((p: string) => `<span class="tag">${esc(p)}</span>`).join('')}</div>
    <div class="recommendation"><span>${esc(item.recommendationLevel)}</span><span class="reference">仅供参考</span></div>
    <div class="reason">${esc(item.recommendationReasons[0] || '')}</div>
    <div class="card-footer"><div><div class="deadline">${item.registrationEndDate ? `报名截止 ${esc(item.registrationEndDate)}` : '报名时间待官方公布'}</div><div class="favorite-date">收藏于 ${esc(item.favoriteAt)}</div></div>
      <button class="btn mini cancel-button" data-act="cancel" data-id="${esc(item.id)}">取消收藏</button></div>
  </div>`;
}

function render() {
  if (!isActive('favorites', viewSeq)) return;
  const body = loading && !items.length
    ? [1, 2, 3].map(() => '<div class="skeleton card"><div></div><div></div><div></div></div>').join('')
    : !items.length
      ? `<div class="state card"><div class="empty-icon">☆</div><div class="state-title">还没有收藏赛事</div><div class="muted">在赛事列表或详情页点击收藏，就能在这里快速找到。</div><button class="btn primary find-button" data-act="home">去发现赛事</button></div>`
      : items.map(card).join('');
  app().innerHTML = `<div class="page pg-favorites"><div class="page-heading"><div class="page-title">我的收藏</div><div class="page-subtitle">共 ${items.length} 场，收藏保存在当前浏览器</div></div>${body}</div>`;
}

const handlers = {
  act: {
    home: () => go('#/'),
    open: (el: HTMLElement) => go(`#/detail/${encodeURIComponent(el.dataset.id!)}`),
    cancel: async (el: HTMLElement, event: Event) => {
      event.stopPropagation();
      const id = el.dataset.id!;
      if (!(await confirmDialog('取消收藏', '确定将这场赛事移出收藏吗？'))) return;
      const item = items.find(entry => entry.id === id);
      toggleFavorite(id);
      track('favorite', { id, name: item?.name, on: false });
      items = items.filter(entry => entry.id !== id);
      render();
      toast('已取消收藏');
    },
  },
};

export async function renderFavorites(seq: number) {
  viewSeq = seq;
  setPageHandlers(handlers);
  document.title = '我的收藏 · 竞赛雷达';
  track('view_page', { page: 'favorites' });
  loading = true;
  const records = getFavoriteRecords();
  render();
  items = await Promise.all(records.map(async record => {
    try {
      const item = await getCompetition(record.editionId);
      return { ...item, favoriteAt: localTime(record.createdAt, false), isEnded: item.dataStatus === 'archived' || item.registrationStatus === '已截止' };
    } catch {
      return { id: record.editionId, name: '赛事暂不可读取或已下架', favoriteAt: localTime(record.createdAt, false), unavailable: true };
    }
  }));
  loading = false;
  render();
}
