const statusEl = document.getElementById('status');
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

let currentTabId = null;
let currentMode = 'embed';

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
  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle, element.title);
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
  link: t('mode_link_desc', '图片会保留原始链接，生成的 Markdown 最轻量。'),
  embed: t('mode_embed_desc', '图片压缩后以内嵌方式写入 Markdown，单文件保存更省心。'),
  zip: t('mode_zip_desc', 'Markdown 和图片一起打包成 ZIP，适合完整离线归档。'),
};

function setStatus(type, text, kindLabel = t('kind_other', '其他')) {
  statusEl.className = `status ${type}`;
  statusEl.querySelector('span').textContent = text;
  statusKindEl.textContent = kindLabel;
}

function setActionDisabled(disabled) {
  downloadBtn.disabled = disabled;
  copyBtn.disabled = disabled;
}

function showResult(type, text) {
  resultEl.className = `result ${type}`;
  resultEl.textContent = text;
  resultEl.style.display = 'block';
  setTimeout(() => {
    resultEl.style.display = 'none';
  }, 4000);
}

function updateProgress(text, progress = null) {
  progressText.textContent = text || t('progress_extracting', '正在提取内容...');
  const completed = Number(progress?.completed);
  const total = Number(progress?.total);
  const determinate = Number.isFinite(completed) && Number.isFinite(total) && total > 0;
  progressBar.hidden = !determinate;
  if (determinate) {
    progressBar.max = total;
    progressBar.value = Math.min(Math.max(completed, 0), total);
    progressBar.setAttribute('aria-label', `${completed}/${total}`);
  } else {
    progressBar.removeAttribute('aria-label');
  }
}

function setCancelState(busy, cancelling = false) {
  cancelBtn.disabled = !busy || cancelling;
  cancelBtn.textContent = cancelling
    ? t('export_cancelling', '正在取消导出...')
    : t('cancel', '取消');
}

function updateModeUi(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  modeDescEl.textContent = MODE_DESCS[mode];
}

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    updateModeUi(btn.dataset.mode);
    // Fix #13: use chrome.storage.local instead of localStorage
    chrome.storage.local.set({ xpd_mode: currentMode });
  });
});

// Fix #13: load mode from chrome.storage.local
chrome.storage.local.get('xpd_mode', (result) => {
  const savedMode = result?.xpd_mode;
  if (savedMode && MODE_DESCS[savedMode]) {
    updateModeUi(savedMode);
  } else {
    updateModeUi(currentMode);
  }
});

async function checkCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      setStatus('no', t('no_active_tab', '无法获取当前标签页'));
      return;
    }

    currentTabId = tab.id;
    const url = tab.url || '';

    if (!url.match(/^https:\/\/(x\.com|twitter\.com)\//)) {
      setStatus('no', t('unsupported', '请打开 X 推文详情页或 Note 页面'));
      setActionDisabled(true);
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(currentTabId, { type: 'PING' });
      if (response && response.ok) {
        setStatus('ok', t('ready', '可以下载当前内容'), response.kindLabel);
        setActionDisabled(false);
      } else {
        setStatus(
          response?.loading ? 'loading' : 'no',
          response?.message || t('retry_after_refresh', '页面还没准备好，请刷新后重试'),
          response?.kindLabel
        );
        setActionDisabled(true);
      }
    } catch {
      setStatus('no', t('retry_after_refresh', '页面还没准备好，请刷新后重试'));
      setActionDisabled(true);
    }
  } catch {
    setStatus('no', t('check_failed', '检测失败，请重试'));
    setActionDisabled(true);
  }
}

checkCurrentPage();

refreshBtn.addEventListener('click', () => {
  if (currentTabId) {
    chrome.tabs.reload(currentTabId);
  } else {
    chrome.tabs.reload();
  }
  setTimeout(() => window.close(), 100);
});

cancelBtn.addEventListener('click', async () => {
  if (!currentTabId || cancelBtn.disabled) return;
  setCancelState(true, true);
  updateProgress(t('export_cancelling', '正在取消导出...'));
  try {
    await chrome.tabs.sendMessage(currentTabId, { type: 'CANCEL_EXPORT' });
  } catch {
    setCancelState(false);
  }
});

diagnosticBtn.addEventListener('click', async () => {
  if (!currentTabId || diagnosticBtn.disabled) return;
  diagnosticBtn.disabled = true;
  try {
    const response = await chrome.tabs.sendMessage(currentTabId, { type: 'COPY_DIAGNOSTICS' });
    showResult(
      response?.success ? 'success' : 'error',
      response?.success
        ? t('diagnostics_copied', '诊断报告已复制')
        : response?.error || t('diagnostics_failed', '诊断报告复制失败')
    );
  } catch {
    showResult('error', t('diagnostics_failed', '诊断报告复制失败'));
  } finally {
    diagnosticBtn.disabled = false;
  }
});

downloadBtn.addEventListener('click', async () => {
  if (!currentTabId) return;

  setActionDisabled(true);
  downloadBtn.textContent = t('processing', '处理中...');
  progressEl.classList.add('show');
  setCancelState(true);
  diagnosticBtn.disabled = true;
  resultEl.className = 'result';
  resultEl.style.display = 'none';

  try {
    updateProgress(t('progress_extracting', '正在提取内容...'));

    const response = await chrome.tabs.sendMessage(currentTabId, {
      type: 'EXTRACT_AND_DOWNLOAD',
      mode: currentMode,
      options: {
        includeAuthor: true,
        includeTime: true,
        includeStats: false,
        includeComments: false,
      },
    });

    if (response && response.success) {
      showResult(
        response.warning ? 'warning' : 'success',
        response.warning
          ? `${t('download_warning', '下载已完成，但部分资源未能离线保存')}：${response.warning}`
          : t('download_success', '下载成功')
      );
    } else {
      showResult(
        response?.cancelled ? 'warning' : 'error',
        response?.cancelled
          ? t('export_cancelled', '导出已取消')
          : response?.error || t('download_failed', '下载失败')
      );
    }
  } catch {
    // Fix #12: friendly error message instead of raw error.message
    showResult('error', t('retry_after_refresh', '页面还没准备好，请刷新后重试'));
  } finally {
    setActionDisabled(false);
    downloadBtn.textContent = t('download', '下载');
    progressEl.classList.remove('show');
    setCancelState(false);
    diagnosticBtn.disabled = false;
    updateProgress(t('progress_extracting', '正在提取内容...'));
  }
});

copyBtn.addEventListener('click', async () => {
  if (!currentTabId) return;

  setActionDisabled(true);
  copyBtn.textContent = t('copying', '复制中...');
  progressEl.classList.add('show');
  setCancelState(true);
  diagnosticBtn.disabled = true;
  resultEl.className = 'result';
  resultEl.style.display = 'none';

  try {
    updateProgress(t('copy_progress', '正在复制 Markdown...'));

    const response = await chrome.tabs.sendMessage(currentTabId, {
      type: 'EXTRACT_AND_COPY',
      options: {
        includeAuthor: true,
        includeTime: true,
        includeStats: false,
        includeComments: false,
      },
    });

    if (response && response.success) {
      showResult('success', t('copy_success', '已复制 Markdown'));
    } else {
      showResult(
        response?.cancelled ? 'warning' : 'error',
        response?.cancelled
          ? t('export_cancelled', '导出已取消')
          : response?.error || t('copy_failed', '复制失败')
      );
    }
  } catch {
    showResult('error', t('retry_after_refresh', '页面还没准备好，请刷新后重试'));
  } finally {
    setActionDisabled(false);
    copyBtn.textContent = t('copy', '复制');
    progressEl.classList.remove('show');
    setCancelState(false);
    diagnosticBtn.disabled = false;
    updateProgress(t('progress_extracting', '正在提取内容...'));
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'XPD_PROGRESS') {
    updateProgress(msg.text, msg.progress);
  }
});

setCancelState(false);
