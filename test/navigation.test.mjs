import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRenderGate, gamesSource, routeFromHash } from '../scripts/games.js';
import * as views from '../scripts/views.js';

test('navigation retains the displayed page until its replacement or error is ready', async () => {
  const writes = [];
  const attributes = new Map();
  const app = {
    _html: '<h1>Reading Megagames</h1><p>Loading games…</p>',
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = value; writes.push(value); },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    querySelectorAll: () => [],
    focus() {}
  };
  const requests = [];
  const context = vm.createContext({
    ...views, createRenderGate, gamesSource, routeFromHash,
    createGamesLoader: () => () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    sizeGallery() {}, ResizeObserver: class { observe() {} disconnect() {} },
    matchMedia: () => ({ matches: false }), setInterval() {},
    console: { error() {} },
    location: { hash: '#past', search: '' },
    window: { addEventListener() {}, scrollTo() {} },
    document: {
      title: 'Reading Megagames',
      getElementById: id => id === 'app' ? app : { open: false },
      querySelectorAll: () => [], addEventListener() {}
    }
  });
  // Exercise the real DOM controller with deferred requests, without a browser dependency.
  const source = fs.readFileSync('scripts/app.js', 'utf8').replace(/^import .*;\r?$/gm, '');
  vm.runInContext(source.replace(/render\(\);\s*$/, 'globalThis.initialRender = render();'), context);
  assert.equal(writes.length, 0, 'initial loading shell stays in place');
  requests.shift().resolve([]);
  await context.initialRender;
  const displayed = app.innerHTML;
  assert.match(displayed, /Past Games/);

  context.location.hash = '#upcoming';
  const navigation = vm.runInContext('render(true)', context);
  assert.equal(attributes.get('aria-busy'), 'true');
  assert.equal(app.innerHTML, displayed, 'pending navigation must not collapse the page');
  assert.equal(context.document.title, 'Past Games | Reading Megagames');
  requests.shift().resolve([]);
  await navigation;
  assert.equal(writes.length, 2, 'each completed navigation replaces content exactly once');
  assert.match(app.innerHTML, /Upcoming Games/);
  assert.equal(attributes.has('aria-busy'), false);

  const beforeError = app.innerHTML;
  context.location.hash = '#past';
  const failingNavigation = vm.runInContext('render(true)', context);
  assert.equal(app.innerHTML, beforeError);
  requests.shift().reject(new Error('Offline'));
  await failingNavigation;
  assert.match(app.innerHTML, /Content could not be loaded/);
  assert.equal(attributes.has('aria-busy'), false);
});
