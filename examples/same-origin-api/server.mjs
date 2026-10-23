// Tiny seeded API for the example: node server.mjs (PORT, default 4010).
// /api/* requires the x-api-token header to equal EXAMPLE_API_TOKEN.
import { createServer } from 'node:http';

const items = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }];
const token = process.env.EXAMPLE_API_TOKEN;

createServer((request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  if (pathname === '/health') return send(200, { ok: true });
  if (!token || request.headers['x-api-token'] !== token) return send(401, { error: 'missing or wrong x-api-token' });
  if (pathname === '/api/items') return send(200, items);
  if (pathname === '/api/summary') return send(200, { count: items.length });
  return send(404, { error: 'not found' });
}).listen(Number(process.env.PORT ?? 4010), '127.0.0.1');
