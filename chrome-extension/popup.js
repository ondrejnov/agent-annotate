// Agent Annotation - Popup Script

const DEFAULT_ENDPOINT = "http://localhost:3000/annotations";
const DEFAULT_REQUEST_MODE = "post";
const DEFAULT_JSONRPC_METHOD = "annotations";

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const endpointInput = document.getElementById("endpoint-url");
const requestModeInput = document.getElementById("request-mode");
const jsonrpcMethodInput = document.getElementById("jsonrpc-method");
const jsonrpcMethodSection = document.getElementById("jsonrpc-method-section");
const modelsInput = document.getElementById("models");
const saveBtn = document.getElementById("save-endpoint");
const startBtn = document.getElementById("start-btn");
const messageEl = document.getElementById("endpoint-message");

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
const shortcutEl = document.getElementById("shortcut-key");
if (shortcutEl) {
  shortcutEl.textContent = isMac ? "⌘ Shift P" : "Ctrl+Shift+P";
}

function validateEndpoint(value) {
  const endpoint = String(value || "").trim();
  if (!endpoint) return "Endpoint URL is required";

  try {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "Use http:// or https://";
    }
  } catch {
    return "Enter a valid URL";
  }

  return "";
}

function setMessage(text, kind = "") {
  messageEl.textContent = text || "";
  messageEl.className = kind ? `message ${kind}` : "message";
}

function getRequestMode() {
  return requestModeInput.value === "jsonrpc" ? "jsonrpc" : "post";
}

function updateJsonrpcMethodVisibility() {
  jsonrpcMethodSection.style.display = getRequestMode() === "jsonrpc" ? "block" : "none";
}

function validateJsonrpcMethod(value) {
  if (getRequestMode() !== "jsonrpc") return "";
  return String(value || "").trim() ? "" : "JSON-RPC method is required";
}

function normalizeModels(value) {
  const rawModels = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  const seen = new Set();
  return rawModels
    .map(model => {
      if (model && typeof model === "object") {
        return {
          id: String(model.id || "").trim(),
          label: String(model.label || model.id || "").trim(),
        };
      }

      const raw = String(model || "").trim();
      const separator = raw.indexOf(":");
      const id = separator >= 0 ? raw.slice(0, separator).trim() : raw;
      const label = separator >= 0 ? raw.slice(separator + 1).trim() : raw;
      return { id, label: label || id };
    })
    .filter(model => {
      if (!model.id || seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
}

function formatModels(models) {
  return normalizeModels(models)
    .map(model => model.label === model.id ? model.id : `${model.id}:${model.label}`)
    .join("\n");
}

function setConfigured(endpointUrl) {
  statusDot.className = "status-dot connected";
  statusText.textContent = "Endpoint configured";
  startBtn.disabled = false;
  setMessage(`Annotations will be POSTed to ${endpointUrl}`, "success");
}

function setInvalid(error) {
  statusDot.className = "status-dot";
  statusText.textContent = "Endpoint missing";
  startBtn.disabled = true;
  setMessage(error, "error");
}

async function loadEndpoint() {
  const stored = await chrome.storage.local.get({
    annotationEndpoint: DEFAULT_ENDPOINT,
    annotationRequestMode: DEFAULT_REQUEST_MODE,
    annotationJsonrpcMethod: DEFAULT_JSONRPC_METHOD,
    annotationModels: [],
  });
  endpointInput.value = stored.annotationEndpoint || DEFAULT_ENDPOINT;
  requestModeInput.value = stored.annotationRequestMode === "jsonrpc" ? "jsonrpc" : "post";
  jsonrpcMethodInput.value = stored.annotationJsonrpcMethod || DEFAULT_JSONRPC_METHOD;
  modelsInput.value = formatModels(stored.annotationModels);
  updateJsonrpcMethodVisibility();
  const error = validateEndpoint(endpointInput.value);
  const methodError = validateJsonrpcMethod(jsonrpcMethodInput.value);
  if (error || methodError) {
    setInvalid(error || methodError);
  } else {
    setConfigured(endpointInput.value.trim());
  }
}

async function saveEndpoint() {
  const endpoint = endpointInput.value.trim();
  const requestMode = getRequestMode();
  const jsonrpcMethod = jsonrpcMethodInput.value.trim() || DEFAULT_JSONRPC_METHOD;
  const models = normalizeModels(modelsInput.value);
  const error = validateEndpoint(endpoint);
  const methodError = validateJsonrpcMethod(jsonrpcMethod);
  if (error || methodError) {
    setInvalid(error || methodError);
    endpointInput.focus();
    return;
  }

  await chrome.storage.local.set({
    annotationEndpoint: endpoint,
    annotationRequestMode: requestMode,
    annotationJsonrpcMethod: jsonrpcMethod,
    annotationModels: models,
  });
  setConfigured(endpoint);
}

saveBtn.addEventListener("click", saveEndpoint);

endpointInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveEndpoint();
});

endpointInput.addEventListener("input", () => {
  const error = validateEndpoint(endpointInput.value);
  if (error) {
    setInvalid(error);
  } else {
    statusDot.className = "status-dot checking";
    statusText.textContent = "Unsaved endpoint";
    startBtn.disabled = true;
    setMessage("Save endpoint before starting annotation.", "warning");
  }
});

requestModeInput.addEventListener("change", () => {
  updateJsonrpcMethodVisibility();
  statusDot.className = "status-dot checking";
  statusText.textContent = "Unsaved request type";
  startBtn.disabled = true;
  setMessage("Save settings before starting annotation.", "warning");
});

jsonrpcMethodInput.addEventListener("input", () => {
  statusDot.className = "status-dot checking";
  statusText.textContent = "Unsaved JSON-RPC method";
  startBtn.disabled = true;
  setMessage("Save settings before starting annotation.", "warning");
});

modelsInput.addEventListener("input", () => {
  statusDot.className = "status-dot checking";
  statusText.textContent = "Unsaved models";
  startBtn.disabled = true;
  setMessage("Save settings before starting annotation.", "warning");
});

startBtn.addEventListener("click", async () => {
  const error = validateEndpoint(endpointInput.value);
  const methodError = validateJsonrpcMethod(jsonrpcMethodInput.value);
  if (error || methodError) {
    setInvalid(error || methodError);
    return;
  }

  await chrome.runtime.sendMessage({ type: "TOGGLE_PICKER" });
  window.close();
});

loadEndpoint().catch((err) => {
  setInvalid(err instanceof Error ? err.message : String(err));
});
