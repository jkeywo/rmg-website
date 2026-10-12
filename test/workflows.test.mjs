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

test('production is manual-only and packages without image processing', () => {
  assert.doesNotMatch(production, /\bschedule:|event-day-update|needs-deploy|npm ci/);
  assert.match(production, /npm run package && npm run check/);
});

test('staging retains unique artifacts and waits for their metadata', () => {
  assert.match(staging, /npm run package:staging/);
  assert.match(staging, /Wait for Pages artifact metadata/);
  assert.match(staging, /artifact_name: github-pages-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
});

test('manual production releases explicitly use latest main', () => {
  assert.match(production, /Check out latest main[\s\S]*?ref: main/);
  assert.match(production, /git push origin HEAD:production/);
});

test('staging deploys and verifies an independent preview API without publishing production', () => {
  assert.match(staging, /pages deploy dist --project-name=reading-megagames --branch=staging/);
  assert.match(staging, /pages secret put TICKET_TAILOR_API_KEY --project-name=reading-megagames --env preview/);
  assert.ok(staging.indexOf('node tools/check-ticket-endpoint.mjs') < staging.indexOf('uses: actions/deploy-pages'));
  assert.doesNotMatch(staging, /--branch=production|--env production|HEAD:production/);
});
