import { hasGameOnUtcDate, readGames } from './site-lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));

const now = args.date ? new Date(`${args.date}T16:00:00Z`) : new Date();
if (Number.isNaN(now.valueOf())) throw new Error(`Invalid --date value: ${args.date}`);
const games = readGames(args.source || 'games.neon');
process.stdout.write(hasGameOnUtcDate(games, now) ? 'true' : 'false');
