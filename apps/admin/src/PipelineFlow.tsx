import { useMemo, useState } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './pipelineFlow.css';
import type { FlowEdge, FlowNode, PipelineRunRow } from './adminCloud';

// 数据流图（2026-10-01 起）：抓取流水线的每个环节画成方框，标明是系统规则还是 AI；
// 点方框看流进这个环节的比赛和处理之后各去了哪，点连线看走这条线的比赛。
// 图上的数字和下面的清单都由每条比赛自己的 trail 算出来，所以点开的条数一定和图上一致。
// 画图用的是 React Flow（@xyflow/react，MIT 协议）。

const W = 260;
// 方框位置（左上角）。主线从上到下，通知追溯放右侧，各种“结束”放最右一列。
const POS: Record<string, [number, number]> = {
  search:[150, 0], platforms:[450, 0], dedupe:[300, 170], rule:[300, 340], jev:[300, 510],
  trace:[690, 510], followup:[690, 700], read:[300, 870], extract:[300, 1040], same_name:[300, 1210], scope:[300, 1380], gate:[300, 1550],
  end_dropped:[1090, 0], end_dup:[1090, 170], end_rejected:[1090, 340], end_lead:[1090, 510], end_trace_none:[1090, 700],
  end_readfail:[1090, 955], end_scope:[1090, 1465], end_written:[300, 1740],
};
const TONE_COLOR: Record<string, string> = { drop:'#94a3b8', bad:'#dc2626', warn:'#d97706', good:'#16a34a' };

type StageData = { node:FlowNode; selected:boolean };
type StageNode = Node<StageData, 'stage'>;

function StageBox({ data }: NodeProps<StageNode>) {
  const { node, selected } = data;
  const kindLabel = node.kind === 'ai' ? 'AI' : node.kind === 'system' ? '系统规则' : '结束';
  const outcomes = node.outcomes.filter(outcome => outcome.count > 0);
  return <div className={`flow-node flow-${node.kind}${node.tone ? ` tone-${node.tone}` : ''}${selected ? ' selected' : ''}${node.in === 0 ? ' idle' : ''}`} style={{ width:W }}>
    <Handle id="t" type="target" position={Position.Top}/><Handle id="l" type="target" position={Position.Left}/>
    <div className="flow-node-head"><span className="flow-badge">{kindLabel}</span><b>{node.label}</b></div>
    <div className="flow-node-count"><span>流入</span><strong>{node.in}</strong><span>场</span></div>
    {outcomes.length > 0 && <ul className="flow-outcomes">{outcomes.map(outcome => <li key={outcome.id}><span>{outcome.label}</span><b>{outcome.count}</b></li>)}</ul>}
    <Handle id="b" type="source" position={Position.Bottom}/><Handle id="r" type="source" position={Position.Right}/><Handle id="sl" type="source" position={Position.Left}/>
  </div>;
}
const nodeTypes = { stage:StageBox };

// 连线从哪边出、从哪边进：到“结束”走右侧；判重直通读详情的绕左边；其余自上而下
function handlesFor(from:string, to:string): { sourceHandle:string; targetHandle:string; type:'default' | 'smoothstep' } {
  if (to.startsWith('end_') && to !== 'end_written') return { sourceHandle:'r', targetHandle:'l', type:'default' };
  if (from === 'dedupe' && to === 'read') return { sourceHandle:'sl', targetHandle:'l', type:'smoothstep' };
  if (from === 'jev' && to === 'trace') return { sourceHandle:'r', targetHandle:'l', type:'default' };
  if (from === 'rule' && to === 'trace') return { sourceHandle:'r', targetHandle:'t', type:'default' };
  return { sourceHandle:'b', targetHandle:'t', type:'default' };
}

const stepNote = (row:PipelineRunRow, nodeId:string) => row.trail?.find(entry => entry.n === nodeId && !entry.virtual)?.note || '';

export default function PipelineFlow({ nodes, edges, rows, onSelect }: { nodes:FlowNode[]; edges:FlowEdge[]; rows:PipelineRunRow[]; onSelect?: (nodeId:string) => void }) {
  const [selectedNode, setSelectedNode] = useState('');
  const [selectedEdge, setSelectedEdge] = useState('');
  const [shown, setShown] = useState<Record<string, number>>({});
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);

  const flowNodes: StageNode[] = useMemo(() => nodes.filter(node => POS[node.id]).map(node => ({
    id:node.id, type:'stage', position:{ x:POS[node.id][0], y:POS[node.id][1] }, data:{ node, selected:selectedNode === node.id }, draggable:false, selectable:false,
  })), [nodes, selectedNode]);
  const flowEdges: Edge[] = useMemo(() => edges.filter(edge => POS[edge.from] && POS[edge.to]).map(edge => {
    const target = nodeById.get(edge.to);
    const color = target?.kind === 'end' ? (TONE_COLOR[target.tone] || '#94a3b8') : '#3b82f6';
    const chosen = selectedEdge === edge.id;
    return {
      id:edge.id, source:edge.from, target:edge.to, ...handlesFor(edge.from, edge.to),
      label:String(edge.count), labelStyle:{ fontSize:12, fontWeight:700, fill:'#1e293b' }, labelBgStyle:{ fill:'#fff', fillOpacity:.92 }, labelBgPadding:[5, 3] as [number, number], labelBgBorderRadius:6,
      style:{ stroke:color, strokeWidth:chosen ? 5 : Math.min(1.5 + Math.log2(edge.count + 1) * 0.9, 7), opacity:selectedEdge && !chosen ? .35 : .85 },
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
    <div className="flow-legend"><span className="flow-badge">系统规则</span>固定规则，每次结果一样，不花钱　<span className="flow-badge ai">AI</span>用了模型判断　<span className="flow-badge end">结束</span>不再往下走　· 点方框看流进来的比赛和处理结果，点连线看走这条线的比赛，滚轮平移，Ctrl+滚轮缩放</div>
    <div className="flow-canvas">
      {/* 整张图很高：打开时先放大到上半部分（搜索 → 筛选 → 追溯），往下滚动看读取和入库 */}
      <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} minZoom={.25} maxZoom={1.4}
        onInit={instance => { void instance.fitView({ nodes:['search', 'platforms', 'dedupe', 'rule', 'jev', 'trace', 'end_dropped', 'end_dup', 'end_rejected', 'end_lead'].map(id => ({ id })), padding:.04, maxZoom:1 }); }}
        nodesDraggable={false} nodesConnectable={false} panOnScroll zoomOnScroll={false} zoomActivationKeyCode="Control"
        onNodeClick={(_, node) => chooseNode(node.id)} onEdgeClick={(_, edge) => { setSelectedNode(''); setSelectedEdge(edge.id); setShown({}); }}
        onPaneClick={() => { setSelectedNode(''); setSelectedEdge(''); onSelect?.(''); }}>
        <Background gap={24} color="#e2e8f0"/><Controls showInteractive={false}/>
      </ReactFlow>
    </div>
    {!panel && <p className="flow-hint">点上面任意一个方框或连线，这里会列出流进去的比赛，以及处理之后各去了哪。</p>}
    {panel?.kind === 'node' && <section className="flow-panel">
      <h3>{panel.node.label}<span className={`flow-badge ${panel.node.kind}`}>{panel.node.kind === 'ai' ? 'AI' : panel.node.kind === 'system' ? '系统规则' : '结束'}</span></h3>
      {panel.node.who && <p className="flow-who">{panel.node.who}</p>}
      {panel.node.desc && <p className="flow-desc">{panel.node.desc}</p>}
      {panel.node.kind !== 'end' && panel.groups.length > 0 && <div className="flow-groups">
        <h4>处理结果（流入 {panel.inbound.length} 场）</h4>
        {panel.groups.map(({ outcome, list }) => <div key={outcome.id} className="flow-group">
          <div className="flow-group-head"><b>{outcome.label}</b><span>{outcome.count} 场</span>
            {outcome.to && nodeById.get(outcome.to) && <button type="button" onClick={() => chooseNode(outcome.to)}>去向：{nodeById.get(outcome.to)!.label} ›</button>}</div>
          {rowItems(list, `${panel.node.id}:${outcome.id}`, row => stepNote(row, panel.node.id))}
        </div>)}
      </div>}
      <div className="flow-groups">
        <h4>流进这个环节的比赛（{panel.inbound.length} 场）</h4>
        {panel.inbound.length ? rowItems(panel.inbound, `${panel.node.id}:in`, row => (panel.node.kind === 'end' ? row.final : stepNote(row, panel.node.id))) : <p className="flow-hint">这一轮没有比赛流进这个环节。</p>}
      </div>
    </section>}
    {panel?.kind === 'edge' && <section className="flow-panel">
      <h3>{panel.from?.label} → {panel.to?.label}<span className="flow-badge">{panel.list.length} 场</span></h3>
      {rowItems(panel.list, `edge:${selectedEdge}`, row => stepNote(row, panel.from?.id || ''))}
    </section>}
  </div>;
}
