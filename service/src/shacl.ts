import type { FastifyInstance } from 'fastify';
import { DataFactory, Store, Writer, type BlankNode, type NamedNode, type Quad, type Quad_Object } from 'n3';
import SHACLValidator from 'rdf-validate-shacl';
import type { CheckFinding, DetailDef, Entity, EntityCheck, Fact, FloorCheck, Ontology, RelationDef } from './api-types.ts';
import type { Atlas } from './knowledge.ts';
import { checkDetail, withSubtypes } from './ontology.ts';
import { AUGUR_NS } from './packs.ts';

/**
 * Checks against the ontology's shapes (ADR 0062). The ontology is written as
 * SHACL shapes with N3.js: a node shape for each kind, a property shape for
 * each of its details and kinds of link. What's kept is written as RDF beside
 * them and checked with rdf-validate-shacl, on demand, for one entity or a
 * page of those in sight. Each finding is said in words, the same words the
 * checks on writing use. Those checks stay: these find what was kept before a
 * rule existed, or came in some other way, and let others check against the
 * same shapes (`GET /ontology/shacl`).
 */

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const SH = 'http://www.w3.org/ns/shacl#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

/** Where entities are named in the RDF checked here. Nothing outside this check reads it. */
const ENTITY_NS = 'urn:augur:atlas:entity:';

/** Most entities one `GET /checks` page checks. */
export const CHECKS_MOST = 500;
const CHECKS_DEFAULT = 100;

const { namedNode, literal, quad, blankNode } = DataFactory;
const ns = (key: string) => namedNode(`${AUGUR_NS}${encodeURIComponent(key)}`);
const shapeOf = (key: string) => namedNode(`${AUGUR_NS}shapes/${encodeURIComponent(key)}`);
const detailIri = (type: string, key: string) => ns(`${type}.${key}`);
const sh = (name: string) => namedNode(`${SH}${name}`);
const xsd = (name: string) => namedNode(`${XSD}${name}`);
const a = namedNode(`${RDF}type`);

/** What a predicate in the shapes stands for, so a finding can be said in words. */
type Said = { kind: 'detail'; def: DetailDef } | { kind: 'relation'; def: RelationDef };

/**
 * A shape as nested statements, so it can go into a store to check against
 * and be written as readable Turtle, its lists and blank nodes inline.
 */
type Obj = Quad_Object | { list: Obj[] } | { blank: Pairs };
type Pairs = [string, Obj][];

interface Shapes {
  /** Each kind's node shape, by its IRI. */
  nodes: [NamedNode, Pairs][];
  said: Map<string, Said>;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The ontology as SHACL shapes, and what each predicate in them is. */
export const shapesOf = (ontology: Ontology): Shapes => {
  const said = new Map<string, Said>();
  const nodes = new Map<string, [NamedNode, Pairs]>();
  for (const t of ontology.types)
    nodes.set(t.key, [
      shapeOf(t.key),
      [
        [`${RDF}type`, sh('NodeShape')],
        [`${SH}targetClass`, ns(t.key)],
        [`${RDFS}label`, literal(t.label, 'en')],
      ],
    ]);
  const property = (type: string, path: NamedNode, name: string, rest: Pairs) =>
    nodes.get(type)?.[1].push([`${SH}property`, { blank: [[`${SH}path`, path], [`${SH}name`, literal(name, 'en')], ...rest] }]);
  const anyOf = (p: string, items: Quad_Object[]): Pairs => (items.length === 1 ? [[p, items[0]]] : [[`${SH}or`, { list: items.map((o) => ({ blank: [[p, o]] })) }]]);
  for (const t of ontology.types)
    for (const d of t.details) {
      const path = detailIri(t.key, d.key);
      said.set(path.value, { kind: 'detail', def: d });
      const rest: Pairs =
        d.kind === 'number' || d.kind === 'quantity'
          ? [[`${SH}datatype`, xsd('decimal')]]
          : d.kind === 'date'
            ? anyOf(`${SH}datatype`, [xsd('date'), xsd('dateTime')])
            : [[`${SH}datatype`, xsd('string')], [`${SH}maxLength`, literal('200', xsd('integer'))]];
      if (d.kind === 'choice') rest.push([`${SH}in`, { list: (d.values ?? []).map((v) => literal(v)) }]);
      if (d.pattern) rest.push([`${SH}pattern`, literal(`^(?:${d.pattern})$`)]);
      if (d.onEntity !== false) rest.push([`${SH}maxCount`, literal('1', xsd('integer'))]);
      if (d.hint) rest.push([`${SH}description`, literal(d.hint, 'en')]);
      property(t.key, path, d.label, rest);
    }
  for (const r of ontology.relations) {
    const path = ns(r.key);
    said.set(path.value, { kind: 'relation', def: r });
    for (const from of r.from) property(from, path, r.label, anyOf(`${SH}class`, r.to.map(ns)));
  }
  return { nodes: [...nodes.values()], said };
};

/** The shapes as quads, to check against. */
const shapeQuads = ({ nodes }: Shapes): Quad[] => {
  const quads: Quad[] = [];
  const term = (o: Obj): Quad_Object => {
    if ('list' in o) {
      let tail: Quad_Object = namedNode(`${RDF}nil`);
      for (const item of [...o.list].reverse()) {
        const cell = blankNode();
        quads.push(quad(cell, namedNode(`${RDF}first`), term(item)), quad(cell, namedNode(`${RDF}rest`), tail));
        tail = cell;
      }
      return tail;
    }
    if ('blank' in o) {
      const b = blankNode();
      emit(b, o.blank);
      return b;
    }
    return o;
  };
  const emit = (s: NamedNode | BlankNode, pairs: Pairs) => {
    for (const [p, o] of pairs) quads.push(quad(s, namedNode(p), term(o)));
  };
  for (const [s, pairs] of nodes) emit(s, pairs);
  return quads;
};

/** The shapes as Turtle, for `GET /ontology/shacl`. */
export const shaclTurtle = (ontology: Ontology): Promise<string> => {
  const writer = new Writer({ prefixes: { sh: SH, rdf: RDF, rdfs: RDFS, xsd: XSD, atlas: AUGUR_NS } });
  const term = (o: Obj): Quad_Object => {
    if ('list' in o) return writer.list(o.list.map(term)) as unknown as Quad_Object;
    if ('blank' in o) return writer.blank(o.blank.map(([p, x]) => ({ predicate: namedNode(p), object: term(x) }))) as unknown as Quad_Object;
    return o;
  };
  for (const [s, pairs] of shapesOf(ontology).nodes) for (const [p, o] of pairs) writer.addQuad(s, namedNode(p), term(o));
  return new Promise((resolve, reject) => writer.end((err, out) => (err ? reject(err) : resolve(out ?? ''))));
};

/** A detail's value as RDF: typed as its kind when it reads as one, else as words, so the shape says what's wrong. */
const valueTerm = (d: DetailDef, value: string) => {
  if ((d.kind === 'number' || d.kind === 'quantity') && value.trim() && Number.isFinite(Number(value))) return literal(String(Number(value)), xsd('decimal'));
  if (d.kind === 'date' && isoDate.test(value)) return literal(value, xsd('date'));
  if (d.kind === 'date' && isoDateTime.test(value)) return literal(value, xsd('dateTime'));
  return literal(value);
};

/** A kind and every kind above it. */
const kindsOf = (ontology: Ontology, type: string) => {
  const byKey = new Map(ontology.types.map((t) => [t.key, t]));
  const chain: string[] = [];
  for (let t = byKey.get(type); t && !chain.includes(t.key); t = t.parent ? byKey.get(t.parent) : undefined) chain.push(t.key);
  return chain;
};

/** The detail by this key on a kind or the kinds above it, and the kind that has it. */
const detailOn = (ontology: Ontology, type: string, key: string) => {
  for (const k of kindsOf(ontology, type)) {
    const d = ontology.types.find((t) => t.key === k)?.details.find((x) => x.key === key);
    if (d) return { type: k, def: d };
  }
  return undefined;
};

export interface CheckInput {
  /** The entities to check. */
  entities: readonly Entity[];
  /** Facts about them, as they stand now on the floors in sight. Facts about other entities are left out. */
  facts: readonly Fact[];
  /** Entities their links reach, by id, so a link's other end has its kind. */
  ends: ReadonlyMap<string, Entity>;
  /** Whether the caller may see an entity, so a finding names only what they may. */
  visible(entity: Entity): boolean;
}

const localName = (iri: string) => iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1);

/** Checks what's kept against the ontology's shapes, and says each finding in words. */
export const checkKept = async (ontology: Ontology, { entities, facts, ends, visible }: CheckInput, shapes = shapesOf(ontology)): Promise<CheckFinding[]> => {
  const data: Quad[] = [];
  /** The fact each triple came from, when it came from one. */
  const from = new Map<string, string>();
  const key = (s: string, p: string, o: { termType: string; value: string; datatype?: { value: string } }) => `${s}|${p}|${o.termType}|${o.value}|${o.datatype?.value ?? ''}`;
  const typed = new Set<string>();
  const type = (e: Entity) => {
    if (typed.has(e.id)) return;
    typed.add(e.id);
    for (const k of kindsOf(ontology, e.type)) data.push(quad(namedNode(`${ENTITY_NS}${e.id}`), a, ns(k)));
  };
  const checking = new Set(entities.map((e) => e.id));
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const e of entities) {
    type(e);
    const s = namedNode(`${ENTITY_NS}${e.id}`);
    for (const [k, value] of Object.entries(e.details)) {
      const d = detailOn(ontology, e.type, k);
      if (d) data.push(quad(s, detailIri(d.type, k), valueTerm(d.def, value)));
    }
  }
  for (const f of facts) {
    const e = byId.get(f.entity);
    if (!e || !checking.has(f.entity)) continue;
    const s = namedNode(`${ENTITY_NS}${e.id}`);
    if (f.target) {
      const end = byId.get(f.target) ?? ends.get(f.target);
      if (end) type(end);
      const o = namedNode(`${ENTITY_NS}${f.target}`);
      data.push(quad(s, ns(f.property), o));
      from.set(key(s.value, ns(f.property).value, o), f.id);
    } else if (f.value !== undefined) {
      const d = detailOn(ontology, e.type, f.property);
      if (!d) continue;
      const p = detailIri(d.type, f.property);
      const o = valueTerm(d.def, f.value);
      data.push(quad(s, p, o));
      from.set(key(s.value, p.value, o), f.id);
    }
  }
  const report = await new SHACLValidator(new Store(shapeQuads(shapes))).validate(new Store(data));
  const findings: CheckFinding[] = [];
  const seenOnce = new Set<string>();
  for (const r of report.results) {
    const id = r.focusNode?.value.startsWith(ENTITY_NS) ? r.focusNode.value.slice(ENTITY_NS.length) : undefined;
    const entity = id ? byId.get(id) : undefined;
    const path = r.path?.value;
    const what = path ? shapes.said.get(path) : undefined;
    if (!entity || !what || !path) continue;
    const constraint = localName(r.sourceConstraintComponent?.value ?? '');
    const value = r.value ?? undefined;
    let message: string;
    if (what.kind === 'detail') {
      const d = what.def;
      message =
        constraint === 'MaxCountConstraintComponent' ? `${d.label} has more than one value.` : (value && checkDetail(d, value.value)) ?? `${d.label} doesn’t fit its kind.`;
    } else {
      const r2 = what.def;
      const kinds = r2.to.map((k) => ontology.types.find((t) => t.key === k)?.plural.toLowerCase() ?? k).join(' or ');
      const end = value ? (byId.get(value.value.slice(ENTITY_NS.length)) ?? ends.get(value.value.slice(ENTITY_NS.length))) : undefined;
      message = end && visible(end) ? `“${r2.label}” links to ${kinds}, and ${end.label} isn’t one.` : `“${r2.label}” links to ${kinds}, and the entity at its other end isn’t one, or no longer shows from here.`;
    }
    const fact = value ? from.get(key(r.focusNode!.value, path, value)) : undefined;
    const once = `${entity.id}|${path}|${constraint}|${value?.value ?? ''}`;
    if (seenOnce.has(once)) continue;
    seenOnce.add(once);
    findings.push({ entity: entity.id, label: entity.label, property: what.def.key, message, constraint, ...(fact ? { fact } : {}) });
  }
  return findings.sort((x, y) => x.label.localeCompare(y.label) || x.entity.localeCompare(y.entity) || x.property.localeCompare(y.property));
};

export const checkRoutes = (app: FastifyInstance, atlas: Atlas) => {
  const { store } = atlas;

  /** Facts and link ends for these entities, from the floors in sight, as they stand now. */
  const gather = async (floors: string[], entities: Entity[]) => {
    const facts = (await store.facts(entities.map((e) => e.id), { floors })).filter((f) => !f.supersededAt);
    const ids = new Set(entities.map((e) => e.id));
    const endIds = [...new Set(facts.flatMap((f) => (f.target && !ids.has(f.target) ? [f.target] : [])))];
    const ends = new Map((await store.entitiesById(endIds)).map((e) => [e.id, e]));
    return { facts, ends, visible: (e: Entity) => floors.includes(e.floor) };
  };

  app.get('/ontology/shacl', async (req, reply) => {
    // Only what shows from where the caller stands: a team's kinds stay that team's.
    const caller = atlas.onFloor(req, reply);
    if (!caller) return reply;
    const ontology = await atlas.ontologySeen(caller);
    reply.header('content-type', 'text/turtle; charset=utf-8').header('content-disposition', `attachment; filename="data-atlas-shapes-v${ontology.version}.ttl"`);
    return shaclTurtle(ontology);
  });

  app.get<{ Params: { id: string } }>(
    '/entities/:id/check',
    { schema: { params: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 64 } }, required: ['id'] } } },
    async (req, reply) => {
      const found = await atlas.seen(req, reply, req.params.id);
      if (!found) return reply;
      const { floors } = await atlas.sight(found.caller);
      const ontology = await store.ontology();
      const findings = await checkKept(ontology, { entities: [found.entity], ...(await gather(floors, [found.entity])) });
      return { entity: found.entity.id, version: ontology.version, findings } satisfies EntityCheck;
    },
  );

  app.get<{ Querystring: { type?: string; limit?: number; offset?: number } }>(
    '/checks',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', minLength: 1, maxLength: 64 },
            limit: { type: 'integer', minimum: 1, maximum: CHECKS_MOST },
            offset: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const caller = atlas.onFloor(req, reply);
      if (!caller) return reply;
      const { floors } = await atlas.sight(caller);
      const ontology = await store.ontology();
      const { type, limit = CHECKS_DEFAULT, offset = 0 } = req.query;
      if (type && !ontology.types.some((t) => t.key === type)) return reply.code(400).send({ error: 'unknown-type', message: `There’s no kind called “${type}”.` });
      const { entities, total } = await store.entities({ floors, types: type ? withSubtypes(ontology, type) : undefined, limit, offset });
      const findings = await checkKept(ontology, { entities, ...(await gather(floors, entities)) });
      return { version: ontology.version, checked: entities.length, offset, total, findings } satisfies FloorCheck;
    },
  );
};
