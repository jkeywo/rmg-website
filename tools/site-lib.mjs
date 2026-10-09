import fs from 'node:fs';
import path from 'node:path';
import { parseNeon, validateGames } from '../scripts/site-lib.js';
export * from '../scripts/site-lib.js';

export function readGames(sourcePath, rootDirectory = process.cwd()) {
  const absolute = path.resolve(rootDirectory, sourcePath);
  if (!fs.existsSync(absolute)) throw new Error(`Game source does not exist: ${sourcePath}`);
  const games = validateGames(parseNeon(fs.readFileSync(absolute, 'utf8'), sourcePath));
  for (const game of games) {
    for (const image of [game.listImage, game.bannerImage, ...game.photos.map(name => `photos/${game.slug}/${name}`)]) {
      if (!fs.existsSync(path.join(rootDirectory, image))) throw new Error(`${game.slug}: missing image "${image}"`);
    }
  }
  return games;
}
