// X Markdown Exporter - Background Service Worker
// Handles cross-origin image fetching with URL whitelist validation.

const ALLOWED_IMAGE_HOSTS = new Set(['pbs.twimg.com']);
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;
const activeImageFetches = new Map();

function getImageRequestKey(sender, requestId) {
  if (sender?.tab?.id == null || !requestId) return '';
  return `${sender.tab.id}:${requestId}`;
}

function isAllowedImageUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isAllowedSender(sender) {
  if (!sender?.tab?.url) return false;
  try {
    const host = new URL(sender.tab.url).hostname.replace(/^www\./, '');
    return host === 'x.com' || host === 'twitter.com';
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CANCEL_IMAGE_FETCH') {
    if (!isAllowedSender(sender)) return false;
    const requestKey = getImageRequestKey(sender, message.requestId);
    const controller = activeImageFetches.get(requestKey);
    if (controller) controller.abort('cancelled');
    sendResponse({ success: true, cancelled: Boolean(controller) });
    return false;
  }

  if (message.type !== 'FETCH_IMAGE') return false;

  if (!isAllowedSender(sender)) {
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return false;
  }

  if (!isAllowedImageUrl(message.url)) {
    sendResponse({ success: false, error: 'URL not in allowed hosts' });
    return false;
  }

  const requestKey = getImageRequestKey(sender, message.requestId);
  const controller = new AbortController();
  if (requestKey) activeImageFetches.set(requestKey, controller);

  fetchAsBase64(message.url, controller)
    .then((data) => sendResponse({ success: true, data }))
    .catch((err) => sendResponse({
      success: false,
      cancelled: err?.code === 'CANCELLED',
      error: err.message,
    }))
    .finally(() => {
      if (requestKey) activeImageFetches.delete(requestKey);
    });
  return true;
});

async function fetchAsBase64(url, controller = new AbortController()) {
  let fetchUrl = url;
  if (fetchUrl.includes('pbs.twimg.com') && fetchUrl.includes('/media')) {
    fetchUrl = fetchUrl.replace(/&name=\w+/, '&name=large');
    if (!fetchUrl.includes('name=')) {
      fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'name=large';
    }
  }

  const timeoutId = setTimeout(() => controller.abort('timeout'), IMAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(fetchUrl, {
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!isAllowedImageUrl(response.url)) throw new Error('Redirected outside allowed hosts');

    const contentType = (response.headers.get('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new Error(`Unsupported image type: ${contentType || 'unknown'}`);
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds 25 MB limit');
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('Image exceeds 25 MB limit');
    }
    const uint8Array = new Uint8Array(arrayBuffer);

    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize));
    }

    return {
      base64: btoa(binary),
      contentType,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (controller.signal.reason === 'cancelled') {
        const cancelledError = new Error('Image fetch cancelled');
        cancelledError.code = 'CANCELLED';
        throw cancelledError;
      }
      throw new Error('Image fetch timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
