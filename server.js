const http = require('node:http');
const handler = require('./api');

function createServer(apiHandler = handler) {
  return http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (pathname === '/healthz' && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      Promise.resolve(apiHandler(req, res)).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server error.' }));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found.' }));
  });
}

if (require.main === module) {
  for (const name of ['MONGODB_URI', 'JWT_SECRET']) {
    if (!process.env[name] || (name === 'JWT_SECRET' && process.env[name].length < 32)) {
      console.error(`${name} must be configured${name === 'JWT_SECRET' ? ' with at least 32 characters' : ''}.`);
      process.exit(1);
    }
  }
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`Barber Co API listening on port ${port}`));
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createServer };
