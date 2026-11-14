// 转发卡片（2026-11-05）：微信卡片只有标题和一张图，所以比赛名、队名要画进图里；只写这两样，不写人数（2026-11-06 用户定）。
// 这台手机画不出来就用固定封面，不影响转发。文字都来自队伍数据，不写“冲刺国奖”这类不一定属实的话。
import { saveCardImage } from './cardImage';
import type { TeamView } from './teams';

export const STATIC_CARD_IMAGE = '/assets/team-share-card.png';
const WIDTH = 500;
const HEIGHT = 400;
const PADDING = 32;

export function wrapText(text: string, maxWidth: number, maxLines: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index += 1) {
    const next = line + chars[index];
    if (measure(next) <= maxWidth) { line = next; continue; }
    if (lines.length === maxLines - 1) {
      const kept = Array.from(line);
      while (kept.length && measure(`${kept.join('')}…`) > maxWidth) kept.pop();
      lines.push(`${kept.join('')}…`);
      return lines;
    }
    lines.push(line);
    line = chars[index];
  }
  if (line) lines.push(line);
  return lines;
}

function paint(context: any, team: TeamView): void {
  const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#2f7cf0');
  gradient.addColorStop(1, '#1450b8');
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = 'rgba(255,255,255,0.1)';
  context.beginPath();
  context.arc(WIDTH - 20, 20, 130, 0, Math.PI * 2);
  context.fill();

  const measure = (value: string) => context.measureText(value).width;
  const maxWidth = WIDTH - PADDING * 2;
  context.textBaseline = 'top';

  // 只写比赛和队名（2026-11-06 用户定），整体上下居中
  context.font = 'bold 40px sans-serif';
  const 比赛行 = wrapText(team.competitionName, maxWidth, 3, measure);
  const 比赛高 = 比赛行.length * 54;
  context.font = '30px sans-serif';
  const 队伍行 = wrapText(`队伍：${team.name}`, maxWidth, 2, measure);
  const 队伍高 = 队伍行.length * 42;
  let top = Math.round((HEIGHT - 比赛高 - 28 - 队伍高) / 2);
  context.fillStyle = '#ffffff';
  context.font = 'bold 40px sans-serif';
  for (const line of 比赛行) { context.fillText(line, PADDING, top); top += 54; }
  top += 28;
  context.font = '30px sans-serif';
  for (const line of 队伍行) { context.fillText(line, PADDING, top); top += 42; }
}

const drawn = new Map<string, { key: string; path: string }>();

export async function drawTeamCard(team: TeamView): Promise<string> {
  try {
    const key = JSON.stringify([team.competitionName, team.name]);
    const cached = drawn.get(team.id);
    if (cached?.key === key) return cached.path;
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: WIDTH, height: HEIGHT });
    paint(canvas.getContext('2d'), team);
    const path = await saveCardImage('team-card', team.id, canvas);
    drawn.set(team.id, { key, path });
    return path;
  } catch (_error) {
    return STATIC_CARD_IMAGE;
  }
}

// 给 onShareAppMessage 用：先给固定封面兜底，画好了用画好的（微信最多等 3 秒）
export function teamShareContent(team: TeamView) {
  const title = `组队邀请：「${team.name}」｜${team.competitionName}`;
  const path = `/pages/team-detail/team-detail?id=${encodeURIComponent(team.id)}`;
  return { title, path, imageUrl: STATIC_CARD_IMAGE, promise: drawTeamCard(team).then(imageUrl => ({ title, path, imageUrl })) };
}
