// Postcase - UI Module
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
    link: t('mode_link_desc', '图片保留为在线链接，文件较小。'),
    embed: t('mode_embed_desc', '图片压缩后写入 Markdown，保存为单个文件。'),
    zip: t('mode_zip_desc', 'Markdown 与原始图片一起打包。'),
  });

  const UI_TEXT = Object.freeze({
    launcherTitle: t('launcher_title', 'X帖匣 · Postcase，拖动可移动'),
    title: t('brand_name', 'X帖匣 · Postcase'),
    modeTitle: t('download_format', '导出模式'),
    checking: t('checking', '检测中...'),
    ready: t('ready', '可以导出'),
    unsupported: t('unsupported', '请打开 X 推文详情页或 Note 页面'),
    notReady: t('not_ready', '正在等待推文内容加载；如果一直不动，请刷新页面或重新打开详情页'),
    unsupportedTimeline: t('unsupported_timeline', '时间线暂不直接导出；请点开某条推文详情页后再下载或复制'),
    unsupportedExplore: t('unsupported_explore', '探索页暂不直接导出；请打开一条推文详情页或 Note 页面'),
    unsupportedSearch: t('unsupported_search', '搜索页暂不直接导出；请打开搜索结果里的某条推文详情页'),
    unsupportedProfile: t('unsupported_profile', '主页暂不直接导出；请打开一条推文详情页或 Note 页面'),
    unsupportedOther: t('unsupported_other', '当前页面暂不支持导出；请打开 X 推文详情页或 Note 页面'),
    note: t('metadata_note', '附带作者、时间和原文链接'),
    copyHint: t('copy_link_hint', '复制始终使用图片链接。'),
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
    cancelling: false,
    diagnosticBusy: false,
    modeChanged: false,
    positionChanged: false,
    pendingMode: null,
    lastUrl: window.location.href,
    resultTimer: null,
    toastTimer: null,
    refreshTimers: [],
    urlWatcherInterval: null,
    abortController: null,
    contentObserver: null,
    panelObserver: null,
    statusTimer: null,
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
    uiState.contentObserver?.disconnect();
    uiState.panelObserver?.disconnect();
    clearScheduledPanelRefreshes();
    window.clearTimeout(uiState.statusTimer);
    clearResult();
    hideToast();
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
    root.className = 'xpd-surface';
    root.innerHTML = getFloatingUiMarkup();

    (document.body || document.documentElement).appendChild(root);

    uiState.root = root;
    uiState.launcher = root.querySelector('[data-role="launcher"]');
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
        if (uiState.busyCount > 0) return;
        uiState.modeChanged = true;
        updateModeUi(button.dataset.mode);
      });
    });

    // Global listeners with AbortController (fix #9)
    document.addEventListener('pointerdown', handleDocumentPointerDown, { capture: true, signal });
    document.addEventListener('keydown', handleDocumentKeydown, { capture: true, signal });
    document.addEventListener('visibilitychange', handleVisibilityChange, { capture: true, signal });
    window.addEventListener('resize', handleViewportResize, { capture: true, signal });

    const handleStorageChange = (changes, area) => {
      if (area !== 'local' || !Object.hasOwn(changes, 'xpd_mode')) return;
      const mode = changes.xpd_mode.newValue || 'embed';
      if (!Object.hasOwn(MODE_DESCS, mode)) return;
      uiState.modeChanged = true;
      if (uiState.busyCount > 0) uiState.pendingMode = mode;
      else updateModeUi(mode, { persist: false });
    };
    chrome.storage.onChanged?.addListener(handleStorageChange);
    signal.addEventListener('abort', () => {
      chrome.storage.onChanged?.removeListener(handleStorageChange);
    }, { once: true });

    // Load settings from chrome.storage (fix #13)
    loadSettings().then((settings) => {
      if (uiState.root !== root) return;
      if (!uiState.modeChanged) updateModeUi(settings.mode, { persist: false });
      if (!uiState.positionChanged) {
        applyFloatingPosition(settings, { persist: false });
      }
    });

    // Apply defaults immediately while storage loads
    updateModeUi(uiState.currentMode, { persist: false });
    applyFloatingPosition(
      { top: uiState.floatingTop, right: uiState.floatingRight },
      { persist: false, includePanel: false }
    );

    updateProgressText(UI_TEXT.progressDefault);
    clearResult();
    syncUiControls();

    // X can render its body long after the route changes. Ignore our own writes.
    uiState.contentObserver = new MutationObserver((records) => {
      if (document.hidden || !records.some((record) => !root.contains(record.target))) return;
      const kind = core.classifyPageRoute().kind;
      if (kind !== 'tweet' && kind !== 'article') return;
      if (uiState.statusTimer) return;
      uiState.statusTimer = window.setTimeout(() => {
        uiState.statusTimer = null;
        refreshPanelStatus();
      }, 250);
    });
    uiState.contentObserver.observe(document.body || document.documentElement, {
      childList: true, subtree: true, characterData: true,
    });
    if (typeof ResizeObserver !== 'undefined') {
      uiState.panelObserver = new ResizeObserver(() => {
        if (uiState.open) updatePanelPlacement();
      });
      uiState.panelObserver.observe(uiState.panel);
    }
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
          const mode = Object.hasOwn(MODE_DESCS, savedMode) ? savedMode : 'embed';
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
    // Generated from icons/postcase.svg by scripts/generate-brand-assets.js.
    /* postcase-mark:start */
    const brandMark = "<svg class=\"xpd-brand-mark\" aria-hidden=\"true\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\" fill=\"none\">\n  <rect width=\"64\" height=\"64\" rx=\"14\" fill=\"#A9D5F3\"/>\n  <path d=\"M18 10H36L46 20V38H18V10Z\" fill=\"#F7FBFF\"/>\n  <path d=\"M36 10V20H46L36 10Z\" fill=\"#669FC6\"/>\n  <path d=\"M24 25H39M24 31H34\" stroke=\"#2B5D80\" stroke-width=\"3\"/>\n  <path d=\"M12 39V50C12 52.2 13.8 54 16 54H48C50.2 54 52 52.2 52 50V39\" stroke=\"#2B5D80\" stroke-width=\"4\"/>\n</svg>";
    /* postcase-mark:end */
    return `
      <section class="xpd-panel" id="xpd-export-panel" data-role="panel" role="dialog" aria-labelledby="xpd-panel-title" aria-hidden="true" inert>
        <div class="xpd-panel__inner">
          <div class="xpd-header">
            <div class="xpd-brand">
              <span class="xpd-brand-icon" aria-hidden="true">${brandMark}</span>
              <div><h2 class="xpd-header__title" id="xpd-panel-title">${h(UI_TEXT.title)}</h2>
              <span class="xpd-brand-purpose">X → Markdown</span></div>
            </div>
            <button class="xpd-close" data-role="closeBtn" type="button" aria-label="${h(UI_TEXT.close)}" title="${h(UI_TEXT.close)}">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18"></path>
              </svg>
            </button>
          </div>
          <div class="xpd-status xpd-status--loading" data-role="status" role="status" aria-live="polite">
            <span data-role="statusText">${h(UI_TEXT.checking)}</span>
            <span class="xpd-status__type" data-role="statusKind">${h(PAGE_KIND_LABELS.other)}</span>
          </div>
          <div class="xpd-format">
            <div class="xpd-section-title">${h(UI_TEXT.modeTitle)}</div>
            <div class="xpd-mode-selector" role="group" aria-label="${h(UI_TEXT.modeTitle)}">
              <button class="xpd-mode-btn" data-mode="link" type="button" aria-pressed="false">${h(MODE_LABELS.link)}</button>
              <button class="xpd-mode-btn" data-mode="embed" type="button" aria-pressed="false">${h(MODE_LABELS.embed)}</button>
              <button class="xpd-mode-btn" data-mode="zip" type="button" aria-pressed="false">${h(MODE_LABELS.zip)}</button>
            </div>
            <p class="xpd-mode-desc" data-role="modeDesc"></p>
          </div>
          <div class="xpd-actions">
            <button class="xpd-btn xpd-btn--primary" data-role="downloadBtn" type="button">${h(UI_TEXT.download)}</button>
            <button class="xpd-btn xpd-btn--secondary" data-role="copyBtn" type="button" aria-describedby="xpd-copy-hint">${h(UI_TEXT.copy)}</button>
          </div>
          <p class="xpd-note">${h(UI_TEXT.note)}<br><span id="xpd-copy-hint">${h(UI_TEXT.copyHint)}</span></p>
          <div class="xpd-progress" data-role="progress" role="status" aria-live="polite">
            <span class="xpd-spinner" aria-hidden="true"></span>
            <span class="xpd-progress__details">
              <span data-role="progressText">${h(UI_TEXT.progressDefault)}</span>
              <progress class="xpd-progress__bar" data-role="progressBar" max="1" value="0" hidden></progress>
            </span>
            <button class="xpd-progress__cancel" data-role="cancelBtn" type="button">${h(UI_TEXT.cancel)}</button>
          </div>
          <div class="xpd-result" data-role="result" role="status" aria-live="polite"></div>
          <div class="xpd-footer">
            <span>v${h(chrome.runtime.getManifest().version)}</span>
            <div class="xpd-footer__tools">
              <button class="xpd-text-btn" data-role="refreshBtn" type="button">${h(UI_TEXT.refresh)}</button>
              <button class="xpd-text-btn" data-role="diagnosticBtn" type="button">${h(UI_TEXT.diagnostics)}</button>
            </div>
          </div>
        </div>
      </section>
      <button class="xpd-launcher" data-role="launcher" type="button" aria-label="${h(UI_TEXT.launcherTitle)}" aria-controls="xpd-export-panel" aria-expanded="false" title="${h(UI_TEXT.launcherTitle)}">
        <span class="xpd-launcher__icon" aria-hidden="true">
          ${brandMark}
        </span>
      </button>
      <div class="xpd-toast" data-role="toast" role="status" aria-live="polite"></div>
    `;
  }

  // ── Mode management ────────────────────────────────────────────────

  function updateModeUi(mode, { persist = true } = {}) {
    if (!Object.hasOwn(MODE_DESCS, mode)) return;
    uiState.currentMode = mode;
    if (persist) saveMode(mode);
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
    if (!event.isTrusted) return;
    if (event.pointerId !== uiState.dragPointerId) return;
    const deltaX = event.clientX - uiState.dragStartX;
    const deltaY = event.clientY - uiState.dragStartY;
    if (!uiState.dragMoved && Math.hypot(deltaX, deltaY) < FLOATING_DRAG_THRESHOLD) return;

    if (!uiState.dragMoved) {
      uiState.dragMoved = true;
      uiState.positionChanged = true;
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
    if (!event.isTrusted) return;
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
    if (!event.isTrusted) return;
    if (event.key === 'Escape' && uiState.open && uiState.root?.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
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
    if (uiState.busyCount > 0 || uiState.diagnosticBusy) return;
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
    if (!event?.isTrusted || uiState.busyCount > 0 || uiState.diagnosticBusy) return;
    clearResult();
    try {
      await _XPD.copyDiagnosticReport();
      showResult('success', UI_TEXT.diagnosticsCopied);
      showToast('success', UI_TEXT.diagnosticsCopied);
    } catch {
      showResult('error', UI_TEXT.diagnosticsFailed);
      showToast('error', UI_TEXT.diagnosticsFailed);
    }
  }

  async function runFloatingAction(event, action) {
    if (!event?.isTrusted) return;
    if (uiState.busyCount > 0 || uiState.diagnosticBusy) return;
    const availability = refreshPanelStatus();
    if (!availability.ready) {
      showResult('warning', availability.message);
      return;
    }
    try {
      // The entry point owns the job state and result for both UI entry points.
      await action();
    } catch {
      // runExportJob has already displayed the failure or cancellation.
    }
  }

  function handleFloatingDownload(event) {
    return runFloatingAction(event, () => _XPD.handleExtractAndDownload(
      { includeAuthor: true, includeTime: true, includeStats: false, includeComments: false },
      uiState.currentMode
    ));
  }

  function handleFloatingCopy(event) {
    return runFloatingAction(event, () => _XPD.handleExtractAndCopy(
      { includeAuthor: true, includeTime: true, includeStats: false, includeComments: false }
    ));
  }

  // ── Panel open/close ───────────────────────────────────────────────

  function setPanelOpen(nextOpen) {
    const open = Boolean(nextOpen);
    if (!open && uiState.panel?.contains(document.activeElement)) {
      uiState.launcher?.focus({ preventScroll: true });
    }
    uiState.open = open;
    if (uiState.panel) {
      uiState.panel.inert = !open;
      uiState.panel.setAttribute('aria-hidden', String(!open));
    }
    uiState.launcher?.setAttribute('aria-expanded', String(open));
    if (open) {
      hideToast();
      updatePanelPlacement();
    }
    uiState.root?.classList.toggle('xpd-open', open);
    if (open) {
      window.requestAnimationFrame(() => {
        if (uiState.open) uiState.closeBtn?.focus({ preventScroll: true });
      });
    }
  }

  // ── Busy / progress / result / toast ───────────────────────────────

  function beginUiWork() {
    uiState.busyCount += 1;
    uiState.cancelling = false;
    clearResult();
    hideToast();
    syncUiControls();
  }

  function endUiWork() {
    uiState.busyCount = Math.max(0, uiState.busyCount - 1);
    if (uiState.busyCount === 0) {
      uiState.cancelling = false;
      updateProgressText(UI_TEXT.progressDefault, null);
      if (uiState.pendingMode) {
        updateModeUi(uiState.pendingMode, { persist: false });
        uiState.pendingMode = null;
      }
    }
    syncUiControls();
  }

  function syncUiControls() {
    const isBusy = uiState.busyCount > 0;
    const controlsLocked = isBusy || uiState.diagnosticBusy;
    if (uiState.downloadBtn) {
      uiState.downloadBtn.disabled = controlsLocked || !uiState.ready;
      uiState.downloadBtn.textContent = isBusy ? UI_TEXT.processing : UI_TEXT.download;
    }
    if (uiState.copyBtn) {
      uiState.copyBtn.disabled = controlsLocked || !uiState.ready;
      uiState.copyBtn.textContent = UI_TEXT.copy;
    }
    if (uiState.cancelBtn) {
      uiState.cancelBtn.disabled = !isBusy || uiState.cancelling;
      uiState.cancelBtn.textContent = uiState.cancelling ? UI_TEXT.cancelling : UI_TEXT.cancel;
    }
    if (uiState.diagnosticBtn) uiState.diagnosticBtn.disabled = controlsLocked;
    if (uiState.refreshBtn) uiState.refreshBtn.disabled = controlsLocked;
    uiState.root?.querySelectorAll('[data-mode]').forEach((button) => {
      button.disabled = controlsLocked;
    });
    if (uiState.progress) uiState.progress.classList.toggle('xpd-show', isBusy);
    if (uiState.launcher) uiState.launcher.classList.toggle('xpd-busy', isBusy);
  }

  function setDiagnosticBusy(busy) {
    uiState.diagnosticBusy = Boolean(busy);
    syncUiControls();
  }

  function updateProgressText(text, progress = null) {
    if (text === UI_TEXT.cancelling) {
      uiState.cancelling = true;
      syncUiControls();
    }
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
    uiState.resultTimer = type === 'success'
      ? window.setTimeout(() => clearResult(), 4000)
      : null;
    if (uiState.open) updatePanelPlacement();
  }

  function clearResult() {
    if (!uiState.result) return;
    if (uiState.resultTimer) { window.clearTimeout(uiState.resultTimer); uiState.resultTimer = null; }
    uiState.result.className = 'xpd-result';
    uiState.result.textContent = '';
  }

  function showToast(type, text) {
    if (!uiState.toast) return;
    if (uiState.open) return;
    if (uiState.toastTimer) window.clearTimeout(uiState.toastTimer);
    uiState.toast.className = `xpd-toast xpd-toast--${type} xpd-show`;
    uiState.toast.textContent = text;
    uiState.toastTimer = window.setTimeout(() => hideToast(), 5000);
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
      if (!src) return;
      urls.add(core.upgradeImageUrl(src));
    });
    return urls;
  }

  function countTweetMediaImages(root) {
    return collectTweetMediaImageUrls(root, new Set()).size;
  }

  function countArticleMediaImages() {
    const urls = new Set();
    core.getArticleContext().containers.forEach((container) => collectTweetMediaImageUrls(container, urls));
    return urls.size;
  }

  function hasQuotedTweet(mainTweetEl) {
    return Boolean(mainTweetEl?.querySelector(dom.css.tweetArticle));
  }

  function hasPreviewCard(mainTweetEl) {
    if (!(mainTweetEl instanceof Element)) return false;
    return Array.from(mainTweetEl.querySelectorAll('a[href]')).some(core.isPreviewCardAnchor);
  }

  function countThreadTweets(mainTweetEl) {
    if (!(mainTweetEl instanceof Element)) return 0;
    const authorHandle = core.extractAuthorInfo(mainTweetEl).handle;
    if (!authorHandle || authorHandle === '@unknown') return 0;
    const articles = getTopLevelTweetArticles();
    const mainIndex = articles.indexOf(mainTweetEl);
    if (mainIndex < 0) return 0;

    let count = 0;
    for (let i = mainIndex + 1; i < articles.length; i += 1) {
      if (core.extractAuthorInfo(articles[i]).handle !== authorHandle) break;
      if (!core.hasVerifiedThreadRelation?.(articles[i], authorHandle)) break;
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
    if (uiState.launcher) uiState.launcher.dataset.state = type;
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

  function clampFloatingPosition(position) {
    const padding = getFloatingPadding();
    const { width, height } = getLauncherMetrics();
    const maxTop = Math.max(padding, window.innerHeight - height - padding);
    const maxRight = Math.max(padding, window.innerWidth - width - padding);
    return {
      top: Math.min(Math.max(position.top, padding), maxTop),
      right: Math.min(Math.max(position.right, padding), maxRight),
    };
  }

  function updatePanelPlacement() {
    if (!uiState.root || !uiState.panel) return;
    const padding = getFloatingPadding();
    const gap = getPanelGap();
    const { width: launcherWidth, height: launcherHeight } = getLauncherMetrics();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.max(1, Math.min(320, viewportWidth - padding * 2));
    const maxHeight = Math.max(1, viewportHeight - padding * 2);
    uiState.root.style.setProperty('--xpd-panel-width', `${width}px`);
    uiState.panel.style.maxHeight = `${maxHeight}px`;
    const height = Math.min(uiState.panel.offsetHeight || 360, maxHeight);
    const launcherLeft = viewportWidth - uiState.floatingRight - launcherWidth;
    const leftRoom = launcherLeft - gap - padding;
    const rightRoom = uiState.floatingRight - gap - padding;
    let left;
    let top = uiState.floatingTop;

    if (leftRoom >= width) {
      left = launcherLeft - gap - width;
    } else if (rightRoom >= width) {
      left = launcherLeft + launcherWidth + gap;
    } else {
      // At narrow widths, keep a readable panel and place it above/below the handle.
      left = Math.min(Math.max(padding, launcherLeft + launcherWidth - width), viewportWidth - width - padding);
      const below = uiState.floatingTop + launcherHeight + gap;
      top = below + height <= viewportHeight - padding
        ? below
        : uiState.floatingTop - gap - height;
    }
    top = Math.min(Math.max(top, padding), Math.max(padding, viewportHeight - height - padding));
    uiState.root.style.setProperty('--xpd-panel-left', `${Math.round(left)}px`);
    uiState.root.style.setProperty('--xpd-panel-top', `${Math.round(top)}px`);
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
    setDiagnosticBusy,
    updateProgressText,
    showResult,
    showToast,
  };
})();
