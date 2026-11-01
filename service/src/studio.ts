import { callerFromHeaders, type Caller } from '@augur/service-kit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OnFloor } from './app.ts';
import type { Atlas } from './knowledge.ts';
import { isA, type DetailDef, type DetailKind, type Ontology, type OntologyChange, type TypeDef } from './ontology.ts';
import { owlTurtle, packFromTurtle, type PackTerm } from './packs.ts';
import type { ProposedTerm } from './store.ts';

/**
 * The ontology studio (spec, "Ontology", AT7): where admins add kinds of thing,
 * details and kinds of link, adopt terms from packs (CCO comes with Data Atlas;
 * an org loads its own, such as MIP MIM, as Turtle), and decide the terms
 * sources keep asking for. Admins govern it for now (Harry's Q4). Everyone can
 * read it, its history and its packs; what they can't do says why.
 */

const KEY = /^[a-z][a-z0-9-]{0,47}$/;
const ICON = /^[a-z][a-z-]{0,31}$/;
const NOT_ADMIN = 'Only admins change the ontology for now. You can read it, its packs and its history.';

/** Whether the caller may change the ontology, and why not. */
export const governs = (caller: Caller | undefined) => (caller?.roles.includes('admin') ? { govern: true } : { govern: false, why: NOT_ADMIN });

/** A key from a name: "Patrol Boat" is patrol-boat. */
export const keyFrom = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, 'x-$1')
    .slice(0, 48) || 'term';

/** A plural for a kind's name, for a start the admin can change. */
export const pluralOf = (label: string) =>
  /[^aeiou]y$/i.test(label) ? `${label.slice(0, -1)}ies` : /(ss|us|x|z|ch|sh)$/i.test(label) ? `${label}es` : /s$/i.test(label) ? label : `${label}s`;

const words = (s: string | undefined, what: string, most = 80) => (!s?.trim() ? `${what} can’t be blank.` : s.length > most ? `${what} is too long.` : undefined);

/**
 * Why a set of changes won't do, in words; undefined when they will. Checked
 * in order against the ontology as each leaves it, so one set can add a kind
 * and a detail of it. Nothing is taken away or narrowed: what's kept must
 * still fit.
 */
export const checkChanges = (ontology: Ontology, changes: OntologyChange[]): string | undefined => {
  const o: Ontology = structuredClone(ontology);
  const type = (key: string) => o.types.find((t) => t.key === key);
  const named = (key: string) => type(key)?.label ?? key;
  for (const c of changes) {
    switch (c.op) {
      case 'add-type': {
        const t = c.type;
        if (!KEY.test(t.key)) return `“${t.key}” won’t do as a key: lower-case letters, digits and dashes, starting with a letter.`;
        if (type(t.key)) return `There’s already a kind called “${t.key}” (${named(t.key)}).`;
        if (t.parent && !type(t.parent)) return `There’s no kind “${t.parent}” for ${t.label} to go under.`;
        const bad = words(t.label, 'The name') ?? words(t.plural, 'The plural') ?? (ICON.test(t.icon) ? undefined : 'Pick an icon from the list.');
        if (bad) return bad;
        if (o.types.some((x) => x.label.toLowerCase() === t.label.toLowerCase())) return `There’s already a kind named ${t.label}.`;
        o.types.push({ ...t, details: [] });
        break;
      }
      case 'edit-type': {
        const t = type(c.key);
        if (!t) return `There’s no kind “${c.key}”.`;
        const bad = (c.label !== undefined && words(c.label, 'The name')) || (c.plural !== undefined && words(c.plural, 'The plural')) || (c.icon !== undefined && !ICON.test(c.icon) && 'Pick an icon from the list.');
        if (bad) return bad;
        if (c.label && o.types.some((x) => x !== t && x.label.toLowerCase() === c.label!.toLowerCase())) return `There’s already a kind named ${c.label}.`;
        Object.assign(t, { ...(c.label ? { label: c.label } : {}), ...(c.plural ? { plural: c.plural } : {}), ...(c.icon ? { icon: c.icon } : {}) });
        break;
      }
      case 'add-detail': {
        const t = type(c.type);
        if (!t) return `There’s no kind “${c.type}” to add a detail to.`;
        const d = c.detail;
        if (!KEY.test(d.key)) return `“${d.key}” won’t do as a key: lower-case letters, digits and dashes, starting with a letter.`;
        const bad = words(d.label, 'The detail’s name');
        if (bad) return bad;
        // A detail may not share a key with one above it or below it: an entity would have both.
        const near = o.types.filter((k) => isA(o, k.key, t.key) || isA(o, t.key, k.key)).flatMap((k) => k.details.map((x) => ({ x, on: k.key })));
        const clash = near.find(({ x }) => x.key === d.key);
        if (clash) return `${named(clash.on)} already has a detail “${d.key}” (${clash.x.label}).`;
        if (d.pattern) {
          try {
            new RegExp(d.pattern);
          } catch {
            return 'The pattern isn’t a regular expression that can be read.';
          }
        }
        if (d.identity && d.onEntity === false) return 'An identity key is typed on the entity itself, so it can’t be known only through facts.';
        t.details.push(d);
        break;
      }
      case 'edit-detail': {
        const d = type(c.type)?.details.find((x) => x.key === c.key);
        if (!d) return `${named(c.type)} has no detail “${c.key}” of its own.`;
        const bad = c.label !== undefined && words(c.label, 'The detail’s name');
        if (bad) return bad;
        if (c.hint !== undefined && c.hint.length > 200) return 'The hint is too long.';
        Object.assign(d, { ...(c.label ? { label: c.label } : {}), ...(c.hint !== undefined ? { hint: c.hint } : {}) });
        break;
      }
      case 'add-relation': {
        const r = c.relation;
        if (!KEY.test(r.key)) return `“${r.key}” won’t do as a key: lower-case letters, digits and dashes, starting with a letter.`;
        if (o.relations.some((x) => x.key === r.key)) return `There’s already a kind of link called “${r.key}”.`;
        const bad = words(r.label, 'The name') ?? words(r.inverse, 'How it reads backwards');
        if (bad) return bad;
        if (!r.from.length || !r.to.length) return 'Say which kinds it runs from and to.';
        const unknown = [...r.from, ...r.to].find((k) => !type(k));
        if (unknown) return `There’s no kind “${unknown}”.`;
        o.relations.push(r);
        break;
      }
      case 'edit-relation': {
        const r = o.relations.find((x) => x.key === c.key);
        if (!r) return `There’s no kind of link “${c.key}”.`;
        const bad = (c.label !== undefined && words(c.label, 'The name')) || (c.inverse !== undefined && words(c.inverse, 'How it reads backwards'));
        if (bad) return bad;
        for (const [side, now, next] of [['from', r.from, c.from], ['to', r.to, c.to]] as const) {
          if (!next) continue;
          const dropped = now.find((k) => !next.includes(k));
          // Links already made from a kind would stop fitting.
          if (dropped) return `A kind of link can only widen: it already runs ${side} ${named(dropped)}, and links made that way would stop fitting.`;
          const unknown = next.find((k) => !type(k));
          if (unknown) return `There’s no kind “${unknown}”.`;
        }
        Object.assign(r, { ...(c.label ? { label: c.label } : {}), ...(c.inverse ? { inverse: c.inverse } : {}), ...(c.from ? { from: c.from } : {}), ...(c.to ? { to: c.to } : {}) });
        break;
      }
    }
  }
  return undefined;
};

/** Where each pack term is kept here, by IRI: the kind, detail or kind of link adopted from it. */
export const adoptedIn = (ontology: Ontology) => {
  const at = new Map<string, string>();
  for (const t of ontology.types) {
    if (t.packIri) at.set(t.packIri, t.key);
    for (const d of t.details) if (d.packIri) at.set(d.packIri, `${t.key}.${d.key}`);
  }
  for (const r of ontology.relations) if (r.packIri) at.set(r.packIri, r.key);
  return at;
};

/** What an admin may say when adopting a pack term, over what the pack gives. */
export interface Adoption {
  pack: string;
  iri: string;
  key?: string;
  label?: string;
  plural?: string;
  icon?: string;
  parent?: string;
  /** For a detail: the kind it's of, and what it holds. */
  type?: string;
  kind?: DetailKind;
  from?: string[];
  to?: string[];
  inverse?: string;
}

/** The change adopting a pack term makes, or why it can't yet, in words. */
export const adoptionChange = (ontology: Ontology, packId: string, term: PackTerm, a: Adoption): OntologyChange | string => {
  const byIri = new Map(ontology.types.filter((t) => t.packIri).map((t) => [t.packIri!, t]));
  const label = a.label?.trim() || term.label.replace(/^\w/, (x) => x.toUpperCase());
  const key = a.key ?? keyFrom(label);
  const kinds = (given: string[] | undefined, iris: string[] | undefined, side: string) => {
    if (given?.length) return given;
    const found = (iris ?? []).map((i) => byIri.get(i)?.key).filter((k): k is string => !!k);
    return found.length ? found : `Say which kinds it runs ${side}: the pack’s ${side === 'from' ? 'domain' : 'range'} isn’t kept here yet.`;
  };
  if (term.kind === 'class') {
    const parent = a.parent ?? (term.parent ? byIri.get(term.parent)?.key : undefined);
    if (a.parent === undefined && term.parent && !parent) {
      return `The pack has ${label} as a kind of ${term.parent.split(/[#/]/).pop()}, which isn’t kept here yet: adopt that first, or say which kind it goes under.`;
    }
    const icon = a.icon ?? (parent ? ontology.types.find((t) => t.key === parent)?.icon : undefined) ?? 'tag';
    const type: Omit<TypeDef, 'details'> = { key, label, plural: a.plural ?? pluralOf(label), abstract: false, icon, pack: packId, packTerm: term.label, packIri: term.iri, ...(parent ? { parent } : {}) };
    return { op: 'add-type', type };
  }
  if (term.kind === 'detail') {
    const on = a.type ?? (term.domain ?? []).map((i) => byIri.get(i)?.key).find(Boolean);
    if (!on) return 'Say which kind it’s a detail of: the pack’s domain isn’t kept here yet.';
    const detail: DetailDef = { key, label, kind: a.kind ?? 'text', identity: false, packIri: term.iri };
    return { op: 'add-detail', type: on, detail };
  }
  const from = kinds(a.from, term.domain, 'from');
  if (typeof from === 'string') return from;
  const to = kinds(a.to, term.range, 'to');
  if (typeof to === 'string') return to;
  if (!a.inverse?.trim()) return `Say how ${label} reads backwards, as in “Operated by” and “Operates”.`;
  return { op: 'add-relation', relation: { key, label, inverse: a.inverse.trim(), from, to, pack: packId, packTerm: term.label, packIri: term.iri } };
};

/** Where a candidate term would go: what an admin adopting it is offered to start from. */
const candidateChange = (ontology: Ontology, t: { kind: ProposedTerm['kind']; name: string; parents: string[] }): OntologyChange => {
  const label = t.name.trim().replace(/^\w/, (x) => x.toUpperCase());
  const parent = t.parents.find((p) => ontology.types.some((x) => x.key === p));
  if (t.kind === 'type') return { op: 'add-type', type: { key: keyFrom(label), label, plural: pluralOf(label), abstract: false, icon: (parent && ontology.types.find((x) => x.key === parent)?.icon) || 'tag', pack: 'augur', packTerm: t.name, ...(parent ? { parent } : {}) } };
  if (t.kind === 'detail') return { op: 'add-detail', type: parent ?? '', detail: { key: keyFrom(label), label, kind: 'text', identity: false } };
  return { op: 'add-relation', relation: { key: keyFrom(label), label, inverse: '', from: parent ? [parent] : [], to: [], pack: 'augur', packTerm: t.name } };
};

const DETAIL_DEF = {
  type: 'object',
  properties: {
    key: { type: 'string', maxLength: 48 },
    label: { type: 'string', maxLength: 80 },
    kind: { enum: ['text', 'number', 'date'] },
    identity: { type: 'boolean' },
    pattern: { type: 'string', maxLength: 200 },
    hint: { type: 'string', maxLength: 200 },
    onEntity: { type: 'boolean' },
    packIri: { type: 'string', maxLength: 500 },
  },
  required: ['key', 'label', 'kind', 'identity'],
  additionalProperties: false,
} as const;
const KINDS = { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 48 } } as const;
const CHANGE = {
  type: 'object',
  properties: {
    op: { enum: ['add-type', 'edit-type', 'add-detail', 'edit-detail', 'add-relation', 'edit-relation'] },
    key: { type: 'string', maxLength: 48 },
    label: { type: 'string', maxLength: 80 },
    plural: { type: 'string', maxLength: 80 },
    icon: { type: 'string', maxLength: 32 },
    hint: { type: 'string', maxLength: 200 },
    inverse: { type: 'string', maxLength: 80 },
    from: KINDS,
    to: KINDS,
    type: {
      anyOf: [
        { type: 'string', maxLength: 48 },
        {
          type: 'object',
          properties: {
            key: { type: 'string', maxLength: 48 },
            label: { type: 'string', maxLength: 80 },
            plural: { type: 'string', maxLength: 80 },
            parent: { type: 'string', maxLength: 48 },
            abstract: { type: 'boolean' },
            icon: { type: 'string', maxLength: 32 },
            pack: { type: 'string', maxLength: 48 },
            packTerm: { type: 'string', maxLength: 200 },
            packIri: { type: 'string', maxLength: 500 },
          },
          required: ['key', 'label', 'plural', 'abstract', 'icon', 'pack', 'packTerm'],
          additionalProperties: false,
        },
      ],
    },
    detail: DETAIL_DEF,
    relation: {
      type: 'object',
      properties: {
        key: { type: 'string', maxLength: 48 },
        label: { type: 'string', maxLength: 80 },
        inverse: { type: 'string', maxLength: 80 },
        from: KINDS,
        to: KINDS,
        pack: { type: 'string', maxLength: 48 },
        packTerm: { type: 'string', maxLength: 200 },
        packIri: { type: 'string', maxLength: 500 },
      },
      required: ['key', 'label', 'inverse', 'from', 'to', 'pack', 'packTerm'],
      additionalProperties: false,
    },
  },
  required: ['op'],
} as const;
const NOTE = { type: 'string', maxLength: 500 } as const;

/** What a change is about, for the audit log and a version's note. */
const changeWords = (c: OntologyChange) =>
  c.op === 'add-type'
    ? `added the kind ${c.type.label}`
    : c.op === 'add-detail'
      ? `added the detail ${c.detail.label}`
      : c.op === 'add-relation'
        ? `added the link ${c.relation.label}`
        : `changed ${c.key}`;

export const studioRoutes = (app: FastifyInstance, atlas: Atlas) => {
  const { store, recorded } = atlas;

  /** An admin on a floor, or a refusal saying why, already sent. */
  const admin = (req: FastifyRequest, reply: FastifyReply): OnFloor | undefined => {
    const caller = atlas.onFloor(req, reply);
    if (!caller) return undefined;
    if (!caller.roles.includes('admin')) {
      reply.code(403).send({ error: 'not-admin', message: NOT_ADMIN });
      return undefined;
    }
    return caller;
  };

  /** Makes the changes a new version, says so in the audit log, and answers with the ontology as it now is. */
  const change = async (caller: OnFloor, changes: OntologyChange[], note: string | undefined, adopts: Parameters<typeof store.changeOntology>[3] = []) => {
    const version = await store.changeOntology(changes, caller.id, note?.trim() || changes.map(changeWords).join('; ').replace(/^\w/, (x) => x.toUpperCase()), adopts);
    void recorded({ actor: caller.id, action: 'ontology.changed', target: `ontology:${version}`, workspace: caller.workspace.id, detail: { version, changes: changes.map((c) => c.op) } });
    void atlas.resolver.catchUp(await store.ontology());
    return { version, ontology: await store.ontology() };
  };

  app.get('/ontology/packs', async (req) => ({ ...governs(callerFromHeaders(req.headers)), packs: await store.packs() }));

  /** A pack's terms, each saying where it's kept here when it has been adopted. */
  app.get<{ Params: { id: string } }>('/ontology/packs/:id', { schema: { params: { type: 'object', properties: { id: { type: 'string', maxLength: 48 } }, required: ['id'] } } }, async (req, reply) => {
    const pack = await store.pack(req.params.id);
    if (!pack) return reply.code(404).send({ error: 'not-found', message: 'There’s no such pack.' });
    const at = adoptedIn(await store.ontology());
    return { ...pack, terms: pack.terms.map((t) => ({ ...t, ...(at.has(t.iri) ? { adopted: at.get(t.iri) } : {}) })) };
  });

  /** Loads a pack from Turtle: MIP MIM, the full CCO, or the org's own. */
  app.post<{ Body: { id: string; name: string; version: string; licence: string; source?: string; turtle: string } }>(
    '/ontology/packs',
    {
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          properties: {
            id: { type: 'string', pattern: KEY.source, maxLength: 48 },
            name: { type: 'string', minLength: 1, maxLength: 120 },
            version: { type: 'string', minLength: 1, maxLength: 40 },
            licence: { type: 'string', minLength: 1, maxLength: 120 },
            source: { type: 'string', maxLength: 500 },
            turtle: { type: 'string', minLength: 1 },
          },
          required: ['id', 'name', 'version', 'licence', 'turtle'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const caller = admin(req, reply);
      if (!caller) return reply;
      const { turtle, ...about } = req.body;
      let pack;
      try {
        pack = packFromTurtle(turtle, { ...about, source: about.source?.trim() || 'Loaded by an admin' });
      } catch (err) {
        return reply.code(400).send({ error: 'unreadable-pack', message: (err as Error).message });
      }
      if (!(await store.savePack(pack, caller.id))) return reply.code(409).send({ error: 'built-in', message: `“${pack.id}” is a pack that comes with Data Atlas: load yours under another id.` });
      void recorded({ actor: caller.id, action: 'ontology.pack-loaded', target: `pack:${pack.id}`, workspace: caller.workspace.id, detail: { version: pack.version, terms: pack.terms.length } });
      return reply.code(201).send({ id: pack.id, name: pack.name, version: pack.version, licence: pack.licence, source: pack.source, terms: pack.terms.length });
    },
  );

  app.get('/ontology/versions', async () => ({ versions: await store.versions() }));

  /** The ontology as OWL in Turtle, saying which pack term each kind and link is. */
  app.get('/ontology/owl', async (_req, reply) => {
    const ontology = await store.ontology();
    reply.header('content-type', 'text/turtle; charset=utf-8').header('content-disposition', `attachment; filename="data-atlas-ontology-v${ontology.version}.ttl"`);
    return owlTurtle(ontology);
  });

  app.post<{ Body: { changes: OntologyChange[]; note?: string } }>(
    '/ontology/changes',
    { schema: { body: { type: 'object', properties: { changes: { type: 'array', minItems: 1, maxItems: 50, items: CHANGE }, note: NOTE }, required: ['changes'], additionalProperties: false } } },
    async (req, reply) => {
      const caller = admin(req, reply);
      if (!caller) return reply;
      const problem = checkChanges(await store.ontology(), req.body.changes);
      if (problem) return reply.code(400).send({ error: 'bad-change', message: problem });
      return change(caller, req.body.changes, req.body.note);
    },
  );

  /** Adopts a pack's term: a kind, a detail or a kind of link that names it. */
  app.post<{ Body: Adoption & { note?: string } }>(
    '/ontology/adopt',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            pack: { type: 'string', maxLength: 48 },
            iri: { type: 'string', maxLength: 500 },
            key: { type: 'string', maxLength: 48 },
            label: { type: 'string', maxLength: 80 },
            plural: { type: 'string', maxLength: 80 },
            icon: { type: 'string', maxLength: 32 },
            parent: { type: 'string', maxLength: 48 },
            type: { type: 'string', maxLength: 48 },
            kind: { enum: ['text', 'number', 'date'] },
            from: KINDS,
            to: KINDS,
            inverse: { type: 'string', maxLength: 80 },
            note: NOTE,
          },
          required: ['pack', 'iri'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const caller = admin(req, reply);
      if (!caller) return reply;
      const pack = await store.pack(req.body.pack);
      const term = pack?.terms.find((t) => t.iri === req.body.iri);
      if (!pack || !term) return reply.code(404).send({ error: 'not-found', message: 'That pack has no such term.' });
      const ontology = await store.ontology();
      const already = adoptedIn(ontology).get(term.iri);
      if (already) return reply.code(409).send({ error: 'adopted', message: `${term.label} is already kept here, as “${already}”.` });
      const made = adoptionChange(ontology, pack.id, term, req.body);
      if (typeof made === 'string') return reply.code(400).send({ error: 'bad-change', message: made });
      const problem = checkChanges(ontology, [made]);
      if (problem) return reply.code(400).send({ error: 'bad-change', message: problem });
      return change(caller, [made], req.body.note?.trim() || `Adopted ${term.label} from ${pack.name}`);
    },
  );

  /**
   * Terms sources asked for that the ontology hasn't got. Only admins see what
   * they are (they came from every floor); everyone else is told how many wait.
   */
  app.get('/ontology/candidates', async (req) => {
    const can = governs(callerFromHeaders(req.headers));
    const candidates = await store.termCandidates();
    if (!can.govern) return { ...can, waiting: candidates.length, candidates: [] };
    const ontology = await store.ontology();
    return { ...can, waiting: candidates.length, candidates: candidates.map((c) => ({ ...c, start: candidateChange(ontology, c) })) };
  });

  /** Adopts a candidate term (as the change given) or dismisses it, for every source that asked. */
  app.post<{ Body: { kind: ProposedTerm['kind']; name: string; as: 'adopt' | 'dismiss'; change?: OntologyChange; note?: string } }>(
    '/ontology/candidates/decide',
    {
      schema: {
        body: {
          type: 'object',
          properties: { kind: { enum: ['type', 'detail', 'relation'] }, name: { type: 'string', minLength: 1, maxLength: 200 }, as: { enum: ['adopt', 'dismiss'] }, change: CHANGE, note: NOTE },
          required: ['kind', 'name', 'as'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const caller = admin(req, reply);
      if (!caller) return reply;
      const { kind, name } = req.body;
      if (!(await store.termCandidates()).some((c) => c.kind === kind && c.name.toLowerCase() === name.toLowerCase())) {
        return reply.code(409).send({ error: 'decided', message: 'It has already been decided, or nothing asks for it now. Look again.' });
      }
      if (req.body.as === 'dismiss') {
        const asked = await store.decideTerm(kind, name, { as: 'dismissed', ...(req.body.note ? { note: req.body.note } : {}) }, caller.id);
        void recorded({ actor: caller.id, action: 'ontology.term-dismissed', target: `term:${kind}:${name}`, workspace: caller.workspace.id, detail: { asked } });
        return { dismissed: asked };
      }
      const c = req.body.change;
      const op = { type: 'add-type', detail: 'add-detail', relation: 'add-relation' }[kind];
      if (!c || c.op !== op) return reply.code(400).send({ error: 'bad-change', message: `Say how to keep it: adopting a ${kind === 'type' ? 'kind' : kind === 'detail' ? 'detail' : 'kind of link'} adds one.` });
      const problem = checkChanges(await store.ontology(), [c]);
      if (problem) return reply.code(400).send({ error: 'bad-change', message: problem });
      const key = c.op === 'add-type' ? c.type.key : c.op === 'add-detail' ? `${c.type}.${c.detail.key}` : c.op === 'add-relation' ? c.relation.key : '';
      return change(caller, [c], req.body.note?.trim() || `Adopted ${name}, which sources asked for`, [{ kind, name, key }]);
    },
  );
};
