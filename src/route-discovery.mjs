import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value?.type) walk(value, visit);
  }
}

/** Read source syntax only; never import a project's router or build configuration. */
export async function discoverRoutes(folder, files, dependencies = {}) {
  const routes = new Set();
  const pending = new Set();
  const notes = [];
  let hash = false;
  let browser = false;
  let base = '/';
  let hashBasename = '';
  let outDir;
  let staticExport = false;
  let serverBuild = false;
  const add = (route) => {
    if (/[:*$?\[\]]/.test(route)) pending.add(route);
    else routes.add(route || '/');
  };
  const frameworks = [];
  for (const [dependency, label] of Object.entries({next: 'Next.js', nuxt: 'Nuxt', '@sveltejs/kit': 'SvelteKit', astro: 'Astro'})) {
    if (!dependencies[dependency]) continue;
    frameworks.push(label);
    for (const file of files) {
      let route;
      if (dependency === 'next') {
        const app = /^(?:src\/)?app\/(.*\/)?page\.[jt]sx?$/.exec(file);
        const pages = /^(?:src\/)?pages\/(.+)\.[jt]sx?$/.exec(file);
        if (app) {
          const parts = (app[1] ?? '').split('/').filter(Boolean);
          if (parts.some((part) => part.startsWith('_'))) continue;
          if (parts.some((part) => part.startsWith('@') || /^\(\./.test(part))) { pending.add(`Next.js parallel/intercepted page: ${file}`); continue; }
          route = parts.filter((part) => !/^\(.+\)$/.test(part)).join('/');
        } else if (pages && !/^(api\/|_app$|_document$|_error$)/.test(pages[1])) route = pages[1].replace(/(?:^|\/)index$/, '');
      }
      if (dependency === 'nuxt') {
        const page = /^(?:(?:app|src)\/)?pages\/(.+)\.vue$/.exec(file);
        if (page) route = page[1].split('/').filter((part) => !/^\(.+\)$/.test(part)).map((part) => part.startsWith('_') ? `:${part.slice(1) || 'path'}` : part).join('/').replace(/(?:^|\/)index$/, '');
      }
      if (dependency === '@sveltejs/kit') {
        const page = /^src\/routes\/(.*\/)?\+page(?:@[^.]*)?\.svelte$/.exec(file);
        if (page) route = (page[1] ?? '').split('/').filter((part) => part && !/^\(.+\)$/.test(part)).join('/');
      }
      if (dependency === 'astro') {
        const page = /^src\/pages\/(.+)\.(?:astro|md|mdx|html)$/.exec(file);
        if (page) route = page[1].replace(/(?:^|\/)index$/, '');
      }
      if (route !== undefined) add(`/${route}`);
    }
  }
  const modules = new Map();
  const owners = new WeakMap();
  const candidates = files.filter((file) => /(?:\.[cm]?[jt]sx?|\.vue)$/.test(file)
    && !/(^|\/)(node_modules|dist|build|coverage|qa|tests?|__tests__)\//.test(file)
    && !/\.(test|spec|stories)\.[^.]+$/.test(file));
  if (candidates.length > 500) notes.push('Route scan limited to 500 source files; review routes manually.');
  for (const file of candidates.slice(0, 500)) {
    const full = await realpath(path.join(folder, file)).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
    if (!full) continue;
    if (!full.startsWith(`${folder}${path.sep}`)) continue;
    if ((await stat(full)).size > 1_048_576) { notes.push(`Route scan skipped large file: ${file}.`); continue; }
    let ast;
    try {
      let source = await readFile(full, 'utf8');
      if (file.endsWith('.vue')) source = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n');
      ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript', 'decorators-legacy'] });
    }
    catch { notes.push(`Could not read route syntax in ${file}; review it manually.`); continue; }
    const bindings = new Map();
    const imports = new Map();
    const imported = new Map();
    const exported = new Map();
    const module = { ast, bindings, imports, imported, exported, file };
    modules.set(file, module);
    walk(ast, (node) => {
      owners.set(node, module);
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') bindings.set(node.id.name, bindings.has(node.id.name) ? null : node.init);
      if (node.type === 'ImportDeclaration' && ['react-router', 'react-router-dom', 'vue-router', '@angular/router'].includes(node.source.value)) {
        for (const spec of node.specifiers) imports.set(spec.local.name, spec.type === 'ImportSpecifier' ? spec.imported.name : spec.type === 'ImportNamespaceSpecifier' ? '*' : 'VueRouter');
      }
      if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.')) {
        for (const spec of node.specifiers) imported.set(spec.local.name, { from: node.source.value, name: spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.imported?.name });
      }
      if (node.type === 'ExportNamedDeclaration') {
        for (const item of node.declaration?.declarations ?? []) exported.set(item.id.name, item.init);
        for (const item of node.specifiers) exported.set(item.exported.name, item.local);
      }
      if (node.type === 'ExportDefaultDeclaration') exported.set('default', node.declaration);
    });
  }
  function resolveModule(file, from) {
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), from));
    return [relative, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.js'].map((ext) => relative + ext)].map((candidate) => modules.get(candidate)).find(Boolean);
  }
  for (const { ast, imports, file } of modules.values()) {
    function resolve(node, seen = new Set()) {
      if (node?.type === 'Identifier' && !seen.has(node)) {
        const owner = owners.get(node);
        const value = owner?.bindings.get(node.name);
        if (value) return resolve(value, new Set([...seen, node]));
        const imported = owner?.imported.get(node.name);
        if (imported) {
          const target = resolveModule(owner.file, imported.from)?.exported.get(imported.name);
          if (target) return resolve(target, new Set([...seen, node]));
        }
      }
      if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'JSXExpressionContainer'].includes(node?.type)) return resolve(node.expression, seen);
      return node;
    }
    const literal = (node) => {
      node = resolve(node);
      return node?.type === 'StringLiteral' ? node.value : node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : undefined;
    };
    const prop = (node, key) => resolve(node)?.properties?.find((item) => item.type === 'ObjectProperty' && (item.key.name ?? item.key.value) === key)?.value;
    const attr = (node, key) => node.openingElement.attributes.find((item) => item.type === 'JSXAttribute' && item.name.name === key);
    const join = (parent, child) => child.startsWith('/') ? child : `${parent.replace(/\/$/, '')}/${child}`;
    function jsx(node, parent = '') {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'JSXElement' && imports.get(node.openingElement.name.name) === 'Route') {
        const attribute = attr(node, 'path');
        const segment = literal(attribute?.value);
        if (attribute && segment === undefined) { pending.add('(computed route path)'); return; }
        const route = segment === undefined ? parent : join(parent, segment);
        if (segment !== undefined || attr(node, 'index')) add(route);
        node.children.forEach((child) => jsx(child, route));
        return;
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach((child) => jsx(child, parent));
        else if (value?.type) jsx(value, parent);
      }
    }
    function objectRoutes(node, parent = '', seen = new Set()) {
      node = resolve(node);
      if (!node || seen.has(node)) return;
      seen = new Set([...seen, node]);
      if (node.type !== 'ArrayExpression') { pending.add('(computed route list)'); return; }
      for (let item of node.elements) {
        item = resolve(item);
        if (item?.type === 'SpreadElement') { objectRoutes(item.argument, parent, seen); continue; }
        if (item?.type !== 'ObjectExpression') { pending.add('(computed route entry)'); continue; }
        const segment = literal(prop(item, 'path'));
        if (prop(item, 'path') && segment === undefined) { pending.add('(computed route path)'); continue; }
        const route = segment === undefined ? parent : join(parent, segment);
        if (prop(item, 'loadChildren')) pending.add(`lazy route children below ${route || '/'}`);
        if (prop(item, 'redirectTo') || prop(item, 'redirect')) continue;
        if (segment !== undefined || resolve(prop(item, 'index'))?.value === true) add(route);
        if (prop(item, 'children')) objectRoutes(prop(item, 'children'), route, seen);
      }
    }
    jsx(ast);
    walk(ast, (node) => {
      if (node.type === 'JSXElement') {
        const name = imports.get(node.openingElement.name.name);
        if (name === 'HashRouter') { hash = true; frameworks.push('React Router'); }
        if (['HashRouter', 'BrowserRouter'].includes(name)) {
          const basename = literal(attr(node, 'basename')?.value);
          if (basename?.startsWith('/')) {
            if (name === 'HashRouter' || name === 'createHashRouter') hashBasename = basename.replace(/\/$/, '');
            else base = basename;
          }
        }
        if (name === 'BrowserRouter') { browser = true; frameworks.push('React Router'); }
      }
      if (node.type === 'CallExpression' || node.type === 'NewExpression') {
        const name = imports.get(node.callee.name) ?? (node.callee.type === 'MemberExpression' && imports.get(node.callee.object.name) === '*' ? node.callee.property.name : undefined);
        if (name === 'createRouter' || name === 'VueRouter') {
          frameworks.push('Vue Router');
          const config = resolve(node.arguments[0]);
          objectRoutes(prop(config, 'routes'));
          if (name === 'VueRouter') {
            if (literal(prop(config, 'mode')) === 'history') browser = true;
            else hash = true;
          }
        }
        if (name === 'createWebHashHistory' || name === 'withHashLocation') hash = true;
        if (name === 'createWebHistory') browser = true;
        if (['createWebHistory', 'createWebHashHistory'].includes(name)) {
          const historyBase = literal(node.arguments[0]);
          if (historyBase?.startsWith('/')) base = historyBase;
        }
        if (name === 'provideRouter' || (node.callee.type === 'MemberExpression' && imports.get(node.callee.object.name) === 'RouterModule' && node.callee.property.name === 'forRoot')) {
          frameworks.push('Angular');
          objectRoutes(node.arguments[0]);
          if (resolve(prop(node.arguments[1], 'useHash'))?.value === true) hash = true;
        }
        if (['createHashRouter', 'createBrowserRouter', 'useRoutes'].includes(name)) {
          if (name === 'createHashRouter') hash = true;
          if (name === 'createBrowserRouter') browser = true;
          frameworks.push('React Router');
          const basename = literal(prop(node.arguments[1], 'basename'));
          if (basename?.startsWith('/')) {
            if (name === 'HashRouter' || name === 'createHashRouter') hashBasename = basename.replace(/\/$/, '');
            else base = basename;
          }
          objectRoutes(node.arguments[0]);
        }
      }
      if (/^(vite|next|nuxt|astro|svelte)\.config\.[cm]?[jt]s$/.test(file) && (node.type === 'ExportDefaultDeclaration' || node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && node.left.object.name === 'module' && node.left.property.name === 'exports')) {
        let config = resolve(node.declaration ?? node.right);
        if (config?.type === 'CallExpression') config = resolve(config.arguments[0]);
        if (config?.type !== 'ObjectExpression') notes.push(`Could not statically read ${file}; review base path and build output.`);
        const detectedBase = literal(prop(config, 'base')) ?? literal(prop(config, 'basePath'))
          ?? literal(prop(resolve(prop(config, 'app')), 'baseURL'))
          ?? literal(prop(resolve(prop(resolve(prop(config, 'kit')), 'paths')), 'base'));
        if (detectedBase === '' || detectedBase?.startsWith('/')) base = detectedBase || '/';
        else if (detectedBase !== undefined || prop(config, 'base')) notes.push(`Review ${file} base: it is relative or computed.`);
        outDir = literal(prop(resolve(prop(config, 'build')), 'outDir')) ?? literal(prop(config, 'outDir')) ?? outDir;
        if (file.startsWith('next.config') && literal(prop(config, 'output')) === 'export') staticExport = true;
        if (file.startsWith('astro.config') && ['server', 'hybrid'].includes(literal(prop(config, 'output')))) serverBuild = true;
      }
    });
  }
  if (frameworks.length) notes.unshift(`Detected frontend routing: ${[...new Set(frameworks)].join(', ')}.`);
  if (hash && browser) notes.push('Both hash and browser routers found; review route URL format.');
  const prefix = hash && !browser ? '#' : '';
  if (pending.size) notes.push(`Routes needing concrete sample URLs: ${[...pending].join(', ')}. Replace parameters/wildcards and add these routes manually.`);
  if (!routes.size) { routes.add('/'); notes.push('No literal routes detected; using home only. Add routes manually for unsupported routers.'); }
  else notes.push(`Detected ${routes.size} literal routes. Review query parameters and routes assembled across files.`);
  return { base, outDir, staticExport, serverBuild, routes: [...routes].map((route) => ({ name: route === '/' ? 'home' : route.slice(1).replace(/[^\w-]+/g, '-'), path: `${prefix}${prefix ? hashBasename : ''}${route}` })), notes };
}
