// 数据流图的固定版面（apps/admin/src/flowLayout.ts）：每条线都是手工设计的转折点，
// 这里逐条检查——任意两条线不相交也不重叠、不穿过方框、起点终点在方框边上、连线上的数字不压在方框或别的线上。
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { BOUNDS, NODE_H, NODE_W, POS, ROUTES, labelAnchor } from '../apps/admin/src/flowLayout';

const require = createRequire(import.meta.url);
const { NODES } = require('../apps/miniprogram/cloudfunctions/adminData/pipelineFlow.js');

const rectOf = id => { const [x, y] = POS[id]; return { l:x, t:y, r:x + NODE_W, b:y + NODE_H }; };
const segments = points => points.slice(0, -1).map((p, i) => ({ a:p, b:points[i + 1] }));
const isHorizontal = s => s.a[1] === s.b[1];
const isVertical = s => s.a[0] === s.b[0];

// 两条横竖线段是否有公共点（含端点相碰、同一直线上重叠）
function touch(s, t) {
  const box = seg => ({ l:Math.min(seg.a[0], seg.b[0]), r:Math.max(seg.a[0], seg.b[0]), t:Math.min(seg.a[1], seg.b[1]), b:Math.max(seg.a[1], seg.b[1]) });
  const p = box(s), q = box(t);
  return p.l <= q.r && q.l <= p.r && p.t <= q.b && q.t <= p.b;
}
// 线段是否进入方框内部（边界上不算；方框四边各缩 1 像素当作内部）
function entersInterior(seg, rect) {
  const b = { l:Math.min(seg.a[0], seg.b[0]), r:Math.max(seg.a[0], seg.b[0]), t:Math.min(seg.a[1], seg.b[1]), b:Math.max(seg.a[1], seg.b[1]) };
  return b.l < rect.r - 1 && b.r > rect.l + 1 && b.t < rect.b - 1 && b.b > rect.t + 1;
}
const onBoundary = (pt, rect) => {
  const [x, y] = pt;
  const inX = x >= rect.l - .5 && x <= rect.r + .5, inY = y >= rect.t - .5 && y <= rect.b + .5;
  return (inX && (Math.abs(y - rect.t) < .5 || Math.abs(y - rect.b) < .5)) || (inY && (Math.abs(x - rect.l) < .5 || Math.abs(x - rect.r) < .5));
};

// 流程定义里所有可能的连线（出发>到达）
const possible = [];
for (const [from, node] of Object.entries(NODES)) for (const outcome of Object.values(node.outcomes || {})) possible.push(`${from}>${outcome.to}`);
const unique = [...new Set(possible)];

describe('数据流图版面', () => {
  it('流程里每个环节都有位置，每条可能的连线都有走法', () => {
    expect(Object.keys(NODES).filter(id => !POS[id])).toEqual([]);
    expect(unique.filter(key => !ROUTES[key])).toEqual([]);
    expect(Object.keys(ROUTES).filter(key => !unique.includes(key))).toEqual([]);
  });
  it('方框互不重叠，都在图的范围内', () => {
    const ids = Object.keys(POS);
    for (const id of ids) {
      const r = rectOf(id);
      expect(r.l >= BOUNDS.x && r.r <= BOUNDS.x + BOUNDS.w && r.t >= BOUNDS.y && r.b <= BOUNDS.y + BOUNDS.h, id).toBe(true);
    }
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
      const a = rectOf(ids[i]), b = rectOf(ids[j]);
      expect(a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b, `${ids[i]} × ${ids[j]}`).toBe(false);
    }
  });
  it('每条线只有横线和竖线，起点在出发方框的边上、终点在到达方框的边上', () => {
    for (const [key, points] of Object.entries(ROUTES)) {
      const [from, to] = key.split('>');
      for (const s of segments(points)) expect(isHorizontal(s) || isVertical(s), `${key} 有斜线`).toBe(true);
      expect(onBoundary(points[0], rectOf(from)), `${key} 起点`).toBe(true);
      expect(onBoundary(points[points.length - 1], rectOf(to)), `${key} 终点`).toBe(true);
    }
  });
  it('没有任何一条线穿过任何方框', () => {
    for (const [key, points] of Object.entries(ROUTES)) for (const id of Object.keys(POS)) for (const s of segments(points)) {
      expect(entersInterior(s, rectOf(id)), `${key} 穿过 ${id}`).toBe(false);
    }
  });
  it('任意两条线既不相交也不重叠（连碰一下都没有）', () => {
    const keys = Object.keys(ROUTES);
    const bad = [];
    for (let i = 0; i < keys.length; i += 1) for (let j = i + 1; j < keys.length; j += 1) {
      for (const s of segments(ROUTES[keys[i]])) for (const t of segments(ROUTES[keys[j]])) if (touch(s, t)) bad.push(`${keys[i]} × ${keys[j]}`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
  it('连线上的数字（约 30×18）不压在方框上，也不压在别的线上', () => {
    const halfW = 15, halfH = 9;
    const labels = Object.entries(ROUTES).map(([key, points]) => { const [x, y] = labelAnchor(points); return { key, l:x - halfW, r:x + halfW, t:y - halfH, b:y + halfH }; });
    for (const label of labels) {
      for (const id of Object.keys(POS)) {
        const r = rectOf(id);
        expect(label.l < r.r && r.l < label.r && label.t < r.b && r.t < label.b, `${label.key} 的数字压在 ${id} 上`).toBe(false);
      }
      for (const [key, points] of Object.entries(ROUTES)) {
        if (key === label.key) continue;
        for (const s of segments(points)) {
          expect(touch(s, { a:[label.l, label.t], b:[label.r, label.b] }), `${label.key} 的数字压在 ${key} 上`).toBe(false);
        }
      }
    }
    for (let i = 0; i < labels.length; i += 1) for (let j = i + 1; j < labels.length; j += 1) {
      const a = labels[i], b = labels[j];
      expect(a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b, `${a.key} 与 ${b.key} 的数字重叠`).toBe(false);
    }
  });
});

describe('检查本身可靠（故意构造错误的线，确认能被抓出来）', () => {
  it('交叉、重叠、碰一下、穿过方框都能识别', () => {
    const cross = [{ a:[0, 5], b:[10, 5] }, { a:[5, 0], b:[5, 10] }];
    expect(touch(cross[0], cross[1])).toBe(true);                                            // 十字交叉
    expect(touch({ a:[0, 5], b:[10, 5] }, { a:[4, 5], b:[20, 5] })).toBe(true);              // 同一直线重叠
    expect(touch({ a:[0, 5], b:[10, 5] }, { a:[10, 5], b:[10, 20] })).toBe(true);            // 端点相碰
    expect(touch({ a:[0, 5], b:[10, 5] }, { a:[0, 8], b:[10, 8] })).toBe(false);             // 平行不碰
    const box = { l:100, t:100, r:200, b:166 };
    expect(entersInterior({ a:[50, 130], b:[150, 130] }, box)).toBe(true);                   // 穿进方框
    expect(entersInterior({ a:[100, 90], b:[200, 90] }, box)).toBe(false);                   // 在方框外
    expect(entersInterior({ a:[100, 100], b:[200, 100] }, box)).toBe(false);                 // 贴着方框边
    expect(onBoundary([150, 100], box)).toBe(true);
    expect(onBoundary([150, 130], box)).toBe(false);
  });
  it('把现有版面里的一条线改坏，测试确实会报错', () => {
    // 模拟：让 jev>end_lead 的竖线改走 x=440（正好撞上 jev>end_rejected 的竖线）
    const broken = [[440, 300], [440, 128], [420, 128]];
    const other = ROUTES['jev>end_rejected'];
    const hits = segments(broken).some(s => segments(other).some(t => touch(s, t)));
    expect(hits).toBe(true);
  });
});
