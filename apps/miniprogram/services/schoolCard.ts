// 校赛转发卡片（2026-11-05）：微信卡片只有标题和一张图，学校、校赛名、学分和主办单位画进图里；画不出来用固定封面。
import type { ContestView } from './schoolContests';
import { saveCardImage } from './cardImage';
import { wrapText } from './teamCard';

export const STATIC_SCHOOL_CARD = '/assets/school-share-card.png';
const WIDTH = 500;
const HEIGHT = 400;
const PADDING = 32;

function paint(context: any, contest: ContestView): void {
  const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#142b5b');
  gradient.addColorStop(1, '#2563eb');
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  const measure = (value: string) => context.measureText(value).width;
  const maxWidth = WIDTH - PADDING * 2;
  context.textBaseline = 'top';

  const label = '校赛';
  context.font = 'bold 24px sans-serif';
  context.fillStyle = '#ffc53d';
  context.fillRect(PADDING, 36, measure(label) + 24, 42);
  context.fillStyle = '#172033';
  context.fillText(label, PADDING + 12, 44);

  context.fillStyle = '#ffffff';
  context.font = '26px sans-serif';
  let top = 94;
  for (const line of wrapText(contest.school, maxWidth, 1, measure)) { context.fillText(line, PADDING, top); top += 40; }
  context.font = 'bold 36px sans-serif';
  for (const line of wrapText(contest.title, maxWidth, 2, measure)) { context.fillText(line, PADDING, top); top += 48; }
  context.font = '26px sans-serif';
  top += 8;
  if (contest.endDate) context.fillText(`结束日期 ${contest.endDate}`, PADDING, top);
}

export async function drawContestCard(contest: ContestView): Promise<string> {
  try {
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: WIDTH, height: HEIGHT });
    paint(canvas.getContext('2d'), contest);
    return await saveCardImage('school-card', contest.id, canvas);
  } catch (_error) {
    return STATIC_SCHOOL_CARD;
  }
}

export function contestShareContent(contest: ContestView) {
  const title = `【校赛报名】${contest.title}`;
  const path = `/pages/school-detail/school-detail?id=${encodeURIComponent(contest.id)}`;
  return { title, path, imageUrl: STATIC_SCHOOL_CARD, promise: drawContestCard(contest).then(imageUrl => ({ title, path, imageUrl })) };
}
