const test = require('node:test');
const assert = require('node:assert/strict');

const { createBaseContext, loadScript } = require('./helpers/load-extension-module');

function loadBackground(fetchImpl, globals = {}) {
  const listeners = [];
  const tabRemovedListeners = [];
  const tabUpdatedListeners = [];
  const context = createBaseContext({
    globals: {
      chrome: {
        runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } },
        tabs: {
          onRemoved: { addListener: (listener) => tabRemovedListeners.push(listener) },
          onUpdated: { addListener: (listener) => tabUpdatedListeners.push(listener) },
        },
      },
      fetch: fetchImpl,
      AbortController,
      setTimeout,
      clearTimeout,
      btoa,
      Uint8Array,
      ...globals,
    },
  });
  loadScript(context, 'background.js');
  context.backgroundListeners = listeners;
  context.tabRemovedListeners = tabRemovedListeners;
  context.tabUpdatedListeners = tabUpdatedListeners;
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

test('background upgrades media sizes independently of query parameter order', async () => {
  const requestedUrls = [];
  const context = loadBackground(async (url) => {
    requestedUrls.push(new URL(url));
    return {
      ok: true,
      url,
      headers: responseHeaders({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => Uint8Array.from([1]).buffer,
    };
  });
  await context.fetchAsBase64('https://pbs.twimg.com/media/example?name=small&format=jpg');
  await context.fetchAsBase64('https://pbs.twimg.com/media/example?format=jpg&name=small');
  await context.fetchAsBase64('https://pbs.twimg.com/media/example?format=jpg');
  for (const url of requestedUrls) {
    assert.equal(url.searchParams.get('name'), 'large');
    assert.equal(url.searchParams.get('format'), 'jpg');
    assert.equal(url.searchParams.getAll('name').length, 1);
  }
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

test('background cancellation handles fetch rejecting with the custom abort reason', async () => {
  const context = loadBackground((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const listener = context.backgroundListeners[0];
  const sender = { tab: { id: 42, url: 'https://x.com/alice/status/123' } };
  const fetchResponse = new Promise((resolve) => listener({
    type: 'FETCH_IMAGE',
    url: 'https://pbs.twimg.com/media/example',
    requestId: 'custom-reason',
  }, sender, resolve));

  listener({ type: 'CANCEL_IMAGE_FETCH', requestId: 'custom-reason' }, sender, () => {});

  const response = await fetchResponse;
  assert.equal(response.success, false);
  assert.equal(response.cancelled, true);
  assert.equal(response.error, 'Image fetch cancelled');
});

test('background timeout gives a useful error when fetch rejects with signal.reason', async () => {
  let fireTimeout;
  const context = loadBackground((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), {
    setTimeout: (callback) => { fireTimeout = callback; return 1; },
    clearTimeout: () => {},
  });
  const operation = context.fetchAsBase64('https://pbs.twimg.com/media/example');
  fireTimeout();
  await assert.rejects(operation, /Image fetch timed out/);
});

test('cancelling an image request leaves the same request id in another tab running', async () => {
  const requests = new Map();
  const context = loadBackground((url, { signal }) => new Promise((resolve, reject) => {
    requests.set(new URL(url).pathname, { signal, resolve });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const listener = context.backgroundListeners[0];
  const senderA = { tab: { id: 41, url: 'https://x.com/alice/status/123' } };
  const senderB = { tab: { id: 42, url: 'https://x.com/bob/status/456' } };
  const startFetch = (sender, suffix) => new Promise((resolve) => listener({
    type: 'FETCH_IMAGE',
    url: `https://pbs.twimg.com/media/${suffix}`,
    requestId: 'shared-id',
  }, sender, resolve));
  const fetchA = startFetch(senderA, 'tab-a');
  const fetchB = startFetch(senderB, 'tab-b');

  listener({ type: 'CANCEL_IMAGE_FETCH', requestId: 'shared-id' }, senderA, () => {});

  assert.equal(requests.get('/media/tab-a').signal.aborted, true);
  assert.equal(requests.get('/media/tab-b').signal.aborted, false);
  requests.get('/media/tab-b').resolve({
    ok: true,
    url: 'https://pbs.twimg.com/media/tab-b',
    headers: responseHeaders({ 'content-type': 'image/png' }),
    arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
  });
  assert.equal((await fetchA).cancelled, true);
  assert.equal((await fetchB).success, true);
});

test('background queues image fetches across tabs instead of multiplying per-tab concurrency', async () => {
  const pending = [];
  const context = loadBackground((_url, { signal }) => new Promise((resolve, reject) => {
    pending.push({ resolve, reject, signal });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const listener = context.backgroundListeners[0];
  const startFetch = (tabId, index) => new Promise((resolve) => listener({
    type: 'FETCH_IMAGE',
    url: `https://pbs.twimg.com/media/tab-${tabId}-${index}`,
    requestId: `request-${tabId}-${index}`,
  }, { tab: { id: tabId, url: 'https://x.com/alice/status/123' } }, resolve));

  const active = Array.from({ length: 6 }, (_, index) => startFetch(index + 1, 1));
  await new Promise((resolve) => setImmediate(resolve));
  const queued = startFetch(7, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 6);

  const response = {
    ok: true,
    url: 'https://pbs.twimg.com/media/allowed',
    headers: responseHeaders({ 'content-type': 'image/png' }),
    arrayBuffer: async () => Uint8Array.from([1]).buffer,
  };
  pending[0].resolve(response);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 7);
  const stats = context.getImageFetchQueueStats();
  assert.equal(stats.maxQueueDepth, 1);
  assert.equal(stats.queuedCompleted, 1);
  assert.equal(stats.rejected, 0);

  for (const request of pending.slice(1)) {
    request.resolve({
      ...response,
      arrayBuffer: async () => Uint8Array.from([1]).buffer,
    });
  }
  assert.equal((await queued).success, true);
  assert.equal((await Promise.all(active)).every((result) => result.success), true);
});

test('background cancels queued image fetches before they consume a slot', async () => {
  const pending = [];
  const context = loadBackground((_url, { signal }) => new Promise((resolve, reject) => {
    pending.push({ resolve, reject, signal });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const listener = context.backgroundListeners[0];
  const startFetch = (tabId, index) => new Promise((resolve) => listener({
    type: 'FETCH_IMAGE',
    url: `https://pbs.twimg.com/media/queued-${tabId}-${index}`,
    requestId: `queued-${tabId}-${index}`,
  }, { tab: { id: tabId, url: 'https://x.com/alice/status/123' } }, resolve));

  const active = Array.from({ length: 6 }, (_, index) => startFetch(index + 1, 1));
  await new Promise((resolve) => setImmediate(resolve));
  const queued = startFetch(7, 1);
  await new Promise((resolve) => setImmediate(resolve));
  let cancelResponse;
  listener({ type: 'CANCEL_IMAGE_FETCH', requestId: 'queued-7-1' }, {
    tab: { id: 7, url: 'https://x.com/alice/status/123' },
  }, (response) => { cancelResponse = response; });

  assert.deepEqual({ ...cancelResponse }, { success: true, cancelled: true });
  const queuedResponse = await queued;
  assert.deepEqual({ ...queuedResponse }, {
    success: false,
    cancelled: true,
    error: 'Image fetch cancelled',
  });
  assert.equal(pending.length, 6);
  for (const request of pending) {
    request.resolve({
      ok: true,
      url: 'https://pbs.twimg.com/media/allowed',
      headers: responseHeaders({ 'content-type': 'image/png' }),
      arrayBuffer: async () => Uint8Array.from([1]).buffer,
    });
  }
  assert.equal((await Promise.all(active)).every((result) => result.success), true);
});

test('background applies backpressure when the global image queue is full', async () => {
  const pending = [];
  const context = loadBackground((_url, { signal }) => new Promise((resolve, reject) => {
    pending.push({ resolve, reject, signal });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const listener = context.backgroundListeners[0];
  const startFetch = (tabId, index) => new Promise((resolve) => listener({
    type: 'FETCH_IMAGE',
    url: `https://pbs.twimg.com/media/backpressure-${tabId}-${index}`,
    requestId: `backpressure-${tabId}-${index}`,
  }, { tab: { id: tabId, url: 'https://x.com/alice/status/123' } }, resolve));

  const active = Array.from({ length: 6 }, (_, index) => startFetch(index + 1, 1));
  await new Promise((resolve) => setImmediate(resolve));
  const queued = Array.from({ length: 96 }, (_, index) => startFetch(7, index));
  await new Promise((resolve) => setImmediate(resolve));
  const rejected = await startFetch(8, 0);
  assert.deepEqual({ ...rejected }, {
    success: false,
    error: 'Image fetch queue is full',
  });
  const stats = context.getImageFetchQueueStats();
  assert.equal(stats.maxQueueDepth, 96);
  assert.equal(stats.rejected, 1);
  assert.equal(pending.length, 6);

  context.tabRemovedListeners.forEach((handler) => handler(7));
  const queuedResults = await Promise.all(queued);
  assert.equal(queuedResults.every((result) => result.cancelled), true);
  for (const request of pending) {
    request.resolve({
      ok: true,
      url: 'https://pbs.twimg.com/media/allowed',
      headers: responseHeaders({ 'content-type': 'image/png' }),
      arrayBuffer: async () => Uint8Array.from([1]).buffer,
    });
  }
  assert.equal((await Promise.all(active)).every((result) => result.success), true);
});

test('background cancels requests when a tab is removed or starts navigating', async () => {
  const pending = new Map();
  const context = loadBackground((_url, { signal }) => new Promise((resolve, reject) => {
    const key = String(pending.size + 1);
    pending.set(key, { signal, resolve, reject });
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const listener = context.backgroundListeners[0];
  const sender = { tab: { id: 42, url: 'https://x.com/alice/status/123' } };
  const first = new Promise((resolve) => listener({
    type: 'FETCH_IMAGE', url: 'https://pbs.twimg.com/media/first', requestId: 'first',
  }, sender, resolve));
  await new Promise((resolve) => setImmediate(resolve));
  context.tabUpdatedListeners.forEach((handler) => handler(42, { status: 'loading' }));
  assert.equal([...pending.values()][0].signal.aborted, true);
  assert.equal((await first).cancelled, true);

  const second = new Promise((resolve) => listener({
    type: 'FETCH_IMAGE', url: 'https://pbs.twimg.com/media/second', requestId: 'second',
  }, sender, resolve));
  await new Promise((resolve) => setImmediate(resolve));
  context.tabRemovedListeners.forEach((handler) => handler(42));
  assert.equal([...pending.values()][1].signal.aborted, true);
  assert.equal((await second).cancelled, true);
});

test('background reads streamed image bytes in order', async () => {
  const chunks = [Uint8Array.from([1]), Uint8Array.from([2, 3])];
  let released = false;
  const context = loadBackground(async () => ({
    ok: true,
    url: 'https://pbs.twimg.com/media/example',
    headers: responseHeaders({ 'content-type': 'image/png' }),
    body: { getReader: () => ({
      read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true },
      releaseLock: () => { released = true; },
    }) },
    arrayBuffer: () => { throw new Error('The stream must not be buffered without a limit'); },
  }));

  const response = await context.fetchAsBase64('https://pbs.twimg.com/media/example');
  assert.equal(response.base64, 'AQID');
  assert.equal(released, true);
});

test('background stops an oversized stream without relying on Content-Length', async () => {
  let readCount = 0;
  let cancelled = false;
  let released = false;
  const context = loadBackground(async () => ({
    ok: true,
    url: 'https://pbs.twimg.com/media/example',
    headers: responseHeaders({ 'content-type': 'image/png' }),
    body: { getReader: () => ({
      read: async () => {
        readCount += 1;
        return { done: false, value: new Uint8Array(16 * 1024 * 1024) };
      },
      cancel: async () => { cancelled = true; },
      releaseLock: () => { released = true; },
    }) },
    arrayBuffer: () => { throw new Error('The stream must not be buffered without a limit'); },
  }));

  await assert.rejects(
    context.fetchAsBase64('https://pbs.twimg.com/media/example'),
    /Image exceeds 25 MB limit/
  );
  assert.equal(readCount, 2);
  assert.equal(cancelled, true);
  assert.equal(released, true);
});
