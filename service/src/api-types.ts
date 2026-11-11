// The app's wire types, written once. The service answers with them, its OpenAPI document (openapi.ts)
// describes them and the frontend reads them, so none of the three can drift from the others (AUGUR's ADR
// 0055). A ThingView is the kit's (`@augur/app-kit`'s ThingPage and `quill-thing-page`): the same shape here.

/** Where a line came from, for its one quiet trust line. */
export interface ThingSource {
  id?: string;
  how: 'as-written' | 'forecast';
  reports: number;
  who: string;
  byYou?: boolean;
  on: string;
  title: string;
  yours?: boolean;
}
export type ThingAnswerKey = 'now' | 'next' | 'what' | 'when' | 'last-heard' | 'known-for';
export type ThingProblemKind = 'conflict' | 'duplicate' | 'problem' | 'slipped';

/** `GET /v1/things/:id`: one thing in the one shape, filled by Data Atlas's rules (service/src/shape.ts). */
export interface ThingView {
  id: string;
  name: string;
  kind: { name: string; icon: string };
  aliases?: string[];
  answer: { key: ThingAnswerKey; value: string; source?: ThingSource }[];
  problems: { kind: ThingProblemKind; text: string; source?: ThingSource }[];
  facts: { label: string; value: string; adopted?: boolean; source?: ThingSource }[];
  around: { id: string; relation: string; name: string; group?: string }[];
  total: number;
  reports: number;
}

/** `GET /v1/find?q=`: things whose name or other names match, best first. */
export interface Found {
  query: string;
  things: { id: string; name: string; kind: string }[];
}

const S = { type: 'string' } as const;
const N = { type: 'integer', minimum: 0 } as const;
const source = {
  type: 'object',
  required: ['how', 'reports', 'who', 'on', 'title'],
  additionalProperties: false,
  properties: { id: S, how: { type: 'string', enum: ['as-written', 'forecast'] }, reports: N, who: S, byYou: { type: 'boolean' }, on: S, title: S, yours: { type: 'boolean' } },
} as const;

/** `ThingView` as JSON Schema: the route's response schema and the OpenAPI document's. */
export const thingViewSchema = {
  type: 'object',
  required: ['id', 'name', 'kind', 'answer', 'problems', 'facts', 'around', 'total', 'reports'],
  additionalProperties: false,
  properties: {
    id: S,
    name: S,
    kind: { type: 'object', required: ['name', 'icon'], additionalProperties: false, properties: { name: S, icon: S } },
    aliases: { type: 'array', items: S },
    answer: {
      type: 'array',
      items: { type: 'object', required: ['key', 'value'], additionalProperties: false, properties: { key: { type: 'string', enum: ['now', 'next', 'what', 'when', 'last-heard', 'known-for'] }, value: S, source } },
    },
    problems: {
      type: 'array',
      items: { type: 'object', required: ['kind', 'text'], additionalProperties: false, properties: { kind: { type: 'string', enum: ['conflict', 'duplicate', 'problem', 'slipped'] }, text: S, source } },
    },
    facts: { type: 'array', items: { type: 'object', required: ['label', 'value'], additionalProperties: false, properties: { label: S, value: S, adopted: { type: 'boolean' }, source } } },
    around: { type: 'array', items: { type: 'object', required: ['id', 'relation', 'name'], additionalProperties: false, properties: { id: S, relation: S, name: S, group: S } } },
    total: N,
    reports: N,
  },
} as const;

/** `Found` as JSON Schema. */
export const foundSchema = {
  type: 'object',
  required: ['query', 'things'],
  additionalProperties: false,
  properties: {
    query: S,
    things: { type: 'array', items: { type: 'object', required: ['id', 'name', 'kind'], additionalProperties: false, properties: { id: S, name: S, kind: S } } },
  },
} as const;

/** `GET /v1/things/:id/everything`: all that is known of a thing in sight, now and before, in plain sections. */
export interface Everything {
  id: string;
  name: string;
  sections: { key: 'now' | 'links' | 'before'; label: string; rows: EverythingRow[] }[];
}
export interface EverythingRow {
  /** The belief it says, for "Something's wrong". */
  belief: string;
  label: string;
  value: string;
  /** When it was said and how many reports agree, in words. */
  detail: string;
  /** The thing it links to, to open. */
  opens?: string;
}

/** `GET /v1/things/:id/wrong`: the lines a person can say are wrong, as the page shows them. */
export interface WrongChoices {
  lines: { belief: string; line: string }[];
}

/** `POST /v1/things/:id/disputes`: one line said to be wrong, for its floor's settler. */
export interface DisputeAsk {
  belief: string;
  reason: string;
}
export interface Disputed {
  dispute: string;
}

/** `GET|PUT|DELETE /v1/follows/:id`: whether the person keeps an eye on a thing (Data Atlas's own data). */
export interface Following {
  thing: string;
  following: boolean;
}

const row = {
  type: 'object',
  required: ['belief', 'label', 'value', 'detail'],
  additionalProperties: false,
  properties: { belief: S, label: S, value: S, detail: S, opens: S },
} as const;

export const everythingSchema = {
  type: 'object',
  required: ['id', 'name', 'sections'],
  additionalProperties: false,
  properties: {
    id: S,
    name: S,
    sections: {
      type: 'array',
      items: { type: 'object', required: ['key', 'label', 'rows'], additionalProperties: false, properties: { key: { type: 'string', enum: ['now', 'links', 'before'] }, label: S, rows: { type: 'array', items: row } } },
    },
  },
} as const;

export const wrongChoicesSchema = {
  type: 'object',
  required: ['lines'],
  additionalProperties: false,
  properties: { lines: { type: 'array', items: { type: 'object', required: ['belief', 'line'], additionalProperties: false, properties: { belief: S, line: S } } } },
} as const;

export const disputeAskSchema = {
  type: 'object',
  required: ['belief', 'reason'],
  additionalProperties: false,
  properties: { belief: { type: 'string', minLength: 1, maxLength: 80 }, reason: { type: 'string', minLength: 1, maxLength: 500 } },
} as const;

export const disputedSchema = { type: 'object', required: ['dispute'], additionalProperties: false, properties: { dispute: S } } as const;

export const followingSchema = { type: 'object', required: ['thing', 'following'], additionalProperties: false, properties: { thing: S, following: { type: 'boolean' } } } as const;

/** A way in on the home door gallery: the kit's `DoorDescriptor`, as plain data. */
export type DoorSignalKind = 'change' | 'moved' | 'incident' | 'contradiction' | 'meeting' | 'due' | 'coming' | 'new-thing' | 'question' | 'queue';
export interface HomeDoor {
  id: string;
  name: string;
  line: string;
  icon: string;
  reads: DoorSignalKind[];
  order: number;
  firstDay?: string;
  unavailable?: { why: string; who: string };
}
/** One thing that may wait behind a door (the kit's `DoorSignal`): the shell scores the doors from these. */
export interface HomeSignal {
  kind: DoorSignalKind;
  reason: string;
  about?: string;
}

/** `GET /v1/home`: the doors, what waits behind them, and what the person keeps an eye on. */
export interface Home {
  doors: HomeDoor[];
  signals: HomeSignal[];
  /** Nothing is followed yet. */
  firstDay: boolean;
  following: { id: string; label: string }[];
}

/** `GET /v1/doors/:id`: what is behind one door, as a list of things. */
export interface DoorList {
  door: string;
  heading: string;
  items: { id: string; title: string; detail: string }[];
  empty: string;
}

const signalKind = { type: 'string', enum: ['change', 'moved', 'incident', 'contradiction', 'meeting', 'due', 'coming', 'new-thing', 'question', 'queue'] } as const;
export const homeSchema = {
  type: 'object',
  required: ['doors', 'signals', 'firstDay', 'following'],
  additionalProperties: false,
  properties: {
    doors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'line', 'icon', 'reads', 'order'],
        additionalProperties: false,
        properties: {
          id: S,
          name: S,
          line: S,
          icon: S,
          reads: { type: 'array', items: signalKind },
          order: { type: 'number' },
          firstDay: S,
          unavailable: { type: 'object', required: ['why', 'who'], additionalProperties: false, properties: { why: S, who: S } },
        },
      },
    },
    signals: { type: 'array', items: { type: 'object', required: ['kind', 'reason'], additionalProperties: false, properties: { kind: signalKind, reason: S, about: S } } },
    firstDay: { type: 'boolean' },
    following: { type: 'array', items: { type: 'object', required: ['id', 'label'], additionalProperties: false, properties: { id: S, label: S } } },
  },
} as const;

export const doorListSchema = {
  type: 'object',
  required: ['door', 'heading', 'items', 'empty'],
  additionalProperties: false,
  properties: {
    door: S,
    heading: S,
    items: { type: 'array', items: { type: 'object', required: ['id', 'title', 'detail'], additionalProperties: false, properties: { id: S, title: S, detail: S } } },
    empty: S,
  },
} as const;
