import { useEffect, useMemo, useRef, useState } from 'react';
import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './pipelineFlow.css';
import type { FlowEdge, FlowNode, PipelineRunRow } from './adminCloud';

// 数据流图（2026-10-01 起）：抓取流水线的每个环节画成方框，标明是系统规则还是 AI；
// 点方框看流进这个环节的比赛和处理之后各去了哪，点连线看走这条线的比赛。
// 图上的数字和下面的清单都由每条比赛自己的 trail 算出来，所以点开的条数一定和图上一致。
// 画图用的是 React Flow（@xyflow/react，MIT 协议）。

// 横向固定排版（2026-10-01 重排）：主线从左到右一条线；所有“结束”统一排在上面一行；追溯分支在主线下方。
// 整张图按页面宽度一次性铺满，不缩放、不拖动，也不需要滚动。
const W = 104;                 // 方框宽度（相邻两列之间留 36px 放连线上的数字）
const plain = (label:string) => label.replace(/\n/g, ' ');
const BOX_H = 66;              // 方框大致高度，只用来算连线从哪边出
const DESIGN_W = 1376, DESIGN_H = 612; // 设计尺寸，用来定容器的宽高比
const POS: Record<string, [number, number]> = {
  // 上面一行：各种“结束”（红色是被拦下的，橙色是没处理，灰色是丢弃）
  end_dropped:[0, -100], end_dup:[140, -100], end_lead:[300, -100], end_rejected:[440, -100], end_readfail:[630, -100], end_scope:[980, -100],
  // 主线：发现 → 判重 → 前置筛选 → 读详情 → 抽取 → 查库 → 范围检查 → 入库门槛 → 写入
  search:[0, 40], platforms:[0, 190], dedupe:[140, 110], rule:[280, 110], jev:[420, 110],
  read:[560, 110], extract:[700, 110], same_name:[840, 110], scope:[980, 110], gate:[1120, 110], end_written:[1260, 110],
  // 下面：通知追溯分支
  trace:[420, 300], followup:[560, 300], end_trace_none:[490, 440],
};
const TONE_COLOR: Record<string, string> = { drop:'#94a3b8', bad:'#dc2626', warn:'#d97706', good:'#16a34a' };

type StageData = { node:FlowNode; selected:boolean };
type StageNode = Node<StageData, 'stage'>;

function StageBox({ data }: NodeProps<StageNode>) {
  const { node, selected } = data;
  const kindLabel = node.kind === 'ai' ? 'AI' : node.kind === 'system' ? '系统' : '结束';
  // 各处理结果的数量放在鼠标悬停提示里，也标在连线上；点开方框下面的面板有完整清单
  const tip = `${plain(node.label)}\n${node.who}${node.outcomes.filter(outcome => outcome.count > 0).map(outcome => `\n· ${outcome.label}：${outcome.count}`).join('')}`;
  return <div title={tip} className={`flow-node flow-${node.kind}${node.tone ? ` tone-${node.tone}` : ''}${selected ? ' selected' : ''}${node.in === 0 ? ' idle' : ''}`} style={{ width:W, minHeight:BOX_H }}>
    {/* 四边都有进出口，连线按两个方框的相对位置自动选边 */}
    <Handle id="tT" type="target" position={Position.Top}/><Handle id="tR" type="target" position={Position.Right}/><Handle id="tB" type="target" position={Position.Bottom}/><Handle id="tL" type="target" position={Position.Left}/>
    <Handle id="sT" type="source" position={Position.Top}/><Handle id="sR" type="source" position={Position.Right}/><Handle id="sB" type="source" position={Position.Bottom}/><Handle id="sL" type="source" position={Position.Left}/>
    <div className="flow-node-top"><span className={`flow-dot ${node.kind}`}>{kindLabel}</span><strong>{node.in}</strong></div>
    <div className="flow-node-title">{node.label}</div>
  </div>;
}
const nodeTypes = { stage:StageBox };

// 连线从哪边出、从哪边进：按两个方框的相对位置选；判重直通读详情的从下方绕过去
function handlesFor(from:string, to:string): { sourceHandle:string; targetHandle:string; pathOptions?:{ offset:number; borderRadius:number } } {
  const [fx, fy] = POS[from], [tx, ty] = POS[to];
  const dx = tx - fx, dy = ty - fy;
  const round = { offset:34, borderRadius:10 };
  if (from === 'dedupe' && to === 'read') return { sourceHandle:'sB', targetHandle:'tB', pathOptions:{ offset:105, borderRadius:10 } };
  if (Math.abs(dx) >= Math.abs(dy) * 1.2) return dx >= 0 ? { sourceHandle:'sR', targetHandle:'tL', pathOptions:round } : { sourceHandle:'sL', targetHandle:'tR', pathOptions:round };
  return dy >= 0 ? { sourceHandle:'sB', targetHandle:'tT', pathOptions:round } : { sourceHandle:'sT', targetHandle:'tB', pathOptions:round };
}

const stepNote = (row:PipelineRunRow, nodeId:string) => row.trail?.find(entry => entry.n === nodeId && !entry.virtual)?.note || '';

export default function PipelineFlow({ nodes, edges, rows, onSelect }: { nodes:FlowNode[]; edges:FlowEdge[]; rows:PipelineRunRow[]; onSelect?: (nodeId:string) => void }) {
  const [selectedNode, setSelectedNode] = useState('');
  const [selectedEdge, setSelectedEdge] = useState('');
  const [shown, setShown] = useState<Record<string, number>>({});
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  // 整张图固定铺满容器宽度：打开时和窗口大小变化时各适配一次，用户不能缩放、拖动
  const canvasRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReactFlowInstance<StageNode, Edge> | null>(null);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => { void instanceRef.current?.fitView({ padding:.015, duration:0 }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const flowNodes: StageNode[] = useMemo(() => nodes.filter(node => POS[node.id]).map(node => ({
    id:node.id, type:'stage', position:{ x:POS[node.id][0], y:POS[node.id][1] }, data:{ node, selected:selectedNode === node.id }, draggable:false, selectable:false,
  })), [nodes, selectedNode]);
  const flowEdges: Edge[] = useMemo(() => edges.filter(edge => POS[edge.from] && POS[edge.to]).map(edge => {
    const target = nodeById.get(edge.to);
    const color = target?.kind === 'end' ? (TONE_COLOR[target.tone] || '#94a3b8') : '#3b82f6';
    const chosen = selectedEdge === edge.id;
    return {
      id:edge.id, source:edge.from, target:edge.to, type:'smoothstep', ...handlesFor(edge.from, edge.to),
      label:String(edge.count), labelStyle:{ fontSize:12, fontWeight:700, fill:'#1e293b' }, labelBgStyle:{ fill:'#fff', fillOpacity:.92 }, labelBgPadding:[5, 3] as [number, number], labelBgBorderRadius:6,
      style:{ stroke:color, strokeWidth:chosen ? 4.5 : Math.min(1.4 + Math.log2(edge.count + 1) * 0.55, 5), opacity:selectedEdge && !chosen ? .3 : .85 },
      markerEnd:{ type:MarkerType.ArrowClosed, color },
    };
  }), [edges, nodeById, selectedEdge]);

  // 当前选中的：环节 → 流入的比赛 + 各处理结果；连线 → 走这条线的比赛
  const panel = useMemo(() => {
    if (selectedEdge) {
      const [from, to] = selectedEdge.split('>');
      const list = rows.filter(row => (row.trail || []).some((entry, index) => entry.n === from && row.trail![index + 1]?.n === to));
      return { kind:'edge' as const, from:nodeById.get(from), to:nodeById.get(to), list };
    }
    const node = nodeById.get(selectedNode);
    if (!node) return null;
    const inbound = rows.filter(row => (row.trail || []).some(entry => entry.n === node.id && !entry.virtual));
    const groups = node.outcomes.filter(outcome => outcome.count > 0).map(outcome => ({
      outcome, list:rows.filter(row => (row.trail || []).some(entry => entry.n === node.id && entry.o === outcome.id && !entry.virtual)),
    }));
    return { kind:'node' as const, node, inbound, groups };
  }, [selectedNode, selectedEdge, rows, nodeById]);

  function chooseNode(id:string) { setSelectedEdge(''); setSelectedNode(id); setShown({}); onSelect?.(id); }
  const more = (key:string) => setShown(current => ({ ...current, [key]:(current[key] || 30) + 60 }));
  const rowItems = (list:PipelineRunRow[], key:string, noteFor:(row:PipelineRunRow) => string) => {
    const limit = shown[key] || 30;
    return <>
      <ul className="flow-rows">{list.slice(0, limit).map((row, index) => <li key={`${row.url}-${index}`}>
        {row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.title || row.url}</a> : <span>{row.title}</span>}
        <small>{row.source}{noteFor(row) ? ` · ${noteFor(row)}` : ''}</small>
        {row.thinking && <details className="ai-thinking"><summary>AI 思考过程（{row.thinking.length} 字）</summary><pre>{row.thinking}</pre></details>}
      </li>)}</ul>
      {list.length > limit && <button type="button" className="flow-more" onClick={() => more(key)}>再显示 {Math.min(60, list.length - limit)} 条（还有 {list.length - limit} 条）</button>}
    </>;
  };

  return <div className="pipeline-flow">
    <div className="flow-legend"><span className="flow-dot system">系统</span>固定规则，每次结果一样，不花钱　<span className="flow-dot ai">AI</span>用了模型判断　<span className="flow-dot end">结束</span>不再往下走　· 方框右上角的数字是流入场数，连线上的数字是走这条线的场数；点方框或连线，下面列出对应的比赛</div>
    <div className="flow-canvas" ref={canvasRef} style={{ aspectRatio:`${DESIGN_W} / ${DESIGN_H}` }}>
      <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding:.015 }} minZoom={.05} maxZoom={3}
        onInit={instance => { instanceRef.current = instance; }}
        nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false}
        panOnDrag={false} panOnScroll={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false}
        proOptions={{ hideAttribution:false }}
        onNodeClick={(_, node) => chooseNode(node.id)} onEdgeClick={(_, edge) => { setSelectedNode(''); setSelectedEdge(edge.id); setShown({}); }}
        onPaneClick={() => { setSelectedNode(''); setSelectedEdge(''); onSelect?.(''); }}/>
    </div>
    {!panel && <p className="flow-hint">点上面任意一个方框或连线，这里会列出流进去的比赛，以及处理之后各去了哪。</p>}
    {panel?.kind === 'node' && <section className="flow-panel">
      <h3>{plain(panel.node.label)}<span className={`flow-badge ${panel.node.kind}`}>{panel.node.kind === 'ai' ? 'AI' : panel.node.kind === 'system' ? '系统规则' : '结束'}</span></h3>
      {panel.node.who && <p className="flow-who">{panel.node.who}</p>}
      {panel.node.desc && <p className="flow-desc">{panel.node.desc}</p>}
      {panel.node.kind !== 'end' && panel.groups.length > 0 && <div className="flow-groups">
        <h4>处理结果（流入 {panel.inbound.length} 场）</h4>
        {panel.groups.map(({ outcome, list }) => <div key={outcome.id} className="flow-group">
          <div className="flow-group-head"><b>{outcome.label}</b><span>{outcome.count} 场</span>
            {outcome.to && nodeById.get(outcome.to) && <button type="button" onClick={() => chooseNode(outcome.to)}>去向：{plain(nodeById.get(outcome.to)!.label)} ›</button>}</div>
          {rowItems(list, `${panel.node.id}:${outcome.id}`, row => stepNote(row, panel.node.id))}
        </div>)}
      </div>}
      <div className="flow-groups">
        <h4>流进这个环节的比赛（{panel.inbound.length} 场）</h4>
        {panel.inbound.length ? rowItems(panel.inbound, `${panel.node.id}:in`, row => (panel.node.kind === 'end' ? row.final : stepNote(row, panel.node.id))) : <p className="flow-hint">这一轮没有比赛流进这个环节。</p>}
      </div>
    </section>}
    {panel?.kind === 'edge' && <section className="flow-panel">
      <h3>{plain(panel.from?.label || '')} → {plain(panel.to?.label || '')}<span className="flow-badge">{panel.list.length} 场</span></h3>
      {rowItems(panel.list, `edge:${selectedEdge}`, row => stepNote(row, panel.from?.id || ''))}
    </section>}
  </div>;
}
