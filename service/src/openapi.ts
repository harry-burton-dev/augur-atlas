import type { AppManifest } from '@augur/service-kit';
import { foundSchema, thingViewSchema } from './api-types.ts';

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
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'The thing, as the person sees it from this floor', content: { 'application/json': { schema: thingViewSchema } } },
          401: { description: 'Nobody signed in', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          403: { description: 'The knowledge graph refused Data Atlas', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          404: { description: 'Nothing by that id is in sight from this floor', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          502: { description: 'The knowledge graph did not answer', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
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
