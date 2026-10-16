import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { toPng } from "html-to-image";
import {
  Background, getNodesBounds, getViewportForBounds, Handle, MarkerType, MiniMap, Panel, Position, ReactFlow,
  useNodesInitialized, useNodesState, useReactFlow,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Graph, GraphTable, Relationship } from "../lib/api";
import { useTheme } from "../lib/theme";

const NODE_W = 260;
const HEADER_H = 30;
const ROW_H = 22;
const FIT = { padding: 0.15, maxZoom: 1, duration: 200 };

const ACCENTS = [
  "bg-cyan-500/15 text-cyan-200", "bg-violet-500/15 text-violet-200", "bg-emerald-500/15 text-emerald-200",
  "bg-amber-500/15 text-amber-200", "bg-rose-500/15 text-rose-200", "bg-sky-500/15 text-sky-200",
];
const accentFor = (name: string) =>
  ACCENTS[[...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % ACCENTS.length];

type TableNodeT = Node<{ table: GraphTable }, "table">;

function TableNodeView({ data, selected }: NodeProps<TableNodeT>) {
  const dot = { width: 7, height: 7, background: "var(--color-slate-500)", border: "none" };
  return (
    <div style={{ width: NODE_W }} className={`rounded-lg border bg-surface text-xs shadow-lg ${selected ? "border-cyan-400 ring-1 ring-cyan-400/60" : "border-slate-700"}`}>
      <div style={{ height: HEADER_H }} className={`relative flex items-center justify-between rounded-t-lg px-2.5 text-sm font-semibold ${accentFor(data.table.name)}`}>
        <span className="truncate">{data.table.name}</span>
        <span className="text-[10px] font-normal opacity-70">{data.table.columns.length}</span>
        <Handle type="target" id="__t" position={Position.Left} style={dot} />
        <Handle type="source" id="__s" position={Position.Right} style={dot} />
      </div>
      {data.table.columns.map((c) => (
        <div key={c.name} style={{ height: ROW_H }} className="relative flex items-center justify-between border-t border-slate-800/60 px-2.5 text-slate-300">
          <span className={`truncate ${c.primary_key ? "font-medium text-slate-100" : ""}`}>{c.name}</span>
          <span className="ml-2 flex shrink-0 items-center gap-1 text-slate-500">
            {c.primary_key && <span className="rounded bg-amber-500/15 px-1 text-[9px] font-semibold text-amber-300">PK</span>}
            {c.foreign_key && <span className="rounded bg-cyan-500/15 px-1 text-[9px] font-semibold text-cyan-300">FK</span>}
            <span className="max-w-24 truncate">{c.type}</span>
          </span>
          <Handle type="target" id={c.name} position={Position.Left} style={dot} />
          <Handle type="source" id={c.name} position={Position.Right} style={dot} />
        </div>
      ))}
    </div>
  );
}

const nodeTypes = { table: TableNodeView };

function buildLayout(graph: Graph): { nodes: TableNodeT[]; rels: Relationship[] } {
  const height = (t: GraphTable) => HEADER_H + ROW_H * t.columns.length;
  const names = new Set(graph.tables.map((t) => t.name));
  const rels = graph.relationships.filter((r) => names.has(r.source_table) && names.has(r.target_table));

  const linkedNames = new Set<string>();
  rels.forEach((r) => { linkedNames.add(r.source_table); linkedNames.add(r.target_table); });
  const linked = graph.tables.filter((t) => linkedNames.has(t.name));
  const isolated = graph.tables.filter((t) => !linkedNames.has(t.name));

  const pos = new Map<string, { x: number; y: number }>();
  let bottom = 0;

  if (linked.length > 0) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 160 });
    g.setDefaultEdgeLabel(() => ({}));
    linked.forEach((t) => g.setNode(t.name, { width: NODE_W, height: height(t) }));
    rels.forEach((r) => g.setEdge(r.source_table, r.target_table));
    dagre.layout(g);
    linked.forEach((t) => {
      const p = g.node(t.name);
      const y = p.y - height(t) / 2;
      pos.set(t.name, { x: p.x - NODE_W / 2, y });
      bottom = Math.max(bottom, y + height(t));
    });
  }

  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(isolated.length))));
  let y = linked.length > 0 ? bottom + 100 : 0;
  for (let i = 0; i < isolated.length; i += cols) {
    const row = isolated.slice(i, i + cols);
    row.forEach((t, k) => pos.set(t.name, { x: k * (NODE_W + 60), y }));
    y += Math.max(...row.map(height)) + 60;
  }

  const nodes: TableNodeT[] = graph.tables.map((t) => ({
    id: t.name, type: "table", data: { table: t }, position: pos.get(t.name) ?? { x: 0, y: 0 },
  }));
  return { nodes, rels };
}

function makeEdges(graph: Graph, rels: Relationship[], dark: boolean, selectedId: string | null): Edge[] {
  const columns = new Map(graph.tables.map((t) => [t.name, new Set(t.columns.map((c) => c.name))]));
  return rels.map((r) => {
    const inferred = r.kind === "inferred";
    const color = inferred ? (dark ? "#f59e0b" : "#d97706") : dark ? "#22d3ee" : "#0891b2";
    const active = selectedId !== null && (r.source_table === selectedId || r.target_table === selectedId);
    const dim = selectedId !== null && !active;
    const sc = r.source_columns[0];
    const tc = r.target_columns[0];
    return {
      id: r.id, source: r.source_table, target: r.target_table,
      sourceHandle: columns.get(r.source_table)?.has(sc) ? sc : "__s",
      targetHandle: columns.get(r.target_table)?.has(tc) ? tc : "__t",
      type: "smoothstep",
      label: active ? `${inferred ? "inferred? " : ""}${r.source_columns.join(", ")} → ${r.target_columns.join(", ")}` : undefined,
      labelStyle: { fill: color, fontSize: 11 },
      labelBgStyle: { fill: "var(--color-surface)" },
      style: { stroke: color, strokeWidth: active ? 2.5 : 1.6, strokeDasharray: inferred ? "6 4" : undefined, opacity: dim ? 0.15 : 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      zIndex: active ? 10 : 0,
    };
  });
}

function FitController({ wrapRef, signature }: { wrapRef: RefObject<HTMLDivElement | null>; signature: string }) {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();

  useEffect(() => {
    if (initialized) fitView(FIT);
  }, [initialized, signature, fitView]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timer: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fitView(FIT), 150);
    });
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(timer); };
  }, [wrapRef, fitView]);

  return null;
}

function Toolbar({ wrapRef, filename, dark }: { wrapRef: RefObject<HTMLDivElement | null>; filename: string; dark: boolean }) {
  const { getNodes, fitView, zoomTo } = useReactFlow();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const btn = "rounded-md border border-slate-600 bg-surface px-2.5 py-1 text-xs text-slate-200 hover:border-cyan-500/50 disabled:opacity-50";

  const download = async () => {
    const nodes = getNodes();
    const el = wrapRef.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (nodes.length === 0 || !el) return;
    setBusy(true);
    setErr("");
    try {
      const bounds = getNodesBounds(nodes);
      const width = Math.min(6000, Math.max(800, Math.ceil(bounds.width) + 160));
      const height = Math.min(6000, Math.max(600, Math.ceil(bounds.height) + 160));
      const vp = getViewportForBounds(bounds, width, height, 0.1, 2, 0.05);
      const dataUrl = await toPng(el, {
        backgroundColor: dark ? "#070b14" : "#ffffff", width, height,
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      a.click();
    } catch {
      setErr("Could not create the image");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel position="top-right">
        <div className="flex gap-1.5">
          <button onClick={() => fitView(FIT)} className={btn}>Fit</button>
          <button onClick={() => zoomTo(1, { duration: 200 })} className={btn}>100%</button>
          <button onClick={download} disabled={busy} className={btn}>{busy ? "Saving..." : "Download image"}</button>
        </div>
        {err && <div className="mt-1 text-right text-xs text-red-400">{err}</div>}
      </Panel>
      <Panel position="top-left">
        <div className="rounded-md border border-slate-700 bg-surface/90 px-2 py-1 text-[11px] text-slate-400">
          <span className="text-cyan-400">━</span> foreign key &nbsp; <span className="text-amber-400">╍</span> guessed &nbsp; · click a table to follow its links
        </div>
      </Panel>
    </>
  );
}

export default function ErFlow({ graph, height = "100%", filename = "er-diagram.png" }: {
  graph: Graph; height?: string; filename?: string;
}) {
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const layout = useMemo(() => buildLayout(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeT>(layout.nodes);
  useEffect(() => { setNodes(layout.nodes); setSelectedId(null); }, [layout, setNodes]);

  const edges = useMemo(() => makeEdges(graph, layout.rels, dark, selectedId), [graph, layout, dark, selectedId]);
  const signature = graph.tables.map((t) => t.name).join("|");

  return (
    <div ref={wrapRef} style={{ height }} className="overflow-hidden rounded-md border border-slate-800">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={resolved}
        fitView fitViewOptions={FIT} minZoom={0.05} maxZoom={2} nodesConnectable={false}
        onNodeClick={(_, n) => setSelectedId(n.id)} onPaneClick={() => setSelectedId(null)}
      >
        <Background />
        <MiniMap pannable zoomable />
        <Toolbar wrapRef={wrapRef} filename={filename} dark={dark} />
        <FitController wrapRef={wrapRef} signature={signature} />
      </ReactFlow>
    </div>
  );
}
