import { useEffect, useState } from 'react';
import { listAiReasoning, type AiReasoningEntry } from './adminCloud';

// 查看某条赛事的 AI 思考过程（2026-09-30 测试阶段打开，见后端 aiReasoning.js）。
// 每次 AI 审核、三项核验、收录判断各存一条，最新的在前。
const KIND_LABEL: Record<string, string> = {
  ai_review:'AI 审核', ai_review_agentic:'AI 审核（可自行查看链接）', field_verification:'三项核验',
  admission:'收录判断', extract:'读详情抽字段',
};

export default function AiThinkingDialog({ record, onClose }: { record:{ id:string; name:string }; onClose:() => void }) {
  const [entries, setEntries] = useState<AiReasoningEntry[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    listAiReasoning(record.id).then(list => { if (alive) setEntries(list); }).catch(err => { if (alive) setError(err instanceof Error ? err.message : String(err)); });
    return () => { alive = false; };
  }, [record.id]);

  return <div className="ai-thinking-mask" onClick={onClose}>
    <div className="ai-thinking-dialog" role="dialog" aria-label={`${record.name} 的 AI 思考过程`} onClick={event => event.stopPropagation()}>
      <div className="ai-thinking-head"><div><b>AI 思考过程</b><small>{record.name}</small></div><button onClick={onClose}>关闭</button></div>
      <div className="ai-thinking-body">
        {error && <p className="ai-thinking-empty">读取失败：{error}</p>}
        {!error && !entries && <p className="ai-thinking-empty">正在读取…</p>}
        {entries && !entries.length && <p className="ai-thinking-empty">还没有记录。2026-09-30 之后运行的 AI 审核、三项核验、收录判断才会保存思考过程。</p>}
        {entries?.map((entry, index) => <details key={`${entry.created_at}-${index}`} open={index === 0} className="ai-thinking">
          <summary>{KIND_LABEL[entry.kind] || entry.kind}{entry.extra?.stage ? `（${entry.extra.stage}）` : ''}{entry.extra?.turn ? `第 ${entry.extra.turn} 轮` : ''} · {new Date(entry.created_at).toLocaleString('zh-CN')} · {entry.model} · {entry.chars} 字{entry.tokens != null ? `（${entry.tokens} tokens）` : ''}{entry.finish_reason === 'length' ? ' · 额度用完被截断' : ''}{entry.truncated ? ' · 超长已截取' : ''}</summary>
          {entry.text_zh ? <>
            <pre>{entry.text_zh}</pre>
            <details className="ai-thinking-original"><summary>查看原文（模型用英文思考，上面是中文译文）</summary><pre>{entry.text}</pre></details>
          </> : <>
            {entry.translation === 'pending' && <p className="ai-thinking-empty">这段是英文，中文译文还在生成，过一会儿重新打开就能看到。</p>}
            {entry.translation === 'failed' && <p className="ai-thinking-empty">这段是英文，自动翻译失败，下面是原文。</p>}
            <pre>{entry.text}</pre>
          </>}
        </details>)}
      </div>
    </div>
  </div>;
}
