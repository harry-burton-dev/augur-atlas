import { defineApp } from '@augur/mfe-sdk/sdk3';
import type { Found, ThingView } from '../../service/src/api-types.js';
import { ABOUT, API, details, findScreen, pathOf, routeOf, thingScreen, why, type Asked, type Route } from './screen.js';

/**
 * What the shell runs in the app's worker (the manifest's `frontend.entry`): `start(ctx)`, once, with
 * the person, the floor and the calls the bridge carries. The host owns the URL: `/` finds a thing,
 * `/things/<id>` is its page. A new floor starts the worker again, so nothing here outlives one floor.
 */
export default defineApp((ctx) => {
  let route: Route = { kind: 'find' };
  let query = '';
  let found: Asked<Found> = { kind: 'idle' };
  let thing: Asked<ThingView> = { kind: 'idle' };
  let asking = 0;

  const draw = () =>
    ctx.frame.screen.render(
      route.kind === 'thing'
        ? thingScreen(thing, { open, retry: () => void read(route) })
        : findScreen(query, found, { find: (q) => void find(q), open }),
    );

  // Through the gateway, which adds the person's token, the floor and the app: the worker never sees them.
  const ask = async <T>(path: string): Promise<Asked<T>> => {
    try {
      const res = await ctx.fetch(`${API}${path}`);
      return res.ok ? { kind: 'answered', value: (await res.json()) as T } : { kind: 'failed', why: await why(res) };
    } catch (err) {
      return { kind: 'failed', why: (err as Error).message };
    }
  };

  const find = async (q: string) => {
    query = q.trim();
    if (!query) {
      found = { kind: 'idle' };
      return draw();
    }
    const mine = ++asking;
    found = { kind: 'asking' };
    draw();
    const answer = await ask<Found>(`/find?q=${encodeURIComponent(query)}`);
    if (mine !== asking) return;
    found = answer;
    draw();
  };

  const read = async (at: Route) => {
    if (at.kind !== 'thing') return;
    const mine = ++asking;
    thing = { kind: 'asking' };
    ctx.frame.set({ title: 'Data Atlas' });
    draw();
    const answer = await ask<ThingView>(`/things/${encodeURIComponent(at.id)}`);
    if (mine !== asking) return;
    thing = answer;
    if (answer.kind === 'answered') ctx.frame.set({ title: answer.value.name });
    draw();
  };

  // Every move, the person's or the host's, lands here once.
  let shown: string | undefined;
  const arrive = (path: string) => {
    const next = routeOf(path);
    if (pathOf(next) === shown) return;
    shown = pathOf(next);
    route = next;
    if (route.kind === 'thing') return void read(route);
    ctx.frame.set({ title: 'Find a thing' });
    draw();
  };
  function open(id: string) {
    const to = pathOf({ kind: 'thing', id });
    ctx.navigate(to);
    arrive(to);
  }

  ctx.onNavigate(arrive);
  ctx.frame.about(ABOUT.details).render(details(ctx));
  arrive(ctx.path);
});
