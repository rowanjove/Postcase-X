// X Markdown Exporter - UI Module
// Floating panel, drag interaction, status management, and chrome.storage sync.

(function () {
  'use strict';

  const _XPD = window._XPD;
  const core = _XPD.core;
  const dom = _XPD.dom;

  function t(key, fallback) {
    try {
      return chrome.i18n?.getMessage(key) || fallback;
    } catch {
      return fallback;
    }
  }

  // ── Localized UI constants ────────────────────────────────────────

  const MODE_LABELS = Object.freeze({
    link: t('mode_link', '链接引用'),
    embed: t('mode_embed', '内嵌图片'),
    zip: t('mode_zip', 'ZIP 打包'),
  });

  const MODE_DESCS = Object.freeze({
    link: t('mode_link_desc', '图片会保留原始链接，生成的 Markdown 最轻量。'),
    embed: t('mode_embed_desc', '图片压缩后以内嵌方式写入 Markdown，单文件保存更省心。'),
    zip: t('mode_zip_desc', 'Markdown 和图片一起打包成 ZIP，适合完整离线归档。'),
  });

  const UI_TEXT = Object.freeze({
    launcherTitle: t('launcher_title', 'X Markdown Exporter，拖动可移动'),
    title: t('extension_name', 'X Markdown Exporter'),
    subtitle: t('panel_subtitle', '保存当前推文或 Note'),
    modeTitle: t('download_format', '导出模式'),
    checking: t('checking', '检测中...'),
    ready: t('ready', '可以下载当前内容'),
    unsupported: t('unsupported', '请打开 X 推文详情页或 Note 页面'),
    notReady: t('not_ready', '正在等待推文内容加载；如果一直不动，请刷新页面或重新打开详情页'),
    unsupportedTimeline: t('unsupported_timeline', '时间线暂不直接导出；请点开某条推文详情页后再下载或复制'),
    unsupportedExplore: t('unsupported_explore', '探索页暂不直接导出；请打开一条推文详情页或 Note 页面'),
    unsupportedSearch: t('unsupported_search', '搜索页暂不直接导出；请打开搜索结果里的某条推文详情页'),
    unsupportedProfile: t('unsupported_profile', '主页暂不直接导出；请打开一条推文详情页或 Note 页面'),
    unsupportedOther: t('unsupported_other', '当前页面暂不支持导出；请打开 X 推文详情页或 Note 页面'),
    note: t('metadata_note', '默认会附带作者和时间。'),
    download: t('download', '下载'),
    processing: t('processing', '处理中...'),
    refresh: t('refresh', '刷新'),
    refreshLoading: t('refresh_loading', '正在刷新页面...'),
    progressDefault: t('progress_extracting', '正在提取内容...'),
    downloadSuccess: t('download_success', '下载成功'),
    downloadWarning: t('download_warning', '下载已完成，但部分资源未能离线保存'),
    downloadFailed: t('download_failed', '下载失败'),
    copy: t('copy', '复制'),
    copySuccess: t('copy_success', '已复制 Markdown'),
    copyFailed: t('copy_failed', '复制失败'),
    cancel: t('cancel', '取消'),
    cancelling: t('export_cancelling', '正在取消导出...'),
    cancelled: t('export_cancelled', '导出已取消'),
    diagnostics: t('diagnostics_copy', '复制诊断报告'),
    diagnosticsCopied: t('diagnostics_copied', '诊断报告已复制'),
    diagnosticsFailed: t('diagnostics_failed', '诊断报告复制失败'),
    close: t('close', '关闭'),
  });

  const PAGE_KIND_LABELS = Object.freeze({
    article: t('kind_article', '文章'),
    tweet: t('kind_tweet', '推文'),
    timeline: t('kind_timeline', '时间线'),
    explore: t('kind_explore', '探索'),
    search: t('kind_search', '搜索'),
    profile: t('kind_profile', '主页'),
    other: t('kind_other', '其他'),
  });

  const CONTENT_TAG_LABELS = Object.freeze({
    thread: t('tag_thread', '线程'),
    images: t('tag_images', '图'),
    quote: t('tag_quote', '引用'),
    card: t('tag_card', '外链'),
  });

  const FLOATING_TOP_STORAGE_KEY = 'xpd_float_top';
  const FLOATING_RIGHT_STORAGE_KEY = 'xpd_float_right';
  const FLOATING_DEFAULT_TOP = 104;
  const FLOATING_DEFAULT_RIGHT = 18;
  const FLOATING_DRAG_THRESHOLD = 6;

  // ── UI state ───────────────────────────────────────────────────────

  const uiState = {
    root: null,
    launcher: null,
    launcherBadge: null,
    panel: null,
    status: null,
    statusText: null,
    statusKind: null,
    modeDesc: null,
    downloadBtn: null,
    copyBtn: null,
    refreshBtn: null,
    closeBtn: null,
    progress: null,
    progressText: null,
    progressBar: null,
    cancelBtn: null,
    diagnosticBtn: null,
    result: null,
    toast: null,
    currentMode: 'embed',
    ready: false,
    open: false,
    busyCount: 0,
    lastUrl: window.location.href,
    resultTimer: null,
    toastTimer: null,
    refreshTimers: [],
    urlWatcherInterval: null,
    abortController: null,
    floatingTop: FLOATING_DEFAULT_TOP,
    floatingRight: FLOATING_DEFAULT_RIGHT,
    panelSide: 'left',
    dragPointerId: null,
    dragStartX: 0,
    dragStartY: 0,
    dragStartRight: FLOATING_DEFAULT_RIGHT,
    dragStartTop: FLOATING_DEFAULT_TOP,
    dragMoved: false,
    suppressClickUntil: 0,
  };

  // ── Initialization ─────────────────────────────────────────────────

  function initFloatingUi() {
    if (!document.documentElement) return;

    // Cleanup previous instance (fix #9: AbortController for event listeners)
    if (uiState.abortController) {
      uiState.abortController.abort();
    }
    const existingRoot = document.getElementById('xpd-floating-root');
    if (existingRoot) existingRoot.remove();
    if (uiState.urlWatcherInterval) {
      clearInterval(uiState.urlWatcherInterval);
      uiState.urlWatcherInterval = null;
    }

    uiState.abortController = new AbortController();
    const { signal } = uiState.abortController;

    const root = document.createElement('div');
    root.id = 'xpd-floating-root';
    root.innerHTML = getFloatingUiMarkup();

    (document.body || document.documentElement).appendChild(root);

    uiState.root = root;
    uiState.launcher = root.querySelector('[data-role="launcher"]');
    uiState.launcherBadge = root.querySelector('[data-role="launcherBadge"]');
    uiState.panel = root.querySelector('[data-role="panel"]');
    uiState.status = root.querySelector('[data-role="status"]');
    uiState.statusText = root.querySelector('[data-role="statusText"]');
    uiState.statusKind = root.querySelector('[data-role="statusKind"]');
    uiState.modeDesc = root.querySelector('[data-role="modeDesc"]');
    uiState.downloadBtn = root.querySelector('[data-role="downloadBtn"]');
    uiState.copyBtn = root.querySelector('[data-role="copyBtn"]');
    uiState.refreshBtn = root.querySelector('[data-role="refreshBtn"]');
    uiState.closeBtn = root.querySelector('[data-role="closeBtn"]');
    uiState.progress = root.querySelector('[data-role="progress"]');
    uiState.progressText = root.querySelector('[data-role="progressText"]');
    uiState.progressBar = root.querySelector('[data-role="progressBar"]');
    uiState.cancelBtn = root.querySelector('[data-role="cancelBtn"]');
    uiState.diagnosticBtn = root.querySelector('[data-role="diagnosticBtn"]');
    uiState.result = root.querySelector('[data-role="result"]');
    uiState.toast = root.querySelector('[data-role="toast"]');

    // Internal listeners (on root, cleaned up with DOM removal)
    root.addEventListener('pointerdown', stopUiPropagation);
    root.addEventListener('click', stopUiPropagation);
    uiState.launcher.addEventListener('click', handleLauncherClick);
    uiState.launcher.addEventListener('pointerdown', handleLauncherPointerDown);
    uiState.launcher.addEventListener('pointermove', handleLauncherPointerMove);
    uiState.launcher.addEventListener('pointerup', handleLauncherPointerEnd);
    uiState.launcher.addEventListener('pointercancel', handleLauncherPointerEnd);
    uiState.closeBtn.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      setPanelOpen(false);
      uiState.launcher?.focus({ preventScroll: true });
    });
    uiState.refreshBtn.addEventListener('click', handleRefreshClick);
    uiState.downloadBtn.addEventListener('click', handleFloatingDownload);
    uiState.copyBtn.addEventListener('click', handleFloatingCopy);
    uiState.cancelBtn.addEventListener('click', handleCancelClick);
    uiState.diagnosticBtn.addEventListener('click', handleDiagnosticClick);

    root.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        updateModeUi(button.dataset.mode);
      });
    });

    // Global listeners with AbortController (fix #9)
    document.addEventListener('pointerdown', handleDocumentPointerDown, { capture: true, signal });
    document.addEventListener('keydown', handleDocumentKeydown, { capture: true, signal });
    document.addEventListener('visibilitychange', handleVisibilityChange, { capture: true, signal });
    window.addEventListener('resize', handleViewportResize, { capture: true, signal });

    // Load settings from chrome.storage (fix #13)
    loadSettings().then((settings) => {
      uiState.currentMode = settings.mode;
      uiState.floatingTop = settings.top;
      uiState.floatingRight = settings.right;
      updateModeUi(uiState.currentMode);
      applyFloatingPosition(
        { top: uiState.floatingTop, right: uiState.floatingRight },
        { persist: false, includePanel: false }
      );
    });

    // Apply defaults immediately while storage loads
    updateModeUi(uiState.currentMode);
    applyFloatingPosition(
      { top: uiState.floatingTop, right: uiState.floatingRight },
      { persist: false, includePanel: false }
    );

    updateProgressText(UI_TEXT.progressDefault);
    clearResult();
    syncUiControls();
  }

  // ── Settings persistence via chrome.storage (fix #13) ──────────────

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ['xpd_mode', FLOATING_TOP_STORAGE_KEY, FLOATING_RIGHT_STORAGE_KEY],
        (result) => {
          const savedMode = result?.xpd_mode;
          const savedTop = Number(result?.[FLOATING_TOP_STORAGE_KEY]);
          const savedRight = Number(result?.[FLOATING_RIGHT_STORAGE_KEY]);
          const mode = MODE_DESCS[savedMode] ? savedMode : 'embed';
          const pos = clampFloatingPosition(
            {
              top: Number.isFinite(savedTop) ? savedTop : FLOATING_DEFAULT_TOP,
              right: Number.isFinite(savedRight) ? savedRight : FLOATING_DEFAULT_RIGHT,
            },
            false
          );
          resolve({ mode, top: pos.top, right: pos.right });
        }
      );
    });
  }

  function saveMode(mode) {
    chrome.storage.local.set({ xpd_mode: mode });
  }

  function saveFloatingPosition(top, right) {
    chrome.storage.local.set({
      [FLOATING_TOP_STORAGE_KEY]: Math.round(top),
      [FLOATING_RIGHT_STORAGE_KEY]: Math.round(right),
    });
  }

  // ── HTML template (with escapeHtml, fix #1) ────────────────────────

  function getFloatingUiMarkup() {
    const h = core.escapeHtml;
    return `
      <section class="xpd-panel" id="xpd-export-panel" data-role="panel" role="dialog" aria-labelledby="xpd-panel-title" aria-hidden="true">
        <div class="xpd-panel__inner">
          <div class="xpd-header">
            <div>
              <h2 class="xpd-header__title" id="xpd-panel-title">${h(UI_TEXT.title)}</h2>
              <p class="xpd-header__meta">${h(UI_TEXT.subtitle)}</p>
            </div>
            <button class="xpd-close" data-role="closeBtn" type="button" aria-label="${h(UI_TEXT.close)}" title="${h(UI_TEXT.close)}">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"></path>
              </svg>
            </button>
          </div>
          <div class="xpd-status xpd-status--loading" data-role="status" role="status" aria-live="polite">
            <span class="xpd-status__dot"></span>
            <span data-role="statusText">${h(UI_TEXT.checking)}</span>
            <span class="xpd-status__type" data-role="statusKind">${h(PAGE_KIND_LABELS.other)}</span>
          </div>
          <div class="xpd-mode-card">
            <div class="xpd-section-title">${h(UI_TEXT.modeTitle)}</div>
            <div class="xpd-mode-selector" role="group" aria-label="${h(UI_TEXT.modeTitle)}">
              <button class="xpd-mode-btn" data-mode="link" type="button" aria-pressed="false">${h(MODE_LABELS.link)}</button>
              <button class="xpd-mode-btn" data-mode="embed" type="button" aria-pressed="false">${h(MODE_LABELS.embed)}</button>
              <button class="xpd-mode-btn" data-mode="zip" type="button" aria-pressed="false">${h(MODE_LABELS.zip)}</button>
            </div>
            <p class="xpd-mode-desc" data-role="modeDesc"></p>
          </div>
          <div class="xpd-note">${h(UI_TEXT.note)}</div>
          <div class="xpd-actions">
            <button class="xpd-btn xpd-btn--primary" data-role="downloadBtn" type="button">${h(UI_TEXT.download)}</button>
            <button class="xpd-btn xpd-btn--secondary" data-role="copyBtn" type="button">${h(UI_TEXT.copy)}</button>
            <button class="xpd-btn xpd-btn--secondary" data-role="refreshBtn" type="button">${h(UI_TEXT.refresh)}</button>
          </div>
          <div class="xpd-progress" data-role="progress" role="status" aria-live="polite">
            <span class="xpd-spinner" aria-hidden="true"></span>
            <span class="xpd-progress__details">
              <span data-role="progressText">${h(UI_TEXT.progressDefault)}</span>
              <progress class="xpd-progress__bar" data-role="progressBar" max="1" value="0" hidden></progress>
            </span>
            <button class="xpd-progress__cancel" data-role="cancelBtn" type="button">${h(UI_TEXT.cancel)}</button>
          </div>
          <button class="xpd-diagnostic" data-role="diagnosticBtn" type="button">${h(UI_TEXT.diagnostics)}</button>
          <div class="xpd-result" data-role="result" role="status" aria-live="polite"></div>
        </div>
      </section>
      <button class="xpd-launcher" data-role="launcher" type="button" aria-label="${h(UI_TEXT.launcherTitle)}" aria-controls="xpd-export-panel" aria-expanded="false" title="${h(UI_TEXT.launcherTitle)}">
        <span class="xpd-launcher__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1Zm-7 15a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"></path>
          </svg>
        </span>
        <span class="xpd-launcher__badge" data-role="launcherBadge" data-state="loading"></span>
      </button>
      <div class="xpd-toast" data-role="toast" role="status" aria-live="polite"></div>
    `;
  }

  // ── Mode management ────────────────────────────────────────────────

  function updateModeUi(mode) {
    if (!MODE_DESCS[mode]) return;
    uiState.currentMode = mode;
    saveMode(mode);
    if (uiState.root) {
      uiState.root.querySelectorAll('[data-mode]').forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle('xpd-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }
    if (uiState.modeDesc) {
      uiState.modeDesc.textContent = MODE_DESCS[mode];
    }
  }

  // ── Event handlers ─────────────────────────────────────────────────

  function stopUiPropagation(event) {
    event.stopPropagation();
  }

  function handleLauncherClick(event) {
    if (!event?.isTrusted) return;
    if (Date.now() < uiState.suppressClickUntil) return;
    const nextOpen = !uiState.open;
    setPanelOpen(nextOpen);
    if (nextOpen) refreshPanelStatus();
  }

  function handleLauncherPointerDown(event) {
    if (!event.isTrusted) return;
    if (event.button !== 0) return;
    uiState.dragPointerId = event.pointerId;
    uiState.dragStartX = event.clientX;
    uiState.dragStartY = event.clientY;
    uiState.dragStartRight = uiState.floatingRight;
    uiState.dragStartTop = uiState.floatingTop;
    uiState.dragMoved = false;
    if (uiState.launcher?.setPointerCapture) {
      uiState.launcher.setPointerCapture(event.pointerId);
    }
  }

  function handleLauncherPointerMove(event) {
    if (event.pointerId !== uiState.dragPointerId) return;
    const deltaX = event.clientX - uiState.dragStartX;
    const deltaY = event.clientY - uiState.dragStartY;
    if (!uiState.dragMoved && Math.hypot(deltaX, deltaY) < FLOATING_DRAG_THRESHOLD) return;

    if (!uiState.dragMoved) {
      uiState.dragMoved = true;
      if (uiState.root) uiState.root.classList.add('xpd-dragging');
      if (uiState.open) setPanelOpen(false);
    }
    event.preventDefault();
    applyFloatingPosition(
      { top: uiState.dragStartTop + deltaY, right: uiState.dragStartRight - deltaX },
      { persist: false, includePanel: false }
    );
  }

  function handleLauncherPointerEnd(event) {
    if (event.pointerId !== uiState.dragPointerId) return;
    if (uiState.launcher?.hasPointerCapture?.(event.pointerId)) {
      uiState.launcher.releasePointerCapture(event.pointerId);
    }
    if (uiState.dragMoved) {
      uiState.suppressClickUntil = Date.now() + 250;
      saveFloatingPosition(uiState.floatingTop, uiState.floatingRight);
    }
    if (uiState.root) uiState.root.classList.remove('xpd-dragging');
    uiState.dragPointerId = null;
    uiState.dragMoved = false;
  }

  function handleDocumentPointerDown(event) {
    if (!uiState.open || !uiState.root) return;
    if (uiState.root.contains(event.target)) return;
    setPanelOpen(false);
  }

  function handleDocumentKeydown(event) {
    if (event.key === 'Escape' && uiState.open) {
      setPanelOpen(false);
      uiState.launcher?.focus({ preventScroll: true });
    }
  }

  function handleVisibilityChange() {
    if (!document.hidden) schedulePanelStatusRefresh();
  }

  function handleViewportResize() {
    applyFloatingPosition(
      { top: uiState.floatingTop, right: uiState.floatingRight },
      { persist: false, includePanel: uiState.open }
    );
  }

  function handleRefreshClick(event) {
    if (!event?.isTrusted) return;
    setStatus('loading', UI_TEXT.refreshLoading);
    window.location.reload();
  }

  function handleCancelClick(event) {
    if (!event?.isTrusted) return;
    const cancelled = _XPD.cancelActiveExport?.();
    if (!cancelled) return;
    if (uiState.cancelBtn) {
      uiState.cancelBtn.disabled = true;
      uiState.cancelBtn.textContent = UI_TEXT.cancelling;
    }
    updateProgressText(UI_TEXT.cancelling);
  }

  async function handleDiagnosticClick(event) {
    if (!event?.isTrusted || uiState.busyCount > 0) return;
    if (uiState.diagnosticBtn) uiState.diagnosticBtn.disabled = true;
    try {
      await _XPD.copyDiagnosticReport();
      showResult('success', UI_TEXT.diagnosticsCopied);
      showToast('success', UI_TEXT.diagnosticsCopied);
    } catch {
      showResult('error', UI_TEXT.diagnosticsFailed);
      showToast('error', UI_TEXT.diagnosticsFailed);
    } finally {
      if (uiState.diagnosticBtn) uiState.diagnosticBtn.disabled = false;
    }
  }

  async function handleFloatingDownload(event) {
    if (!event?.isTrusted) return;
    const availability = refreshPanelStatus();
    if (!availability.ready) {
      showResult('error', availability.message);
      showToast('error', availability.message);
      return;
    }
    beginUiWork();
    try {
      const response = await _XPD.handleExtractAndDownload(
        { includeAuthor: true, includeTime: true, includeStats: false, includeComments: false },
        uiState.currentMode
      );
      if (response?.success) {
        const type = response.warning ? 'warning' : 'success';
        const message = response.warning
          ? `${UI_TEXT.downloadWarning}：${response.warning}`
          : UI_TEXT.downloadSuccess;
        showResult(type, message);
        showToast(type, message);
      } else {
        const message = response?.error || UI_TEXT.downloadFailed;
        showResult('error', message);
        showToast('error', message);
      }
    } catch (error) {
      const cancelled = error?.code === 'EXPORT_CANCELLED' || error?.name === 'AbortError';
      const message = cancelled
        ? UI_TEXT.cancelled
        : error?.message
          ? `${UI_TEXT.downloadFailed}: ${error.message}`
          : UI_TEXT.downloadFailed;
      showResult(cancelled ? 'warning' : 'error', message);
      showToast(cancelled ? 'warning' : 'error', message);
    } finally {
      endUiWork();
      refreshPanelStatus();
    }
  }

  async function handleFloatingCopy(event) {
    if (!event?.isTrusted) return;
    const availability = refreshPanelStatus();
    if (!availability.ready) {
      showResult('error', availability.message);
      showToast('error', availability.message);
      return;
    }
    beginUiWork();
    try {
      const response = await _XPD.handleExtractAndCopy(
        { includeAuthor: true, includeTime: true, includeStats: false, includeComments: false }
      );
      if (response?.success) {
        showResult('success', UI_TEXT.copySuccess);
        showToast('success', UI_TEXT.copySuccess);
      } else {
        const message = response?.error || UI_TEXT.copyFailed;
        showResult('error', message);
        showToast('error', message);
      }
    } catch (error) {
      const cancelled = error?.code === 'EXPORT_CANCELLED' || error?.name === 'AbortError';
      const message = cancelled
        ? UI_TEXT.cancelled
        : error?.message ? `${UI_TEXT.copyFailed}: ${error.message}` : UI_TEXT.copyFailed;
      showResult(cancelled ? 'warning' : 'error', message);
      showToast(cancelled ? 'warning' : 'error', message);
    } finally {
      endUiWork();
      refreshPanelStatus();
    }
  }

  // ── Panel open/close ───────────────────────────────────────────────

  function setPanelOpen(nextOpen) {
    uiState.open = Boolean(nextOpen);
    if (uiState.root) uiState.root.classList.toggle('xpd-open', uiState.open);
    if (uiState.panel) uiState.panel.setAttribute('aria-hidden', String(!uiState.open));
    if (uiState.launcher) uiState.launcher.setAttribute('aria-expanded', String(uiState.open));

    if (uiState.open) {
      window.requestAnimationFrame(() => {
        applyFloatingPosition(
          { top: uiState.floatingTop, right: uiState.floatingRight },
          { persist: false, includePanel: true }
        );
        uiState.closeBtn?.focus({ preventScroll: true });
      });
    }
  }

  // ── Busy / progress / result / toast ───────────────────────────────

  function beginUiWork() {
    uiState.busyCount += 1;
    clearResult();
    syncUiControls();
  }

  function endUiWork() {
    uiState.busyCount = Math.max(0, uiState.busyCount - 1);
    if (uiState.busyCount === 0) updateProgressText(UI_TEXT.progressDefault, null);
    syncUiControls();
  }

  function syncUiControls() {
    const isBusy = uiState.busyCount > 0;
    if (uiState.downloadBtn) {
      uiState.downloadBtn.disabled = isBusy || !uiState.ready;
      uiState.downloadBtn.textContent = isBusy ? UI_TEXT.processing : UI_TEXT.download;
    }
    if (uiState.copyBtn) {
      uiState.copyBtn.disabled = isBusy || !uiState.ready;
      uiState.copyBtn.textContent = UI_TEXT.copy;
    }
    if (uiState.cancelBtn) {
      uiState.cancelBtn.disabled = !isBusy;
      uiState.cancelBtn.textContent = UI_TEXT.cancel;
    }
    if (uiState.diagnosticBtn) uiState.diagnosticBtn.disabled = isBusy;
    if (uiState.progress) uiState.progress.classList.toggle('xpd-show', isBusy);
    if (uiState.launcher) uiState.launcher.classList.toggle('xpd-busy', isBusy);
  }

  function updateProgressText(text, progress = null) {
    if (uiState.progressText) uiState.progressText.textContent = text || UI_TEXT.progressDefault;
    if (uiState.progressBar) {
      const completed = Number(progress?.completed);
      const total = Number(progress?.total);
      const determinate = Number.isFinite(completed) && Number.isFinite(total) && total > 0;
      uiState.progressBar.hidden = !determinate;
      if (determinate) {
        uiState.progressBar.max = total;
        uiState.progressBar.value = Math.min(Math.max(completed, 0), total);
        uiState.progressBar.setAttribute('aria-label', `${completed}/${total}`);
      } else {
        uiState.progressBar.removeAttribute('aria-label');
      }
    }
  }

  function showResult(type, text) {
    if (!uiState.result) return;
    if (uiState.resultTimer) window.clearTimeout(uiState.resultTimer);
    uiState.result.className = `xpd-result xpd-result--${type} xpd-show`;
    uiState.result.textContent = text;
    uiState.resultTimer = window.setTimeout(() => clearResult(), 4000);
  }

  function clearResult() {
    if (!uiState.result) return;
    if (uiState.resultTimer) { window.clearTimeout(uiState.resultTimer); uiState.resultTimer = null; }
    uiState.result.className = 'xpd-result';
    uiState.result.textContent = '';
  }

  function showToast(type, text) {
    if (!uiState.toast) return;
    if (uiState.toastTimer) window.clearTimeout(uiState.toastTimer);
    uiState.toast.className = `xpd-toast xpd-toast--${type} xpd-show`;
    uiState.toast.textContent = text;
    uiState.toastTimer = window.setTimeout(() => hideToast(), 3200);
  }

  function hideToast() {
    if (!uiState.toast) return;
    if (uiState.toastTimer) { window.clearTimeout(uiState.toastTimer); uiState.toastTimer = null; }
    uiState.toast.className = 'xpd-toast';
    uiState.toast.textContent = '';
  }

  // ── Status management ──────────────────────────────────────────────

  function getPageKind() {
    const route = core.classifyPageRoute();
    if (route.kind === 'article') return 'article';
    if (route.kind === 'tweet') return core.detectArticlePage() ? 'article' : 'tweet';
    try {
      const pathname = new URL(window.location.href).pathname.replace(/\/+$/, '') || '/';
      if (pathname === '/home' || pathname.startsWith('/i/timeline')) return 'timeline';
      if (pathname === '/explore') return 'explore';
      if (pathname === '/search') return 'search';
      if (/^\/(notifications|messages|settings|jobs|compose|i)(\/|$)/i.test(pathname)) {
        return 'other';
      }
      if (/^\/[^/]+$/i.test(pathname)) return 'profile';
    } catch {
      // Keep the generic label below.
    }
    return 'other';
  }

  function getUnsupportedMessage(kind) {
    if (kind === 'timeline') return UI_TEXT.unsupportedTimeline;
    if (kind === 'explore') return UI_TEXT.unsupportedExplore;
    if (kind === 'search') return UI_TEXT.unsupportedSearch;
    if (kind === 'profile') return UI_TEXT.unsupportedProfile;
    if (kind === 'other') return UI_TEXT.unsupportedOther;
    return UI_TEXT.unsupported;
  }

  function getTopLevelTweetArticles(root = document) {
    return dom.topLevelTweets(root);
  }

  function collectTweetMediaImageUrls(root, urls) {
    if (!(root instanceof Element || root instanceof Document)) return urls;
    root.querySelectorAll(dom.css.mediaImage).forEach((img) => {
      const src = img.getAttribute('src') || img.src || '';
      if (!src || src.includes('profile_images') || src.includes('emoji') || src.includes('icon')) {
        return;
      }
      urls.add(core.upgradeImageUrl(src));
    });
    return urls;
  }

  function countTweetMediaImages(root) {
    return collectTweetMediaImageUrls(root, new Set()).size;
  }

  function countArticleMediaImages() {
    const urls = new Set();
    const containers = document.querySelectorAll(dom.css.articleContent);
    if (containers.length > 0) {
      containers.forEach((container) => collectTweetMediaImageUrls(container, urls));
      return urls.size;
    }
    const primaryColumn = document.querySelector(dom.css.primaryColumn);
    collectTweetMediaImageUrls(primaryColumn || document, urls);
    return urls.size;
  }

  function hasQuotedTweet(mainTweetEl) {
    return Boolean(mainTweetEl?.querySelector(dom.css.tweetArticle));
  }

  function hasPreviewCard(mainTweetEl) {
    if (!(mainTweetEl instanceof Element)) return false;
    return Array.from(mainTweetEl.querySelectorAll(`a[href], ${dom.css.cardMarker}`)).some((el) => {
      if (el.closest?.(dom.css.tweetText)) return false;
      if (el.closest?.(dom.css.author)) return false;
      if (el.closest?.(dom.css.actionGroup)) return false;
      if (el.querySelector?.('time')) return false;
      const isCardMarked = el.getAttribute?.(dom.attributes.testId)
        ?.toLowerCase()
        .includes(dom.tokens.card);
      const href = el.getAttribute?.('href') || '';
      const normalizedHref = core.normalizeAnchorUrl(href);
      if (/\/(status\/\d+|photo\/\d+|video\/\d+)/i.test(normalizedHref)) {
        return Boolean(isCardMarked);
      }
      return (
        isCardMarked ||
        href.includes('t.co') ||
        Boolean(normalizedHref && !/https:\/\/(x\.com|twitter\.com)\//i.test(normalizedHref))
      );
    });
  }

  function countThreadTweets(mainTweetEl) {
    if (!(mainTweetEl instanceof Element)) return 0;
    const authorHandle = core.extractAuthorInfo(mainTweetEl).handle;
    const articles = getTopLevelTweetArticles();
    const mainIndex = articles.indexOf(mainTweetEl);
    if (mainIndex < 0) return 0;

    let count = 0;
    for (let i = mainIndex + 1; i < articles.length; i += 1) {
      if (core.extractAuthorInfo(articles[i]).handle !== authorHandle) break;
      count += 1;
    }
    return count;
  }

  function getContentTags(kind, ready) {
    const labels = [PAGE_KIND_LABELS[kind] || PAGE_KIND_LABELS.other];
    if (!ready) return labels;

    if (kind === 'tweet') {
      const mainTweetEl = core.getMainTweet();
      const threadCount = countThreadTweets(mainTweetEl);
      const imageCount = countTweetMediaImages(mainTweetEl);

      if (threadCount > 0) labels.push(CONTENT_TAG_LABELS.thread);
      if (imageCount > 0) labels.push(`${imageCount} ${CONTENT_TAG_LABELS.images}`);
      if (hasQuotedTweet(mainTweetEl)) labels.push(CONTENT_TAG_LABELS.quote);
      if (hasPreviewCard(mainTweetEl)) labels.push(CONTENT_TAG_LABELS.card);
      return labels;
    }

    if (kind === 'article') {
      const imageCount = countArticleMediaImages();
      if (imageCount > 0) labels.push(`${imageCount} ${CONTENT_TAG_LABELS.images}`);
    }

    return labels;
  }

  function getContentLabel(kind, ready) {
    return getContentTags(kind, ready).join(' · ');
  }

  function setStatus(type, text, kindLabel) {
    if (uiState.status) uiState.status.className = `xpd-status xpd-status--${type}`;
    if (uiState.statusText) uiState.statusText.textContent = text;
    if (uiState.statusKind) uiState.statusKind.textContent = kindLabel || PAGE_KIND_LABELS.other;
    if (uiState.launcherBadge) uiState.launcherBadge.dataset.state = type;
  }

  function evaluatePageAvailability() {
    const kind = getPageKind();
    const kindLabel = PAGE_KIND_LABELS[kind] || PAGE_KIND_LABELS.other;

    if (kind === 'article') {
      if (!core.detectArticlePage()) {
        return {
          ready: false,
          loading: true,
          kind,
          kindLabel,
          message: UI_TEXT.notReady,
        };
      }
      return {
        ready: true,
        loading: false,
        kind,
        kindLabel: getContentLabel(kind, true),
        message: UI_TEXT.ready,
      };
    }
    if (kind === 'tweet') {
      if (core.getMainTweet()) {
        return {
          ready: true,
          loading: false,
          kind,
          kindLabel: getContentLabel(kind, true),
          message: UI_TEXT.ready,
        };
      }
      return {
        ready: false,
        loading: true,
        kind,
        kindLabel,
        message: UI_TEXT.notReady,
      };
    }
    return {
      ready: false,
      loading: false,
      kind,
      kindLabel,
      message: getUnsupportedMessage(kind),
    };
  }

  function refreshPanelStatus() {
    const availability = evaluatePageAvailability();
    uiState.ready = availability.ready;
    setStatus(
      availability.ready ? 'ok' : availability.loading ? 'loading' : 'no',
      availability.message,
      availability.kindLabel
    );
    syncUiControls();
    return availability;
  }

  function schedulePanelStatusRefresh() {
    clearScheduledPanelRefreshes();
    [0, 700, 1600].forEach((delay) => {
      const timerId = window.setTimeout(() => {
        refreshPanelStatus();
        uiState.refreshTimers = uiState.refreshTimers.filter((id) => id !== timerId);
      }, delay);
      uiState.refreshTimers.push(timerId);
    });
  }

  function clearScheduledPanelRefreshes() {
    uiState.refreshTimers.forEach((timerId) => window.clearTimeout(timerId));
    uiState.refreshTimers = [];
  }

  // ── Floating position ──────────────────────────────────────────────

  function getFloatingPadding() {
    return window.innerWidth <= 760 ? 12 : 18;
  }

  function getLauncherMetrics() {
    return {
      width: uiState.launcher?.offsetWidth || 48,
      height: uiState.launcher?.offsetHeight || 48,
    };
  }

  function getPanelGap() {
    return window.innerWidth <= 760 ? 8 : 10;
  }

  function clampFloatingPosition(position, includePanel) {
    const padding = getFloatingPadding();
    const { width: launcherWidth, height: launcherHeight } = getLauncherMetrics();
    const floatingHeight = includePanel
      ? Math.max(uiState.panel?.offsetHeight || 336, launcherHeight)
      : launcherHeight;
    const maxTop = Math.max(padding, window.innerHeight - floatingHeight - padding);
    const maxRight = Math.max(padding, window.innerWidth - launcherWidth - padding);
    return {
      top: Math.min(Math.max(position.top, padding), maxTop),
      right: Math.min(Math.max(position.right, padding), maxRight),
    };
  }

  function updatePanelPlacement() {
    if (!uiState.root) return;
    const padding = getFloatingPadding();
    const gap = getPanelGap();
    const { width: launcherWidth } = getLauncherMetrics();
    const viewportWidth = window.innerWidth;
    const maxPanelWidth = Math.min(300, Math.max(180, viewportWidth - padding * 2));
    const availableLeft = Math.max(
      180, viewportWidth - uiState.floatingRight - launcherWidth - gap - padding
    );
    const availableRight = Math.max(180, uiState.floatingRight - gap - padding);
    const nextSide =
      availableLeft >= maxPanelWidth || availableLeft >= availableRight ? 'left' : 'right';
    const availableForSide = nextSide === 'left' ? availableLeft : availableRight;
    const nextWidth = Math.max(180, Math.min(maxPanelWidth, availableForSide));

    uiState.panelSide = nextSide;
    uiState.root.classList.toggle('xpd-panel-side-left', nextSide === 'left');
    uiState.root.classList.toggle('xpd-panel-side-right', nextSide === 'right');
    uiState.root.style.setProperty('--xpd-panel-gap', `${gap}px`);
    uiState.root.style.setProperty('--xpd-panel-width', `${Math.round(nextWidth)}px`);
  }

  function applyFloatingPosition(position, options = {}) {
    const includePanel = Boolean(options.includePanel);
    const nextPosition = clampFloatingPosition(position, includePanel);
    uiState.floatingTop = nextPosition.top;
    uiState.floatingRight = nextPosition.right;

    if (uiState.root) {
      uiState.root.style.top = `${Math.round(nextPosition.top)}px`;
      uiState.root.style.right = `${Math.round(nextPosition.right)}px`;
      uiState.root.style.left = 'auto';
      uiState.root.style.bottom = 'auto';
    }
    updatePanelPlacement();
    if (options.persist !== false) {
      saveFloatingPosition(nextPosition.top, nextPosition.right);
    }
    return nextPosition;
  }

  // ── URL watcher (fix #8: save interval ID) ─────────────────────────

  function startUrlWatcher() {
    if (uiState.urlWatcherInterval) clearInterval(uiState.urlWatcherInterval);

    uiState.urlWatcherInterval = window.setInterval(() => {
      if (window.location.href === uiState.lastUrl) return;
      uiState.lastUrl = window.location.href;
      uiState.ready = false;
      const kind = getPageKind();
      setStatus('loading', UI_TEXT.checking, PAGE_KIND_LABELS[kind]);
      syncUiControls();
      clearResult();
      hideToast();
      applyFloatingPosition(
        { top: uiState.floatingTop, right: uiState.floatingRight },
        { persist: false, includePanel: uiState.open }
      );
      schedulePanelStatusRefresh();
    }, 800);
  }

  // ── Export module ──────────────────────────────────────────────────

  _XPD.ui = {
    MODE_DESCS,
    initFloatingUi,
    startUrlWatcher,
    schedulePanelStatusRefresh,
    evaluatePageAvailability,
    refreshPanelStatus,
    beginUiWork,
    endUiWork,
    updateProgressText,
    showResult,
    showToast,
  };
})();
