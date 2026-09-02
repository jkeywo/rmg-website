import assert from 'node:assert/strict';
import test from 'node:test';
import {
  escapeHtml,
  hasGameOnUtcDate,
  isPastAt,
  markdownToHtml,
  parseGameDate,
  parseNeon,
  safeExternalUrl,
  safeRelativePath
} from '../tools/site-lib.mjs';

test('parses records and removes block indentation', () => {
  const games = parseNeon('-\nname: Example\ndescription: |\n  First paragraph.\n  \n  Second paragraph.\n');
  assert.equal(games.length, 1);
  assert.equal(games[0].description, 'First paragraph.\n\nSecond paragraph.');
});

test('rejects malformed and duplicate fields', () => {
  assert.throws(() => parseNeon('-\nname: One\nnot valid\n'), /expected/);
  assert.throws(() => parseNeon('-\nname: One\nname: Two\n'), /duplicate field/);
});

test('parses strict English calendar dates', () => {
  assert.equal(parseGameDate('10 October 2026').toISOString(), '2026-10-10T00:00:00.000Z');
  assert.throws(() => parseGameDate('31 February 2026'), /invalid calendar date/);
  assert.throws(() => parseGameDate('2026-10-10'), /expected a date/);
});

test('moves an event to past at 16:00 UTC on its date', () => {
  const gameDate = parseGameDate('10 October 2026');
  assert.equal(isPastAt(gameDate, new Date('2026-10-10T15:59:59Z')), false);
  assert.equal(isPastAt(gameDate, new Date('2026-10-10T16:00:00Z')), true);
  assert.equal(isPastAt(gameDate, new Date('2026-10-09T20:00:00Z')), false);
  assert.equal(isPastAt(gameDate, new Date('2026-10-11T00:00:00Z')), true);
});

test('detects whether a game occurs on a UTC date', () => {
  const games = [{ dateObj: parseGameDate('10 October 2026') }];
  assert.equal(hasGameOnUtcDate(games, new Date('2026-10-10T16:00:00Z')), true);
  assert.equal(hasGameOnUtcDate(games, new Date('2026-10-11T16:00:00Z')), false);
});

test('escapes content before applying supported markup', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  const html = markdownToHtml('**Bold** and *italic* <script>');
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.doesNotMatch(html, /<script>/);
});

test('rejects unsafe paths and non-HTTPS external URLs', () => {
  assert.throws(() => safeRelativePath('../secret', 'asset'), /unsafe/);
  assert.throws(() => safeRelativePath('/absolute.png', 'asset'), /unsafe/);
  assert.throws(() => safeExternalUrl('javascript:alert(1)', 'link'), /HTTPS/);
  assert.equal(safeExternalUrl('https://example.com/path', 'link'), 'https://example.com/path');
});
