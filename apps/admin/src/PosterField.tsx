import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { getPosterImage, uploadPosterImage } from './adminCloud';
import {
  addCandidate, CANDIDATE_MAX_BYTES, compressToLimit, describeRatio, isPosterRatio, POSTER_HEIGHT, POSTER_WIDTH,
  posterSourceLabels, removeCandidate,
} from './posterRules';
import type { PosterCandidate, PosterSource } from './posterRules';

// 编辑页里的“封面海报”（2026-10-24 用户定）：
// 选一张图 → 浏览器读宽高 → 是 16:9 的缩成 640×360、压到 60 KB 以内设为海报；不是的原图存进候选图片，只留着备查。
// 海报和候选列表随“保存修改”一起存进比赛记录；图片文件已经先存进服务器的图片总库。
export default function PosterField({ editing, setEditing }: { editing:any; setEditing:Dispatch<SetStateAction<any | null>> }) {
  const [source, setSource] = useState<PosterSource>('manual');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const poster = editing.poster;
  const candidates: PosterCandidate[] = Array.isArray(editing.posterCandidates) ? editing.posterCandidates : [];

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMessage('');
    try {
      const image = await loadImage(file);
      const now = new Date().toISOString();
      if (isPosterRatio(image.naturalWidth, image.naturalHeight)) {
        const compressed = await compressToLimit(quality => drawPoster(image, quality));
        if (!compressed) throw new Error('这张图压到 60 KB 以内会太糊，请换一张细节少一些的图');
        const saved = await uploadPosterImage(await blobToDataUrl(compressed.blob), 'poster');
        setEditing((current:any) => ({ ...current, poster:{ file:saved.file, source, sourceUrl:sourceUrl.trim(), updatedAt:now } }));
        setMessage(`已设为海报：原图 ${describeRatio(image.naturalWidth, image.naturalHeight)}，压成 ${POSTER_WIDTH} × ${POSTER_HEIGHT}、${Math.round(saved.bytes / 1024)} KB。点“保存修改”后生效。`);
      } else {
        if (file.size > CANDIDATE_MAX_BYTES) throw new Error('不是 16:9，而且超过 5 MB，候选图片也存不下');
        const saved = await uploadPosterImage(await blobToDataUrl(file), 'candidate');
        setEditing((current:any) => ({ ...current, posterCandidates:addCandidate(current.posterCandidates, { file:saved.file, width:saved.width, height:saved.height, bytes:saved.bytes, source, sourceUrl:sourceUrl.trim(), addedAt:now }) }));
        setMessage(`这张图是 ${describeRatio(image.naturalWidth, image.naturalHeight)}，不是 16:9，已放进候选图片，不会显示给学生。点“保存修改”后生效。`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '上传失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return <fieldset><legend>封面海报</legend>
    <p className="source-context-hint">只收 16:9 的图（宽高比 1.76～1.79），会自动缩成 {POSTER_WIDTH} × {POSTER_HEIGHT}、压到 60 KB 以内；不是 16:9 的放进候选图片，只留着备查。只用主办方发布的宣传图或项目组自己做的图。</p>
    <div className="editor-grid">
      <label>图片来源<select value={source} onChange={e=>setSource(e.target.value as PosterSource)}>{(Object.keys(posterSourceLabels) as PosterSource[]).map(value=><option key={value} value={value}>{posterSourceLabels[value]}</option>)}</select></label>
      <label className="wide">来源网址（官网原图填图片所在页面）<input type="url" value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)}/></label>
      <label className="wide">选择图片<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{ choose(e.target.files?.[0]); e.target.value = ''; }}/></label>
    </div>
    {busy && <p className="source-context-hint">正在处理图片…</p>}
    {message && <p className="source-context-hint">{message}</p>}
    <div className="editor-grid">
      <div className="wide"><strong>当前海报</strong>
        {poster?.file ? <><PosterPreview file={poster.file} width={320}/><p className="source-context-hint">{posterSourceLabels[poster.source as PosterSource] || '来源未记录'}{poster.sourceUrl ? <> · <a href={poster.sourceUrl} target="_blank" rel="noreferrer">来源 ↗</a></> : null} · {String(poster.updatedAt || '').slice(0, 10)}</p>
          <button className="danger-action" onClick={()=>setEditing((current:any)=>({ ...current, poster:null }))}>去掉海报（小程序改回文字封面）</button></>
          : <p className="source-context-hint">还没有海报，小程序显示文字封面。</p>}
      </div>
      <div className="wide"><strong>候选图片（{candidates.length}）</strong>
        {candidates.length ? candidates.map(item => <div key={item.file} className="source-context-hint">
          <PosterPreview file={item.file} width={160}/> {describeRatio(item.width, item.height)} · {Math.round(item.bytes / 1024)} KB · {posterSourceLabels[item.source] || ''}{item.sourceUrl ? <> · <a href={item.sourceUrl} target="_blank" rel="noreferrer">来源 ↗</a></> : null}
          {' '}<button className="danger-action" onClick={()=>setEditing((current:any)=>({ ...current, posterCandidates:removeCandidate(current.posterCandidates, item.file) }))}>删除</button>
        </div>) : <p className="source-context-hint">暂无。</p>}
      </div>
    </div>
  </fieldset>;
}

// 预览：从服务器的图片总库读回来
function PosterPreview({ file, width }: { file:string; width:number }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setSrc(''); setFailed(false);
    getPosterImage(file).then(result => { if (alive) setSrc(result.dataUrl); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file]);
  if (failed) return <span>图片读取失败</span>;
  return src ? <img src={src} alt="海报预览" style={{ width, maxWidth:'100%', display:'block' }}/> : <span>加载中…</span>;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('读不出这张图，请换 JPG、PNG 或 WebP')); };
    image.src = url;
  });
}

// 画到 640×360 的画布上导出 JPG（比例已在 1.76～1.79 之间，拉伸不超过 1%）
function drawPoster(image: HTMLImageElement, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH; canvas.height = POSTER_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('浏览器不支持图片处理'));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  context.drawImage(image, 0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('压缩失败')), 'image/jpeg', quality));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}
