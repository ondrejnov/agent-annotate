// Agent Annotation - Options Script

const DEFAULT_ENDPOINT = "http://localhost:3000/annotations";

const endpointInput = document.getElementById("endpoint-url");
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

async function loadEndpoint() {
  const stored = await chrome.storage.local.get({ annotationEndpoint: DEFAULT_ENDPOINT });
  endpointInput.value = stored.annotationEndpoint || DEFAULT_ENDPOINT;
  setMessage(`Annotations will be POSTed to ${endpointInput.value.trim()}`, "success");
}

async function saveEndpoint() {
  const endpoint = endpointInput.value.trim();
  const error = validateEndpoint(endpoint);
  if (error) {
    setMessage(error, "error");
    endpointInput.focus();
    return;
  }

  await chrome.storage.local.set({ annotationEndpoint: endpoint });
  setMessage(`Saved. Annotations will be POSTed to ${endpoint}`, "success");
}

saveBtn.addEventListener("click", saveEndpoint);

endpointInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveEndpoint();
});

endpointInput.addEventListener("input", () => {
  const error = validateEndpoint(endpointInput.value);
  setMessage(error || "Unsaved endpoint", error ? "error" : "");
});

loadEndpoint().catch((err) => {
  setMessage(err instanceof Error ? err.message : String(err), "error");
});
