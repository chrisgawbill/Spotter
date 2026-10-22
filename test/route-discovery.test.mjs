import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverRoutes } from '../src/route-discovery.mjs';

test('route discovery reads JSX nesting, aliases, hash URLs and Vite paths without executing source', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'spotter-routes-'));
  try {
    await writeFile(path.join(folder, 'App.tsx'), `
      import { HashRouter as Router, Route as Page } from 'react-router-dom';
      const settings = 'settings';
      throw new Error('Source must never execute');
      // <Page path="/fake-comment" />
      const text = '<Page path="/fake-string" />';
      const api = { path: '/not-a-route' };
      export const App = () => <Router basename="/inside"><Page path="/" element={<Home />} />
        <Page path="account" element={<Layout title=">" />}>
          <Page index element={<Home />} /><Page path={settings} element={<Settings />} />
          <Page path="users/:id" /><Page path={computed} />
        </Page><Page path="*" /></Router>;
    `);
    await writeFile(path.join(folder, 'vite.config.ts'), `import { defineConfig } from 'vite'; export default defineConfig({base: '/demo/', build: {outDir: 'public-build'}});`);
    const result = await discoverRoutes(folder, ['App.tsx', 'vite.config.ts']);
    assert.deepEqual(result.routes.map((route) => route.path), ['#/inside/', '#/inside/account', '#/inside/account/settings']);
    assert.equal(result.base, '/demo/');
    assert.equal(result.outDir, 'public-build');
    assert.match(result.notes.join(' '), /account\/users\/:id/);
    assert.match(result.notes.join(' '), /computed route path/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('route discovery reads object router children and flags unsupported computed lists', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'spotter-routes-'));
  try {
    await writeFile(path.join(folder, 'router.tsx'), `
      import { createBrowserRouter as createRouter } from 'react-router-dom';
      const children = [{index: true}, {path: 'summary'}, {path: ':id'}];
      const routes = [{path: '/', children: [{path: 'reports', children}]}];
      const router = createRouter(routes);
      const unknown = createRouter(importedRoutes);
    `);
    const result = await discoverRoutes(folder, ['router.tsx']);
    assert.deepEqual(result.routes.map((route) => route.path), ['/', '/reports', '/reports/summary']);
    assert.match(result.notes.join(' '), /reports\/:id/);
    assert.match(result.notes.join(' '), /computed route list/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('Vue and Angular route configs follow imported arrays and hash history', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'spotter-routes-'));
  try {
    const fixtures = {
      'routes.ts': `export const children = [{ path: 'overview' }, {path: ':id'}]; export const routes = [{ path: '/teams', children }];`,
      'vue.ts': `import {createRouter, createWebHashHistory} from 'vue-router'; import {routes} from './routes'; export const router = createRouter({history: createWebHashHistory(), routes});`,
      'legacy-vue.ts': `import VueRouter from 'vue-router'; import {routes} from './routes'; export const router = new VueRouter({routes});`,
      'angular.ts': `import { provideRouter, withHashLocation } from '@angular/router'; import {routes} from './routes'; provideRouter(routes, withHashLocation());`,
    };
    for (const [file, source] of Object.entries(fixtures)) await writeFile(path.join(folder, file), source);
    for (const file of ['vue.ts', 'legacy-vue.ts', 'angular.ts']) {
      const result = await discoverRoutes(folder, ['routes.ts', file]);
      assert.deepEqual(result.routes.map((route) => route.path), ['#/teams', '#/teams/overview']);
      assert.match(result.notes.join(' '), /teams\/:id/);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('file routers find pages while excluding layouts, API endpoints and private files', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'spotter-routes-'));
  try {
    const cases = [
      [{next: '*'}, ['app/(public)/page.tsx', 'app/(public)/about/page.tsx', 'app/layout.tsx', 'app/api/route.ts', 'app/_private/page.tsx', 'app/users/[id]/page.tsx', 'pages/legacy/index.tsx', 'pages/api/users.ts', 'pages/_app.tsx'], ['/', '/about', '/legacy']],
      [{nuxt: '*'}, ['app/pages/index.vue', 'app/pages/about.vue', 'app/pages/users/[id].vue'], ['/', '/about']],
      [{'@sveltejs/kit': '*'}, ['src/routes/(public)/+page.svelte', 'src/routes/(public)/about/+page.svelte', 'src/routes/api/+server.ts', 'src/routes/+layout.svelte', 'src/routes/users/[id]/+page.svelte'], ['/', '/about']],
      [{astro: '*'}, ['src/pages/index.astro', 'src/pages/about.md', 'src/pages/api.ts', 'src/pages/users/[id].astro'], ['/', '/about']],
    ];
    for (const [deps, files, expected] of cases) {
      for (const file of files) {
        await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
        await writeFile(path.join(folder, file), file.endsWith('.vue') ? '<template />' : 'export default null;');
      }
      const result = await discoverRoutes(folder, files, deps);
      assert.deepEqual(result.routes.map((route) => route.path), expected);
      assert.match(result.notes.join(' '), /users\/\[id\]/);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
