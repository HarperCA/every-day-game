// 抓取流水线数据流图的固定版面：每个方框的位置、每条线的走法都是手工设计好的（2026-10-01）。
//
// 为什么不用库自动走线：自动走线会让线穿过方框、互相交叉和重叠。这张图是固定排版，
// 所以每条线的转折点直接写在这里，并由 tests/flow-layout.test.mjs 逐条检查：
// 任意两条线不相交也不重叠、不穿过任何方框、起点终点都在对应方框的边上、连线上的数字不压在方框或别的线上。
// 新增环节或结果时，要在这里补上方框位置和对应线路，测试会提醒漏了哪条。

export const NODE_W = 100;
export const NODE_H = 66;

// 方框左上角。主线（y=300）从左到右；所有“结束”排在上面（y=190、y=100）；通知追溯分支在下面。
export const POS: Record<string, [number, number]> = {
  search:[0, 300], platforms:[0, 400],
  dedupe:[140, 300], arbitrate:[210, 440], end_ai_dup:[210, 560], rule:[280, 300], jev:[420, 300], read:[560, 300], extract:[700, 300],
  same_name:[840, 300], scope:[980, 300], gate:[1120, 300], end_written:[1260, 300],
  end_dropped:[0, 190], end_dup:[120, 190], end_rejected:[345, 190], end_readfail:[630, 190], end_scope:[980, 190],
  end_lead:[320, 100],
  trace:[350, 440], followup:[490, 440], end_trace_none:[420, 560],
};

// 整张图的范围（含四周留白），用来定容器宽高比和 SVG 视口
export const BOUNDS = { x:0, y:80, w:1360, h:620 };

type Pt = [number, number];
// 每条线的转折点（从起点到终点，只有横线和竖线）。键是 “出发环节>到达环节”。
// 同一个方框上，每条线用各自的接入点，所以线不会叠在一起。
export const ROUTES: Record<string, Pt[]> = {
  // 来源 → 判重
  'search>dedupe':[[100, 318], [140, 318]],
  'platforms>dedupe':[[100, 433], [120, 433], [120, 352], [140, 352]],
  'search>end_dropped':[[50, 300], [50, 256]],
  // 判重
  'dedupe>rule':[[240, 333], [280, 333]],
  'dedupe>end_dup':[[160, 300], [160, 256]],
  'dedupe>arbitrate':[[225, 366], [225, 440]],                              // 规则拿不准的：往下交给 AI 裁决
  'arbitrate>rule':[[300, 440], [300, 366]],                                // AI 判为不同比赛或新一届：回到主线继续
  'arbitrate>end_ai_dup':[[260, 506], [260, 560]],
  'dedupe>end_lead':[[240, 310], [260, 310], [260, 118], [320, 118]],
  'dedupe>read':[[190, 366], [190, 680], [640, 680], [640, 366]],       // 平台条目直通读详情：从最下面绕过去
  // 前置筛选 · 标题规则
  'rule>jev':[[380, 333], [420, 333]],
  'rule>trace':[[330, 366], [330, 410], [375, 410], [375, 440]],
  'rule>end_lead':[[300, 300], [300, 138], [320, 138]],
  'rule>end_rejected':[[360, 300], [360, 256]],
  // 前置筛选 · Jev
  'jev>read':[[520, 333], [560, 333]],
  'jev>trace':[[470, 366], [470, 410], [425, 410], [425, 440]],
  'jev>end_lead':[[500, 300], [500, 128], [420, 128]],
  'jev>end_rejected':[[440, 300], [440, 256]],
  // 通知追溯（在主线下方）
  'trace>followup':[[450, 473], [490, 473]],
  'trace>end_trace_none':[[400, 506], [400, 533], [450, 533], [450, 560]],
  'followup>read':[[540, 440], [540, 410], [580, 410], [580, 366]],
  'followup>end_trace_none':[[540, 506], [540, 533], [490, 533], [490, 560]],
  // 读取、抽取、查库
  'read>extract':[[660, 333], [700, 333]],
  'read>end_readfail':[[640, 300], [640, 256]],
  'extract>same_name':[[800, 333], [840, 333]],
  'extract>end_readfail':[[720, 300], [720, 256]],
  'same_name>scope':[[940, 333], [980, 333]],
  'same_name>end_scope':[[920, 300], [920, 272], [990, 272], [990, 256]],
  'same_name>end_written':[[890, 300], [890, 140], [1310, 140], [1310, 300]],   // 同名补来源：从上面绕过去
  // 入库
  'scope>gate':[[1080, 333], [1120, 333]],
  'scope>end_scope':[[1030, 300], [1030, 256]],
  'gate>end_written':[[1220, 333], [1260, 333]],
  'gate>end_scope':[[1140, 300], [1140, 272], [1070, 272], [1070, 256]],
};

// 连线上数字放在哪：该线最长的一段的中点（并列时取靠前的）
export function labelAnchor(points: Pt[]): Pt {
  let best = 0, bestLen = -1;
  for (let i = 0; i < points.length - 1; i += 1) {
    const length = Math.abs(points[i + 1][0] - points[i][0]) + Math.abs(points[i + 1][1] - points[i][1]);
    if (length > bestLen) { best = i; bestLen = length; }
  }
  return [(points[best][0] + points[best + 1][0]) / 2, (points[best][1] + points[best + 1][1]) / 2];
}

// 折线转成带圆角的 SVG 路径
export function routePath(points: Pt[], radius = 8): string {
  if (points.length < 2) return '';
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1], [cx, cy] = points[i], [nx, ny] = points[i + 1];
    const before = Math.min(radius, (Math.abs(cx - px) + Math.abs(cy - py)) / 2);
    const after = Math.min(radius, (Math.abs(nx - cx) + Math.abs(ny - cy)) / 2);
    const startX = cx - Math.sign(cx - px) * before, startY = cy - Math.sign(cy - py) * before;
    const endX = cx + Math.sign(nx - cx) * after, endY = cy + Math.sign(ny - cy) * after;
    d += ` L${startX} ${startY} Q${cx} ${cy} ${endX} ${endY}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}
