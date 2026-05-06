/**
 * Agent Annotation - Background Service Worker
 *
 * Injects the annotation UI, captures screenshots, and submits annotation
 * payloads to a configured HTTP endpoint.
 */

const DEFAULT_ENDPOINT = "http://localhost:3000/annotations";
const DEFAULT_REQUEST_MODE = "post";
const DEFAULT_JSONRPC_METHOD = "annotations";
const requestTabs = new Map();

function getRequestId(msg) {
  return typeof msg.requestId === "number" ? msg.requestId : (typeof msg.id === "number" ? msg.id : null);
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|edge|about|devtools|view-source):/.test(url);
}

function normalizeEndpoint(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) throw new Error("HTTP endpoint is not configured");

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("HTTP endpoint must be a valid URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("HTTP endpoint must start with http:// or https://");
  }

  return url.toString();
}

async function getEndpointUrl() {
  const stored = await chrome.storage.local.get({ annotationEndpoint: DEFAULT_ENDPOINT });
  return normalizeEndpoint(stored.annotationEndpoint);
}

async function getRequestSettings() {
  const stored = await chrome.storage.local.get({
    annotationEndpoint: DEFAULT_ENDPOINT,
    annotationRequestMode: DEFAULT_REQUEST_MODE,
    annotationJsonrpcMethod: DEFAULT_JSONRPC_METHOD,
  });

  return {
    endpointUrl: normalizeEndpoint(stored.annotationEndpoint),
    requestMode: stored.annotationRequestMode === "jsonrpc" ? "jsonrpc" : "post",
    jsonrpcMethod: String(stored.annotationJsonrpcMethod || DEFAULT_JSONRPC_METHOD).trim() || DEFAULT_JSONRPC_METHOD,
  };
}

async function getEndpointStatus() {
  try {
    const endpointUrl = await getEndpointUrl();
    return { connected: true, endpointUrl };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function postAnnotations(msg) {
  const { endpointUrl, requestMode, jsonrpcMethod } = await getRequestSettings();
  const annotationPayload = {
    source: "agent-annotation",
    type: "annotations",
    timestamp: new Date().toISOString(),
    requestId: getRequestId(msg),
    result: msg.result,
  };
  const requestBody = requestMode === "jsonrpc"
    ? {
        jsonrpc: "2.0",
        method: jsonrpcMethod,
        params: annotationPayload,
        id: annotationPayload.requestId,
      }
    : annotationPayload;

  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text().catch(() => "");
  if (!response.ok) {
    const detail = responseText ? `: ${responseText.slice(0, 300)}` : "";
    throw new Error(`Endpoint returned ${response.status} ${response.statusText}${detail}`);
  }

  return {
    ok: true,
    endpointUrl,
    requestMode,
    status: response.status,
    response: responseText,
  };
}

// Send message to content script, injecting it first if needed.
async function sendToContentScript(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (err) {
    console.log("[agent-annotation] Content script not found, injecting...");
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await new Promise(r => setTimeout(r, 100));
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (injectErr) {
      console.error("[agent-annotation] Failed to inject:", injectErr.message);
      const requestId = getRequestId(msg);
      if (requestId) requestTabs.delete(requestId);
    }
  }
}

// Wait for a tab to finish loading, then inject content script.
function injectAfterLoad(tabId, msg, requestId) {
  let timeoutId = null;
  const listener = (updatedTabId, info) => {
    if (updatedTabId === tabId && info.status === "complete") {
      if (timeoutId) clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(() => {
        if (requestId) requestTabs.set(requestId, tabId);
        sendToContentScript(tabId, msg);
      }, 150);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);

  timeoutId = setTimeout(() => {
    chrome.tabs.onUpdated.removeListener(listener);
    console.log("[agent-annotation] Navigation timeout - listener removed");
    if (requestId) requestTabs.delete(requestId);
  }, 30000);
}

async function startAnnotation(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const requestId = getRequestId(msg);

  if (!tab?.id) {
    console.log("[agent-annotation] No active tab found");
    return;
  }

  const currentUrl = tab.url;
  const restricted = isRestrictedUrl(currentUrl);
  const tabId = requestId && requestTabs.has(requestId) ? requestTabs.get(requestId) : tab.id;

  if (msg.url && (restricted || currentUrl !== msg.url)) {
    if (restricted) {
      console.log("[agent-annotation] Opening new tab:", msg.url);
      chrome.tabs.create({ url: msg.url }, (createdTab) => {
        if (chrome.runtime.lastError) {
          console.error("[agent-annotation] Failed to create tab:", chrome.runtime.lastError.message);
          return;
        }
        injectAfterLoad(createdTab.id, msg, requestId);
      });
    } else {
      console.log("[agent-annotation] Navigating to:", msg.url);
      chrome.tabs.update(tabId, { url: msg.url }, (updatedTab) => {
        if (chrome.runtime.lastError) {
          console.error("[agent-annotation] Failed to navigate:", chrome.runtime.lastError.message);
          return;
        }
        injectAfterLoad(updatedTab.id, msg, requestId);
      });
    }
    return;
  }

  if (restricted) {
    console.log("[agent-annotation] Cannot annotate restricted tab:", currentUrl);
    return;
  }

  console.log("[agent-annotation] Activating on current tab:", currentUrl);
  if (requestId) requestTabs.set(requestId, tabId);
  await sendToContentScript(tabId, msg);
}

// Toggle annotation picker on active tab (used by popup + keyboard shortcut).
async function togglePicker() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || isRestrictedUrl(tab.url)) {
      console.log("[agent-annotation] Cannot toggle picker: no valid tab");
      return;
    }
    await sendToContentScript(tab.id, { type: "TOGGLE_PICKER" });
  } catch (err) {
    console.error("[agent-annotation] Toggle picker failed:", err);
  }
}

// Handle messages from content script and popup.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[agent-annotation] Message:", msg.type);

  if (msg.type === "CHECK_CONNECTION") {
    getEndpointStatus().then(sendResponse);
    return true;
  }

  if (msg.type === "TOGGLE_PICKER") {
    togglePicker();
    return;
  }

  if (msg.type === "START_ANNOTATION") {
    startAnnotation(msg);
    return;
  }

  const requestId = getRequestId(msg);

  if (msg.type === "CAPTURE_SCREENSHOT") {
    if (!sender.tab?.windowId) {
      console.log("[agent-annotation] Screenshot failed: No window ID");
      sendResponse({ error: "No window ID" });
      return true;
    }
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.log("[agent-annotation] Screenshot error:", chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        console.log("[agent-annotation] Screenshot captured, size:", dataUrl?.length || 0);
        sendResponse({ dataUrl });
      }
    });
    return true;
  }

  if (msg.type === "ANNOTATIONS_COMPLETE") {
    if (requestId) requestTabs.delete(requestId);
    console.log("[agent-annotation] Posting annotations to HTTP endpoint");
    postAnnotations(msg)
      .then(sendResponse)
      .catch((err) => {
        console.error("[agent-annotation] Failed to post annotations:", err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  if (msg.type === "CANCEL") {
    if (requestId) requestTabs.delete(requestId);
    sendResponse({ ok: true });
  }
});

// Handle keyboard shortcut.
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-picker") {
    togglePicker();
  }
});

// Clicking the extension icon starts annotation immediately.
chrome.action.onClicked.addListener(() => {
  startAnnotation({ type: "START_ANNOTATION" });
});

console.log("[agent-annotation] Background script loaded");
