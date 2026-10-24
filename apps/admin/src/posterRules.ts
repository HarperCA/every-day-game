// 比赛海报的规则（2026-10-24 用户定），和服务器 cloudfunctions/adminData/posterImage.js 保持一致：
// 只收 16:9（宽高比 1.76～1.79）；海报存 640 × 360 的 JPG、60 KB 以内；不是 16:9 的进候选图片，只留着备查。
export const POSTER_WIDTH = 640;
export const POSTER_HEIGHT = 360;
export const POSTER_MAX_BYTES = 60 * 1024;
export const CANDIDATE_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_CANDIDATES = 10;
const RATIO_MIN = 1.76;
const RATIO_MAX = 1.79;

export type PosterSource = 'manual' | 'official';
export const posterSourceLabels: Record<PosterSource, string> = { manual:'人工上传', official:'官网原图' };

export interface PosterInfo { file:string; source:PosterSource; sourceUrl:string; updatedAt:string }
export interface PosterCandidate { file:string; width:number; height:number; bytes:number; source:PosterSource; sourceUrl:string; addedAt:string }

export const isPosterRatio = (width:number, height:number) => width > 0 && height > 0 && width / height >= RATIO_MIN && width / height <= RATIO_MAX;

export function describeRatio(width:number, height:number) {
  return `${width} × ${height}（宽高比 ${(width / height).toFixed(2)}）`;
}

// 加一张候选：同一张图（同一文件名）不重复加；最多留 10 张，超出时去掉最早的
export function addCandidate(list:PosterCandidate[] | undefined, candidate:PosterCandidate) {
  const rest = (list || []).filter(item => item.file !== candidate.file);
  return [...rest, candidate].slice(-MAX_CANDIDATES);
}

export const removeCandidate = (list:PosterCandidate[] | undefined, file:string) => (list || []).filter(item => item.file !== file);

// 把一张图压成海报：按 0.9、0.85……0.5 的质量依次试，第一张不超过 60 KB 的就用；都超就返回 null
export async function compressToLimit(encode:(quality:number) => Promise<Blob>, maxBytes = POSTER_MAX_BYTES) {
  for (let quality = 0.9; quality >= 0.5 - 1e-9; quality -= 0.05) {
    const blob = await encode(Number(quality.toFixed(2)));
    if (blob.size <= maxBytes) return { blob, quality:Number(quality.toFixed(2)) };
  }
  return null;
}
