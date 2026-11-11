import type { AppManifest } from '@augur/service-kit';
import { disputeAskSchema, disputedSchema, doorListSchema, everythingSchema, homeSchema, followingSchema, foundSchema, thingViewSchema, wrongChoicesSchema } from './api-types.ts';

/**
 * The service's OpenAPI document, served at the manifest's `api.openapi` path; the registry reads it
 * after install. Built from the wire types' schemas, so it says what the routes answer.
 */
export const openApi = (manifest: AppManifest, version: string, api: string) => ({
  openapi: '3.1.0',
  info: { title: manifest.name, version },
  servers: [{ url: `/api/${manifest.id}` }],
  paths: {
    [`/${api}/things/{id}`]: {
      get: {
        operationId: 'getThing',
        summary: 'One thing in the one shape: what it is, the answer, what is wrong, key facts and what is around it',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'from', in: 'query', required: false, description: 'The thing whose page it was opened from: the link followed counts towards use-ranking on this floor', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'The thing, as the person sees it from this floor', content: { 'application/json': { schema: thingViewSchema } } },
          401: { description: 'Nobody signed in', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          403: { description: 'The knowledge graph refused Data Atlas', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          404: { description: 'Nothing by that id is in sight from this floor', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          502: { description: 'The knowledge graph did not answer', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    [`/${api}/things/{id}/everything`]: {
      get: {
        operationId: 'getEverything',
        summary: 'Everything known of a thing in sight: now, its links both ways, and what was true before',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Its sections', content: { 'application/json': { schema: everythingSchema } } },
          404: { description: 'Nothing by that id is in sight from this floor', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          502: { description: 'The knowledge graph did not answer', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    [`/${api}/things/{id}/wrong`]: {
      get: {
        operationId: 'getWrongChoices',
        summary: 'The lines a person can say are wrong, the page’s own first',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'The lines', content: { 'application/json': { schema: wrongChoicesSchema } } }, 404: { description: 'Not in sight', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } } },
      },
    },
    [`/${api}/things/{id}/disputes`]: {
      post: {
        operationId: 'dispute',
        summary: 'Say one line is wrong, for its floor’s settler to settle (the knowledge graph’s dispute action, as the person)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8 } }],
        requestBody: { required: true, content: { 'application/json': { schema: disputeAskSchema } } },
        responses: {
          200: { description: 'The dispute, opened', content: { 'application/json': { schema: disputedSchema } } },
          400: { description: 'No Idempotency-Key', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          403: { description: 'Not allowed: says why and who can change it', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          409: { description: 'Already said', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          422: { description: 'That line isn’t about this thing', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    [`/${api}/follows/{id}`]: {
      get: { operationId: 'getFollowing', summary: 'Whether the person keeps an eye on a thing, on this floor', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Whether', content: { 'application/json': { schema: followingSchema } } } } },
      put: { operationId: 'follow', summary: 'Keep an eye on a thing in sight', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Kept', content: { 'application/json': { schema: followingSchema } } }, 404: { description: 'Not in sight', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } } } },
      delete: { operationId: 'unfollow', summary: 'Stop keeping an eye on it', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Stopped', content: { 'application/json': { schema: followingSchema } } } } },
    },
    [`/${api}/home`]: {
      get: { operationId: 'getHome', summary: 'The home door gallery: the doors, what waits behind them, and what the person keeps an eye on', responses: { 200: { description: 'The home', content: { 'application/json': { schema: homeSchema } } } } },
    },
    [`/${api}/doors/{id}`]: {
      get: {
        operationId: 'getDoor',
        summary: 'What is behind one door, as a list of things',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'The list', content: { 'application/json': { schema: doorListSchema } } }, 404: { description: 'No such door', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } } },
      },
    },
    [`/${api}/find`]: {
      get: {
        operationId: 'find',
        summary: 'Things whose names match what the person typed',
        parameters: [{ name: 'q', in: 'query', required: false, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Up to 20 things, best first', content: { 'application/json': { schema: foundSchema } } },
          401: { description: 'Nobody signed in', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          502: { description: 'The knowledge graph did not answer', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      // RFC 9457, as every AUGUR service answers an error (the service kit's problemDetails).
      Problem: {
        type: 'object',
        required: ['type', 'title', 'status'],
        properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' }, reason: { type: 'string' }, whoCanChange: { type: 'string' } },
      },
    },
  },
});
