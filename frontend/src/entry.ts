import { defineApp } from '@augur/mfe-sdk/sdk3';
import type { Disputed, Everything, Following, Found, ThingView, WrongChoices } from '../../service/src/api-types.js';
import { ABOUT, API, details, everythingScreen, findScreen, pathOf, routeOf, thingScreen, why, type Asked, type Over, type Route, type Unavailable } from './screen.js';

/**
 * What the shell runs in the app's worker (the manifest's `frontend.entry`): `start(ctx)`, once, with
 * the person, the floor and the calls the bridge carries. The host owns the URL: `/` finds a thing,
 * `/things/<id>` is its page and `/things/<id>/all` everything known of it. A new floor starts the
 * worker again, so nothing here outlives one floor.
 */
export default defineApp((ctx) => {
  let route: Route = { kind: 'find' };
  let query = '';
  let found: Asked<Found> = { kind: 'idle' };
  let thing: Asked<ThingView> = { kind: 'idle' };
  let all: Asked<Everything> = { kind: 'idle' };
  let following = false;
  let over: Over = { kind: 'none' };
  let asking = 0;

  const draw = () =>
    ctx.frame.screen.render(
      route.kind === 'thing'
        ? thingScreen(thing, { following, over }, { open, retry: () => void read(route), act, everything: () => go({ kind: 'all', id: (route as { id: string }).id }), unfollow: () => void follow(false), submitWrong, closeOver })
        : route.kind === 'all'
          ? everythingScreen(all, { back: () => go({ kind: 'thing', id: (route as { id: string }).id }), open, retry: () => void read(route) })
          : findScreen(query, found, { find: (q) => void find(q), open }),
    );

  // Through the gateway, which adds the person's token, the floor and the app: the worker never sees them.
  const ask = async <T>(path: string, init?: RequestInit): Promise<Asked<T>> => {
    try {
      const res = await ctx.fetch(`${API}${path}`, init);
      return res.ok ? { kind: 'answered', value: (await res.json()) as T } : { kind: 'failed', why: await why(res) };
    } catch (err) {
      return { kind: 'failed', why: (err as Error).message };
    }
  };
  const thingPath = (id: string) => `/things/${encodeURIComponent(id)}`;

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
    if (at.kind === 'find') return;
    const mine = ++asking;
    over = { kind: 'none' };
    if (at.kind === 'all') {
      all = { kind: 'asking' };
      draw();
      const answer = await ask<Everything>(`${thingPath(at.id)}/everything`);
      if (mine !== asking) return;
      all = answer;
      ctx.frame.set({ title: answer.kind === 'answered' ? `Everything known of ${answer.value.name}` : 'Everything we know' });
      return draw();
    }
    thing = { kind: 'asking' };
    ctx.frame.set({ title: 'Data Atlas' });
    draw();
    const [answer, eye] = await Promise.all([ask<ThingView>(thingPath(at.id)), ask<Following>(`/follows/${encodeURIComponent(at.id)}`)]);
    if (mine !== asking) return;
    thing = answer;
    following = eye.kind === 'answered' && eye.value.following;
    if (answer.kind === 'answered') ctx.frame.set({ title: answer.value.name });
    draw();
  };

  // The page's actions: keep an eye on it, say something's wrong, or one AUGUR can't carry yet, which says why.
  const follow = async (on: boolean) => {
    if (route.kind !== 'thing') return;
    const id = route.id;
    const res = await ask<Following>(`/follows/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE' });
    if (res.kind === 'failed') return ctx.notify({ title: on ? 'Data Atlas couldn’t keep an eye on it' : 'Data Atlas couldn’t stop keeping an eye on it', body: res.why });
    if (res.kind !== 'answered' || route.kind !== 'thing' || route.id !== id) return;
    following = res.value.following;
    draw();
  };
  const act = (id: string) => {
    if (route.kind !== 'thing') return;
    if (id === 'follow') return void follow(!following);
    if (id === 'wrong') return void wrong(route.id);
    if (id === 'ask' || id === 'send') {
      over = { kind: 'unavailable', action: id as Unavailable };
      draw();
    }
  };
  const wrong = async (id: string) => {
    // One key per opening of the dialog: sending twice from it opens one dispute.
    const key = crypto.randomUUID();
    over = { kind: 'wrong', choices: { kind: 'asking' }, key };
    draw();
    const choices = await ask<WrongChoices>(`${thingPath(id)}/wrong`);
    if (over.kind !== 'wrong' || over.key !== key) return;
    over = { ...over, choices };
    draw();
  };
  const submitWrong = async (values: Record<string, unknown>) => {
    if (over.kind !== 'wrong' || route.kind !== 'thing') return;
    const belief = String(values.belief ?? '');
    const reason = String(values.reason ?? '').trim();
    if (!belief || !reason) {
      over = { ...over, error: 'Pick the line and say what is wrong with it.' };
      return draw();
    }
    const { key } = over;
    over = { ...over, busy: true, error: undefined };
    draw();
    const sent = await ask<Disputed>(`${thingPath(route.id)}/disputes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify({ belief, reason }),
    });
    if (over.kind !== 'wrong' || over.key !== key) return;
    if (sent.kind === 'failed') {
      over = { ...over, busy: false, error: sent.why };
      return draw();
    }
    over = { kind: 'none' };
    ctx.notify({ title: 'Sent to the people who settle this floor’s reports', body: 'The line shows it is disputed until they settle it.' });
    void read(route);
  };
  const closeOver = () => {
    over = { kind: 'none' };
    draw();
  };

  // Every move, the person's or the host's, lands here once.
  let shown: string | undefined;
  const arrive = (path: string) => {
    const next = routeOf(path);
    if (pathOf(next) === shown) return;
    shown = pathOf(next);
    route = next;
    if (route.kind !== 'find') return void read(route);
    ctx.frame.set({ title: 'Find a thing' });
    draw();
  };
  function go(to: Route) {
    ctx.navigate(pathOf(to));
    arrive(pathOf(to));
  }
  function open(id: string) {
    go({ kind: 'thing', id });
  }

  ctx.onNavigate(arrive);
  ctx.frame.about(ABOUT.details).render(details(ctx));
  arrive(ctx.path);
});
