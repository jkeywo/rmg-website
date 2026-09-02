import fs from 'node:fs/promises';

const [manifestPath = 'dist/build-manifest.json', liveUrl = 'https://readingmegagames.co.uk/build-manifest.json'] = process.argv.slice(2);
const local = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

try {
  const response = await fetch(liveUrl, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const live = await response.json();
  process.stdout.write(live.contentHash === local.contentHash ? 'false' : 'true');
} catch (error) {
  console.error(`Live manifest unavailable (${error.message}); deployment is required.`);
  process.stdout.write('true');
}
