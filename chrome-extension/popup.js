// Pi Annotate - Popup Script

const DEFAULT_ENDPOINT = "http://localhost:3000/annotations";

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const endpointInput = document.getElementById("endpoint-url");
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
  const stored = await chrome.storage.local.get({ annotationEndpoint: DEFAULT_ENDPOINT });
  endpointInput.value = stored.annotationEndpoint || DEFAULT_ENDPOINT;
  const error = validateEndpoint(endpointInput.value);
  if (error) {
    setInvalid(error);
  } else {
    setConfigured(endpointInput.value.trim());
  }
}

async function saveEndpoint() {
  const endpoint = endpointInput.value.trim();
  const error = validateEndpoint(endpoint);
  if (error) {
    setInvalid(error);
    endpointInput.focus();
    return;
  }

  await chrome.storage.local.set({ annotationEndpoint: endpoint });
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

startBtn.addEventListener("click", async () => {
  const error = validateEndpoint(endpointInput.value);
  if (error) {
    setInvalid(error);
    return;
  }

  await chrome.runtime.sendMessage({ type: "TOGGLE_PICKER" });
  window.close();
});

loadEndpoint().catch((err) => {
  setInvalid(err instanceof Error ? err.message : String(err));
});
