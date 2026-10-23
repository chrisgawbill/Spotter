import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countPageVisits, isDefaultMatrix, listTargets, matrixProblems } from '../src/browsers.mjs';

const web = (browsers, devices = []) => ({ browsers, devices, routes: [1, 2], viewports: [375, 1280], colorSchemes: ['light'], sessions: [1, 2, 3] });

test('targets list browsers then devices with stable ids', () => {
  assert.deepEqual(listTargets(web(['chromium', 'webkit'], ['iPhone 13 landscape'])), [
    { id: 'chromium', browser: 'chromium', device: null, label: 'chromium' },
    { id: 'webkit', browser: 'webkit', device: null, label: 'webkit' },
    { id: 'iphone-13-landscape', browser: null, device: 'iPhone 13 landscape', label: 'iPhone 13 landscape' },
  ]);
});

test('only Chromium alone is the default matrix', () => {
  assert.equal(isDefaultMatrix(web(['chromium'])), true);
  assert.equal(isDefaultMatrix(web(['firefox'])), false);
  assert.equal(isDefaultMatrix(web(['chromium'], ['Pixel 7'])), false);
});

test('devices visit once per route, scheme and session', () => {
  assert.equal(countPageVisits(web(['chromium'])), 12);
  assert.equal(countPageVisits(web(['chromium', 'firefox'], ['Pixel 7'])), 30);
});

test('matrix lists are validated', () => {
  assert.deepEqual(matrixProblems({}, 'web'), []);
  assert.deepEqual(matrixProblems({ browsers: ['webkit'], devices: ['iPhone 13'] }, 'web'), []);
  assert.equal(matrixProblems({ browsers: [] }, 'web').length, 1);
  assert.equal(matrixProblems({ browsers: ['safari'] }, 'web').length, 1);
  assert.equal(matrixProblems({ browsers: ['firefox', 'firefox'] }, 'web').length, 1);
  assert.match(matrixProblems({ devices: ['iPhone 13', 'iphone-13'] }, 'levels.high')[0], /levels\.high\.devices/);
  assert.equal(matrixProblems({ devices: [''] }, 'web').length, 1);
});
