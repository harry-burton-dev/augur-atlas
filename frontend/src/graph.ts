import { MultiDirectedGraph } from 'graphology';
import { propertyLabel, type Fold, type GraphEdge, type GraphNode, type GraphUnseen, type Ontology, type Subgraph } from './api.js';

/**
 * What the explorer has opened so far around its centre: each answer from the
 * subgraph merged in, a ring or a fold at a time. Nothing loads the whole graph.
 */
export interface Explored {
  centre: string;
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  /** Links not drawn yet, by `${entity} ${relation} ${direction}`: open one to add them. */
  folds: Map<string, Fold>;
  /** What is linked but can't be seen from here, by id. */
  unseen: Map<string, GraphUnseen>;
}

export const foldKey = (f: Pick<Fold, 'entity' | 'relation' | 'direction'>) => `${f.entity} ${f.relation} ${f.direction}`;

const empty = (centre: string): Explored => ({ centre, nodes: new Map(), edges: new Map(), folds: new Map(), unseen: new Map() });

/**
 * Merges a subgraph walked from `from` (the centre, for a fresh start) into what
 * is open. Rings count from the centre. Opening a fold (`relation`) replaces
 * only that fold; opening a ring replaces every fold of the entity it starts at.
 */
export const widen = (open: Explored | undefined, sub: Subgraph, from: string, relation?: string): Explored => {
  const next: Explored = open
    ? { centre: open.centre, nodes: new Map(open.nodes), edges: new Map(open.edges), folds: new Map(open.folds), unseen: new Map(open.unseen) }
    : empty(from);
  const base = next.nodes.get(from)?.depth ?? 0;
  const known = new Set(next.nodes.keys());
  for (const n of sub.nodes) if (!next.nodes.has(n.ref.id)) next.nodes.set(n.ref.id, { ...n, depth: base + n.depth });
  for (const e of sub.edges) next.edges.set(e.id, e);
  for (const [key, fold] of next.folds) if (fold.entity === from && (!relation || fold.relation === relation)) next.folds.delete(key);
  for (const fold of sub.more) {
    // An entity that was already open keeps its own folds; this answer only counts what it walked.
    if (fold.entity !== from && known.has(fold.entity)) continue;
    next.folds.set(foldKey(fold), fold);
  }
  for (const u of sub.unseen) {
    const had = next.unseen.get(u.id);
    next.unseen.set(u.id, { ...u, near: [...new Set([...(had?.near ?? []), ...u.near])] });
  }
  return next;
};

/** The entities in each ring out from the centre, nearest first. */
export const rings = (open: Explored) => {
  const byDepth = new Map<number, GraphNode[]>();
  for (const n of open.nodes.values()) byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n]);
  return [...byDepth].sort(([a], [b]) => a - b).map(([depth, nodes]) => ({ depth, nodes: nodes.sort((a, b) => a.ref.label.localeCompare(b.ref.label)) }));
};

/** The links drawn at an entity, read from its side ("Operated by Northwind", "Operates Kestrel"). */
export const linksOf = (open: Explored, ontology: Ontology | undefined, id: string) => {
  const node = open.nodes.get(id);
  return [...open.edges.values()]
    .filter((e) => e.from === id || e.to === id)
    .map((e) => {
      const out = e.from === id;
      const other = open.nodes.get(out ? e.to : e.from);
      return { edge: e, other, label: propertyLabel(ontology, node?.ref.type ?? '', e.relation, out ? 'out' : 'in') };
    })
    .filter((l): l is typeof l & { other: GraphNode } => !!l.other);
};

/** What an entity has folded, and what is linked to it but hidden. */
export const foldsOf = (open: Explored, id: string) => [...open.folds.values()].filter((f) => f.entity === id);
export const hiddenNear = (open: Explored, id: string) => [...open.unseen.values()].filter((u) => u.near.includes(id));

/** What drawing the graph needs from the page: colours from the kit's tokens. */
export interface Look {
  you: string;
  team: string;
  org: string;
  ink: string;
  muted: string;
  line: string;
  disputed: string;
  /** Behind a highlighted label, so it reads on the dark ground. */
  ground: string;
}

/**
 * How a selected or hovered node is drawn: a ring in ink and its label on the
 * dark ground. Sigma's own puts the label on white, which ink can't be read on.
 */
export const hoverDrawer =
  (look: Look) =>
  (context: CanvasRenderingContext2D, data: { x: number; y: number; size: number; label?: string | null }, settings: { labelSize: number; labelFont: string; labelWeight: string }) => {
    context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
    context.beginPath();
    context.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
    context.strokeStyle = look.ink;
    context.lineWidth = 2;
    context.stroke();
    if (!data.label) return;
    const width = context.measureText(data.label).width;
    const x = data.x + data.size + 6;
    context.fillStyle = look.ground;
    context.beginPath();
    context.roundRect(x - 4, data.y - settings.labelSize / 2 - 4, width + 8, settings.labelSize + 8, 4);
    context.fill();
    context.fillStyle = look.ink;
    context.fillText(data.label, x, data.y + settings.labelSize / 3);
  };

/** Where a node is kept decides its colour, the same marks as the floor gauge. */
const floorColour = (look: Look, floorName: string) => (floorName === 'You' ? look.you : floorName === 'Org' ? look.org : look.team);

export const FOLD = 'fold:';
export const HIDDEN = 'hidden:';

/** The entities and links that show with disputed links left out: those still reachable from the centre. */
const reachable = (open: Explored, hideDisputed: boolean) => {
  if (!hideDisputed) return { nodes: new Set(open.nodes.keys()), edges: [...open.edges.values()] };
  const edges = [...open.edges.values()].filter((e) => e.disputed === 0);
  const nodes = new Set([open.centre]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of edges) {
      if (nodes.has(e.from) !== nodes.has(e.to)) {
        nodes.add(e.from);
        nodes.add(e.to);
        grew = true;
      }
    }
  }
  return { nodes, edges: edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)) };
};

/**
 * Brings a graphology graph in line with what is open, keeping where nodes
 * already are so the picture doesn't jump; a new node starts beside the one it
 * opened from. Folds and hidden counts are small nodes of their own, so they can
 * be pressed. Returns the ids of nodes it added.
 */
export const syncGraph = (graph: MultiDirectedGraph, open: Explored, ontology: Ontology | undefined, look: Look, { hideDisputed = false } = {}) => {
  const shown = reachable(open, hideDisputed);
  const want = new Map<string, Record<string, unknown>>();
  const links: { key: string; from: string; to: string; attrs: Record<string, unknown> }[] = [];
  for (const id of shown.nodes) {
    const n = open.nodes.get(id);
    if (!n) continue;
    const centre = id === open.centre;
    want.set(id, {
      label: n.ref.label,
      size: centre ? 16 : Math.max(6, 11 - n.depth * 2),
      color: floorColour(look, n.floorName),
      kind: 'entity',
      fixed: centre,
      ...(n.state === 'retired' ? { color: look.muted } : {}),
    });
  }
  for (const e of shown.edges) {
    links.push({
      key: e.id,
      from: e.from,
      to: e.to,
      attrs: { label: propertyLabel(ontology, open.nodes.get(e.from)?.ref.type ?? '', e.relation), color: e.disputed ? look.disputed : look.line, size: e.disputed ? 2 : 1.2, type: 'arrow' },
    });
  }
  for (const f of open.folds.values()) {
    if (!want.has(f.entity)) continue;
    const id = `${FOLD}${foldKey(f)}`;
    const relation = propertyLabel(ontology, open.nodes.get(f.entity)?.ref.type ?? '', f.relation, f.direction).toLowerCase();
    want.set(id, { label: `+${f.count} ${relation}`, size: 4, color: look.muted, kind: 'fold' });
    links.push({ key: `${id}>`, from: f.entity, to: id, attrs: { color: look.line, size: 0.8, type: 'line' } });
  }
  const hiddenBy = new Map<string, number>();
  for (const u of open.unseen.values()) for (const near of u.near) if (want.has(near)) hiddenBy.set(near, (hiddenBy.get(near) ?? 0) + 1);
  for (const [near, count] of hiddenBy) {
    const id = `${HIDDEN}${near}`;
    want.set(id, { label: `${count} hidden`, size: 4, color: look.muted, kind: 'hidden' });
    links.push({ key: `${id}>`, from: near, to: id, attrs: { color: look.line, size: 0.8, type: 'line' } });
  }

  graph.forEachNode((id) => {
    if (!want.has(id)) graph.dropNode(id);
  });
  const added: string[] = [];
  const parentOf = (id: string) => links.find((l) => l.to === id && graph.hasNode(l.from))?.from ?? links.find((l) => l.from === id && graph.hasNode(l.to))?.to;
  // Place nearer rings first, so each new node can start beside one already placed.
  const order = [...want.keys()].sort((a, b) => (open.nodes.get(a)?.depth ?? 9) - (open.nodes.get(b)?.depth ?? 9));
  for (const id of order) {
    const attrs = want.get(id)!;
    if (graph.hasNode(id)) {
      graph.mergeNodeAttributes(id, attrs);
      continue;
    }
    const parent = parentOf(id);
    const at = parent ? graph.getNodeAttributes(parent) : { x: 0, y: 0 };
    const turn = Math.random() * Math.PI * 2;
    const away = id === open.centre ? 0 : 1 + Math.random();
    graph.addNode(id, { ...attrs, x: (at.x as number) + Math.cos(turn) * away, y: (at.y as number) + Math.sin(turn) * away });
    added.push(id);
  }
  const keys = new Set(links.map((l) => l.key));
  graph.forEachEdge((key) => {
    if (!keys.has(key)) graph.dropEdge(key);
  });
  for (const l of links) {
    if (!graph.hasNode(l.from) || !graph.hasNode(l.to)) continue;
    if (graph.hasEdge(l.key)) graph.mergeEdgeAttributes(l.key, l.attrs);
    else graph.addDirectedEdgeWithKey(l.key, l.from, l.to, l.attrs);
  }
  return added;
};
