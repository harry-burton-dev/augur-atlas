import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MultiDirectedGraph } from 'graphology';
import type Sigma from 'sigma';
import type FA2Layout from 'graphology-layout-forceatlas2/worker';
import { Button, Checkbox, CheckboxGroup, DateField, Heading, PageHead, Ref, Select, State, Toggle, cx, type SelectOption } from '@augur/app-kit';
import { PAST_DAYS, floorWords, type AtlasApi, type Fold, type GraphNode, type Ontology, type Subgraph } from './api.js';
import { FOLD, HIDDEN, foldsOf, hiddenNear, hoverDrawer, linksOf, rings, syncGraph, widen, type Explored, type Look } from './graph.js';

/** Links drawn from each entity before the rest fold into a count. */
const PER_NODE = 12;
/** Past this many links, their names stay in the panel and the list: on the graph they'd only be noise. */
const NAMED_LINKS = 24;

/** Whether this browser can draw with WebGL, which the graph needs. */
export const canDraw = () => {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
};

const RING_WORDS = ['', 'One ring', 'Two rings', 'Three rings'];

/** The colours the graph draws with, read from the kit's tokens where it sits. */
const lookOf = (el: Element): Look => {
  const style = getComputedStyle(el);
  const token = (name: string, fallback: string) => style.getPropertyValue(`--${name}`).trim() || fallback;
  return {
    you: token('floor-you-high', '#34D399'),
    team: token('floor-team-high', '#F2B24C'),
    org: token('floor-org-high', '#86A0F4'),
    ink: token('ink', '#D1D5DB'),
    muted: token('ink-muted', '#9CA3AF'),
    line: token('hairline-strong', 'rgba(209, 213, 219, 0.24)'),
    disputed: token('warning', '#FBBF24'),
    ground: token('slate-deep', '#1C222C'),
  };
};

export interface ExplorerProps {
  api: AtlasApi;
  ontology: Ontology | undefined;
  /** The entity in the middle. */
  centre: string;
  floorName?: string;
  onOpenEntity: (id: string) => void;
  /** Makes another entity the centre. */
  onExplore: (id: string) => void;
}

/**
 * The explorer: the graph around one entity, as seen from this floor, opened a
 * ring at a time. Each ring shows the strongest links and folds the rest into
 * counts to open; nothing loads the whole graph. What is linked but can't be
 * seen from here shows as a count that says why (explain, never hide). Drawn
 * with Sigma.js on graphology, laid out by ForceAtlas2 in a worker; the same
 * graph is always there as a list, for keyboards and screen readers, and for
 * browsers that can't draw it.
 */
export function Explorer({ api, ontology, centre, floorName = '', onOpenEntity, onExplore }: ExplorerProps) {
  const drawable = useMemo(canDraw, []);
  const topKinds = useMemo<SelectOption[]>(() => (ontology?.types ?? []).filter((t) => !t.parent).map((t) => ({ value: t.key, label: t.plural })), [ontology]);
  const [open, setOpen] = useState<Explored>();
  const [depth, setDepth] = useState(1);
  /** The top kinds to show, as ontology keys; all of them shows everything. */
  const [kinds, setKinds] = useState<string[]>([]);
  const [relations, setRelations] = useState<string[]>([]);
  const [hideDisputed, setHideDisputed] = useState(false);
  /** "True on": a day, or empty for today. */
  const [at, setAt] = useState('');
  /** The node selected: an entity id, or a fold or hidden count. */
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  /** Opening a fold or a ring. */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Why the centre can't be seen from here. */
  const [unseen, setUnseen] = useState('');
  const [view, setView] = useState<'graph' | 'list'>(drawable ? 'graph' : 'list');

  const canvas = useRef<HTMLDivElement>(null);
  const graph = useRef(new MultiDirectedGraph());
  const sigma = useRef<Sigma>(undefined);
  const layout = useRef<FA2Layout>(undefined);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const asked = useRef(0);
  const chosen = useRef(selected);
  chosen.current = selected;

  // Every kind and link is shown until someone narrows it.
  useEffect(() => {
    if (!ontology) return;
    setKinds((now) => (now.length ? now : topKinds.map((o) => o.value)));
    setRelations((now) => (now.length ? now : ontology.relations.map((r) => r.key)));
  }, [ontology, topKinds]);

  /** What the filters ask the service for: nothing, when everything is chosen. Kept as words, so the same ask isn't sent twice. */
  const askKey = JSON.stringify({
    ...(!kinds.length || kinds.length === topKinds.length ? {} : { types: kinds }),
    ...(!relations.length || relations.length === (ontology?.relations.length ?? 0) ? {} : { relations }),
    ...(at ? { asOf: new Date(at).toISOString() } : {}),
  });
  const narrowing = useCallback((): { types?: string[]; relations?: string[]; asOf?: string } => JSON.parse(askKey), [askKey]);

  const stopDrawing = () => {
    clearTimeout(settleTimer.current);
    layout.current?.kill();
    sigma.current?.kill();
    layout.current = undefined;
    sigma.current = undefined;
  };
  useEffect(() => stopDrawing, []);

  /** Starts again from the centre: on arriving, or when a filter or the day changes. */
  const load = useCallback(async () => {
    const mine = ++asked.current;
    setLoading(true);
    setError('');
    setUnseen('');
    try {
      const sub = await api.subgraph({ seeds: [centre], depth, limitPerNode: PER_NODE, ...narrowing() });
      if (mine !== asked.current) return;
      if (sub.missing.includes(centre)) throw new Error('There’s no such entity. It may have been merged into another.');
      const hidden = sub.unseen.find((u) => u.id === centre);
      if (hidden) {
        setUnseen(hidden.message);
        setOpen(undefined);
        return;
      }
      const next = widen(undefined, sub, centre);
      // A fresh start draws afresh, so places from another centre don't linger.
      graph.current.clear();
      setOpen(next);
      setSelected((s) => (next.nodes.has(s) ? s : centre));
    } catch (err) {
      if (mine === asked.current) setError((err as Error).message);
    } finally {
      if (mine === asked.current) setLoading(false);
    }
  }, [api, centre, depth, narrowing]);
  useEffect(() => {
    // Nothing to ask while every kind or link has been unticked: the group says so.
    if (ontology && (!kinds.length || !relations.length)) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /** Adds to what is open, from one entity: a fold's links, or a ring past it. */
  const widenFrom = async (from: string, query: Omit<Parameters<AtlasApi['subgraph']>[0], 'seeds'>, relation?: string) => {
    setBusy(true);
    setError('');
    try {
      const sub: Subgraph = await api.subgraph({ seeds: [from], ...narrowing(), ...query });
      setOpen((now) => (now ? widen(now, sub, from, relation) : now));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openFold = (fold: Fold) => widenFrom(fold.entity, { depth: 1, relations: [fold.relation], limitPerNode: 200 }, fold.relation);

  /** A press on a node: a fold opens, anything else is selected. */
  const choose = (node: string) => {
    if (node.startsWith(FOLD)) {
      const fold = open?.folds.get(node.slice(FOLD.length));
      if (fold) void openFold(fold);
      return;
    }
    setSelected(node);
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  // Draws what is open, laying out only while something new settles in.
  useEffect(() => {
    if (view !== 'graph' || !drawable || !open?.nodes.size) return;
    const container = canvas.current;
    if (!container) return;
    let live = true;
    void (async () => {
      const look = lookOf(container);
      const added = syncGraph(graph.current, open, ontology, look, { hideDisputed });
      if (!sigma.current) {
        const [{ default: SigmaDraw }, { default: Layout }, { default: forceAtlas2 }] = await Promise.all([
          import('sigma'),
          import('graphology-layout-forceatlas2/worker'),
          import('graphology-layout-forceatlas2'),
        ]);
        if (!live || sigma.current) return;
        const font = getComputedStyle(container).fontFamily;
        const drawn = new SigmaDraw(graph.current, container, {
          allowInvalidContainer: true,
          stagePadding: 60,
          labelRenderedSizeThreshold: 0,
          labelDensity: 1,
          labelGridCellSize: 60,
          defaultDrawNodeHover: hoverDrawer(look),
          labelFont: font,
          labelSize: 13,
          labelColor: { color: look.ink },
          edgeLabelFont: font,
          edgeLabelSize: 11,
          edgeLabelColor: { color: look.muted },
          defaultEdgeType: 'arrow',
          zIndex: true,
          nodeReducer: (node, attrs) => (node === chosen.current ? { ...attrs, highlighted: true, zIndex: 1 } : attrs),
        });
        drawn.on('clickNode', ({ node }) => chooseRef.current(node));
        drawn.on('clickStage', () => setSelected(''));
        drawn.on('enterNode', () => (container.style.cursor = 'pointer'));
        drawn.on('leaveNode', () => (container.style.cursor = ''));
        sigma.current = drawn;
        layout.current = new Layout(graph.current, { settings: { ...forceAtlas2.inferSettings(graph.current), slowDown: 4, gravity: 0.6 } });
      }
      if (added.length) {
        layout.current?.start();
        clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => layout.current?.stop(), 1600);
      }
      sigma.current.setSetting('renderEdgeLabels', graph.current.size <= NAMED_LINKS);
      sigma.current.refresh();
    })();
    return () => {
      live = false;
    };
  }, [view, drawable, open, ontology, hideDisputed]);
  useEffect(() => void sigma.current?.refresh(), [selected]);

  /** A fold's links, read from its entity's side: "operates", "located at". */
  const foldWord = (fold: Fold) => {
    const r = ontology?.relations.find((x) => x.key === fold.relation);
    return ((fold.direction === 'in' ? r?.inverse : r?.label) ?? fold.relation).toLowerCase();
  };
  const typeLabel = (n: GraphNode) => ontology?.types.find((t) => t.key === n.ref.type)?.label ?? n.ref.type;

  /** What is selected, and what can be done with it from here. */
  const selection = () => {
    if (!open) return null;
    if (selected.startsWith(HIDDEN)) {
      const near = selected.slice(HIDDEN.length);
      const hidden = hiddenNear(open, near);
      return (
        <>
          <Heading eyebrow="Hidden from here" heading={`${hidden.length} linked to ${open.nodes.get(near)?.ref.label ?? 'it'}`} size="s" />
          <ul className="atlas-why">
            {hidden.map((u) => (
              <li key={u.id}>{u.message}</li>
            ))}
          </ul>
        </>
      );
    }
    const n = open.nodes.get(selected);
    if (!n) return <p className="atlas-note">Select an entity to see how it’s linked, make it the centre, or open its page.</p>;
    const links = linksOf(open, ontology, n.ref.id);
    const folds = foldsOf(open, n.ref.id);
    const hidden = hiddenNear(open, n.ref.id);
    const isCentre = n.ref.id === open.centre;
    return (
      <>
        <Heading eyebrow={`${typeLabel(n)} · ${n.floorName === 'Org' ? 'Org floor' : n.floorName === 'You' ? 'Your own floor' : n.floorName}`} heading={n.ref.label} size="s" />
        {n.state === 'retired' ? <p className="atlas-note">Retired. It keeps its id, so its links still say what it was.</p> : null}
        {links.length ? (
          <ul className="atlas-links">
            {links.map((l) => (
              <li key={l.edge.id}>
                <span className="atlas-relation">{l.label}</span>
                <Ref value={l.other.ref} onOpen={() => setSelected(l.other.ref.id)} />
                {l.edge.disputed ? <span className="atlas-disputed">disputed</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="atlas-note">No links drawn yet.</p>
        )}
        {hidden.length ? (
          <p className="atlas-note">
            {hidden.length} more linked {hidden.length === 1 ? 'one doesn’t' : 'ones don’t'} show from here.{' '}
            <button type="button" className="atlas-link" onClick={() => setSelected(`${HIDDEN}${n.ref.id}`)}>
              Why
            </button>
          </p>
        ) : null}
        <div className="atlas-actions">
          {folds.map((f) => (
            <Button key={`${f.relation} ${f.direction}`} kind="secondary" size="sm" busy={busy} onPress={() => void openFold(f)}>
              Open {f.count} more {foldWord(f)}
            </Button>
          ))}
          <Button kind="secondary" size="sm" disabled={isCentre} reason="It’s already the centre." onPress={() => onExplore(n.ref.id)}>
            Make it the centre
          </Button>
          <Button kind="ghost" size="sm" onPress={() => onOpenEntity(n.ref.id)}>
            Open its page
          </Button>
        </div>
        {!folds.length ? <p className="atlas-note">Everything linked to it from here is open.</p> : null}
      </>
    );
  };

  /** The same graph as a list, a ring at a time. Always there for keyboards and screen readers. */
  const list = () => {
    if (!open) return null;
    return (
      <div className="atlas-rings">
        {rings(open).map(({ depth: d, nodes }) => (
          <section key={d}>
            <h3 className="atlas-ring">{d === 0 ? 'Centre' : `Ring ${d}`}</h3>
            <ul>
              {nodes.map((n) => {
                const links = d === 0 ? [] : linksOf(open, ontology, n.ref.id).filter((l) => l.other.depth < d);
                const folds = foldsOf(open, n.ref.id);
                const hidden = hiddenNear(open, n.ref.id);
                return (
                  <li key={n.ref.id}>
                    <button type="button" className={cx('atlas-link', n.ref.id === selected && 'atlas-chosen')} onClick={() => setSelected(n.ref.id)}>
                      {n.ref.label}
                    </button>
                    <span className="atlas-note">
                      {typeLabel(n)} · {floorWords(n.floorName)}
                    </span>
                    {links.map((l) => (
                      <span key={l.edge.id} className="atlas-note">
                        · {l.label} {l.other.ref.label}
                        {l.edge.disputed ? ' (disputed)' : ''}
                      </span>
                    ))}
                    {folds.map((f) => (
                      <button key={`${f.relation} ${f.direction}`} type="button" className="atlas-fold" disabled={busy} onClick={() => void openFold(f)}>
                        +{f.count} {foldWord(f)}
                      </button>
                    ))}
                    {hidden.length ? (
                      <button type="button" className="atlas-fold" onClick={() => setSelected(`${HIDDEN}${n.ref.id}`)}>
                        {hidden.length} hidden
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );
  };

  const relationOptions = (ontology?.relations ?? []).map((r) => ({ value: r.key, label: r.label }));
  const filters = (
    <aside className="atlas-filters-pane" aria-label="What to show">
      <Select label="Rings out" options={[1, 2, 3].map((d) => ({ value: String(d), label: RING_WORDS[d] }))} value={String(depth)} onChange={(v) => Number(v) !== depth && setDepth(Number(v))} />
      <CheckboxGroup label="Kinds" required value={kinds} hint="The centre always shows" onChange={setKinds} message={kinds.length ? undefined : 'Tick at least one kind to show.'}>
        {topKinds.map((o) => (
          <Checkbox key={o.value} value={o.value}>
            {o.label}
          </Checkbox>
        ))}
      </CheckboxGroup>
      <CheckboxGroup label="Links" required value={relations} onChange={setRelations} message={relations.length ? undefined : 'Tick at least one kind of link to show.'}>
        {relationOptions.map((o) => (
          <Checkbox key={o.value} value={o.value}>
            {o.label}
          </Checkbox>
        ))}
      </CheckboxGroup>
      <Toggle label="Hide disputed" checked={hideDisputed} hint="Disputed links, and what only they reach" onChange={setHideDisputed} />
      <DateField label="True on" optional empty="Today" quick={PAST_DAYS} value={at} hint="The day in the world" onChange={(v) => v !== at && setAt(v)} />
    </aside>
  );

  const legend = (
    <ul className="atlas-legend" aria-label="Key">
      <li>
        <span className="atlas-dot" style={{ background: 'var(--floor-you-high)' }} />
        Kept on your own floor
      </li>
      <li>
        <span className="atlas-dot" style={{ background: 'var(--floor-team-high)' }} />
        On a team’s floor
      </li>
      <li>
        <span className="atlas-dot" style={{ background: 'var(--floor-org-high)' }} />
        On the org floor
      </li>
      <li>
        <span className="atlas-dot atlas-dot-small" style={{ background: 'var(--ink-muted)' }} />
        Folded or hidden: press to open or see why
      </li>
      <li>
        <span className="atlas-line" style={{ background: 'var(--warning)' }} />
        Disputed
      </li>
    </ul>
  );

  let body;
  if (unseen) body = <State heading="You can’t see this from here" body={unseen} />;
  else if (error && !open) body = <State kind="error" heading="Couldn’t open the graph" body={error} action="Try again" onAction={() => void load()} />;
  else if (loading && !open) body = <State kind="loading" heading="Opening the graph…" />;
  else
    body = (
      <div className="atlas-explore">
        {filters}
        <div className="atlas-stage">
          <div className="atlas-stage-bar">
            {drawable ? (
              <Button
                kind="ghost"
                size="sm"
                onPress={() => {
                  if (view === 'graph') stopDrawing();
                  graph.current.clear();
                  setView(view === 'graph' ? 'list' : 'graph');
                }}
              >
                {view === 'graph' ? 'Show as a list' : 'Show as a graph'}
              </Button>
            ) : (
              <p className="atlas-note">This browser can’t draw the graph (it needs WebGL), so it shows as a list.</p>
            )}
            {busy || loading ? (
              <span className="atlas-note" role="status">
                Opening…
              </span>
            ) : null}
            {error ? (
              <span className="atlas-note atlas-refused" role="alert">
                {error}
              </span>
            ) : null}
          </div>
          {view === 'graph' ? (
            <>
              <div ref={canvas} className="atlas-graph-canvas" role="img" aria-label={`The graph around ${open?.nodes.get(centre)?.ref.label ?? 'this entity'}. The same graph is offered as a list.`} />
              {legend}
            </>
          ) : (
            list()
          )}
        </div>
        <aside className="atlas-panel" aria-label="Selected">
          {selection()}
        </aside>
      </div>
    );
  const label = open?.nodes.get(centre)?.ref.label;
  return (
    <div className="atlas-explorer">
      <PageHead eyebrow={floorName ? `${floorName} · Explore` : 'Explore'} heading={label ? `Around ${label}` : 'Explore'} summary="What it’s linked to, as seen from this floor, a ring at a time." />
      {body}
    </div>
  );
}
