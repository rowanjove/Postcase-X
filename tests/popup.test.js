const test = require('node:test');
const assert = require('node:assert/strict');

const { createBaseContext, loadScript } = require('./helpers/load-extension-module');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function element(dataset = {}) {
  const attributes = new Map();
  const listeners = new Map();
  const node = {
    dataset,
    className: '',
    textContent: '',
    disabled: false,
    hidden: false,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
    removeAttribute: (name) => attributes.delete(name),
    addEventListener: (event, listener) => listeners.set(event, listener),
    click: () => node.disabled ? undefined : listeners.get('click')?.(),
  };
  node.classList = {
    toggle(name, force) {
      const classes = new Set(node.className.split(' ').filter(Boolean));
      if (force) classes.add(name);
      else classes.delete(name);
      node.className = [...classes].join(' ');
    },
  };
  return node;
}

function loadPopup(options = {}) {
  const ids = [
    'status', 'statusText', 'statusKind', 'downloadBtn', 'copyBtn', 'progress',
    'progressText', 'progressBar', 'cancelBtn', 'result', 'modeDesc',
    'refreshBtn', 'versionText', 'diagnosticBtn',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  const modes = ['link', 'embed', 'zip'].map((mode) => element({ mode }));
  const document = {
    documentElement: { lang: '' },
    getElementById: (id) => elements[id],
    querySelectorAll: (selector) => selector === '.mode-btn' ? modes : [],
  };
  const listeners = [];
  const requests = [];
  const saved = [];
  const timers = new Map();
  let clock = 0;
  let nextTimer = 0;
  let storageCallback;
  let closed = false;
  const chrome = {
    runtime: {
      id: 'fixture-extension',
      getManifest: () => ({ version: '1.7.0' }),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    storage: {
      local: {
        get(_key, callback) {
          storageCallback = callback;
          if (!options.deferStorage) callback({ xpd_mode: options.mode || 'embed' });
        },
        async set(value) { saved.push(value); },
      },
    },
    tabs: {
      query: options.query || (async () => [{ id: 42, url: 'https://x.com/author/status/123' }]),
      async sendMessage(tabId, message, target) {
        requests.push({ tabId, message, target });
        if (options.sendMessage) return options.sendMessage(tabId, message, target);
        return message.type === 'PING' ? { ok: true, kindLabel: '推文' } : { success: true };
      },
      reload: options.reload || (async () => {}),
    },
  };
  const context = createBaseContext({
    document,
    window: { close() { closed = true; } },
    globals: {
      chrome,
      setTimeout(callback, delay) {
        const id = ++nextTimer;
        timers.set(id, { callback, at: clock + delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  loadScript(context, 'popup.js');
  return {
    elements,
    modes,
    requests,
    saved,
    isClosed: () => closed,
    finishStorage: (mode) => storageCallback({ xpd_mode: mode }),
    emit(message, sender = { tab: { id: 42 }, frameId: 0, id: 'fixture-extension' }) {
      listeners.forEach((listener) => listener(message, sender));
    },
    advanceTimers(duration) {
      clock += duration;
      for (const [id, timer] of timers) {
        if (timer.at > clock) continue;
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('popup locks conflicting controls during export and rechecks page readiness on completion', async () => {
  const download = deferred();
  let ready = true;
  const popup = loadPopup({
    sendMessage: (_tab, message) => message.type === 'PING'
      ? { ok: ready, kindLabel: '推文' } : download.promise,
  });
  await settle();
  const pending = popup.elements.downloadBtn.click();
  assert.equal(popup.elements.downloadBtn.disabled, true);
  assert.equal(popup.elements.copyBtn.disabled, true);
  assert.equal(popup.elements.refreshBtn.disabled, true);
  assert.equal(popup.elements.diagnosticBtn.disabled, true);
  assert.ok(popup.modes.every((mode) => mode.disabled));
  assert.equal(popup.elements.cancelBtn.disabled, false);
  popup.modes[2].click();
  popup.elements.copyBtn.click();
  assert.equal(popup.requests.filter(({ message }) => message.type.startsWith('EXTRACT')).length, 1);
  assert.equal(popup.requests.at(-1).message.mode, 'embed');
  assert.equal(popup.requests.at(-1).target.frameId, 0);

  ready = false;
  download.resolve({ success: true });
  await pending;
  assert.equal(popup.elements.progress.hidden, true);
  assert.equal(popup.elements.downloadBtn.disabled, true);
  assert.equal(popup.elements.copyBtn.disabled, true);
  assert.equal(popup.elements.refreshBtn.disabled, false);
});

test('reopened popup restores an existing job and accepts progress only from its own top-level tab', async () => {
  let busy = true;
  const popup = loadPopup({
    sendMessage: () => ({
      ok: true, busy, action: 'copy', progressText: 'Copying existing job',
      progress: { completed: 2, total: 5 },
    }),
  });
  await settle();
  assert.equal(popup.elements.downloadBtn.disabled, true);
  assert.equal(popup.elements.progress.hidden, false);
  assert.equal(popup.elements.progressText.textContent, 'Copying existing job');
  assert.equal(popup.elements.progressBar.value, 2);
  for (const sender of [
    { tab: { id: 7 }, frameId: 0, id: 'fixture-extension' },
    { tab: { id: 42 }, frameId: 2, id: 'fixture-extension' },
    { tab: { id: 42 }, frameId: 0, id: 'unrelated-extension' },
    {},
  ]) {
    popup.emit({ type: 'XPD_PROGRESS', text: 'Unrelated job' }, sender);
    popup.emit({ type: 'XPD_EXPORT_STATE', busy: false }, sender);
  }
  assert.equal(popup.elements.progressText.textContent, 'Copying existing job');
  assert.equal(popup.elements.downloadBtn.disabled, true);
  popup.emit({ type: 'XPD_PROGRESS', text: 'Finishing', progress: { completed: 6, total: 5 } });
  assert.equal(popup.elements.progressText.textContent, 'Finishing');
  assert.equal(popup.elements.progressBar.value, 5);

  busy = false;
  popup.emit({ type: 'XPD_EXPORT_STATE', busy: false, action: 'copy', result: { success: true } });
  await settle();
  assert.equal(popup.elements.progress.hidden, true);
  assert.equal(popup.elements.copyBtn.disabled, false);
  assert.equal(popup.elements.result.textContent, '已复制 Markdown');
});

test('a delayed PING snapshot cannot clear a newer running-job broadcast', async () => {
  const ping = deferred();
  const popup = loadPopup({ sendMessage: () => ping.promise });
  await settle();
  popup.emit({ type: 'XPD_EXPORT_STATE', busy: true, action: 'download', text: 'Downloading images' });
  ping.resolve({ ok: true, busy: false });
  await settle();
  assert.equal(popup.elements.downloadBtn.disabled, true);
  assert.equal(popup.elements.refreshBtn.disabled, true);
  assert.equal(popup.elements.progress.hidden, false);
  assert.equal(popup.elements.progressText.textContent, 'Downloading images');
});

test('popup ignores stale task progress and terminal state after a newer task starts', async () => {
  const popup = loadPopup();
  await settle();
  const oldTask = { taskId: 'export-old', taskStartedAt: 100, protocolVersion: 1 };
  const newTask = { taskId: 'export-new', taskStartedAt: 200, protocolVersion: 1 };

  popup.emit({
    type: 'XPD_EXPORT_STATE', ...newTask, revision: 10, busy: true,
    action: 'download', progressText: '新任务正在下载',
  });
  popup.emit({
    type: 'XPD_PROGRESS', ...newTask, revision: 11,
    text: '新任务读取图片', progress: { completed: 1, total: 3 },
  });
  popup.emit({
    type: 'XPD_PROGRESS', ...oldTask, revision: 99,
    text: '旧任务延迟进度', progress: { completed: 3, total: 3 },
  });
  popup.emit({
    type: 'XPD_EXPORT_STATE', ...oldTask, revision: 100, busy: false,
    action: 'download', result: { success: true },
  });

  assert.equal(popup.elements.progressText.textContent, '新任务读取图片');
  assert.equal(popup.elements.progressBar.value, 1);
  assert.equal(popup.elements.downloadBtn.disabled, true);
  assert.equal(popup.elements.result.hidden, true);

  popup.emit({
    type: 'XPD_EXPORT_STATE', ...newTask, revision: 12, busy: false,
    action: 'download', result: { success: true },
  });
  await settle();
  assert.equal(popup.elements.downloadBtn.disabled, false);
  assert.equal(popup.elements.result.textContent, '下载成功');
});

test('popup ignores lower revisions from the same task', async () => {
  const popup = loadPopup();
  await settle();
  const task = { taskId: 'export-same', taskStartedAt: 300, protocolVersion: 1 };
  popup.emit({
    type: 'XPD_EXPORT_STATE', ...task, revision: 20, busy: true,
    action: 'copy', progressText: '当前阶段',
  });
  popup.emit({
    type: 'XPD_PROGRESS', ...task, revision: 21,
    text: '最新阶段', progress: { completed: 2, total: 4 },
  });
  popup.emit({
    type: 'XPD_EXPORT_STATE', ...task, revision: 19, busy: true,
    action: 'copy', progressText: '过期阶段',
  });
  assert.equal(popup.elements.progressText.textContent, '最新阶段');
  assert.equal(popup.elements.progressBar.value, 2);
});

test('a diagnostic job from another entry point locks conflicting actions without exposing export cancellation', async () => {
  const popup = loadPopup();
  await settle();
  popup.emit({ type: 'XPD_EXPORT_STATE', busy: false, diagnosing: true });
  assert.equal(popup.elements.downloadBtn.disabled, true);
  assert.equal(popup.elements.copyBtn.disabled, true);
  assert.equal(popup.elements.refreshBtn.disabled, true);
  assert.equal(popup.elements.diagnosticBtn.disabled, true);
  assert.ok(popup.modes.every((mode) => mode.disabled));
  assert.equal(popup.elements.progress.hidden, true);
  assert.equal(popup.elements.cancelBtn.disabled, true);
  popup.elements.downloadBtn.click();
  assert.equal(popup.requests.filter(({ message }) => message.type.startsWith('EXTRACT')).length, 0);

  popup.emit({ type: 'XPD_EXPORT_STATE', busy: false, diagnosing: false });
  assert.equal(popup.elements.downloadBtn.disabled, false);
  assert.equal(popup.elements.copyBtn.disabled, false);
  assert.equal(popup.elements.refreshBtn.disabled, false);
  assert.equal(popup.elements.diagnosticBtn.disabled, false);
  assert.ok(popup.modes.every((mode) => !mode.disabled));
});

test('reopened popup restores a remote diagnostic lock from PING', async () => {
  const popup = loadPopup({ sendMessage: () => ({ ok: true, busy: false, diagnosing: true }) });
  await settle();
  assert.equal(popup.elements.downloadBtn.disabled, true);
  assert.equal(popup.elements.diagnosticBtn.disabled, true);
  assert.equal(popup.elements.progress.hidden, true);
  popup.emit({ type: 'XPD_EXPORT_STATE', busy: false, diagnosing: false });
  assert.equal(popup.elements.downloadBtn.disabled, false);
});

test('a late saved-mode read does not replace the selected mode, and copy never requests embed or ZIP', async () => {
  const popup = loadPopup({ deferStorage: true });
  await settle();
  popup.modes[2].click();
  popup.finishStorage('link');
  assert.equal(popup.modes[2].getAttribute('aria-pressed'), 'true');
  assert.equal(popup.saved.at(-1).xpd_mode, 'zip');
  await popup.elements.copyBtn.click();
  const copy = popup.requests.find(({ message }) => message.type === 'EXTRACT_AND_COPY');
  assert.ok(copy);
  assert.equal(Object.hasOwn(copy.message, 'mode'), false);
  assert.equal(popup.modes[2].getAttribute('aria-pressed'), 'true');
});

test('an old success timer cannot hide a later error and successful feedback expires', async () => {
  let succeeds = true;
  const popup = loadPopup({
    sendMessage: (_tab, message) => message.type === 'PING'
      ? { ok: true } : { success: succeeds, error: 'Clipboard denied' },
  });
  await settle();
  await popup.elements.copyBtn.click();
  popup.advanceTimers(2000);
  succeeds = false;
  await popup.elements.copyBtn.click();
  popup.advanceTimers(10000);
  assert.equal(popup.elements.result.hidden, false);
  assert.equal(popup.elements.result.textContent, 'Clipboard denied');
  succeeds = true;
  await popup.elements.copyBtn.click();
  popup.advanceTimers(4000);
  assert.equal(popup.elements.result.hidden, true);
});

test('a failed cancellation restores the cancel button while an existing job is still running', async () => {
  const popup = loadPopup({
    sendMessage: (_tab, message) => {
      if (message.type === 'CANCEL_EXPORT') throw new Error('Temporary message failure');
      return { ok: true, busy: true, action: 'download' };
    },
  });
  await settle();
  await popup.elements.cancelBtn.click();
  assert.equal(popup.elements.cancelBtn.disabled, false);
  assert.equal(popup.elements.downloadBtn.disabled, true);
  assert.equal(popup.elements.result.textContent, '取消失败，请重试');
});

test('a disconnected page after an export failure does not re-enable export or diagnostic actions', async () => {
  let pings = 0;
  const popup = loadPopup({
    sendMessage: (_tab, message) => {
      if (message.type === 'PING' && pings++ === 0) return { ok: true };
      throw new Error('Receiving end does not exist');
    },
  });
  await settle();
  await popup.elements.downloadBtn.click();
  assert.equal(popup.elements.downloadBtn.disabled, true);
  assert.equal(popup.elements.diagnosticBtn.disabled, true);
  assert.equal(popup.elements.refreshBtn.disabled, false);
  assert.equal(popup.elements.progress.hidden, true);
  assert.equal(popup.elements.result.hidden, false);
});

test('failed page reload keeps the popup open and restores its controls', async () => {
  const popup = loadPopup({ reload: async () => { throw new Error('Tab closed'); } });
  await settle();
  await popup.elements.refreshBtn.click();
  assert.equal(popup.isClosed(), false);
  assert.equal(popup.elements.refreshBtn.disabled, false);
  assert.equal(popup.elements.downloadBtn.disabled, false);
  assert.equal(popup.elements.result.textContent, '刷新失败，请重试');
});
