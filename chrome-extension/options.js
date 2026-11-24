// Agent Annotation - Options Script

const DEFAULT_ENDPOINT = "http://localhost:3000/annotations";
const DEFAULT_REQUEST_MODE = "post";
const DEFAULT_JSONRPC_METHOD = "annotations";
const DEFAULT_SELECT_DRAG = "arrow";
const DEFAULT_DRAW_COLOR = "#ff0000";

const endpointInput = document.getElementById("endpoint-url");
const requestModeInput = document.getElementById("request-mode");
const jsonrpcMethodInput = document.getElementById("jsonrpc-method");
const jsonrpcMethodSection = document.getElementById("jsonrpc-method-section");
const modelsInput = document.getElementById("models");
const selectDragInput = document.getElementById("select-drag");
const drawColorInput = document.getElementById("draw-color");
const drawColorResetBtn = document.getElementById("draw-color-reset");

function normalizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value.toLowerCase() : DEFAULT_DRAW_COLOR;
}
const saveBtn = document.getElementById("save-endpoint");
const messageEl = document.getElementById("endpoint-message");

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

async function loadEndpoint() {
  const stored = await chrome.storage.local.get({
    annotationEndpoint: DEFAULT_ENDPOINT,
    annotationRequestMode: DEFAULT_REQUEST_MODE,
    annotationJsonrpcMethod: DEFAULT_JSONRPC_METHOD,
    annotationModels: [],
    annotationSelectDrag: DEFAULT_SELECT_DRAG,
    annotationDrawColor: DEFAULT_DRAW_COLOR,
  });
  drawColorInput.value = normalizeColor(stored.annotationDrawColor);
  endpointInput.value = stored.annotationEndpoint || DEFAULT_ENDPOINT;
  selectDragInput.value = stored.annotationSelectDrag === "region" ? "region" : "arrow";
  requestModeInput.value = stored.annotationRequestMode === "jsonrpc" ? "jsonrpc" : "post";
  jsonrpcMethodInput.value = stored.annotationJsonrpcMethod || DEFAULT_JSONRPC_METHOD;
  modelsInput.value = formatModels(stored.annotationModels);
  updateJsonrpcMethodVisibility();
  setMessage(`Annotations will be POSTed to ${endpointInput.value.trim()}`, "success");
}

async function saveEndpoint() {
  const endpoint = endpointInput.value.trim();
  const requestMode = getRequestMode();
  const jsonrpcMethod = jsonrpcMethodInput.value.trim() || DEFAULT_JSONRPC_METHOD;
  const models = normalizeModels(modelsInput.value);
  const error = validateEndpoint(endpoint);
  const methodError = validateJsonrpcMethod(jsonrpcMethod);
  if (error || methodError) {
    setMessage(error || methodError, "error");
    endpointInput.focus();
    return;
  }

  await chrome.storage.local.set({
    annotationEndpoint: endpoint,
    annotationRequestMode: requestMode,
    annotationJsonrpcMethod: jsonrpcMethod,
    annotationModels: models,
    annotationSelectDrag: selectDragInput.value === "region" ? "region" : "arrow",
    annotationDrawColor: normalizeColor(drawColorInput.value),
  });
  setMessage(`Settings saved. Annotations will be POSTed to ${endpoint}`, "success");
}

saveBtn.addEventListener("click", saveEndpoint);

endpointInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveEndpoint();
});

endpointInput.addEventListener("input", () => {
  const error = validateEndpoint(endpointInput.value);
  setMessage(error || "Unsaved endpoint", error ? "error" : "");
});

requestModeInput.addEventListener("change", () => {
  updateJsonrpcMethodVisibility();
  setMessage("Unsaved request type", "");
});

jsonrpcMethodInput.addEventListener("input", () => {
  const error = validateJsonrpcMethod(jsonrpcMethodInput.value);
  setMessage(error || "Unsaved JSON-RPC method", error ? "error" : "");
});

modelsInput.addEventListener("input", () => {
  setMessage("Unsaved models", "");
});

selectDragInput.addEventListener("change", () => {
  setMessage("Unsaved drag setting", "");
});

drawColorInput.addEventListener("input", () => {
  setMessage("Unsaved color", "");
});

drawColorResetBtn.addEventListener("click", () => {
  drawColorInput.value = DEFAULT_DRAW_COLOR;
  setMessage("Unsaved color", "");
});

loadEndpoint().catch((err) => {
  setMessage(err instanceof Error ? err.message : String(err), "error");
});
