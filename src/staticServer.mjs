import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

/**
 * Serves a built single-page app from `rootDir` under `basePath` on a random
 * local port. Paths without a file extension fall back to index.html.
 * Resolves with { origin, close }.
 */
export async function startStaticServer(rootDir, basePath = '/') {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (!pathname.startsWith(base) && `${pathname}/` !== base) return sendNotFound(response);
    const relativePath = decodeURIComponent(pathname.slice(base.length));
    const filePath = path.join(rootDir, relativePath);
    if (!filePath.startsWith(rootDir)) return sendNotFound(response);

    const fileStats = await stat(filePath).catch(() => null);
    if (fileStats?.isFile()) return sendFile(response, filePath);
    if (!path.extname(relativePath)) return sendFile(response, path.join(rootDir, 'index.html'));
    return sendNotFound(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sendFile(response, filePath) {
  response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
}

function sendNotFound(response) {
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('Not found');
}
