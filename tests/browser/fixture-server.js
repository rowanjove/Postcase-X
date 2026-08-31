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

// Keep the preview server limited to explicitly required browser resources.
// Repository metadata, tests, dependencies, and arbitrary local files are not served.
const staticResources = new Map([
  'ui-tokens.css', 'content.css', 'content-selectors.js', 'content-core.js',
  'content-export.js', 'content.js', 'jszip.min.js', 'popup.css', 'popup.js',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
].map((name) => [`/${name}`, path.join(projectRoot, name)]));
staticResources.set('/__fixture__/popup-fixture.js', path.join(__dirname, 'popup-fixture.js'));

function fixtureLocale(url) {
  return url.searchParams.get('lang') === 'zh_CN' ? 'zh_CN' : 'en';
}

function fixtureTheme(url) {
  const theme = url.searchParams.get('theme');
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

function localeScript(locale) {
  const messages = JSON.parse(
    fs.readFileSync(path.join(projectRoot, '_locales', locale, 'messages.json'), 'utf8')
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
  const language = locale === 'zh_CN' ? 'zh-CN' : 'en-US';
  return `window.__XPD_MESSAGES__ = ${JSON.stringify(messages)};\n`
    + `window.__XPD_LANGUAGE__ = ${JSON.stringify(language)};\n`
    + `window.__XPD_MANIFEST__ = ${JSON.stringify(manifest)};\n`;
}

function themeStylesheet(theme) {
  if (theme === 'system') return '/* Preview uses the system color scheme. */';
  const source = fs.readFileSync(path.join(projectRoot, 'ui-tokens.css'), 'utf8');
  const blocks = [...source.matchAll(/\.xpd-surface\s*\{([^}]+)\}/g)];
  const declarations = blocks[theme === 'dark' ? 1 : 0]?.[1];
  if (!declarations) throw new Error('Shared theme tokens are missing');
  return `/* Local preview override, copied from the production ${theme} tokens. */\n`
    + `.xpd-surface {${declarations}}\n`;
}

function rootFixture(url) {
  const locale = fixtureLocale(url);
  const theme = fixtureTheme(url);
  return fs.readFileSync(fixturePath, 'utf8')
    .replace('lang="en"', `lang="${locale === 'zh_CN' ? 'zh-CN' : 'en'}"`)
    .replace('/__fixture__/locale.js', `/__fixture__/locale.js?lang=${locale}`)
    .replace('/__fixture__/theme.css', `/__fixture__/theme.css?theme=${theme}`);
}

function popupFixture(url) {
  const locale = fixtureLocale(url);
  const theme = fixtureTheme(url);
  const injected = [
    `<link rel="stylesheet" href="/__fixture__/theme.css?theme=${theme}">`,
    `<script src="/__fixture__/locale.js?lang=${locale}"></script>`,
    '<script src="/__fixture__/popup-fixture.js"></script>',
  ].join('\n  ');
  return fs.readFileSync(path.join(projectRoot, 'popup.html'), 'utf8')
    .replace('<head>', '<head>\n  <base href="/">')
    .replace('</head>', `  ${injected}\n</head>`);
}

function serve(request, response, contentType, body, status = 200) {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    serve(request, response, 'text/plain; charset=utf-8', 'Method not allowed', 405);
    return;
  }
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    if (pathname === '/') {
      serve(request, response, contentTypes.get('.html'), rootFixture(url));
      return;
    }
    if (pathname === '/__fixture__/popup.html') {
      serve(request, response, contentTypes.get('.html'), popupFixture(url));
      return;
    }
    if (pathname === '/__fixture__/locale.js' || pathname === '/__fixture__/locale-en.js') {
      const locale = pathname.endsWith('locale-en.js') ? 'en' : fixtureLocale(url);
      serve(request, response, contentTypes.get('.js'), localeScript(locale));
      return;
    }
    if (pathname === '/__fixture__/theme.css') {
      serve(request, response, contentTypes.get('.css'), themeStylesheet(fixtureTheme(url)));
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
      serve(request, response, contentTypes.get('.js'), source);
      return;
    }
    const filePath = staticResources.get(pathname);
    if (filePath) {
      serve(request, response, contentTypes.get(path.extname(filePath)), fs.readFileSync(filePath));
      return;
    }
    serve(request, response, 'text/plain; charset=utf-8', 'Not found', 404);
  } catch {
    serve(request, response, 'text/plain; charset=utf-8', 'Fixture response failed', 500);
  }
});

server.listen(requestedPort, '127.0.0.1', () => {
  console.log(`XPD browser fixture: http://127.0.0.1:${server.address().port}/`);
});

let shuttingDown = false;
function shutdownFixtureServer() {
  if (shuttingDown) return;
  shuttingDown = true;
  // Playwright can leave keep-alive sockets open after the final assertion.
  // Close them before waiting for the server callback so `npm run test:browser`
  // can terminate cleanly on both Windows and Unix hosts.
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdownFixtureServer);
