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
