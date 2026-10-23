// Example API that needs the Compose data service: node server.mjs (PORT, default 4020).
// /health answers 200 only once the data service responds.
import { createServer } from 'node:http';

const dataUrl = process.env.DATA_URL ?? 'http://127.0.0.1:4021/items.json';
const items = async () => {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`data service answered ${response.status}`);
  return response.json();
};

createServer(async (request, response) => {
  const send = (status, body) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };
  const { pathname } = new URL(request.url, 'http://localhost');
  try {
    if (pathname === '/health') return send(200, { items: (await items()).length });
    if (pathname === '/api/items') return send(200, await items());
    return send(404, { error: 'not found' });
  } catch (error) {
    return send(503, { error: error.message });
  }
}).listen(Number(process.env.PORT ?? 4020), '127.0.0.1');
