import { isPastAt, parseNeon, safeRelativePath, validateGames } from './site-lib.js';

export function gamesSource(search = '') {
  const source = safeRelativePath(new URLSearchParams(search).get('source') || 'games.neon', 'Game source');
  if (!source.endsWith('.neon')) throw new Error('Game source must be a relative .neon file');
  return source;
}

export function createGamesLoader(fetchFile = globalThis.fetch, now = () => new Date()) {
  const pending = new Map();
  return async (source = 'games.neon') => {
    if (!pending.has(source)) {
      const request = Promise.resolve().then(() => fetchFile(source, { cache: 'no-cache' }))
        .then(response => {
          if (!response.ok) throw new Error(`Games request failed (${response.status})`);
          return response.text();
        })
        .then(text => validateGames(parseNeon(text, source)))
        .finally(() => pending.delete(source));
      pending.set(source, request);
    }
    const games = await pending.get(source);
    const currentTime = now();
    return games.map(game => ({ ...game, isPast: isPastAt(game.dateObj, currentTime) }));
  };
}

// Each navigation invalidates all previous asynchronous work, including errors.
export function createRenderGate() {
  let version = 0;
  return () => {
    const current = ++version;
    return () => current === version;
  };
}

export function routeFromHash(hash) {
  const route = hash.replace(/^#/, '') || 'home';
  if (['home', 'upcoming', 'past', 'about', 'about/code-of-conduct'].includes(route)) return { page: route.split('/')[0], conduct: route === 'about/code-of-conduct' };
  if (route.startsWith('game/')) {
    try {
      const slug = decodeURIComponent(route.slice(5));
      if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { page: 'game', slug };
    } catch { /* Malformed bookmarks render the not-found state. */ }
  }
  return { page: 'not-found' };
}
