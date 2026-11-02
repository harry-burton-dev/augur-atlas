/**
 * The ontology: which kinds of thing Data Atlas keeps, and which details of
 * them say for certain which real thing an entity is.
 *
 * It starts from a profile of the Common Core Ontologies (CCO, BSD-3,
 * github.com/CommonCoreOntology/CommonCoreOntologies), a mid-level ontology on
 * the Basic Formal Ontology used across defence and intelligence. Each type
 * names the CCO class it stands for (`packTerm`), so loading the pack itself
 * later (AT7) maps onto these without renaming anything. Some carry a plainer
 * name on screen: CCO's Watercraft is shown as Vessel.
 */

/** What a detail holds. More kinds (quantities, places, links) come with facts. */
export type DetailKind = 'text' | 'number' | 'date';

export interface DetailDef {
  key: string;
  label: string;
  kind: DetailKind;
  /** Says which real thing it is: no two entities may share a value, whatever their floor. */
  identity: boolean;
  /** What a value must look like, as a regular expression over the whole value. */
  pattern?: string;
  /** How a person would recognise one, shown under the field. */
  hint?: string;
  /**
   * False for a detail known only through facts, over time and floor by floor
   * (a vessel's flag), rather than typed on the entity itself. Absent means true.
   */
  onEntity?: boolean;
  /** The pack term it was adopted from, by IRI (AT7). */
  packIri?: string;
}

/**
 * A kind of link from one entity to another: "operated by", "located at". A
 * link is a fact whose value is an entity, so it has the same two clocks, floor
 * and backing as any fact. Read backwards, it uses `inverse`.
 */
export interface RelationDef {
  key: string;
  label: string;
  inverse: string;
  /** Kinds it may start from, and end at; each takes its subkinds too. */
  from: string[];
  to: string[];
  pack: string;
  packTerm: string;
  packIri?: string;
}

export interface TypeDef {
  key: string;
  label: string;
  plural: string;
  /** The kind it is a kind of. */
  parent?: string;
  /** Only a heading for the kinds below it: no entity is made of it directly. */
  abstract: boolean;
  /** A ui-kit icon name. */
  icon: string;
  /** The ontology pack it comes from, and the pack's own name for it. */
  pack: string;
  packTerm: string;
  packIri?: string;
  details: DetailDef[];
}

/**
 * One change an admin makes to the ontology in the studio (AT7). Kinds, details
 * and kinds of link are only ever added or renamed, never taken away or
 * narrowed, so nothing already kept stops fitting it.
 */
export type OntologyChange =
  | { op: 'add-type'; type: Omit<TypeDef, 'details'> }
  | { op: 'edit-type'; key: string; label?: string; plural?: string; icon?: string }
  | { op: 'add-detail'; type: string; detail: DetailDef }
  | { op: 'edit-detail'; type: string; key: string; label?: string; hint?: string }
  | { op: 'add-relation'; relation: RelationDef }
  | { op: 'edit-relation'; key: string; label?: string; inverse?: string; from?: string[]; to?: string[] };

export interface Ontology {
  version: number;
  types: TypeDef[];
  relations: RelationDef[];
}

const text = (key: string, label: string, more: Partial<DetailDef> = {}): DetailDef => ({ key, label, kind: 'text', identity: false, ...more });

/**
 * The starter profile, as migration 002 writes it. It's part of that
 * migration: change the ontology with a new migration, never by editing this.
 */
export const STARTER_TYPES: readonly TypeDef[] = [
  { key: 'agent', label: 'Agent', plural: 'Agents', abstract: true, icon: 'people', pack: 'cco', packTerm: 'Agent', details: [] },
  { key: 'person', label: 'Person', plural: 'People', parent: 'agent', abstract: false, icon: 'account', pack: 'cco', packTerm: 'Person', details: [] },
  {
    key: 'organization',
    label: 'Organisation',
    plural: 'Organisations',
    parent: 'agent',
    abstract: false,
    icon: 'org',
    pack: 'cco',
    packTerm: 'Organization',
    details: [text('registration', 'Registration number', { identity: true, hint: 'As the register that holds it writes it' })],
  },
  { key: 'artifact', label: 'Artifact', plural: 'Artifacts', abstract: true, icon: 'apps', pack: 'cco', packTerm: 'Artifact', details: [] },
  { key: 'vehicle', label: 'Vehicle', plural: 'Vehicles', parent: 'artifact', abstract: true, icon: 'vehicle', pack: 'cco', packTerm: 'Vehicle', details: [] },
  {
    key: 'vessel',
    label: 'Vessel',
    plural: 'Vessels',
    parent: 'vehicle',
    abstract: false,
    icon: 'vessel',
    pack: 'cco',
    packTerm: 'Watercraft',
    details: [
      text('imo', 'IMO number', { identity: true, pattern: '\\d{7}', hint: 'Seven digits, such as 9400117' }),
      text('mmsi', 'MMSI', { identity: true, pattern: '\\d{9}', hint: 'Nine digits' }),
      text('call-sign', 'Call sign', { pattern: '[A-Z0-9]{3,8}' }),
    ],
  },
  {
    key: 'aircraft',
    label: 'Aircraft',
    plural: 'Aircraft',
    parent: 'vehicle',
    abstract: false,
    icon: 'aircraft',
    pack: 'cco',
    packTerm: 'Aircraft',
    details: [
      text('registration', 'Registration', { identity: true, pattern: '[A-Z0-9-]{3,10}', hint: 'Its tail marks, such as G-ABCD' }),
      text('icao24', 'ICAO 24-bit address', { identity: true, pattern: '[0-9A-F]{6}', hint: 'Six hex digits' }),
    ],
  },
  {
    key: 'ground-vehicle',
    label: 'Ground vehicle',
    plural: 'Ground vehicles',
    parent: 'vehicle',
    abstract: false,
    icon: 'vehicle',
    pack: 'cco',
    packTerm: 'Ground Vehicle',
    details: [text('registration', 'Registration', { identity: true })],
  },
  { key: 'facility', label: 'Facility', plural: 'Facilities', abstract: false, icon: 'facility', pack: 'cco', packTerm: 'Facility', details: [] },
  {
    key: 'port',
    label: 'Port',
    plural: 'Ports',
    parent: 'facility',
    abstract: false,
    icon: 'port',
    pack: 'cco',
    packTerm: 'Port',
    details: [text('unlocode', 'UN/LOCODE', { identity: true, pattern: '[A-Z]{2}[A-Z2-9]{3}', hint: 'Five letters, such as GBSOU' })],
  },
  { key: 'place', label: 'Place', plural: 'Places', abstract: false, icon: 'place', pack: 'cco', packTerm: 'Geospatial Region', details: [] },
  { key: 'event', label: 'Event', plural: 'Events', abstract: false, icon: 'event', pack: 'cco', packTerm: 'Act', details: [] },
];

const literal = (value: string | undefined) => (value === undefined ? 'null' : `'${value.replaceAll("'", "''")}'`);

/** The starter profile as SQL, for migration 002. */
export const starterSql = () =>
  [
    "insert into atlas.ontology_versions (version, note) values (1, 'Starter profile of the Common Core Ontologies');",
    ...STARTER_TYPES.map(
      (t, sort) =>
        `insert into atlas.ontology_types (key, parent, label, plural, abstract, icon, pack, pack_term, sort) values (${literal(t.key)}, ${literal(t.parent)}, ${literal(t.label)}, ${literal(t.plural)}, ${t.abstract}, ${literal(t.icon)}, ${literal(t.pack)}, ${literal(t.packTerm)}, ${sort});`,
    ),
    ...STARTER_TYPES.flatMap((t) =>
      t.details.map(
        (d, sort) =>
          `insert into atlas.ontology_details (type, key, label, kind, identity, pattern, hint, sort) values (${literal(t.key)}, ${literal(d.key)}, ${literal(d.label)}, ${literal(d.kind)}, ${d.identity}, ${literal(d.pattern)}, ${literal(d.hint)}, ${sort});`,
      ),
    ),
  ].join('\n');

/**
 * Version 2, as migration 004 writes it (never edit it either): the kinds of
 * link between entities, and details known only through facts. The links are
 * AUGUR's own starter set, named plainly; loading the CCO pack (AT7) maps them
 * onto CCO's object properties.
 */
export const STARTER_RELATIONS: readonly RelationDef[] = [
  { key: 'owned-by', label: 'Owned by', inverse: 'Owns', from: ['artifact', 'facility'], to: ['agent'], pack: 'augur', packTerm: 'owned by' },
  { key: 'operated-by', label: 'Operated by', inverse: 'Operates', from: ['artifact', 'facility'], to: ['agent'], pack: 'augur', packTerm: 'operated by' },
  { key: 'member-of', label: 'Member of', inverse: 'Has member', from: ['person'], to: ['organization'], pack: 'augur', packTerm: 'member of' },
  { key: 'part-of', label: 'Part of', inverse: 'Has part', from: ['organization'], to: ['organization'], pack: 'augur', packTerm: 'part of' },
  { key: 'located-at', label: 'Located at', inverse: 'Location of', from: ['agent', 'artifact', 'facility', 'event'], to: ['place', 'facility'], pack: 'augur', packTerm: 'located at' },
  { key: 'took-part-in', label: 'Took part in', inverse: 'Involved', from: ['agent', 'artifact'], to: ['event'], pack: 'augur', packTerm: 'took part in' },
];

export const KNOWLEDGE_DETAILS: readonly { type: string; detail: DetailDef }[] = [
  { type: 'vessel', detail: text('flag', 'Flag state', { onEntity: false, hint: 'The state it sails under' }) },
  { type: 'vessel', detail: text('vessel-type', 'Type of vessel', { onEntity: false, hint: 'Such as bulk carrier or tug' }) },
  { type: 'person', detail: text('nationality', 'Nationality', { onEntity: false }) },
  { type: 'organization', detail: text('country', 'Country', { onEntity: false, hint: 'Where it is registered or based' }) },
  { type: 'event', detail: { key: 'when', label: 'When', kind: 'date', identity: false, onEntity: false } },
];

const textArray = (values: readonly string[]) => `array[${values.map(literal).join(', ')}]::text[]`;

/** Version 2 as SQL, for migration 004. */
export const knowledgeSql = () =>
  [
    "insert into atlas.ontology_versions (version, note) values (2, 'Links between entities, and details known through facts');",
    ...STARTER_RELATIONS.map(
      (r, sort) =>
        `insert into atlas.ontology_relations (key, label, inverse, from_types, to_types, pack, pack_term, sort) values (${literal(r.key)}, ${literal(r.label)}, ${literal(r.inverse)}, ${textArray(r.from)}, ${textArray(r.to)}, ${literal(r.pack)}, ${literal(r.packTerm)}, ${sort});`,
    ),
    ...KNOWLEDGE_DETAILS.map(
      ({ type, detail: d }, i) =>
        `insert into atlas.ontology_details (type, key, label, kind, identity, pattern, hint, sort, on_entity) values (${literal(type)}, ${literal(d.key)}, ${literal(d.label)}, ${literal(d.kind)}, false, ${literal(d.pattern)}, ${literal(d.hint)}, ${100 + i}, false);`,
    ),
  ].join('\n');

/** A type and every type below it. */
export const withSubtypes = (ontology: Ontology, type: string) => {
  const found = new Set([type]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of ontology.types) if (t.parent && found.has(t.parent) && !found.has(t.key)) {
      found.add(t.key);
      grew = true;
    }
  }
  return [...found];
};

/** True when `type` is `kind` or a kind below it. */
export const isA = (ontology: Ontology, type: string, kind: string) => {
  const byKey = new Map(ontology.types.map((t) => [t.key, t]));
  for (let t = byKey.get(type); t; t = t.parent ? byKey.get(t.parent) : undefined) if (t.key === kind) return true;
  return false;
};

/** The kinds of link that may start from an entity of this type. */
export const relationsFrom = (ontology: Ontology, type: string) => ontology.relations.filter((r) => r.from.some((k) => isA(ontology, type, k)));

/** A type's details, its own after those of the kinds above it. */
export const detailsOf = (ontology: Ontology, type: string): DetailDef[] => {
  const byKey = new Map(ontology.types.map((t) => [t.key, t]));
  const chain: TypeDef[] = [];
  for (let t = byKey.get(type); t; t = t.parent ? byKey.get(t.parent) : undefined) chain.unshift(t);
  return chain.flatMap((t) => t.details);
};

/** Why a detail's value won't do, in words a person can act on; undefined when it will. */
export const checkDetail = (detail: DetailDef, value: string): string | undefined => {
  if (!value.trim()) return `${detail.label} can’t be blank.`;
  if (value.length > 200) return `${detail.label} is too long.`;
  if (detail.kind === 'number' && !Number.isFinite(Number(value))) return `${detail.label} must be a number.`;
  if (detail.kind === 'date' && Number.isNaN(Date.parse(value))) return `${detail.label} must be a date.`;
  if (detail.pattern && !new RegExp(`^(?:${detail.pattern})$`).test(value)) return detail.hint ? `${detail.label} doesn’t look right: ${detail.hint.toLowerCase()}.` : `${detail.label} doesn’t look right.`;
  return undefined;
};

/**
 * A value in the one form it's kept in, so "gbsou" and "GBSOU" are the same
 * port and "9 400 117" the same IMO number: a code (a detail with a pattern)
 * loses its spaces and, if it's lettered, goes to capitals.
 */
export const normaliseDetail = (detail: DetailDef, value: string) => {
  if (!detail.pattern) return value.trim().replace(/\s+/g, ' ');
  const bare = value.replace(/\s+/g, '');
  return /[A-Z]/.test(detail.pattern) ? bare.toUpperCase() : bare;
};
