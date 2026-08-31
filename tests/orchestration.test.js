const test = require('node:test');
const assert = require('node:assert/strict');

const { createBaseContext, loadScript } = require('./helpers/load-extension-module');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function loadOrchestrator({ download, writeText, fallbackSucceeds = true } = {}) {
  const listeners = [];
  const messages = [];
  const calls = {
    begin: 0, end: 0, nativeCopies: 0, fallbackCopies: 0,
    results: [], toasts: [], diagnosticStates: [],
  };
  const core = {
    detectArticlePage: () => true,
    getSourceUrl: () => 'https://x.com/i/article/123',
    extractArticle: () => ({ blocks: [], author: {}, time: '' }),
    validateExtracted: () => {},
    contentBlocksToPlainText: () => '',
    collectImageUrlsFromBlocks: () => [],
    createPostDocument: (documentModel) => documentModel,
    deriveTitleFromBlocks: () => 'Fixture',
    serializeDiagnosticReport: () => '{"privacy":{"includesBodyText":false}}',
  };
  const ui = {
    beginUiWork: () => { calls.begin += 1; },
    endUiWork: () => { calls.end += 1; },
    evaluatePageAvailability: () => ({ ready: true, kindLabel: 'Article' }),
    updateProgressText: () => {},
    initFloatingUi: () => {},
    startUrlWatcher: () => {},
    schedulePanelStatusRefresh: () => {},
    refreshPanelStatus: () => {},
    showResult: (type, text) => { calls.results.push({ type, text }); },
    showToast: (type, text) => { calls.toasts.push({ type, text }); },
    setDiagnosticBusy: (busy) => { calls.diagnosticStates.push(busy); },
  };
  const xpd = {
    core,
    ui,
    exp: {
      downloadAsEmbed: download || (async () => ({})),
      buildMarkdownAsLink: () => 'Fixture Markdown',
    },
  };
  const context = createBaseContext({
    window: { _XPD: xpd },
    document: {
      activeElement: { focus: () => {} },
      createElement: () => ({
        style: {}, setAttribute() {}, focus() {}, select() {}, remove() {},
      }),
      body: { appendChild() {} },
      execCommand: () => { calls.fallbackCopies += 1; return fallbackSucceeds; },
    },
    globals: {
      AbortController,
      navigator: { clipboard: { writeText: (...args) => {
        calls.nativeCopies += 1;
        return (writeText || (async () => {}))(...args);
      } } },
      console: { log() {}, warn() {}, error() {} },
      chrome: { runtime: {
        id: 'fixture-extension',
        sendMessage: (message) => { messages.push(message); return Promise.resolve(); },
        onMessage: { addListener: (listener) => listeners.push(listener) },
      } },
    },
  });
  loadScript(context, 'content.js');
  const listener = listeners[0];
  const sender = { id: 'fixture-extension' };
  return {
    xpd, calls, messages,
    send: (message) => new Promise((resolve) => listener(message, sender, resolve)),
    ping: () => {
      let response;
      listener({ type: 'PING' }, sender, (value) => { response = value; });
      return response;
    },
  };
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

test('PING and broadcasts expose a floating export while a popup reconnects', async () => {
  const pending = deferred();
  const fixture = loadOrchestrator({ download: () => pending.promise });
  assert.equal(fixture.ping().busy, false);

  const operation = fixture.xpd.handleExtractAndDownload({}, 'embed');
  await flushPromises();
  const active = fixture.ping();
  assert.equal(active.ok, true);
  assert.equal(active.busy, true);
  assert.equal(active.cancelling, false);
  assert.equal(active.action, 'download');
  assert.equal(active.protocolVersion, 1);
  assert.match(active.taskId, /^export-/);
  const activeTaskId = active.taskId;
  const activeRevision = active.revision;
  assert.equal(typeof active.progressText, 'string');
  assert.equal(fixture.calls.begin, 1);
  assert.ok(fixture.messages.some((message) =>
    message.type === 'XPD_EXPORT_STATE' && message.busy && message.action === 'download'
  ));

  pending.resolve({ warning: 'One image stayed remote' });
  assert.equal((await operation).success, true);
  const completed = fixture.messages.filter((message) => message.type === 'XPD_EXPORT_STATE').at(-1);
  assert.equal(completed.busy, false);
  assert.equal(completed.taskId, activeTaskId);
  assert.ok(completed.revision > activeRevision);
  assert.equal(completed.protocolVersion, 1);
  assert.equal(completed.result.success, true);
  assert.equal(completed.result.warning, 'One image stayed remote');
  assert.equal(fixture.ping().busy, false);
  assert.equal(fixture.calls.end, 1);
  assert.deepEqual(fixture.calls.results, [{ type: 'warning', text: 'One image stayed remote' }]);
  assert.deepEqual(fixture.calls.toasts, fixture.calls.results);
});

test('a rejected popup request does not clear a running floating export or its busy state', async () => {
  const pending = deferred();
  const fixture = loadOrchestrator({ download: () => pending.promise });
  const running = fixture.xpd.handleExtractAndDownload({}, 'embed');
  await flushPromises();
  const messagesBeforeDuplicate = fixture.messages.length;

  const duplicate = await fixture.send({ type: 'EXTRACT_AND_COPY', options: {} });
  await flushPromises();
  assert.equal(duplicate.success, false);
  assert.equal(fixture.ping().busy, true);
  assert.equal(fixture.ping().action, 'download');
  assert.equal(fixture.calls.begin, 1);
  assert.equal(fixture.calls.end, 0);
  assert.equal(fixture.calls.results.length, 0);
  assert.equal(fixture.calls.toasts.length, 0);
  assert.equal(fixture.messages.slice(messagesBeforeDuplicate).some((message) =>
    message.type === 'XPD_EXPORT_STATE' && !message.busy
  ), false);

  pending.resolve({});
  await running;
  assert.equal(fixture.calls.end, 1);
  assert.equal(fixture.calls.results.length, 1);
  assert.equal(fixture.calls.results[0].type, 'success');
  assert.deepEqual(fixture.calls.toasts, fixture.calls.results);
});

test('popup-started work owns exactly one UI busy lifecycle and broadcasts failure', async () => {
  const pending = deferred();
  const fixture = loadOrchestrator({ download: () => pending.promise });
  const response = fixture.send({ type: 'EXTRACT_AND_DOWNLOAD', mode: 'embed', options: {} });
  await flushPromises();
  assert.equal(fixture.calls.begin, 1);
  assert.equal(fixture.ping().busy, true);

  pending.reject(new Error('Fixture export failed'));
  const result = await response;
  await flushPromises();
  assert.equal(result.success, false);
  assert.equal(fixture.calls.end, 1);
  assert.equal(fixture.ping().busy, false);
  const completed = fixture.messages.filter((message) => message.type === 'XPD_EXPORT_STATE').at(-1);
  assert.equal(completed.busy, false);
  assert.equal(completed.result.success, false);
  assert.equal(completed.result.error, 'Fixture export failed');
  assert.deepEqual(fixture.calls.results, [{ type: 'error', text: 'Fixture export failed' }]);
  assert.deepEqual(fixture.calls.toasts, fixture.calls.results);
});

for (const clipboardOutcome of ['resolve', 'reject']) {
  test(`copy cancellation does not enter the fallback when native clipboard later ${clipboardOutcome}s`, async () => {
    const clipboard = deferred();
    const fixture = loadOrchestrator({ writeText: () => clipboard.promise, fallbackSucceeds: false });
    const operation = fixture.xpd.handleExtractAndCopy({});
    await flushPromises();

    assert.equal(fixture.xpd.cancelActiveExport(), true);
    assert.equal(fixture.ping().cancelling, true);
    assert.equal(fixture.ping().action, 'copy');
    clipboard[clipboardOutcome](new Error('Clipboard unavailable'));
    await assert.rejects(operation, (error) => error.code === 'EXPORT_CANCELLED');

    assert.equal(fixture.calls.fallbackCopies, 0);
    assert.equal(fixture.calls.begin, 1);
    assert.equal(fixture.calls.end, 1);
    assert.equal(fixture.ping().busy, false);
    const completed = fixture.messages.filter((message) => message.type === 'XPD_EXPORT_STATE').at(-1);
    assert.equal(completed.result.cancelled, true);
    assert.equal(fixture.calls.results.length, 1);
    assert.equal(fixture.calls.results[0].type, 'warning');
    assert.deepEqual(fixture.calls.toasts, fixture.calls.results);
  });
}

for (const clipboardOutcome of ['resolve', 'reject']) {
  test(`a pending diagnostic excludes other clipboard/export jobs and unlocks after ${clipboardOutcome}`, async () => {
    const clipboard = deferred();
    const fixture = loadOrchestrator({ writeText: () => clipboard.promise, fallbackSucceeds: false });
    assert.equal(fixture.ping().diagnosing, false);

    const operation = fixture.xpd.copyDiagnosticReport();
    assert.equal(fixture.ping().diagnosing, true);
    assert.equal(fixture.ping().busy, false);
    assert.equal(fixture.calls.nativeCopies, 1);

    await assert.rejects(fixture.xpd.copyDiagnosticReport());
    await assert.rejects(
      fixture.xpd.handleExtractAndDownload({}, 'embed'),
      (error) => error.code === 'EXPORT_BUSY'
    );
    await assert.rejects(
      fixture.xpd.handleExtractAndCopy({}),
      (error) => error.code === 'EXPORT_BUSY'
    );
    assert.equal(fixture.calls.nativeCopies, 1);
    assert.equal(fixture.calls.fallbackCopies, 0);
    assert.equal(fixture.calls.begin, 0);
    assert.equal(fixture.ping().diagnosing, true);

    clipboard[clipboardOutcome](new Error('Fixture diagnostic failed'));
    if (clipboardOutcome === 'reject') await assert.rejects(operation, /copy command returned false/);
    else assert.equal((await operation).success, true);
    assert.equal(fixture.ping().diagnosing, false);
    assert.deepEqual(fixture.calls.diagnosticStates, [true, false]);
    const states = fixture.messages.filter((message) => message.type === 'XPD_EXPORT_STATE');
    assert.equal(states[0].diagnosing, true);
    assert.equal(states.at(-1).diagnosing, false);
    assert.equal(states.some((message) => message.result), false);

    assert.equal((await fixture.xpd.handleExtractAndDownload({}, 'embed')).success, true);
    assert.equal(fixture.calls.begin, 1);
    assert.equal(fixture.calls.end, 1);
  });
}

test('an active export prevents diagnostics from writing to the clipboard', async () => {
  const pending = deferred();
  const fixture = loadOrchestrator({ download: () => pending.promise });
  const operation = fixture.xpd.handleExtractAndDownload({}, 'embed');
  await flushPromises();
  await assert.rejects(fixture.xpd.copyDiagnosticReport());
  assert.equal(fixture.calls.nativeCopies, 0);
  assert.equal(fixture.ping().diagnosing, false);
  assert.equal(fixture.ping().busy, true);
  pending.resolve({});
  await operation;
});
