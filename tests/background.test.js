const test = require('node:test');
const assert = require('node:assert/strict');

const { createBaseContext, loadScript } = require('./helpers/load-extension-module');

function loadBackground(fetchImpl) {
  const listeners = [];
  const context = createBaseContext({
    globals: {
      chrome: { runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } } },
      fetch: fetchImpl,
      AbortController,
      setTimeout,
      clearTimeout,
      btoa,
      Uint8Array,
    },
  });
  loadScript(context, 'background.js');
  context.backgroundListeners = listeners;
  return context;
}

function responseHeaders(values) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return { get: (name) => normalized.get(name.toLowerCase()) || null };
}

test('background image fetch omits credentials and accepts an allowed raster image', async () => {
  let requestOptions;
  const context = loadBackground(async (_url, options) => {
    requestOptions = options;
    return {
      ok: true,
      status: 200,
      url: 'https://pbs.twimg.com/media/example?format=png&name=large',
      headers: responseHeaders({ 'content-type': 'image/png', 'content-length': 3 }),
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    };
  });

  const result = await context.fetchAsBase64(
    'https://pbs.twimg.com/media/example?format=png&name=small'
  );
  assert.equal(requestOptions.credentials, 'omit');
  assert.equal(result.contentType, 'image/png');
  assert.equal(result.base64, 'AQID');
});

test('background image fetch rejects non-image responses', async () => {
  const context = loadBackground(async () => ({
    ok: true,
    status: 200,
    url: 'https://pbs.twimg.com/media/example',
    headers: responseHeaders({ 'content-type': 'text/html' }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }));

  await assert.rejects(
    context.fetchAsBase64('https://pbs.twimg.com/media/example'),
    /Unsupported image type/
  );
});

test('background image fetch rejects redirects outside the allowlist', async () => {
  const context = loadBackground(async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/image.jpg',
    headers: responseHeaders({ 'content-type': 'image/jpeg' }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }));

  await assert.rejects(
    context.fetchAsBase64('https://pbs.twimg.com/media/example'),
    /Redirected outside allowed hosts/
  );
});

test('background cancellation aborts an active image fetch', async () => {
  const context = loadBackground((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  }));
  const listener = context.backgroundListeners[0];
  const sender = { tab: { id: 42, url: 'https://x.com/alice/status/123' } };

  const fetchResponse = new Promise((resolve) => {
    assert.equal(listener({
      type: 'FETCH_IMAGE',
      url: 'https://pbs.twimg.com/media/example',
      requestId: 'request-1',
    }, sender, resolve), true);
  });

  let cancelResponse;
  assert.equal(listener({
    type: 'CANCEL_IMAGE_FETCH',
    requestId: 'request-1',
  }, sender, (response) => { cancelResponse = response; }), false);

  assert.deepEqual({ ...cancelResponse }, { success: true, cancelled: true });
  const response = await fetchResponse;
  assert.equal(response.success, false);
  assert.equal(response.cancelled, true);
});
