import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const staging = fs.readFileSync('.github/workflows/staging.yml', 'utf8');
const production = fs.readFileSync('.github/workflows/production.yml', 'utf8');

test('staging deploys pushes to main without a schedule', () => {
  assert.match(staging, /push:\s*\n\s+branches: \[main\]/);
  assert.doesNotMatch(staging, /\bschedule:/);
  assert.match(staging, /https:\/\/test\.readingmegagames\.co\.uk\//);
});

test('production event updates run at 16:00 UTC from the production branch', () => {
  assert.match(production, /cron: '0 16 \* \* \*'/);
  assert.match(production, /Check out promoted production branch[\s\S]*?ref: production/);
  assert.match(production, /Check for a game today[\s\S]*?check-event-day\.mjs/);
});

test('manual production releases explicitly use latest main', () => {
  assert.match(production, /Check out latest main[\s\S]*?ref: main/);
  assert.match(production, /git push origin HEAD:production/);
});
