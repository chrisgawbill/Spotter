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
  const evidence = { api: [], themeKeys: [], errorText: [], retryDelays: [], routeSamples: [], loadingSelectors: [], proxy: [], relativeRequests: [], expectedStatuses: [], faultKinds: [], playwright: { viewports: [], colorSchemes: [] } };
  const cleanUrl = (value) => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.href.replace(/\/$/, '') : null; } catch { return null; }
  };
  const memberPath = (node) => node?.type === 'Identifier' ? node.name : node?.type === 'MetaProperty' ? `${node.meta.name}.${node.property.name}` : node?.type === 'MemberExpression' ? `${memberPath(node.object)}.${node.computed ? node.property.value : node.property.name}` : '';
  const apiEnv = (node) => {
    const match = /^(?:import\.meta\.env|process\.env)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(memberPath(node));
    return match && /(?:API|BACKEND).*(?:URL|ORIGIN|HOST)/i.test(match[1]) ? match[1] : null;
  };
  let hash = false;
  let browser = false;
  let base = '/';
  let hashBasename = '';
  let outDir;
  let staticExport = false;
  let serverBuild = false;
  const hashRoutes = new Set();
  const hashAliases = new Set();
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
    const strings = new Set();
    walk(ast, (node) => { if (node.type === 'StringLiteral') strings.add(node.value); });
    const bindings = new Map();
    const imports = new Map();
    const imported = new Map();
    const exported = new Map();
    const functions = new Map();
    const module = { ast, bindings, imports, imported, exported, functions, file, strings };
    modules.set(file, module);
    walk(ast, (node) => {
      owners.set(node, module);
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') bindings.set(node.id.name, bindings.has(node.id.name) ? null : node.init);
      if (node.type === 'FunctionDeclaration' && node.id) functions.set(node.id.name, node);
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
  for (const { ast, imports, functions, file, strings } of modules.values()) {
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
    // Hand-written hash routing: literals compared with location.hash (directly or via a function parameter) or assigned to it.
    // `#/path` values belong to hash routers, which the router detection below already reads.
    const isHash = (node) => /^(?:window\.|document\.)?location\.hash$/.test(memberPath(node));
    const addHash = (value) => { value = value.replace(/^#/, ''); if (value && !value.startsWith('/')) hashRoutes.add(value); };
    const compared = (node, matches) => node.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(node.operator)
      ? matches(node.left) ? literal(node.right) : matches(node.right) ? literal(node.left) : undefined : undefined;
    const replacesState = (node) => {
      let found = false;
      walk(node, (child) => { if (child.type === 'CallExpression' && /(?:^|\.)history\.replaceState$/.test(memberPath(child.callee))) found = true; });
      return found;
    };
    const hashComparisons = (scope, matches) => walk(scope, (node) => {
      if (compared(node, matches) !== undefined) addHash(compared(node, matches));
      // `if (location.hash === '#old') history.replaceState(…)` marks a legacy alias.
      if (node.type === 'IfStatement' && ['===', '=='].includes(node.test.operator) && compared(node.test, matches) && replacesState(node.consequent)) hashAliases.add(compared(node.test, matches).replace(/^#/, ''));
      if (node.type === 'SwitchStatement' && matches(node.discriminant)) {
        for (const item of node.cases) if (item.test && literal(item.test) !== undefined) addHash(literal(item.test));
      }
    });
    hashComparisons(ast, isHash);
    walk(ast, (node) => {
      if (node.type === 'AssignmentExpression' && node.operator === '=' && isHash(node.left)) {
        const right = resolve(node.right);
        for (const value of right?.type === 'ConditionalExpression' ? [right.consequent, right.alternate] : [right]) {
          if (literal(value) !== undefined) addHash(literal(value));
          else if (!/^#?\//.test(value?.quasis?.[0].value.cooked ?? '')) pending.add(`location.hash set from an expression in ${file}`);
        }
      }
      const index = node.type === 'CallExpression' ? node.arguments.findIndex(isHash) : -1;
      if (index >= 0) {
        const target = resolve(node.callee);
        const fn = /Function/.test(target?.type ?? '') ? target : functions.get(node.callee.name);
        const param = fn?.params[index];
        if (param?.type === 'Identifier') hashComparisons(fn.body, (child) => child.type === 'Identifier' && child.name === param.name);
      }
    });
    jsx(ast);
    // Literal 4xx comparisons (`e.status === 404`) pair with literal API calls in the same innermost function.
    const scopes = [];
    const statusChecks = [];
    const apiCalls = [];
    walk(ast, (node) => {
      if (/Function|ObjectMethod|ClassMethod/.test(node.type)) scopes.push(node);
      const status = node.type === 'BinaryExpression' && ['===', '=='].includes(node.operator)
        && [[node.left, node.right], [node.right, node.left]].find(([member, value]) => member.type === 'MemberExpression' && !member.computed && member.property.name === 'status'
          && value.type === 'NumericLiteral' && value.value >= 400 && value.value <= 499)?.[1].value;
      if (status) statusChecks.push({ node, status });
      // Faults the app visibly handles: status checks, Retry-After, online/offline, parse failures caught.
      const isStatus = (member) => member?.type === 'MemberExpression' && !member.computed && member.property.name === 'status';
      const faultStatus = (value) => value?.type === 'NumericLiteral' && [401, 403, 429].includes(value.value) ? String(value.value) : null;
      const handles = (kind) => kind && evidence.faultKinds.push({ kind, file });
      if (node.type === 'BinaryExpression' && ['===', '=='].includes(node.operator)) handles((isStatus(node.left) && faultStatus(node.right)) || (isStatus(node.right) && faultStatus(node.left)));
      if (node.type === 'SwitchStatement' && isStatus(node.discriminant)) node.cases.forEach((item) => handles(faultStatus(item.test)));
      if (node.type === 'StringLiteral' && /^retry-after$/i.test(node.value)) handles('429');
      if ((node.type === 'CallExpression' && /(?:^|\.)addEventListener$/.test(memberPath(node.callee)) && ['online', 'offline'].includes(literal(node.arguments[0])))
        || (node.type === 'MemberExpression' && /(?:^|\.)navigator\.onLine$/.test(memberPath(node)))) handles('abort');
      if (node.type === 'TryStatement' && node.handler) {
        const calls = [];
        walk(node.block, (child) => { if (child.type === 'CallExpression') calls.push(memberPath(child.callee)); });
        if (calls.some((name) => /(?:^|\.)(?:json|JSON\.parse)$/.test(name))) handles('malformed');
        if (calls.some((name) => /(?:^|\.)fetch\w*$/i.test(name))) handles('abort'); // a caught fetch rejection is a dropped connection
      }
      if (/^playwright\.config\.[cm]?[jt]s$/.test(file) && node.type === 'ObjectProperty') {
        const key = node.key.name ?? node.key.value;
        const value = resolve(node.value);
        if (key === 'viewport') {
          const width = resolve(prop(value, 'width'))?.value;
          const height = resolve(prop(value, 'height'))?.value;
          if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) evidence.playwright.viewports.push({ width, height });
        }
        if (key === 'colorScheme' && ['light', 'dark'].includes(literal(value))) evidence.playwright.colorSchemes.push(literal(value));
        if (key === 'navigationTimeout' && value?.type === 'NumericLiteral' && value.value > 0) evidence.playwright.pageTimeoutMs = value.value;
      }
      if (apiEnv(node) && !evidence.api.some((item) => item.envVar === apiEnv(node))) evidence.api.push({ envVar: apiEnv(node), urls: [], file });
      if (node.type === 'VariableDeclarator' && !['ArrowFunctionExpression', 'FunctionExpression', 'ObjectExpression', 'ArrayExpression'].includes(node.init?.type)) {
        const envs = new Set();
        const urls = new Set();
        walk(node.init, (child) => {
          if (apiEnv(child)) envs.add(apiEnv(child));
          if (child.type === 'StringLiteral' && cleanUrl(child.value)) urls.add(cleanUrl(child.value));
        });
        for (const envVar of envs) {
          let item = evidence.api.find((candidate) => candidate.envVar === envVar);
          if (!item) { item = { envVar, urls: [], file }; evidence.api.push(item); }
          item.urls = [...new Set([...item.urls, ...urls])];
        }
      }
      if (node.type === 'VariableDeclarator') {
        const delays = resolve(node.init);
        if (/retry.*delay|backoff.*delay/i.test(node.id.name ?? '') && delays?.type === 'ArrayExpression'
          && delays.elements.length && delays.elements.every((item) => item?.type === 'NumericLiteral' && item.value >= 0 && item.value <= 60_000)) {
          evidence.retryDelays.push({ values: delays.elements.map((item) => item.value), file });
        }
      }
      if (node.type === 'CallExpression' && /^(?:window\.)?localStorage\.(?:getItem|setItem)$/.test(memberPath(node.callee))) {
        const key = literal(node.arguments[0]);
        if (key && /theme|color.?scheme/i.test(key) && strings.has('light') && strings.has('dark')) evidence.themeKeys.push({ key, file });
      }
      if (node.type === 'JSXElement') {
        for (const key of ['to', 'href']) {
          const value = literal(attr(node, key)?.value);
          if (value && /^(?:\/|#\/)/.test(value) && !value.startsWith('//')) evidence.routeSamples.push({ path: value, file });
        }
        if (/loading|spinner|progress/i.test(file)) {
          const classes = literal(attr(node, 'className')?.value) ?? literal(attr(node, 'class')?.value);
          for (const name of classes?.split(/\s+/) ?? []) if (/^[a-zA-Z_-][\w-]*$/.test(name) && /loading|spinner|progress/i.test(name)) evidence.loadingSelectors.push({ value: `[class~="${name}"]`, file });
        }
        const component = node.openingElement.name.name ?? '';
        if (/Error|Fallback|Alert/.test(component) || literal(attr(node, 'role')?.value) === 'alert') {
          for (const key of ['title', 'message']) {
            const value = literal(attr(node, key)?.value);
            if (value && value.length <= 200 && /couldn.t|unable|failed|error|something went wrong|unavailable/i.test(value)) evidence.errorText.push({ value, file });
          }
          for (const child of node.children) if (child.type === 'JSXText' && child.value.trim() && child.value.trim().length <= 200 && /couldn.t|unable|failed|error|something went wrong|unavailable/i.test(child.value)) evidence.errorText.push({ value: child.value.trim(), file });
        }
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
      if (node.type === 'CallExpression' && /fetch|request|^(?:get|post|put|patch|delete)$/i.test(node.callee.name ?? (node.callee.type === 'MemberExpression' && !node.callee.computed ? node.callee.property.name : ''))) {
        for (const arg of node.arguments.slice(0, 2)) {
          const text = literal(arg) ?? (arg.type === 'TemplateLiteral' ? arg.quasis[0].value.cooked : undefined);
          if (/^\/(?!\/)[\w-]/.test(text ?? '')) {
            evidence.relativeRequests.push({ path: text.split(/[?#]/)[0], file });
            const calleeName = node.callee.name ?? (node.callee.type === 'MemberExpression' && !node.callee.computed ? node.callee.property.name : '');
            const method = [literal(node.arguments[0]), literal(prop(node.arguments[1], 'method')), calleeName].map((value) => value?.toUpperCase())
              .find((value) => ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(value)) ?? 'GET';
            if (literal(arg) !== undefined || !text.endsWith('/')) apiCalls.push({ node, method, path: text.split(/[?#]/)[0] });
          }
        }
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
        if (/^vite\.config\.[cm]?[jt]s$/.test(file)) {
          const proxy = resolve(prop(resolve(prop(config, 'server')), 'proxy'));
          let unreadable = false;
          if (proxy && proxy.type !== 'ObjectExpression') unreadable = true;
          else for (const item of proxy?.properties ?? []) {
            const key = item.type === 'ObjectProperty' && !item.computed ? (item.key.type === 'Identifier' ? item.key.name : item.key.type === 'StringLiteral' ? item.key.value : undefined) : undefined;
            if (!key?.startsWith('/') || key === '/') { unreadable = true; continue; }
            evidence.proxy.push({ path: key.replace(/\/+$/, ''), target: cleanUrl(literal(item.value) ?? literal(prop(item.value, 'target'))), file });
          }
          if (unreadable) notes.push(`Could not statically read server.proxy in ${file}; configure web.api.paths manually.`);
        }
        outDir = literal(prop(resolve(prop(config, 'build')), 'outDir')) ?? literal(prop(config, 'outDir')) ?? outDir;
        if (file.startsWith('next.config') && literal(prop(config, 'output')) === 'export') staticExport = true;
        if (file.startsWith('astro.config') && ['server', 'hybrid'].includes(literal(prop(config, 'output')))) serverBuild = true;
      }
    });
    const scopeOf = (node) => scopes.filter((scope) => scope.start <= node.start && node.end <= scope.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    for (const { node, status } of statusChecks) {
      const scope = scopeOf(node);
      for (const call of scope ? apiCalls.filter((item) => scopeOf(item.node) === scope) : []) evidence.expectedStatuses.push({ method: call.method, path: call.path, status, file });
    }
  }
  if (frameworks.length) notes.unshift(`Detected frontend routing: ${[...new Set(frameworks)].join(', ')}.`);
  if (hash && browser) notes.push('Both hash and browser routers found; review route URL format.');
  const prefix = hash && !browser ? '#' : '';
  if (pending.size) notes.push(`Routes needing concrete sample URLs: ${[...pending].join(', ')}. Replace parameters/wildcards and add these routes manually.`);
  if (!routes.size) {
    routes.add('/');
    if (!hashRoutes.size) notes.push('No literal routes detected; using home only. Add routes manually for unsupported routers.');
  } else notes.push(`Detected ${routes.size} literal routes. Review query parameters and routes assembled across files.`);
  if (hashRoutes.size) notes.push(`Detected ${hashRoutes.size} hash routes from location.hash: ${[...hashRoutes].map((value) => `#${value}`).join(', ')}.${hashAliases.size ? ` Drop legacy aliases the app rewrites with history.replaceState: ${[...hashAliases].map((value) => `#${value}`).join(', ')}.` : ''}`);
  return { base, outDir, staticExport, serverBuild, evidence, hashAliases: [...hashAliases].map((value) => `/#${value}`), patterns: [...routes, ...pending].filter((route) => route.startsWith('/')), routes: [...routes].map((route) => ({ name: route === '/' ? 'home' : route.slice(1).replace(/[^\w-]+/g, '-'), path: `${prefix}${prefix ? hashBasename : ''}${route}` }))
    .concat([...hashRoutes].map((value) => ({ name: value.replace(/[^\w-]+/g, '-'), path: `/#${value}` }))), notes };
}
