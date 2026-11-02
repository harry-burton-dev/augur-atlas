import { DataFactory, Parser, Writer, type Quad, type Quad_Object } from 'n3';
import type { Ontology } from './ontology.ts';

/**
 * Ontology packs (spec, "Ontology"): vocabularies Data Atlas's admins adopt
 * terms from. A pack is read from Turtle (OWL classes and properties, with
 * N3.js) or comes with Data Atlas. Adopting a term makes a kind, a detail or a
 * kind of link that names it, so what's kept here can be exported as OWL that
 * says which pack term each one is (Harry's Q5: pluggable packs, CCO first,
 * MIP MIM loadable by an org that has it).
 */

export interface PackTerm {
  iri: string;
  kind: 'class' | 'relation' | 'detail';
  label: string;
  /** For a class: the class it is a kind of, by IRI. */
  parent?: string;
  /** For a property: the classes it runs from and to, by IRI. */
  domain?: string[];
  range?: string[];
  /** What the pack says it is (rdfs:comment or skos:definition). */
  note?: string;
}

export interface Pack {
  /** Short and stable: "cco", "mip-mim". */
  id: string;
  name: string;
  version: string;
  /** What it may be used under, as the pack says, so admins can check before loading it. */
  licence: string;
  /** Where it came from: a URL, or "uploaded by an admin". */
  source: string;
  terms: PackTerm[];
}

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

/** The last part of an IRI, spaced out, for a term the pack gives no label. */
const nameFrom = (iri: string) =>
  (iri.split(/[#/]/).pop() ?? iri)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

/** The most this reads from one upload. A pack bigger than this is better trimmed to a profile first. */
export const MOST_TERMS = 5000;

/**
 * Reads a pack from Turtle: its OWL classes (with their first named parent),
 * object properties (links) and datatype properties (details), with English
 * labels where there are several. Blank nodes (unions, restrictions) are left
 * out: what's kept here says a link's kinds itself. Throws, in words, on what
 * can't be read.
 */
export const packFromTurtle = (turtle: string, about: Omit<Pack, 'terms'>): Pack => {
  let quads: Quad[];
  try {
    quads = new Parser().parse(turtle);
  } catch (err) {
    throw new Error(`It isn’t Turtle that can be read: ${(err as Error).message}`, { cause: err });
  }
  const of = (s: string, p: string) => quads.filter((q) => q.subject.value === s && q.predicate.value === p);
  const named = (q: Quad) => q.object.termType === 'NamedNode';
  const label = (s: string) => {
    const labels = [...of(s, `${RDFS}label`), ...of(s, `${SKOS}prefLabel`)].filter((q) => q.object.termType === 'Literal');
    const english = labels.find((q) => /^en\b/i.test((q.object as { language?: string }).language ?? '')) ?? labels.find((q) => !(q.object as { language?: string }).language) ?? labels[0];
    return english?.object.value.trim() || nameFrom(s);
  };
  const note = (s: string) => [...of(s, `${SKOS}definition`), ...of(s, `${RDFS}comment`)].find((q) => q.object.termType === 'Literal')?.object.value.trim();
  const typed = (type: string) => [...new Set(quads.filter((q) => q.predicate.value === `${RDF}type` && q.object.value === type && q.subject.termType === 'NamedNode').map((q) => q.subject.value))];
  const terms: PackTerm[] = [
    ...typed(`${OWL}Class`).map((iri): PackTerm => {
      const parent = of(iri, `${RDFS}subClassOf`).find(named)?.object.value;
      return { iri, kind: 'class', label: label(iri), ...(parent ? { parent } : {}), ...(note(iri) ? { note: note(iri)!.slice(0, 1000) } : {}) };
    }),
    ...(['relation', 'detail'] as const).flatMap((kind) =>
      typed(kind === 'relation' ? `${OWL}ObjectProperty` : `${OWL}DatatypeProperty`).map((iri): PackTerm => {
        const domain = of(iri, `${RDFS}domain`).filter(named).map((q) => q.object.value);
        const range = of(iri, `${RDFS}range`).filter(named).map((q) => q.object.value);
        return { iri, kind, label: label(iri), ...(domain.length ? { domain } : {}), ...(range.length && kind === 'relation' ? { range } : {}), ...(note(iri) ? { note: note(iri)!.slice(0, 1000) } : {}) };
      }),
    ),
  ];
  if (!terms.length) throw new Error('It has no OWL classes or properties to adopt.');
  if (terms.length > MOST_TERMS) throw new Error(`It has ${terms.length} terms, more than the ${MOST_TERMS} one upload takes: load a profile of it.`);
  return { ...about, terms: terms.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)) };
};

/** CCO's IRIs, in the named form of its 1.x releases (2.0 numbers them instead: check against your copy). */
export const CCO_NS = 'http://www.ontologyrepository.com/CommonCoreOntologies/';
const CCO = CCO_NS;
const cco = (name: string, parent?: string, note?: string): PackTerm => ({
  iri: `${CCO}${name.replace(/ /g, '')}`,
  kind: 'class',
  // CCO labels its classes in lower case ("group of agents"): shown here with a capital.
  label: name.charAt(0) + name.slice(1).toLowerCase(),
  ...(parent ? { parent: `${CCO}${parent.replace(/ /g, '')}` } : {}),
  ...(note ? { note } : {}),
});

/**
 * A profile of the Common Core Ontologies that comes with Data Atlas: the
 * classes its starter kinds stand for, and more an operations floor is likely
 * to want. The full CCO can be loaded as Turtle beside it.
 */
export const CCO_PROFILE: Pack = {
  id: 'cco',
  name: 'Common Core Ontologies (profile)',
  version: '1.5',
  licence: 'BSD-3-Clause',
  source: 'https://github.com/CommonCoreOntology/CommonCoreOntologies',
  terms: [
    cco('Agent', undefined, 'A material entity that bears a capability to perform intentional acts.'),
    cco('Person', 'Agent'),
    cco('Group Of Agents', 'Agent'),
    cco('Organization', 'Group Of Agents'),
    cco('Government Organization', 'Organization'),
    cco('Commercial Organization', 'Organization'),
    cco('Armed Force', 'Organization'),
    cco('Educational Organization', 'Organization'),
    cco('Artifact', undefined, 'A material entity designed by an agent to realise a function.'),
    cco('Vehicle', 'Artifact'),
    cco('Watercraft', 'Vehicle'),
    cco('Aircraft', 'Vehicle'),
    cco('Ground Vehicle', 'Vehicle'),
    cco('Spacecraft', 'Vehicle'),
    cco('Weapon', 'Artifact'),
    cco('Facility', undefined, 'A material entity designed to support an activity at a site.'),
    cco('Port', 'Facility'),
    cco('Airport', 'Facility'),
    cco('Military Installation', 'Facility'),
    cco('Geospatial Region', undefined, 'A site on or near the Earth’s surface.'),
    cco('Act', undefined, 'A process in which at least one agent plays a causative role.'),
  ],
};

/** The packs that come with Data Atlas. */
export const BUILT_IN_PACKS: readonly Pack[] = [CCO_PROFILE];

/** Where AUGUR's own terms live, for kinds and links no pack names. */
export const AUGUR_NS = 'https://augur.invalid/atlas/ontology#';

/** The pack term something kept here is, by IRI: the one it was adopted from, else AUGUR's own. */
const iriOf = (packIri: string | undefined, key: string) => packIri ?? `${AUGUR_NS}${encodeURIComponent(key)}`;

/**
 * The ontology as OWL, in Turtle: each kind a class under its parent, each
 * detail a datatype property, each kind of link an object property with its
 * inverse, all with their labels. Kinds and links keep AUGUR's IRIs, and say
 * which pack term they are with skos:exactMatch, so the plainer names shown
 * here (Vessel for CCO's Watercraft) don't rename anything in the pack.
 */
export const owlTurtle = (ontology: Ontology): Promise<string> => {
  const { namedNode, literal, quad } = DataFactory;
  const writer = new Writer({ prefixes: { owl: OWL, rdfs: RDFS, skos: SKOS, xsd: XSD, cco: CCO, atlas: AUGUR_NS } });
  const ns = (key: string) => namedNode(`${AUGUR_NS}${encodeURIComponent(key)}`);
  const a = namedNode(`${RDF}type`);
  const add = (s: ReturnType<typeof namedNode>, p: string, o: Quad_Object) => writer.addQuad(quad(s, namedNode(p), o));
  const onto = namedNode(AUGUR_NS.replace(/#$/, ''));
  writer.addQuad(quad(onto, a, namedNode(`${OWL}Ontology`)));
  add(onto, `${OWL}versionInfo`, literal(String(ontology.version)));
  add(onto, `${RDFS}label`, literal('Data Atlas ontology', 'en'));
  for (const t of ontology.types) {
    const s = ns(t.key);
    writer.addQuad(quad(s, a, namedNode(`${OWL}Class`)));
    add(s, `${RDFS}label`, literal(t.label, 'en'));
    if (t.parent) add(s, `${RDFS}subClassOf`, ns(t.parent));
    add(s, `${SKOS}exactMatch`, namedNode(iriOf(t.packIri, t.key)));
    for (const d of t.details) {
      const p = ns(`${t.key}.${d.key}`);
      writer.addQuad(quad(p, a, namedNode(`${OWL}DatatypeProperty`)));
      add(p, `${RDFS}label`, literal(`${d.label} (${t.label})`, 'en'));
      add(p, `${RDFS}domain`, s);
      add(p, `${RDFS}range`, namedNode(`${XSD}${d.kind === 'number' ? 'decimal' : d.kind === 'date' ? 'date' : 'string'}`));
      if (d.identity) writer.addQuad(quad(p, a, namedNode(`${OWL}FunctionalProperty`)));
      if (d.packIri) add(p, `${SKOS}exactMatch`, namedNode(d.packIri));
    }
  }
  for (const r of ontology.relations) {
    const p = ns(r.key);
    writer.addQuad(quad(p, a, namedNode(`${OWL}ObjectProperty`)));
    add(p, `${RDFS}label`, literal(r.label, 'en'));
    add(p, `${SKOS}altLabel`, literal(`${r.inverse} (read backwards)`, 'en'));
    // A link may run from several kinds: one is said plainly, several as a union.
    const kinds = (keys: string[]): Quad_Object => (keys.length === 1 ? ns(keys[0]) : (writer.blank([{ predicate: namedNode(`${OWL}unionOf`), object: writer.list(keys.map(ns)) }]) as unknown as Quad_Object));
    add(p, `${RDFS}domain`, kinds(r.from));
    add(p, `${RDFS}range`, kinds(r.to));
    add(p, `${SKOS}exactMatch`, namedNode(iriOf(r.packIri, r.key)));
  }
  return new Promise((resolve, reject) => writer.end((err, out) => (err ? reject(err) : resolve(out ?? ''))));
};
