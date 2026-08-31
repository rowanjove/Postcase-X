// Local-only API adapter. The production popup HTML, styles, and script remain unchanged.
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const chinese = window.__XPD_LANGUAGE__ === 'zh-CN';
  const store = {};
  const listeners = [];
  const tab = { id: 73, url: 'https://x.com/fixture_author/status/987654321' };
  const extensionId = 'xpd-local-popup-preview';
  const previewMessage = chinese
    ? '本地界面预览：不会下载文件或复制内容。'
    : 'Local UI preview: no files are downloaded and nothing is copied.';
  const state = {
    ok: params.get('state') !== 'unavailable',
    busy: false,
    diagnosing: false,
    cancelling: false,
    action: null,
    kind: 'tweet',
    kindLabel: window.__XPD_MESSAGES__.kind_tweet.message,
    progressText: '',
    progress: null,
    message: chinese ? '本地预览：示例内容尚未加载。' : 'Local preview: sample content is unavailable.',
  };

  document.title = chinese
    ? '本地界面预览 · 匿名示例数据 · X Markdown Exporter'
    : 'Local UI preview · anonymous sample data · X Markdown Exporter';

  window.__XPD_POPUP_FIXTURE__ = {
    preview: true,
    store,
    setState(update) {
      Object.assign(state, update);
      const message = { type: 'XPD_EXPORT_STATE', ...state, text: state.progressText };
      const sender = { tab, frameId: 0, id: extensionId };
      listeners.forEach((listener) => listener(message, sender));
    },
  };

  window.chrome = {
    i18n: {
      getMessage: (key) => window.__XPD_MESSAGES__?.[key]?.message || '',
      getUILanguage: () => window.__XPD_LANGUAGE__,
    },
    runtime: {
      id: extensionId,
      getManifest: () => window.__XPD_MANIFEST__,
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    storage: {
      local: {
        get(keys, callback) {
          const names = Array.isArray(keys) ? keys : [keys];
          const values = Object.fromEntries(names.filter((key) => Object.hasOwn(store, key))
            .map((key) => [key, store[key]]));
          callback?.(values);
          return Promise.resolve(values);
        },
        async set(values) { Object.assign(store, values); },
      },
    },
    tabs: {
      query: async () => [tab],
      async sendMessage(_tabId, message) {
        if (message.type === 'PING') return { ...state };
        if (message.type === 'CANCEL_EXPORT') {
          const wasBusy = state.busy;
          window.__XPD_POPUP_FIXTURE__.setState({ busy: false, cancelling: false });
          return { success: true, cancelled: wasBusy };
        }
        // Do not turn a UI preview click into a real side effect or a fake success.
        return { success: false, error: previewMessage };
      },
      reload: async () => { throw new Error(previewMessage); },
    },
  };
})();
