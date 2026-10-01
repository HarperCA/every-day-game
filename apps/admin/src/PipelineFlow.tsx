import { useEffect, useRef, useState } from 'react';
import './pipelineFlow.css';
import type { FlowEdge, FlowNode } from './adminCloud';
import { BOUNDS, NODE_H, NODE_W, POS, ROUTES, labelAnchor, routePath } from './flowLayout';

// 数据流图（2026-10-01）：抓取流水线的每个环节画成方框，标明是系统规则还是 AI。
// 版面固定、每条线的走法都手工设计好（见 flowLayout.ts，有测试保证线路不交叉不重叠）；
// 整张图按容器宽度同比缩放，不能缩放拖动。点方框、点连线、点连线上的数字都会选中，
// 选中后下面的明细表只显示对应的比赛（见 PipelineRunDetail.tsx）。

const TONE_COLOR: Record<string, string> = { drop:'#94a3b8', bad:'#dc2626', warn:'#d97706', good:'#16a34a' };
const MAIN_COLOR = '#3b82f6';
export const plain = (label:string) => label.replace(/\n/g, ' ');
export const kindName = (kind:FlowNode['kind']) => kind === 'ai' ? 'AI' : kind === 'system' ? '系统' : '结束';

type Props = {
  nodes:FlowNode[]; edges:FlowEdge[];
  selectedNode:string; selectedEdge:string;
  onNode:(id:string) => void; onEdge:(id:string) => void; onClear:() => void;
};

export default function PipelineFlow({ nodes, edges, selectedNode, selectedEdge, onNode, onEdge, onClear }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return undefined;
    const fit = () => setScale(element.clientWidth / BOUNDS.w || 1);
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const drawn = edges.filter(edge => ROUTES[edge.id]);
  const shift = (points:Array<[number, number]>) => points.map(([x, y]) => [x - BOUNDS.x, y - BOUNDS.y] as [number, number]);
  const colorOf = (edge:FlowEdge) => { const target = nodeById.get(edge.to); return target?.kind === 'end' ? (TONE_COLOR[target.tone] || '#94a3b8') : MAIN_COLOR; };
  const colors = [...new Set(drawn.map(colorOf))];
  const anySelected = selectedNode !== '' || selectedEdge !== '';
  const emphasised = (edge:FlowEdge) => selectedEdge === edge.id || (selectedNode !== '' && (edge.from === selectedNode || edge.to === selectedNode));

  return <div className="flow-canvas" ref={wrapRef} style={{ height:BOUNDS.h * scale }}>
    <div className="flow-stage" style={{ width:BOUNDS.w, height:BOUNDS.h, transform:`scale(${scale})` }} onClick={onClear}>
      <svg width={BOUNDS.w} height={BOUNDS.h} className="flow-lines">
        <defs>{colors.map(color => <marker key={color} id={`arrow-${color.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill={color}/></marker>)}</defs>
        {drawn.map(edge => {
          const color = colorOf(edge);
          const path = routePath(shift(ROUTES[edge.id]));
          const strong = emphasised(edge);
          return <g key={edge.id} className="flow-line" opacity={anySelected && !strong ? .22 : 1}>
            <path d={path} fill="none" stroke={color} strokeWidth={strong ? 4.5 : Math.min(1.4 + Math.log2(edge.count + 1) * .55, 5)} strokeLinejoin="round" markerEnd={`url(#arrow-${color.slice(1)})`}/>
            <path d={path} fill="none" stroke="transparent" strokeWidth={16} style={{ cursor:'pointer' }} onClick={event => { event.stopPropagation(); onEdge(edge.id); }}><title>点击查看走这条线的 {edge.count} 场比赛</title></path>
          </g>;
        })}
      </svg>
      {drawn.map(edge => {
        const [x, y] = labelAnchor(shift(ROUTES[edge.id]));
        const strong = emphasised(edge);
        return <button type="button" key={edge.id} data-edge={edge.id} className={`flow-edge-label${selectedEdge === edge.id ? ' selected' : ''}`} style={{ left:x, top:y, opacity:anySelected && !strong ? .4 : 1 }}
          title="点击查看走这条线的比赛" onClick={event => { event.stopPropagation(); onEdge(edge.id); }}>{edge.count}</button>;
      })}
      {nodes.filter(node => POS[node.id]).map(node => {
        const [x, y] = POS[node.id];
        const tip = `${plain(node.label)}（${kindName(node.kind)}）\n${node.who}${node.outcomes.filter(outcome => outcome.count > 0).map(outcome => `\n· ${outcome.label}：${outcome.count}`).join('')}`;
        return <div key={node.id} data-node={node.id} title={tip} role="button" tabIndex={0}
          className={`flow-node flow-${node.kind}${node.tone ? ` tone-${node.tone}` : ''}${selectedNode === node.id ? ' selected' : ''}${node.in === 0 ? ' idle' : ''}`}
          style={{ left:x - BOUNDS.x, top:y - BOUNDS.y, width:NODE_W, height:NODE_H }}
          onClick={event => { event.stopPropagation(); onNode(node.id); }} onKeyDown={event => { if (event.key === 'Enter') onNode(node.id); }}>
          <div className="flow-node-top"><span className={`flow-dot ${node.kind}`}>{kindName(node.kind)}</span><strong>{node.in}</strong></div>
          <div className="flow-node-title">{node.label}</div>
        </div>;
      })}
    </div>
  </div>;
}
