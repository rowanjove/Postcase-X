const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(__dirname, 'fixture.html');
const requestedPort = Number(process.env.XPD_FIXTURE_PORT || 4173);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
]);

function resolveRequestPath(url) {
  const pathname = new URL(url, 'http://127.0.0.1').pathname;
  if (pathname === '/') return fixturePath;

  const relativePath = pathname.replace(/^\/+/, '');
  const candidate = path.resolve(projectRoot, relativePath);
  const relativeToRoot = path.relative(projectRoot, candidate);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return null;
  return candidate;
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  if (pathname === '/__fixture__/locale-en.js') {
    const messages = JSON.parse(
      fs.readFileSync(path.join(projectRoot, '_locales', 'en', 'messages.json'), 'utf8')
    );
    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(`window.__XPD_MESSAGES__ = ${JSON.stringify(messages)};`);
    return;
  }

  if (pathname === '/__fixture__/content-ui.js') {
    const source = fs.readFileSync(path.join(projectRoot, 'content-ui.js'), 'utf8')
      .replaceAll(
        'if (!event?.isTrusted) return;',
        'if (!event?.isTrusted && !window.__XPD_FIXTURE__) return;'
      )
      .replaceAll(
        'if (!event.isTrusted) return;',
        'if (!event.isTrusted && !window.__XPD_FIXTURE__) return;'
      );
    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(source);
    return;
  }

  const filePath = resolveRequestPath(request.url || '/');
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const contentType = contentTypes.get(path.extname(filePath)) || 'application/octet-stream';
  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(requestedPort, '127.0.0.1', () => {
  console.log(`XPD browser fixture: http://127.0.0.1:${requestedPort}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
