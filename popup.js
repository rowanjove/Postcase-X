const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('statusText');
const statusKindEl = document.getElementById('statusKind');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const progressEl = document.getElementById('progress');
const progressText = document.getElementById('progressText');
const progressBar = document.getElementById('progressBar');
const cancelBtn = document.getElementById('cancelBtn');
const resultEl = document.getElementById('result');
const modeDescEl = document.getElementById('modeDesc');
const refreshBtn = document.getElementById('refreshBtn');
const versionTextEl = document.getElementById('versionText');
const diagnosticBtn = document.getElementById('diagnosticBtn');
const modeButtons = [...document.querySelectorAll('.mode-btn')];

let currentTabId = null;
let currentMode = 'embed';
let pageReady = false;
let pageSupported = false;
let pageConnected = false;
let checking = true;
let localAction = null;
let remoteBusy = false;
let remoteDiagnosing = false;
let remoteAction = null;
let cancelling = false;
let diagnosing = false;
let refreshing = false;
let modeWasSelected = false;
let checkSequence = 0;
let exportStateRevision = 0;
const PROTOCOL_VERSION = 1;
let remoteTaskId = null;
let remoteTaskStartedAt = null;
let remoteRevision = 0;
let remoteProtocolVersion = 0;
let resultTimer = null;

function t(key, fallback) {
  try {
    return chrome.i18n?.getMessage(key) || fallback;
  } catch {
    return fallback;
  }
}

function localizeDocument() {
  try {
    document.documentElement.lang = chrome.i18n?.getUILanguage?.() || 'zh-CN';
  } catch {
    document.documentElement.lang = 'zh-CN';
  }
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n, element.textContent);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute(
      'aria-label',
      t(element.dataset.i18nAriaLabel, element.getAttribute('aria-label') || '')
    );
  });
}

localizeDocument();
versionTextEl.textContent = `v${chrome.runtime.getManifest().version}`;

const MODE_DESCS = {
  link: t('mode_link_desc', '图片保留原始链接，需要联网查看。'),
  embed: t('mode_embed_desc', '图片写入 Markdown，保存为一个文件。'),
  zip: t('mode_zip_desc', 'Markdown 和图片分别保存，打包为 ZIP。'),
};

function setStatus(type, text, kindLabel = '') {
  statusEl.className = `status ${type}`;
  statusTextEl.textContent = text;
  statusKindEl.textContent = kindLabel;
  statusKindEl.hidden = !kindLabel || kindLabel === t('kind_other', '其他');
}

function renderControls() {
  const exporting = Boolean(localAction || remoteBusy);
  const occupied = exporting || diagnosing || remoteDiagnosing || refreshing;
  downloadBtn.disabled = !pageReady || checking || occupied;
  copyBtn.disabled = !pageReady || checking || occupied;
  refreshBtn.disabled = currentTabId === null || !pageSupported || checking || occupied;
  diagnosticBtn.disabled = !pageConnected || checking || occupied;
  modeButtons.forEach((button) => { button.disabled = occupied; });
  downloadBtn.textContent = exporting && (localAction || remoteAction) === 'download'
    ? t('processing', '处理中…') : t('download', '下载');
  copyBtn.textContent = exporting && (localAction || remoteAction) === 'copy'
    ? t('copying', '复制中…') : t('copy', '复制');
  progressEl.hidden = !exporting;
  progressEl.classList.toggle('show', exporting);
  cancelBtn.disabled = !exporting || cancelling;
  cancelBtn.textContent = cancelling
    ? t('export_cancelling', '正在取消导出…') : t('cancel', '取消');
}

function clearResult() {
  if (resultTimer !== null) clearTimeout(resultTimer);
  resultTimer = null;
  resultEl.hidden = true;
  resultEl.className = 'result';
  resultEl.textContent = '';
}

function showResult(type, text) {
  clearResult();
  resultEl.className = `result ${type}`;
  resultEl.textContent = text;
  resultEl.hidden = false;
  // Keep warnings and errors available until the next deliberate action.
  if (type === 'success') resultTimer = setTimeout(clearResult, 4000);
}

function showExportResult(response, action) {
  if (response?.success) {
    showResult(
      response.warning ? 'warning' : 'success',
      response.warning
        ? `${t('download_warning', '下载已完成，但部分资源未能离线保存')}：${response.warning}`
        : action === 'copy' ? t('copy_success', '已复制 Markdown') : t('download_success', '下载成功')
    );
  } else {
    showResult(
      response?.cancelled ? 'warning' : 'error',
      response?.cancelled ? t('export_cancelled', '导出已取消')
        : response?.error || (action === 'copy' ? t('copy_failed', '复制失败') : t('download_failed', '下载失败'))
    );
  }
}

function updateProgress(text, progress = null) {
  progressText.textContent = text || t('progress_extracting', '正在提取内容…');
  const completed = Number(progress?.completed);
  const total = Number(progress?.total);
  const determinate = Number.isFinite(completed) && Number.isFinite(total) && total > 0;
  progressBar.hidden = !determinate;
  if (determinate) {
    const value = Math.min(Math.max(completed, 0), total);
    progressBar.max = total;
    progressBar.value = value;
    progressBar.setAttribute('aria-label', `${value}/${total}`);
  } else {
    progressBar.removeAttribute('aria-label');
  }
}

function updateModeUi(mode) {
  if (!Object.hasOwn(MODE_DESCS, mode)) return;
  currentMode = mode;
  modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  modeDescEl.textContent = MODE_DESCS[mode];
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (button.disabled) return;
    modeWasSelected = true;
    updateModeUi(button.dataset.mode);
    chrome.storage.local.set({ xpd_mode: currentMode }).catch(() => {});
  });
});

chrome.storage.local.get('xpd_mode', (result) => {
  // A slow storage read must not replace a selection made after opening.
  if (chrome.runtime.lastError || modeWasSelected) return;
  updateModeUi(Object.hasOwn(MODE_DESCS, result?.xpd_mode) ? result.xpd_mode : currentMode);
});
updateModeUi(currentMode);

function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
}

function normalizeTaskId(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeTaskStartedAt(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isSupportedProtocol(snapshot) {
  const version = Number(snapshot?.protocolVersion);
  return !Number.isFinite(version) || version <= PROTOCOL_VERSION;
}

function isRemoteActive() {
  return remoteBusy || remoteDiagnosing;
}

function isSnapshotNewEnough(snapshot, source) {
  if (!isSupportedProtocol(snapshot)) return false;
  const incomingTaskId = normalizeTaskId(snapshot?.taskId);
  const incomingRevision = normalizeRevision(snapshot?.revision);
  if (!incomingTaskId || incomingRevision === null || !remoteTaskId) return true;

  const incomingActive = Boolean(snapshot.busy || snapshot.diagnosing);
  const currentActive = isRemoteActive();
  if (incomingTaskId === remoteTaskId) return incomingRevision >= remoteRevision;

  const incomingStartedAt = normalizeTaskStartedAt(snapshot.taskStartedAt);
  if (incomingStartedAt !== null && remoteTaskStartedAt !== null) {
    if (!incomingActive && source !== 'ping') return false;
    if (incomingStartedAt !== remoteTaskStartedAt) {
      return incomingStartedAt > remoteTaskStartedAt;
    }
    return incomingRevision > remoteRevision;
  }

  // A PING is an authoritative snapshot once its request has not been
  // overtaken by a later broadcast (the caller tracks that request revision).
  if (source === 'ping' && !currentActive) return true;
  if (currentActive) {
    // A terminal message from another task is stale by definition. A new
    // task is accepted only after its own active snapshot has arrived.
    if (!incomingActive || source === 'progress') return false;
    return incomingRevision > remoteRevision;
  }
  if (incomingActive) return true;
  // A different task cannot legitimately send an idle broadcast without a
  // preceding active snapshot. PING remains the recovery path for a popup
  // that was closed during the task.
  return source === 'ping';
}

function applyRemoteIdentity(snapshot) {
  const incomingTaskId = normalizeTaskId(snapshot?.taskId);
  const incomingRevision = normalizeRevision(snapshot?.revision);
  if (!incomingTaskId || incomingRevision === null) return;
  remoteTaskId = incomingTaskId;
  remoteTaskStartedAt = normalizeTaskStartedAt(snapshot.taskStartedAt);
  remoteRevision = incomingRevision;
  const version = Number(snapshot.protocolVersion);
  if (Number.isFinite(version)) remoteProtocolVersion = version;
}

function applyExportSnapshot(snapshot, source = 'broadcast') {
  if (!isSnapshotNewEnough(snapshot, source)) return false;
  applyRemoteIdentity(snapshot);
  remoteBusy = Boolean(snapshot.busy);
  remoteDiagnosing = Boolean(snapshot.diagnosing);
  if (snapshot.action === 'copy' || snapshot.action === 'download') remoteAction = snapshot.action;
  cancelling = remoteBusy && Boolean(snapshot.cancelling);
  if (remoteBusy) updateProgress(snapshot.progressText || snapshot.text, snapshot.progress);
  return true;
}

function applyExportProgress(message) {
  if (!isSupportedProtocol(message)) return false;
  const snapshot = { ...message, busy: true, diagnosing: false };
  if (!isSnapshotNewEnough(snapshot, 'progress')) return false;
  applyRemoteIdentity(message);
  return true;
}

function resetRemoteIdentity() {
  remoteTaskId = null;
  remoteTaskStartedAt = null;
  remoteRevision = 0;
  remoteProtocolVersion = 0;
}

async function checkCurrentPage() {
  const sequence = ++checkSequence;
  checking = true;
  renderControls();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (sequence !== checkSequence) return;
    const nextTabId = Number.isInteger(tab?.id) ? tab.id : null;
    if (nextTabId !== currentTabId) resetRemoteIdentity();
    currentTabId = nextTabId;
    pageReady = false;
    pageConnected = false;
    pageSupported = /^https:\/\/(x\.com|twitter\.com)\//.test(tab?.url || '');
    if (currentTabId === null) {
      remoteBusy = false;
      remoteDiagnosing = false;
      resetRemoteIdentity();
      setStatus('no', t('no_active_tab', '无法获取当前标签页'));
      return;
    }
    if (!pageSupported) {
      remoteBusy = false;
      remoteDiagnosing = false;
      resetRemoteIdentity();
      setStatus('no', t('unsupported', '请打开 X 推文详情页或 Note 页面'));
      return;
    }

    const tabId = currentTabId;
    const revision = exportStateRevision;
    const response = await sendToTab(tabId, { type: 'PING' });
    if (sequence !== checkSequence || tabId !== currentTabId) return;
    pageConnected = Boolean(response);
    pageReady = Boolean(response?.ok);
    // A later state broadcast is newer than this asynchronous PING snapshot.
    if (revision === exportStateRevision) applyExportSnapshot(response || {}, 'ping');
    setStatus(
      pageReady ? 'ok' : response?.loading ? 'loading' : 'no',
      pageReady ? t('ready', '可以导出')
        : response?.message || t('retry_after_refresh', '页面还没准备好，请刷新后重试'),
      response?.kindLabel
    );
  } catch {
    if (sequence !== checkSequence) return;
    pageReady = false;
    pageConnected = false;
    remoteBusy = false;
    remoteDiagnosing = false;
    resetRemoteIdentity();
    setStatus('no', t('retry_after_refresh', '页面还没准备好，请刷新后重试'));
  } finally {
    if (sequence === checkSequence) {
      checking = false;
      renderControls();
    }
  }
}

refreshBtn.addEventListener('click', async () => {
  if (refreshBtn.disabled || currentTabId === null) return;
  refreshing = true;
  clearResult();
  renderControls();
  try {
    await chrome.tabs.reload(currentTabId);
    window.close();
  } catch {
    refreshing = false;
    showResult('error', t('refresh_failed', '刷新失败，请重试'));
    renderControls();
  }
});

cancelBtn.addEventListener('click', async () => {
  if (cancelBtn.disabled || currentTabId === null) return;
  cancelling = true;
  renderControls();
  updateProgress(t('export_cancelling', '正在取消导出…'));
  try {
    const response = await sendToTab(currentTabId, { type: 'CANCEL_EXPORT' });
    if (!response?.success) throw new Error('Cancel request failed');
    // The job may have ended between clicking and delivering the request.
    if (!response.cancelled) await checkCurrentPage();
  } catch {
    cancelling = false;
    showResult('error', t('cancel_failed', '取消失败，请重试'));
    await checkCurrentPage();
  } finally {
    renderControls();
  }
});

diagnosticBtn.addEventListener('click', async () => {
  if (diagnosticBtn.disabled || currentTabId === null) return;
  diagnosing = true;
  clearResult();
  renderControls();
  try {
    const response = await sendToTab(currentTabId, { type: 'COPY_DIAGNOSTICS' });
    showResult(
      response?.success ? 'success' : 'error',
      response?.success ? t('diagnostics_copied', '诊断报告已复制')
        : response?.error || t('diagnostics_failed', '诊断报告复制失败')
    );
  } catch {
    showResult('error', t('diagnostics_failed', '诊断报告复制失败'));
  } finally {
    diagnosing = false;
    await checkCurrentPage();
  }
});

async function runExport(action) {
  const button = action === 'copy' ? copyBtn : downloadBtn;
  if (button.disabled || currentTabId === null) return;
  const tabId = currentTabId;
  localAction = action;
  cancelling = false;
  clearResult();
  updateProgress(action === 'copy'
    ? t('copy_progress', '正在复制 Markdown…') : t('progress_extracting', '正在提取内容…'));
  renderControls();
  try {
    const message = {
      type: action === 'copy' ? 'EXTRACT_AND_COPY' : 'EXTRACT_AND_DOWNLOAD',
      options: { includeAuthor: true, includeTime: true, includeStats: false, includeComments: false },
    };
    if (action === 'download') message.mode = currentMode;
    const response = await sendToTab(tabId, message);
    showExportResult(response, action);
  } catch {
    showResult('error', t('retry_after_refresh', '页面还没准备好，请刷新后重试'));
  } finally {
    localAction = null;
    // Re-check the target page instead of blindly enabling controls after a
    // navigation, failed connection, or export started from the floating panel.
    await checkCurrentPage();
  }
}

downloadBtn.addEventListener('click', () => runExport('download'));
copyBtn.addEventListener('click', () => runExport('copy'));

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || sender?.tab?.id !== currentTabId || currentTabId === null) return;
  if (sender.frameId !== undefined && sender.frameId !== 0) return;
  if (sender.id && chrome.runtime.id && sender.id !== chrome.runtime.id) return;
  if (message.type === 'XPD_PROGRESS') {
    if (!applyExportProgress(message)) return;
    if (localAction || remoteBusy) updateProgress(message.text, message.progress);
    return;
  }
  if (message.type !== 'XPD_EXPORT_STATE') return;
  exportStateRevision += 1;
  const wasBusy = remoteBusy;
  const action = message.action || remoteAction;
  if (!applyExportSnapshot(message, 'broadcast')) return;
  if (message.busy && !wasBusy && !localAction) clearResult();
  renderControls();
  if (!remoteBusy && wasBusy && !localAction) {
    if (message.result) showExportResult(message.result, action);
    void checkCurrentPage();
  }
});

renderControls();
void checkCurrentPage();
