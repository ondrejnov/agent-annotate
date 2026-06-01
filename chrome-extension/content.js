/**
 * Agent Annotation - Content Script (v0.4.0)
 * 
 * DevTools-like element picker with inline note cards:
 * - Hover to highlight elements
 * - Alt/Option+scroll to cycle through parent elements
 * - Click to select (shift+click for multi)
 * - Per-element floating note cards with comments
 * - Bottom panel for overall context
 */

(() => {
  // Prevent double-injection (use Symbol for unique key to avoid conflicts)
  const LOADED_KEY = "__agentAnnotation_" + chrome.runtime.id;
  if (window[LOADED_KEY]) return;
  window[LOADED_KEY] = true;
  
  // ─────────────────────────────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────────────────────────────
  
  const SCREENSHOT_PADDING = 20;
  const TEXT_MAX_LENGTH = 500;
  const Z_INDEX_CONNECTORS = 2147483643;
  const Z_INDEX_MARKERS = 2147483644;
  const Z_INDEX_HIGHLIGHT = 2147483645;
  const Z_INDEX_PANEL = 2147483646;
  const Z_INDEX_TOOLTIP = 2147483647;
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const ALT_KEY_LABEL = IS_MAC ? "⌥" : "Alt";
  const REACT_COMPONENT_MARKER_ATTR = "data-agent-react-component-marker";
  
  // HTML escape to prevent XSS when inserting user-controlled content
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  
  // Check if element is part of agent-annotation UI (by id or class)
  function isAgentElement(el) {
    if (!el) return false;
    if (el.id?.startsWith("agent-")) return true;
    const cls = el.className;
    if (!cls) return false;
    // Handle both string className and SVGAnimatedString
    const clsStr = typeof cls === "string" ? cls : cls.baseVal || "";
    return clsStr.split(/\s+/).some(c => c.startsWith("agent-"));
  }
  
  // Update note card's displayed selector label
  function updateNoteCardLabel(index) {
    const sel = selectedElements[index];
    if (!sel) return;
    const card = notesContainer?.querySelector(`[data-index="${index}"]`);
    if (!card) return;
    const label = sel.id ? `#${sel.id}` : `${sel.tag}${sel.classes[0] ? "." + sel.classes[0] : ""}`;
    const selectorEl = card.querySelector(".agent-note-selector");
    if (selectorEl) {
      selectorEl.textContent = label;
      selectorEl.title = sel.selector;
    }
    updateNoteCardReactComponent(index);
  }

  function updateNoteCardReactComponent(index) {
    const sel = selectedElements[index];
    const card = notesContainer?.querySelector(`[data-index="${index}"]`);
    if (!sel || !card) return;

    const reactEl = card.querySelector(".agent-note-react");
    if (!reactEl) return;

    const label = formatReactComponentLabel(sel.reactComponent);
    reactEl.textContent = label;
    reactEl.title = formatReactComponentTitle(sel.reactComponent);
    reactEl.style.display = label ? "" : "none";
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────
  
  let isActive = false;
  let requestId = null;
  let multiSelectMode = true;
  let screenshotMode = "each"; // "each" | "full" | "none"
  let reactMarkerSeq = 0;
  
  // Element picker state
  let elementStack = [];
  let stackIndex = 0;
  let selectedElements = [];
  let elementScreenshots = new Map(); // index → boolean
  
  // Note card state (v0.2.0)
  let notesContainer = null;
  let connectorsEl = null;
  let elementComments = new Map(); // index → comment string
  let openNotes = new Set();       // indices of currently open notes
  let notePositions = new Map();   // index → {x, y} manual position overrides
  let dragState = null;            // note card or bottom panel drag state
  let panelTopOffset = null;       // manual panel top position after dragging
  
  // Debug mode state (v0.3.0)
  let debugMode = false;
  let cachedCSSVarNames = null;    // Cache for CSS variable discovery

  // Edit capture state
  let etchMode = false;
  let etchObserver = null;
  let etchStartTime = null;
  let etchInitialRules = null;           // serialized stylesheet snapshot (ownerNode + ruleTexts[])
  let etchStyleInitials = new Map();     // Element → initial style attribute value
  let etchClassInitials = new Map();     // Element → initial class attribute value
  let etchAttrInitials = new Map();      // Element → Map<attrName, oldValue> (non-style/class)
  let etchTextInitials = new Map();      // Text node → initial text value
  let etchChildListMutations = [];       // raw MutationRecords for structural changes
  let etchChangeCount = 0;
  
  // DOM elements
  let highlightEl = null;
  let tooltipEl = null;
  let panelEl = null;
  let markersContainer = null;
  let styleEl = null;
  
  // ─────────────────────────────────────────────────────────────────────
  // Styles
  // ─────────────────────────────────────────────────────────────────────
  
  const STYLES = `
    /* ═══════════════════════════════════════════════════════════════════
       CSS Custom Properties (aligned with agent annotation theme)
       ═══════════════════════════════════════════════════════════════════ */
    :root {
      --agent-bg-body: #18181e;
      --agent-bg-card: #1e1e24;
      --agent-bg-elevated: #252530;
      --agent-bg-selected: #3a3a4a;
      --agent-bg-hover: #2b2b37;
      --agent-fg: #e0e0e0;
      --agent-fg-muted: #808080;
      --agent-fg-dim: #666666;
      --agent-accent: #8abeb7;
      --agent-accent-hover: #9dcec7;
      --agent-accent-muted: rgba(138, 190, 183, 0.15);
      --agent-border: #5f87ff;
      --agent-border-muted: #505050;
      --agent-border-focus: #7a7a8a;
      --agent-success: #b5bd68;
      --agent-warning: #f0c674;
      --agent-error: #cc6666;
      --agent-focus-ring: rgba(95, 135, 255, 0.2);
      --agent-shadow: rgba(0, 0, 0, 0.5);
      --agent-font-mono: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
      --agent-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --agent-radius: 4px;
    }
    
    /* Light theme */
    @media (prefers-color-scheme: light) {
      :root {
        --agent-bg-body: #f8f8f8;
        --agent-bg-card: #ffffff;
        --agent-bg-elevated: #f0f0f0;
        --agent-bg-selected: #d0d0e0;
        --agent-bg-hover: #e8e8e8;
        --agent-fg: #1a1a1a;
        --agent-fg-muted: #6c6c6c;
        --agent-fg-dim: #8a8a8a;
        --agent-accent: #5f8787;
        --agent-accent-hover: #4a7272;
        --agent-accent-muted: rgba(95, 135, 135, 0.15);
        --agent-border: #5f87af;
        --agent-border-muted: #b0b0b0;
        --agent-border-focus: #8a8a9a;
        --agent-success: #87af87;
        --agent-warning: #d7af5f;
        --agent-error: #af5f5f;
        --agent-focus-ring: rgba(95, 135, 175, 0.2);
        --agent-shadow: rgba(0, 0, 0, 0.15);
      }

      .agent-etch-toggle.recording {
        background: rgba(175, 95, 95, 0.1);
        box-shadow: 0 0 8px rgba(175, 95, 95, 0.2), inset 0 0 6px rgba(175, 95, 95, 0.04);
        color: #8b4444;
      }
    }
    
    /* ═══════════════════════════════════════════════════════════════════
       Highlight & Tooltip
       ═══════════════════════════════════════════════════════════════════ */
    #agent-highlight {
      position: fixed;
      pointer-events: none;
      z-index: ${Z_INDEX_HIGHLIGHT};
      background: var(--agent-accent-muted);
      border: 2px solid var(--agent-accent);
      border-radius: var(--agent-radius);
      transition: all 0.05s ease-out;
    }
    
    #agent-tooltip {
      position: fixed;
      pointer-events: none;
      z-index: ${Z_INDEX_TOOLTIP};
      background: var(--agent-bg-card);
      color: var(--agent-fg);
      padding: 6px 10px;
      border-radius: var(--agent-radius);
      border: 1px solid var(--agent-border-muted);
      font: 12px/1.4 var(--agent-font-mono);
      box-shadow: 0 2px 8px var(--agent-shadow);
      max-width: 400px;
    }
    
    #agent-tooltip .tag { color: var(--agent-error); }
    #agent-tooltip .id { color: var(--agent-warning); }
    #agent-tooltip .class { color: var(--agent-border); }
    #agent-tooltip .size { color: var(--agent-fg-dim); margin-left: 8px; }
    #agent-tooltip .hint { color: var(--agent-accent); font-size: 11px; margin-top: 4px; display: block; }
    
    /* ═══════════════════════════════════════════════════════════════════
       Markers & Selection
       ═══════════════════════════════════════════════════════════════════ */
    #agent-markers {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: ${Z_INDEX_MARKERS};
    }
    
    .agent-marker-outline {
      position: fixed;
      pointer-events: none;
      border: 2px solid var(--agent-accent);
      border-radius: var(--agent-radius);
      background: var(--agent-accent-muted);
    }
    
    .agent-marker-badge {
      position: fixed;
      pointer-events: auto;
      background: var(--agent-accent);
      color: var(--agent-bg-body);
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font: bold 13px var(--agent-font-ui);
      cursor: pointer;
      box-shadow: 0 2px 8px var(--agent-shadow);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    
    .agent-marker-badge:hover {
      transform: scale(1.1);
      background: var(--agent-accent-hover);
    }
    
    .agent-marker-badge.open {
      background: var(--agent-success);
    }
    
    /* ═══════════════════════════════════════════════════════════════════
       Connectors
       ═══════════════════════════════════════════════════════════════════ */
    .agent-connectors {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: ${Z_INDEX_CONNECTORS};
    }
    
    .agent-connector {
      fill: none;
      stroke: var(--agent-accent);
      stroke-opacity: 0.5;
      stroke-width: 2;
      stroke-dasharray: 6 4;
    }
    
    .agent-connector-dot {
      fill: var(--agent-accent);
    }
    
    /* ═══════════════════════════════════════════════════════════════════
       Note Cards
       ═══════════════════════════════════════════════════════════════════ */
    .agent-notes-container {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: ${Z_INDEX_MARKERS};
    }
    
    .agent-note-card {
      position: fixed;
      width: 280px;
      background: var(--agent-bg-card);
      border: 1px solid var(--agent-border-muted);
      border-radius: 8px;
      box-shadow: 0 4px 24px var(--agent-shadow);
      pointer-events: auto;
      font-family: var(--agent-font-ui);
      overflow: hidden;
    }
    
    .agent-note-card * { box-sizing: border-box; }
    
    .agent-note-card:hover {
      border-color: var(--agent-border-focus);
    }
    
    .agent-note-card.dragging {
      opacity: 0.9;
      cursor: grabbing;
    }
    
    .agent-note-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: var(--agent-bg-elevated);
      border-bottom: 1px solid var(--agent-border-muted);
      cursor: grab;
    }
    
    .agent-note-badge {
      background: var(--agent-accent);
      color: var(--agent-bg-body);
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font: bold 11px var(--agent-font-ui);
      flex-shrink: 0;
    }
    
    .agent-note-selector {
      flex: 1;
      font: 12px var(--agent-font-mono);
      color: var(--agent-fg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    
    .agent-note-selector:hover {
      color: var(--agent-accent);
      text-decoration: underline;
    }

    .agent-note-react {
      margin-bottom: 8px;
      color: var(--agent-accent);
      font: 11px/1.35 var(--agent-font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .agent-note-screenshot,
    .agent-note-close,
    .agent-note-expand,
    .agent-note-contract {
      background: none;
      border: none;
      color: var(--agent-fg-dim);
      font-size: 14px;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: var(--agent-radius);
      transition: all 0.15s;
    }
    
    .agent-note-expand,
    .agent-note-contract { font-size: 11px; }
    .agent-note-expand:hover,
    .agent-note-contract:hover { background: var(--agent-bg-elevated); color: var(--agent-fg-muted); }
    .agent-note-screenshot { opacity: 0.4; }
    .agent-note-screenshot:hover { background: var(--agent-bg-elevated); opacity: 0.7; }
    .agent-note-screenshot.active { opacity: 1; background: var(--agent-accent-muted); }
    .agent-note-close:hover { background: var(--agent-bg-elevated); color: var(--agent-error); }
    
    .agent-note-body {
      padding: 10px;
    }
    
    .agent-note-textarea {
      width: 100%;
      background: var(--agent-bg-body);
      border: 1px solid var(--agent-border-muted);
      border-radius: 6px;
      color: var(--agent-fg);
      font: 13px/1.5 var(--agent-font-ui);
      padding: 10px 12px;
      resize: none;
      min-height: 72px;
      max-height: 160px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    
    .agent-note-textarea:focus {
      outline: none;
      border-color: var(--agent-accent);
      box-shadow: 0 0 0 3px var(--agent-focus-ring);
    }
    
    .agent-note-textarea::placeholder {
      color: var(--agent-fg-dim);
    }
    
    /* ═══════════════════════════════════════════════════════════════════
       Bottom Panel
       ═══════════════════════════════════════════════════════════════════ */
    #agent-panel {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      background: var(--agent-bg-card);
      color: var(--agent-fg);
      font-family: var(--agent-font-ui);
      padding: 10px 16px;
      z-index: ${Z_INDEX_PANEL};
      box-shadow: 0 -4px 24px var(--agent-shadow);
      border-top: 1px solid var(--agent-border-muted);
    }
    
    #agent-panel * { box-sizing: border-box; }
    
    .agent-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--agent-bg-elevated);
      cursor: grab;
      user-select: none;
    }

    #agent-panel.dragging .agent-header { cursor: grabbing; }
    
    .agent-logo { 
      font-size: 15px; 
      font-weight: 700; 
      color: var(--agent-accent);
    }
    .agent-hint { color: var(--agent-fg-dim); font-size: 11px; margin-left: auto; }
    
    .agent-close {
      background: none;
      border: none;
      color: var(--agent-fg-dim);
      font-size: 18px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
    }
    .agent-close:hover { color: var(--agent-error); }
    
    .agent-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    
    .agent-mode-toggle {
      display: flex;
      gap: 4px;
    }
    
    .agent-mode-btn {
      background: var(--agent-bg-elevated);
      border: 1px solid var(--agent-border-muted);
      border-radius: var(--agent-radius);
      padding: 5px 10px;
      font-size: 11px;
      color: var(--agent-fg-muted);
      cursor: pointer;
      transition: all 0.15s;
    }
    
    .agent-mode-btn:hover { background: var(--agent-bg-hover); }
    
    .agent-mode-btn.active {
      background: var(--agent-accent);
      border-color: var(--agent-accent);
      color: var(--agent-bg-body);
    }
    
    .agent-screenshot-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--agent-bg-body);
      padding: 2px 2px 2px 8px;
      border-radius: var(--agent-radius);
    }
    
    .agent-toggle-label {
      font-size: 11px;
      color: var(--agent-fg-dim);
    }
    
    .agent-ss-btn {
      background: transparent;
      border: none;
      border-radius: 3px;
      padding: 5px 10px;
      font-size: 11px;
      color: var(--agent-fg-dim);
      cursor: pointer;
      transition: all 0.15s;
    }
    
    .agent-ss-btn:hover { color: var(--agent-fg-muted); }
    
    .agent-ss-btn.active {
      background: var(--agent-accent);
      color: var(--agent-bg-body);
    }
    
    .agent-spacer { flex: 1; }
    
    .agent-count {
      font-size: 12px;
      color: var(--agent-fg-dim);
    }
    
    .agent-notes-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--agent-fg-muted);
      cursor: pointer;
      user-select: none;
    }
    
    .agent-notes-toggle input {
      width: 14px;
      height: 14px;
      accent-color: var(--agent-accent);
      cursor: pointer;
    }
    
    .agent-notes-toggle:hover { color: var(--agent-fg); }

    /* ── Etch toggle: recording mode pill ── */
    .agent-etch-toggle {
      background: var(--agent-bg-elevated);
      border: 1px solid var(--agent-border-muted);
      border-radius: 16px;
      padding: 3px 10px 3px 8px;
      transition: background 0.3s, border-color 0.3s, box-shadow 0.3s, color 0.3s;
    }

    .agent-etch-toggle input { display: none; }

    .agent-etch-toggle span:first-of-type::before {
      content: "●";
      font-size: 9px;
      margin-right: 4px;
      vertical-align: 1px;
      color: var(--agent-fg-dim);
      transition: color 0.3s;
    }

    .agent-etch-toggle:hover {
      border-color: var(--agent-fg-dim);
      color: var(--agent-fg);
    }

    .agent-etch-toggle.recording {
      background: rgba(204, 102, 102, 0.15);
      border-color: var(--agent-error);
      box-shadow: 0 0 8px rgba(204, 102, 102, 0.3), inset 0 0 6px rgba(204, 102, 102, 0.06);
      color: #e0a0a0;
    }

    .agent-etch-toggle.recording:hover {
      box-shadow: 0 0 12px rgba(204, 102, 102, 0.4), inset 0 0 6px rgba(204, 102, 102, 0.08);
    }

    .agent-etch-toggle.recording span:first-of-type::before {
      color: var(--agent-error);
      animation: agent-etch-pulse 1.5s ease-in-out infinite;
    }

    @keyframes agent-etch-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }

    .agent-etch-badge {
      background: var(--agent-accent);
      color: var(--agent-bg-body);
      font: bold 10px var(--agent-font-ui);
      min-width: 18px;
      height: 18px;
      border-radius: 9px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
      transition: background 0.3s;
    }

    .agent-etch-toggle.recording .agent-etch-badge { background: var(--agent-error); }

    /* Changed element indicators */
    [data-agent-changed] {
      outline: 2px dashed var(--agent-warning) !important;
      outline-offset: 2px !important;
    }
    
    .agent-context-row {
      margin-bottom: 8px;
    }
    
    .agent-context-row input {
      width: 100%;
      background: var(--agent-bg-body);
      border: 1px solid var(--agent-border-muted);
      border-radius: var(--agent-radius);
      color: var(--agent-fg);
      font-family: inherit;
      font-size: 13px;
      padding: 8px 12px;
    }
    
    .agent-context-row input:focus {
      outline: none;
      border-color: var(--agent-accent);
      box-shadow: 0 0 0 3px var(--agent-focus-ring);
    }
    
    .agent-context-row input::placeholder { color: var(--agent-fg-dim); }
    
    .agent-actions {
      display: flex;
      justify-content: flex-end;
      padding-top: 8px;
      border-top: 1px solid var(--agent-bg-elevated);
    }
    
    .agent-buttons { display: flex; gap: 8px; }
    
    .agent-btn {
      padding: 6px 14px;
      border-radius: var(--agent-radius);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }
    
    .agent-btn-cancel {
      background: var(--agent-bg-elevated);
      color: var(--agent-fg-muted);
      border: 1px solid var(--agent-border-muted);
    }
    
    .agent-btn-cancel:hover { background: var(--agent-bg-hover); color: var(--agent-fg); }
    
    .agent-btn-submit {
      background: var(--agent-accent);
      color: var(--agent-bg-body);
    }
    
    .agent-btn-submit:hover { 
      background: var(--agent-accent-hover);
    }
  `;
  
  // ─────────────────────────────────────────────────────────────────────
  // Message Handling
  // ─────────────────────────────────────────────────────────────────────
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("[agent-annotation] Received:", msg.type);
    
    if (msg.type === "START_ANNOTATION") {
      requestId = msg.requestId || msg.id || null;
      activate();
    } else if (msg.type === "TOGGLE_PICKER") {
      if (isActive) {
        deactivate();
      } else {
        activate();
      }
    } else if (msg.type === "CANCEL") {
      if (isActive) {
        deactivate();
      }
    }
  });
  
  // ─────────────────────────────────────────────────────────────────────
  // Activation
  // ─────────────────────────────────────────────────────────────────────
  
  function activate() {
    if (isActive) {
      console.log("[agent-annotation] Restarting session (new request)");
      resetState();
      return;
    }
    isActive = true;
    
    // Inject styles
    styleEl = document.createElement("style");
    styleEl.id = "agent-styles";
    styleEl.textContent = STYLES;
    (document.head || document.documentElement).appendChild(styleEl);
    
    // Create UI
    createHighlight();
    createTooltip();
    createMarkers();
    createNotesContainer();
    createPanel();
    
    // Add listeners
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    initDragHandlers();
    
    document.body.style.cursor = "crosshair";
    console.log("[agent-annotation] Activated");
  }
  
  function resetState() {
    if (etchObserver) { etchObserver.disconnect(); etchObserver = null; }

    elementStack = [];
    stackIndex = 0;
    selectedElements = [];
    elementScreenshots = new Map();
    elementComments = new Map();
    openNotes = new Set();
    notePositions = new Map();
    dragState = null;
    panelTopOffset = null;
    multiSelectMode = true;
    screenshotMode = "each";
    debugMode = false;
    resetCSSVarCache();
    etchMode = false;
    etchStartTime = null;
    etchInitialRules = null;
    etchStyleInitials = new Map();
    etchClassInitials = new Map();
    etchAttrInitials = new Map();
    etchTextInitials = new Map();
    etchChildListMutations = [];
    etchChangeCount = 0;
    updateEtchCounter();
    clearEtchMarkers();
    
    // Reset UI elements
    if (markersContainer) markersContainer.innerHTML = "";
    if (notesContainer) notesContainer.innerHTML = "";
    if (connectorsEl) connectorsEl.innerHTML = "";
    hideHighlight();
    hideTooltip();
    if (panelEl) {
      panelEl.style.top = "";
      panelEl.style.bottom = "0";
    }
    
    // Reset mode toggle buttons
    const singleBtn = document.getElementById("agent-mode-single");
    const multiBtn = document.getElementById("agent-mode-multi");
    if (singleBtn && multiBtn) {
      singleBtn.classList.remove("active");
      multiBtn.classList.add("active");
    }
    
    // Reset screenshot mode buttons
    const eachBtn = document.getElementById("agent-ss-each");
    const fullBtn = document.getElementById("agent-ss-full");
    const noneBtn = document.getElementById("agent-ss-none");
    if (eachBtn && fullBtn && noneBtn) {
      eachBtn.classList.add("active");
      fullBtn.classList.remove("active");
      noneBtn.classList.remove("active");
    }
    
    // Clear context input
    const contextEl = document.getElementById("agent-context");
    if (contextEl) contextEl.value = "";
    
    // Reset debug mode checkbox
    const debugCheckbox = document.getElementById("agent-debug-mode");
    if (debugCheckbox) debugCheckbox.checked = false;

    const etchCheckbox = document.getElementById("agent-etch-mode");
    if (etchCheckbox) etchCheckbox.checked = false;
    const etchToggle = etchCheckbox?.closest(".agent-etch-toggle");
    if (etchToggle) etchToggle.classList.remove("recording");
    
    // Update count
    const countEl = document.getElementById("agent-count");
    if (countEl) countEl.textContent = "0 selected";
    
    console.log("[agent-annotation] State reset for new session");
  }
  
  function deactivate() {
    if (!isActive) return;
    isActive = false;
    
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("wheel", onWheel, { capture: true });
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", handleScroll, true);
    window.removeEventListener("resize", handleResize);
    cleanupDragHandlers();

    document.body.style.cursor = "";

    if (etchObserver) { etchObserver.disconnect(); etchObserver = null; }
    clearEtchMarkers();

    styleEl?.remove();
    highlightEl?.remove();
    tooltipEl?.remove();
    panelEl?.remove();
    markersContainer?.remove();
    notesContainer?.remove();
    connectorsEl?.remove();
    
    styleEl = highlightEl = tooltipEl = panelEl = markersContainer = null;
    notesContainer = connectorsEl = null;
    elementStack = [];
    stackIndex = 0;
    selectedElements = [];
    elementScreenshots = new Map();
    elementComments = new Map();
    openNotes = new Set();
    notePositions = new Map();
    dragState = null;
    panelTopOffset = null;
    requestId = null;
    multiSelectMode = true;
    screenshotMode = "each";
    debugMode = false;
    resetCSSVarCache();
    etchMode = false;
    etchStartTime = null;
    etchInitialRules = null;
    etchStyleInitials = new Map();
    etchClassInitials = new Map();
    etchAttrInitials = new Map();
    etchTextInitials = new Map();
    etchChildListMutations = [];
    etchChangeCount = 0;
    
    console.log("[agent-annotation] Deactivated");
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // UI Creation
  // ─────────────────────────────────────────────────────────────────────
  
  function createHighlight() {
    highlightEl = document.createElement("div");
    highlightEl.id = "agent-highlight";
    highlightEl.style.display = "none";
    document.body.appendChild(highlightEl);
  }
  
  function createTooltip() {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "agent-tooltip";
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);
  }
  
  function createMarkers() {
    markersContainer = document.createElement("div");
    markersContainer.id = "agent-markers";
    document.body.appendChild(markersContainer);
  }
  
  function createNotesContainer() {
    notesContainer = document.createElement("div");
    notesContainer.className = "agent-notes-container";
    document.body.appendChild(notesContainer);
    
    connectorsEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    connectorsEl.setAttribute("class", "agent-connectors");
    document.body.appendChild(connectorsEl);
  }
  
  function createPanel() {
    panelEl = document.createElement("div");
    panelEl.id = "agent-panel";
    panelEl.innerHTML = `
      <div class="agent-header">
        <span class="agent-logo">Agent Annotation</span>
        <span class="agent-hint">Click elements • ${ALT_KEY_LABEL}+scroll cycles parents • ESC to close</span>
        <button class="agent-close" id="agent-close" title="Close (ESC)">×</button>
      </div>
      <div class="agent-toolbar">
        <div class="agent-mode-toggle">
          <button class="agent-mode-btn" id="agent-mode-single" title="Click replaces selection">Single</button>
          <button class="agent-mode-btn active" id="agent-mode-multi" title="Click adds to selection">Multi</button>
        </div>
        <div class="agent-screenshot-toggle">
          <span class="agent-toggle-label">Screenshot</span>
          <button class="agent-ss-btn active" id="agent-ss-each" title="Crop screenshot to each element">Crop</button>
          <button class="agent-ss-btn" id="agent-ss-full" title="Capture entire viewport">Full</button>
          <button class="agent-ss-btn" id="agent-ss-none" title="No screenshots">None</button>
        </div>
        <div class="agent-spacer"></div>
        <span class="agent-count" id="agent-count">0 selected</span>
        <label class="agent-notes-toggle" title="Show/hide all note cards">
          <input type="checkbox" id="agent-notes-visible" checked />
          <span>Notes</span>
        </label>
        <label class="agent-notes-toggle" title="Capture computed styles, layout, and CSS variables">
          <input type="checkbox" id="agent-debug-mode" />
          <span>Debug</span>
        </label>
        <label class="agent-notes-toggle agent-etch-toggle" title="Record DevTools edits (style, class, CSS rule changes)">
          <input type="checkbox" id="agent-etch-mode" />
          <span>Etch</span>
          <span class="agent-etch-badge" id="agent-etch-count" style="display:none"></span>
        </label>
      </div>
      <div class="agent-context-row">
        <input type="text" id="agent-context" placeholder="General context (optional)..." />
      </div>
      <div class="agent-actions">
        <div class="agent-buttons">
          <button class="agent-btn agent-btn-cancel" id="agent-cancel">Cancel</button>
          <button class="agent-btn agent-btn-submit" id="agent-submit">Submit</button>
        </div>
      </div>
    `;
    document.body.appendChild(panelEl);
    
    document.getElementById("agent-close").addEventListener("click", handleCancel);
    document.getElementById("agent-cancel").addEventListener("click", handleCancel);
    document.getElementById("agent-submit").addEventListener("click", handleSubmit);
    setupPanelDrag();
    
    // Mode toggle
    document.getElementById("agent-mode-single").addEventListener("click", () => setMultiMode(false));
    document.getElementById("agent-mode-multi").addEventListener("click", () => setMultiMode(true));
    
    // Screenshot mode toggle
    document.getElementById("agent-ss-each").addEventListener("click", () => setScreenshotMode("each"));
    document.getElementById("agent-ss-full").addEventListener("click", () => setScreenshotMode("full"));
    document.getElementById("agent-ss-none").addEventListener("click", () => setScreenshotMode("none"));
    
    // Notes visibility toggle
    document.getElementById("agent-notes-visible").addEventListener("change", (e) => {
      if (e.target.checked) {
        expandAllNotes();
      } else {
        collapseAllNotes();
      }
    });
    
    // Debug mode toggle
    document.getElementById("agent-debug-mode").addEventListener("change", (e) => {
      debugMode = e.target.checked;
    });

    document.getElementById("agent-etch-mode").addEventListener("change", (e) => {
      const toggle = e.target.closest(".agent-etch-toggle");
      if (e.target.checked) {
        startEtchCapture();
        if (toggle) toggle.classList.add("recording");
      } else {
        stopEtchCapture();
        if (toggle) toggle.classList.remove("recording");
      }
    });
    
    // Stop events from reaching the page
    panelEl.addEventListener("mousemove", e => e.stopPropagation(), true);
    panelEl.addEventListener("click", e => {
      const target = e.target;
      if (target.tagName === "BUTTON" || target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }
      e.stopPropagation();
    }, true);
  }
  
  function setMultiMode(isMulti) {
    multiSelectMode = isMulti;
    const singleBtn = document.getElementById("agent-mode-single");
    const multiBtn = document.getElementById("agent-mode-multi");
    if (singleBtn && multiBtn) {
      singleBtn.classList.toggle("active", !isMulti);
      multiBtn.classList.toggle("active", isMulti);
    }
  }
  
  function setScreenshotMode(mode) {
    screenshotMode = mode;
    const eachBtn = document.getElementById("agent-ss-each");
    const fullBtn = document.getElementById("agent-ss-full");
    const noneBtn = document.getElementById("agent-ss-none");
    if (eachBtn && fullBtn && noneBtn) {
      eachBtn.classList.toggle("active", mode === "each");
      fullBtn.classList.toggle("active", mode === "full");
      noneBtn.classList.toggle("active", mode === "none");
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // Note Card Functions
  // ─────────────────────────────────────────────────────────────────────
  
  function calculateNotePosition(element, cardWidth = 280, cardHeight = 150) {
    const rect = element.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panelHeight = document.getElementById("agent-panel")?.offsetHeight || 96;
    const margin = 16;
    
    // Try right side first
    if (rect.right + margin + cardWidth < vw) {
      return { x: rect.right + margin, y: Math.max(margin, rect.top) };
    }
    // Try left side
    if (rect.left - margin - cardWidth > 0) {
      return { x: rect.left - margin - cardWidth, y: Math.max(margin, rect.top) };
    }
    // Try below
    if (rect.bottom + margin + cardHeight < vh - panelHeight) {
      return { x: Math.max(margin, rect.left), y: rect.bottom + margin };
    }
    // Try above
    if (rect.top - margin - cardHeight > 0) {
      return { x: Math.max(margin, rect.left), y: rect.top - margin - cardHeight };
    }
    // Fallback: offset from element
    return { x: Math.min(rect.right + margin, vw - cardWidth - margin), y: Math.max(margin, rect.top) };
  }
  
  function hasOverlap(rect1, rect2, margin = 8) {
    return !(
      rect1.right + margin < rect2.left ||
      rect1.left > rect2.right + margin ||
      rect1.bottom + margin < rect2.top ||
      rect1.top > rect2.bottom + margin
    );
  }
  
  function adjustForCollisions(position, cardSize, existingCards) {
    const myRect = {
      left: position.x,
      top: position.y,
      right: position.x + cardSize.width,
      bottom: position.y + cardSize.height
    };
    
    let adjusted = { ...position };
    let attempts = 0;
    
    while (attempts < 10) {
      let collision = false;
      
      for (const card of existingCards) {
        const cardRect = card.getBoundingClientRect();
        if (hasOverlap(myRect, cardRect)) {
          adjusted.y = cardRect.bottom + 12;
          myRect.top = adjusted.y;
          myRect.bottom = adjusted.y + cardSize.height;
          collision = true;
          break;
        }
      }
      
      if (!collision) break;
      attempts++;
    }
    
    // Clamp to viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panelHeight = document.getElementById("agent-panel")?.offsetHeight || 96;
    adjusted.x = Math.max(16, Math.min(adjusted.x, vw - cardSize.width - 16));
    adjusted.y = Math.max(16, Math.min(adjusted.y, vh - cardSize.height - panelHeight - 16));
    
    return adjusted;
  }
  
  function createNoteCard(index) {
    const sel = selectedElements[index];
    if (!sel || !sel.element || !document.contains(sel.element)) return null;
    
    // Guard against duplicate cards
    if (openNotes.has(index)) {
      return notesContainer.querySelector(`[data-index="${index}"]`);
    }
    
    // Use stored position if user previously dragged, otherwise calculate
    let adjustedPos;
    if (notePositions.has(index)) {
      adjustedPos = notePositions.get(index);
    } else {
      const position = calculateNotePosition(sel.element);
      adjustedPos = adjustForCollisions(
        position,
        { width: 280, height: 150 },
        notesContainer.querySelectorAll(".agent-note-card")
      );
    }
    
    const label = sel.id ? `#${sel.id}` : `${sel.tag}${sel.classes[0] ? "." + sel.classes[0] : ""}`;
    const reactLabel = formatReactComponentLabel(sel.reactComponent);
    const reactTitle = formatReactComponentTitle(sel.reactComponent);
    const hasScreenshot = elementScreenshots.get(index) !== false;
    const comment = elementComments.get(index) || "";
    
    const card = document.createElement("div");
    card.className = "agent-note-card";
    card.dataset.index = index;
    card.style.left = `${adjustedPos.x}px`;
    card.style.top = `${adjustedPos.y}px`;
    
    card.innerHTML = `
      <div class="agent-note-header">
        <span class="agent-note-badge">${index + 1}</span>
        <span class="agent-note-selector" title="${escapeHtml(sel.selector)}">${escapeHtml(label)}</span>
        <button class="agent-note-expand" title="Expand to parent">▲</button>
        <button class="agent-note-contract" title="Contract to child">▼</button>
        <button class="agent-note-screenshot ${hasScreenshot ? "active" : ""}" title="Toggle screenshot">📷</button>
        <button class="agent-note-close" title="Remove element">×</button>
      </div>
      <div class="agent-note-body">
        <div class="agent-note-react" title="${escapeHtml(reactTitle)}" style="${reactLabel ? "" : "display:none"}">${escapeHtml(reactLabel)}</div>
        <textarea class="agent-note-textarea" placeholder="Describe changes for this element...">${escapeHtml(comment)}</textarea>
      </div>
    `;
    
    // Helper to get current index from DOM (survives reindexing)
    const getIndex = () => parseInt(card.dataset.index, 10);
    
    // Event listeners
    const textarea = card.querySelector(".agent-note-textarea");
    textarea.addEventListener("input", () => {
      elementComments.set(getIndex(), textarea.value);
      autoResizeTextarea(textarea);
    });
    
    const screenshotBtn = card.querySelector(".agent-note-screenshot");
    screenshotBtn.addEventListener("click", () => {
      const idx = getIndex();
      const current = elementScreenshots.get(idx) !== false;
      elementScreenshots.set(idx, !current);
      screenshotBtn.classList.toggle("active", !current);
    });
    
    const closeBtn = card.querySelector(".agent-note-close");
    closeBtn.addEventListener("click", () => removeElement(getIndex()));
    
    const expandBtn = card.querySelector(".agent-note-expand");
    expandBtn.addEventListener("click", () => expandElement(getIndex()));
    
    const contractBtn = card.querySelector(".agent-note-contract");
    contractBtn.addEventListener("click", () => contractElement(getIndex()));
    
    const selectorEl = card.querySelector(".agent-note-selector");
    selectorEl.addEventListener("click", () => {
      const idx = getIndex();
      const currentSel = selectedElements[idx];
      if (currentSel?.element) scrollToElement(currentSel.element);
    });
    
    // Drag to reposition
    setupDrag(card);
    
    notesContainer.appendChild(card);
    openNotes.add(index);
    
    // Focus textarea
    textarea.focus();
    
    return card;
  }
  
  function toggleNote(index) {
    if (openNotes.has(index)) {
      // Close note
      const card = notesContainer.querySelector(`[data-index="${index}"]`);
      if (card) card.remove();
      openNotes.delete(index);
    } else {
      // Open note
      createNoteCard(index);
    }
    updateBadges();
    updateConnectors();
  }
  
  function autoResizeTextarea(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(160, Math.max(72, textarea.scrollHeight)) + "px";
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // Drag Handling
  // ─────────────────────────────────────────────────────────────────────
  
  function initDragHandlers() {
    document.addEventListener("mousemove", handleDragMove);
    document.addEventListener("mouseup", handleDragEnd);
  }
  
  function cleanupDragHandlers() {
    document.removeEventListener("mousemove", handleDragMove);
    document.removeEventListener("mouseup", handleDragEnd);
  }
  
  function handleDragMove(e) {
    if (!dragState) return;

    if (dragState.type === "panel") {
      const { panel, startY, startTop } = dragState;
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      const newTop = Math.max(0, Math.min(startTop + e.clientY - startY, maxTop));

      panel.style.top = `${newTop}px`;
      panel.style.bottom = "auto";
      panelTopOffset = newTop;
      return;
    }

    const { card, startX, startY, startLeft, startTop } = dragState;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newX = startLeft + dx;
    const newY = startTop + dy;
    card.style.left = `${newX}px`;
    card.style.top = `${newY}px`;
    const index = parseInt(card.dataset.index, 10);
    notePositions.set(index, { x: newX, y: newY });
    updateConnectors();
  }
  
  function handleDragEnd() {
    if (dragState) {
      (dragState.card || dragState.panel)?.classList.remove("dragging");
      dragState = null;
    }
  }

  function setupPanelDrag() {
    const header = panelEl.querySelector(".agent-header");

    header.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;

      const rect = panelEl.getBoundingClientRect();
      dragState = {
        type: "panel",
        panel: panelEl,
        startY: e.clientY,
        startTop: rect.top
      };
      panelEl.classList.add("dragging");
      e.preventDefault();
      e.stopPropagation();
    });
  }
  
  function setupDrag(card) {
    const header = card.querySelector(".agent-note-header");
    
    header.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON" || e.target.tagName === "SPAN") return;
      dragState = {
        type: "note",
        card,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: card.offsetLeft,
        startTop: card.offsetTop
      };
      card.classList.add("dragging");
      e.preventDefault();
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // Element Management
  // ─────────────────────────────────────────────────────────────────────
  
  function removeElement(index) {
    selectedElements.splice(index, 1);
    
    // Close and remove the note card if open
    if (openNotes.has(index)) {
      const card = notesContainer.querySelector(`[data-index="${index}"]`);
      if (card) card.remove();
      openNotes.delete(index);
    }
    
    // Reindex all state Maps and Sets
    const reindexMap = (map) => {
      const newMap = new Map();
      map.forEach((v, k) => {
        if (k < index) newMap.set(k, v);
        else if (k > index) newMap.set(k - 1, v);
      });
      return newMap;
    };
    
    const reindexSet = (set) => {
      const newSet = new Set();
      set.forEach(k => {
        if (k < index) newSet.add(k);
        else if (k > index) newSet.add(k - 1);
      });
      return newSet;
    };
    
    elementScreenshots = reindexMap(elementScreenshots);
    elementComments = reindexMap(elementComments);
    notePositions = reindexMap(notePositions);
    openNotes = reindexSet(openNotes);
    
    // Update data-index attributes on remaining note cards
    notesContainer.querySelectorAll(".agent-note-card").forEach(card => {
      const cardIndex = parseInt(card.dataset.index, 10);
      if (cardIndex > index) {
        const newIndex = cardIndex - 1;
        card.dataset.index = newIndex;
        const badge = card.querySelector(".agent-note-badge");
        if (badge) badge.textContent = newIndex + 1;
      }
    });
    
    updateBadges();
    updateConnectors();
  }
  
  function expandElement(index) {
    const sel = selectedElements[index];
    if (!sel?.element || !document.contains(sel.element)) return;
    
    const parent = sel.element.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement) {
      if (isAgentElement(parent)) {
        console.log("[agent-annotation] Cannot expand to agent-annotation UI element");
        return;
      }
      
      console.log("[agent-annotation] Expanding to parent:", parent.tagName);
      const nextSelection = createSelectionData(parent);
      selectedElements[index] = nextSelection;
      updateNoteCardLabel(index);
      enrichSelectionReactComponent(nextSelection);
      updateBadges();
      updateConnectors();
    } else {
      console.log("[agent-annotation] Already at root - no valid parent");
    }
  }
  
  function contractElement(index) {
    const sel = selectedElements[index];
    if (!sel?.element || !document.contains(sel.element)) return;
    
    const children = Array.from(sel.element.children).filter(c => 
      c.nodeType === 1 && !isAgentElement(c)
    );
    
    if (children.length > 0) {
      console.log("[agent-annotation] Contracting to child:", children[0].tagName);
      const nextSelection = createSelectionData(children[0]);
      selectedElements[index] = nextSelection;
      updateNoteCardLabel(index);
      enrichSelectionReactComponent(nextSelection);
      updateBadges();
      updateConnectors();
    } else {
      console.log("[agent-annotation] No children to contract to");
    }
  }
  
  function scrollToElement(element) {
    if (!element || !document.contains(element)) return;
    
    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center"
    });
    
    // Flash highlight effect after scroll
    setTimeout(() => {
      if (!element || !document.contains(element)) return;
      
      const rect = element.getBoundingClientRect();
      highlightEl.style.display = "";
      highlightEl.style.left = rect.left + "px";
      highlightEl.style.top = rect.top + "px";
      highlightEl.style.width = rect.width + "px";
      highlightEl.style.height = rect.height + "px";
      highlightEl.style.transition = "opacity 0.3s";
      highlightEl.style.opacity = "1";
      
      setTimeout(() => {
        highlightEl.style.opacity = "0";
        setTimeout(() => {
          highlightEl.style.display = "none";
          highlightEl.style.transition = "";
          highlightEl.style.opacity = "";
        }, 300);
      }, 500);
    }, 400);
  }
  
  function expandAllNotes() {
    selectedElements.forEach((_, i) => {
      if (!openNotes.has(i)) {
        createNoteCard(i);
      }
    });
    updateBadges();
    updateConnectors();
  }
  
  function collapseAllNotes() {
    openNotes.forEach(i => {
      const card = notesContainer.querySelector(`[data-index="${i}"]`);
      if (card) card.remove();
    });
    openNotes.clear();
    updateBadges();
    updateConnectors();
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // UI Updates
  // ─────────────────────────────────────────────────────────────────────
  
  function updateBadges() {
    if (!markersContainer) return;
    markersContainer.innerHTML = "";
    
    selectedElements.forEach((sel, i) => {
      if (!sel.element || !document.contains(sel.element)) return;
      
      const rect = sel.element.getBoundingClientRect();
      
      // Create outline box around selected element
      const outline = document.createElement("div");
      outline.className = "agent-marker-outline";
      outline.style.left = `${rect.left}px`;
      outline.style.top = `${rect.top}px`;
      outline.style.width = `${rect.width}px`;
      outline.style.height = `${rect.height}px`;
      markersContainer.appendChild(outline);
      
      // Create numbered badge
      const badge = document.createElement("div");
      badge.className = `agent-marker-badge ${openNotes.has(i) ? "open" : ""}`;
      badge.dataset.index = i;
      badge.textContent = i + 1;
      badge.style.left = `${rect.right - 14}px`;
      badge.style.top = `${rect.top - 14}px`;
      
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleNote(i);
      });
      
      markersContainer.appendChild(badge);
    });
    
    // Update count
    const countEl = document.getElementById("agent-count");
    if (countEl) countEl.textContent = `${selectedElements.length} selected`;
  }
  
  function updateConnectors() {
    if (!connectorsEl) return;
    connectorsEl.innerHTML = "";
    
    selectedElements.forEach((sel, i) => {
      if (!openNotes.has(i)) return;
      
      const card = notesContainer.querySelector(`[data-index="${i}"]`);
      if (!card || !sel.element || !document.contains(sel.element)) return;
      
      const elemRect = sel.element.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      
      const elemCenter = {
        x: elemRect.left + elemRect.width / 2,
        y: elemRect.top + elemRect.height / 2
      };
      
      let cardAnchor;
      if (cardRect.left > elemRect.right) {
        cardAnchor = { x: cardRect.left, y: cardRect.top + 20 };
      } else if (cardRect.right < elemRect.left) {
        cardAnchor = { x: cardRect.right, y: cardRect.top + 20 };
      } else if (cardRect.top > elemRect.bottom) {
        cardAnchor = { x: cardRect.left + 20, y: cardRect.top };
      } else if (cardRect.bottom < elemRect.top) {
        cardAnchor = { x: cardRect.left + 20, y: cardRect.bottom };
      } else {
        return; // Card overlaps element
      }
      
      const midX = (elemCenter.x + cardAnchor.x) / 2;
      const midY = (elemCenter.y + cardAnchor.y) / 2;
      
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "agent-connector");
      path.setAttribute("d", `M ${elemCenter.x},${elemCenter.y} Q ${midX},${midY} ${cardAnchor.x},${cardAnchor.y}`);
      connectorsEl.appendChild(path);
      
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("class", "agent-connector-dot");
      dot.setAttribute("cx", elemCenter.x);
      dot.setAttribute("cy", elemCenter.y);
      dot.setAttribute("r", 4);
      connectorsEl.appendChild(dot);
    });
  }
  
  function updateHighlight() {
    const el = elementStack[stackIndex];
    if (!el) return hideHighlight();
    
    const rect = el.getBoundingClientRect();
    Object.assign(highlightEl.style, {
      display: "",
      left: rect.left + "px",
      top: rect.top + "px",
      width: rect.width + "px",
      height: rect.height + "px",
    });
  }
  
  function hideHighlight() {
    if (highlightEl) highlightEl.style.display = "none";
  }
  
  function updateTooltip(mx, my) {
    const el = elementStack[stackIndex];
    if (!el) return hideTooltip();
    
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const id = el.id;
    const classes = Array.from(el.classList).slice(0, 3);
    
    let html = `<span class="tag">${escapeHtml(tag)}</span>`;
    if (id) html += `<span class="id">#${escapeHtml(id)}</span>`;
    if (classes.length) html += `<span class="class">.${escapeHtml(classes.join("."))}</span>`;
    html += `<span class="size">${Math.round(rect.width)}×${Math.round(rect.height)}</span>`;
    if (elementStack.length > 1) {
      html += `<span class="hint">${ALT_KEY_LABEL}+▲▼ ${stackIndex + 1}/${elementStack.length}</span>`;
    }
    
    tooltipEl.innerHTML = html;
    tooltipEl.style.display = "";
    
    let tx = mx + 15, ty = my + 15;
    const tr = tooltipEl.getBoundingClientRect();
    if (tx + tr.width > window.innerWidth - 10) tx = mx - tr.width - 10;
    if (ty + tr.height > window.innerHeight - 100) ty = my - tr.height - 10;
    
    tooltipEl.style.left = tx + "px";
    tooltipEl.style.top = ty + "px";
  }
  
  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = "none";
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────────────
  
  function onMouseMove(e) {
    if (!isActive || dragState || e.target.closest("#agent-panel") || e.target.closest(".agent-note-card")) {
      hideHighlight();
      hideTooltip();
      return;
    }
    
    highlightEl.style.display = "none";
    tooltipEl.style.display = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    highlightEl.style.display = "";
    
    if (!el || el === document.body || el === document.documentElement || isAgentElement(el)) {
      hideHighlight();
      hideTooltip();
      return;
    }
    
    // Build parent chain
    elementStack = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      if (!isAgentElement(current)) {
        elementStack.push(current);
      }
      current = current.parentElement;
    }
    stackIndex = 0;
    
    updateHighlight();
    updateTooltip(e.clientX, e.clientY);
  }
  
  function onWheel(e) {
    if (!isActive || !elementStack.length || e.target.closest("#agent-panel") || e.target.closest(".agent-note-card")) return;
    
    if (!e.altKey) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    stackIndex = e.deltaY > 0 
      ? Math.min(stackIndex + 1, elementStack.length - 1)
      : Math.max(stackIndex - 1, 0);
    
    updateHighlight();
    updateTooltip(e.clientX, e.clientY);
  }
  
  function onClick(e) {
    if (!isActive || e.target.closest("#agent-panel") || e.target.closest(".agent-note-card")) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const el = elementStack[stackIndex];
    if (!el) return;
    
    const idx = selectedElements.findIndex(s => s.element === el);
    
    if (idx >= 0) {
      // Already selected - deselect it
      removeElement(idx);
      return;
    }
    
    // Not selected - add it
    const addToExisting = multiSelectMode || e.shiftKey;
    if (!addToExisting) {
      // Clear existing selections
      collapseAllNotes();
      selectedElements = [];
      elementScreenshots = new Map();
      elementComments = new Map();
      notePositions = new Map();
    }
    selectElement(el);
    
    // Auto-open note for the newly selected element
    const newIndex = selectedElements.length - 1;
    createNoteCard(newIndex);
    
    updateBadges();
    updateConnectors();
  }
  
  function onKeyDown(e) {
    if (!isActive) return;
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  }
  
  function handleScroll() {
    updateBadges();
    updateConnectors();
  }
  
  function handleResize() {
    updateBadges();
    const panelHeight = document.getElementById("agent-panel")?.offsetHeight || 96;

    if (panelEl && panelTopOffset !== null) {
      const newTop = Math.max(0, Math.min(panelTopOffset, window.innerHeight - panelEl.offsetHeight));
      panelEl.style.top = `${newTop}px`;
      panelEl.style.bottom = "auto";
      panelTopOffset = newTop;
    }

    openNotes.forEach(index => {
      const card = notesContainer.querySelector(`[data-index="${index}"]`);
      if (!card) return;
      
      const rect = card.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      
      let newX = card.offsetLeft;
      let newY = card.offsetTop;
      let moved = false;
      
      if (rect.right > vw - 16) {
        newX = vw - rect.width - 16;
        moved = true;
      }
      if (rect.bottom > vh - panelHeight - 16) {
        newY = vh - rect.height - panelHeight - 16;
        moved = true;
      }
      
      if (moved) {
        card.style.left = `${newX}px`;
        card.style.top = `${newY}px`;
        // Update stored position so rebuild uses correct location
        notePositions.set(index, { x: newX, y: newY });
      }
    });
    updateConnectors();
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // Selection
  // ─────────────────────────────────────────────────────────────────────
  
  function selectElement(el) {
    const selection = createSelectionData(el);
    selectedElements.push(selection);
    enrichSelectionReactComponent(selection);
  }
  
  function generateSelector(el) {
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return `#${el.id}`;
    
    if (el.classList.length) {
      const classes = Array.from(el.classList).filter(c => /^[a-zA-Z][\w-]*$/.test(c));
      if (classes.length) {
        const sel = el.tagName.toLowerCase() + "." + classes.join(".");
        try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
      }
    }
    
    const path = [];
    let cur = el;
    while (cur && cur !== document.body) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[a-zA-Z][\w-]*$/.test(cur.id)) {
        path.unshift(`#${cur.id}`);
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      path.unshift(part);
      cur = parent;
    }
    return path.join(" > ");
  }
  
  /**
   * Get all HTML attributes for an element (except class/id which are captured separately)
   * @param {Element} el - Target element
   * @returns {Record<string, string>} Attribute name → value map
   */
  function getAttrs(el) {
    const attrs = {};
    for (const attr of el.attributes) {
      // Skip class and id (captured separately)
      if (attr.name === "class" || attr.name === "id") continue;
      // Skip style attribute (too verbose, use computedStyles instead)
      if (attr.name === "style") continue;
      // Truncate long values
      attrs[attr.name] = attr.value.length > 200 ? attr.value.slice(0, 200) + "…" : attr.value;
    }
    return attrs;
  }

  function formatReactSource(source, compact = true) {
    if (!source?.fileName) return "";

    let fileName = String(source.fileName).split(/[?#]/)[0].replace(/\\/g, "/");
    try {
      if (/^(https?|file):\/\//.test(fileName)) {
        fileName = new URL(fileName).pathname;
      }
    } catch {}

    if (compact) {
      const parts = fileName.split("/").filter(Boolean);
      if (parts.length > 2) fileName = parts.slice(-2).join("/");
      else if (parts.length) fileName = parts.join("/");
    }

    const line = source.lineNumber ? `:${source.lineNumber}` : "";
    const column = source.columnNumber ? `:${source.columnNumber}` : "";
    return `${fileName}${line}${column}`;
  }

  function formatReactComponentLabel(info) {
    if (!info?.name) return "";
    const source = formatReactSource(info.jsxSource || info.source);
    return source ? `${info.name} @ ${source}` : info.name;
  }

  function formatReactComponentTitle(info) {
    if (!info?.name) return "";

    const lines = [`React component: ${info.name}`];
    if (Array.isArray(info.componentStack) && info.componentStack.length) {
      lines.push(`Stack: ${info.componentStack.join(" > ")}`);
    }

    const jsxSource = formatReactSource(info.jsxSource, false);
    if (jsxSource) lines.push(`JSX: ${jsxSource}`);

    const source = formatReactSource(info.source, false);
    if (source && source !== jsxSource) lines.push(`Source: ${source}`);

    return lines.join("\n");
  }

  function createReactMarker() {
    reactMarkerSeq += 1;
    return `agent-react-${Date.now()}-${reactMarkerSeq}`;
  }

  async function requestReactComponentInfo(elements) {
    const marked = [];

    elements.forEach((el, index) => {
      if (!el || !(el instanceof Element) || !document.contains(el)) return;

      const marker = createReactMarker();
      el.setAttribute(REACT_COMPONENT_MARKER_ATTR, marker);
      marked.push({ el, index, marker });
    });

    if (!marked.length) return [];

    try {
      const response = await chrome.runtime.sendMessage({
        type: "GET_REACT_COMPONENT_INFO",
        attr: REACT_COMPONENT_MARKER_ATTR,
        markers: marked.map(item => item.marker),
      });

      if (!response?.ok || !Array.isArray(response.components)) return [];

      const byMarker = new Map(
        response.components.map(item => [item.marker, item.reactComponent || null])
      );

      return marked.map(item => ({
        index: item.index,
        reactComponent: byMarker.get(item.marker) || null,
      }));
    } catch (err) {
      console.log("[agent-annotation] React component lookup failed:", err);
      return [];
    } finally {
      marked.forEach(({ el, marker }) => {
        if (el.getAttribute(REACT_COMPONENT_MARKER_ATTR) === marker) {
          el.removeAttribute(REACT_COMPONENT_MARKER_ATTR);
        }
      });
    }
  }

  async function enrichSelectionReactComponent(selection) {
    if (!selection?.element || selection.reactComponent || !document.contains(selection.element)) return;

    const results = await requestReactComponentInfo([selection.element]);
    const reactComponent = results[0]?.reactComponent;
    if (!reactComponent || !selectedElements.includes(selection)) return;

    selection.reactComponent = reactComponent;
    updateNoteCardReactComponent(selectedElements.indexOf(selection));
  }

  async function enrichReactComponentInfo() {
    const pending = selectedElements
      .map((selection, index) => ({ selection, index }))
      .filter(({ selection }) => (
        selection?.element &&
        !selection.reactComponent &&
        document.contains(selection.element)
      ));

    if (!pending.length) return;

    const results = await requestReactComponentInfo(
      pending.map(item => item.selection.element)
    );

    results.forEach(({ index, reactComponent }) => {
      if (!reactComponent) return;

      const selection = pending[index]?.selection;
      if (!selection || !selectedElements.includes(selection)) return;

      selection.reactComponent = reactComponent;
      updateNoteCardReactComponent(selectedElements.indexOf(selection));
    });
  }
  
  function createSelectionData(el) {
    const data = {
      element: el,
      selector: generateSelector(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: Array.from(el.classList),
      text: (el.textContent || "").slice(0, TEXT_MAX_LENGTH).trim().replace(/\s+/g, " "),
      rect: getRectData(el),
      attributes: getAttrs(el),
      boxModel: getBoxModel(el),
      accessibility: getAccessibilityInfo(el),
      keyStyles: getKeyStyles(el),
    };
    
    if (debugMode) {
      data.computedStyles = getComputedStyles(el);
      data.parentContext = getParentContext(el);
      data.cssVariables = getCSSVariables(el);
    }
    
    return data;
  }
  
  function getRectData(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x + window.scrollX),
      y: Math.round(rect.y + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // DevTools Context Helpers (v0.3.0)
  // ─────────────────────────────────────────────────────────────────────
  
  /**
   * Get box model breakdown (content, padding, border, margin)
   * @param {Element} el - Target element
   * @returns {{ content: {width: number, height: number}, padding: {...}, border: {...}, margin: {...} }}
   */
  function getBoxModel(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    
    const paddingH = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const paddingV = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const borderH = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const borderV = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    
    return {
      content: {
        width: Math.max(0, Math.round(rect.width - paddingH - borderH)),
        height: Math.max(0, Math.round(rect.height - paddingV - borderV))
      },
      padding: {
        top: Math.round(parseFloat(style.paddingTop)),
        right: Math.round(parseFloat(style.paddingRight)),
        bottom: Math.round(parseFloat(style.paddingBottom)),
        left: Math.round(parseFloat(style.paddingLeft))
      },
      border: {
        top: Math.round(parseFloat(style.borderTopWidth)),
        right: Math.round(parseFloat(style.borderRightWidth)),
        bottom: Math.round(parseFloat(style.borderBottomWidth)),
        left: Math.round(parseFloat(style.borderLeftWidth))
      },
      margin: {
        top: Math.round(parseFloat(style.marginTop)),
        right: Math.round(parseFloat(style.marginRight)),
        bottom: Math.round(parseFloat(style.marginBottom)),
        left: Math.round(parseFloat(style.marginLeft))
      }
    };
  }
  
  // ARIA role mappings for getImplicitRole (defined once, not per-call)
  const INPUT_TYPE_ROLES = {
    button: "button",
    submit: "button",
    reset: "button",
    image: "button",
    checkbox: "checkbox",
    radio: "radio",
    range: "slider",
    number: "spinbutton",
    search: "searchbox",
    email: "textbox",
    tel: "textbox",
    url: "textbox",
    text: "textbox",
    password: "textbox",
  };
  
  const TAG_ROLES = {
    article: "article",
    aside: "complementary",
    button: "button",
    datalist: "listbox",
    details: "group",
    dialog: "dialog",
    fieldset: "group",
    figure: "figure",
    footer: "contentinfo",
    form: "form",
    h1: "heading", h2: "heading", h3: "heading",
    h4: "heading", h5: "heading", h6: "heading",
    header: "banner",
    hr: "separator",
    li: "listitem",
    main: "main",
    math: "math",
    menu: "list",
    nav: "navigation",
    ol: "list",
    optgroup: "group",
    option: "option",
    output: "status",
    progress: "progressbar",
    section: "region",
    select: "combobox",
    summary: "button",
    table: "table",
    tbody: "rowgroup",
    td: "cell",
    textarea: "textbox",
    tfoot: "rowgroup",
    th: "columnheader",
    thead: "rowgroup",
    tr: "row",
    ul: "list",
  };
  
  /**
   * Get implicit ARIA role for an element based on tag and attributes
   * @param {Element} el - Target element
   * @returns {string|null} Implicit role or null
   */
  function getImplicitRole(el) {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type")?.toLowerCase();
    
    // Special cases
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (tag === "area") return el.hasAttribute("href") ? "link" : null;
    if (tag === "input") return type ? (INPUT_TYPE_ROLES[type] || "textbox") : "textbox";
    if (tag === "img") {
      const alt = el.getAttribute("alt");
      if (alt === null) return "img";
      if (alt === "") return "presentation";
      return "img";
    }
    
    return TAG_ROLES[tag] || null;
  }
  
  /**
   * Check if element can receive keyboard focus
   * @param {Element} el - Target element
   * @returns {boolean}
   */
  function isFocusable(el) {
    if (el.hasAttribute("tabindex")) {
      return el.tabIndex >= 0;
    }
    if (el.disabled) return false;
    
    const tag = el.tagName.toLowerCase();
    if (tag === "a" || tag === "area") {
      return el.hasAttribute("href");
    }
    
    return ["button", "input", "select", "textarea"].includes(tag);
  }
  
  /**
   * Get computed accessible name for an element
   * @param {Element} el - Target element
   * @returns {string|null}
   */
  function getAccessibleName(el) {
    // Priority: aria-labelledby > aria-label > label[for] > title > text content
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const name = labelledBy.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean).join(" ");
      if (name) return name;
    }
    
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    
    // For labelable elements, check associated label
    const tag = el.tagName.toLowerCase();
    const labelable = ["input", "select", "textarea", "button", "meter", "progress", "output"];
    if (el.id && labelable.includes(tag)) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent?.trim() || null;
    }
    
    const title = el.getAttribute("title");
    if (title) return title;
    
    // Fallback to text content for interactive elements
    if (["button", "a", "label", "legend", "caption"].includes(tag)) {
      const text = el.textContent?.trim();
      return text ? text.slice(0, 100) : null;
    }
    
    // For img, use alt
    if (tag === "img") {
      return el.getAttribute("alt") || null;
    }
    
    return null;
  }
  
  /**
   * Get aria-describedby content
   * @param {Element} el - Target element
   * @returns {string|null}
   */
  function getAccessibleDescription(el) {
    const describedBy = el.getAttribute("aria-describedby");
    if (describedBy) {
      return describedBy.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean).join(" ") || null;
    }
    return null;
  }
  
  /**
   * Get accessibility information for an element
   * @param {Element} el - Target element
   * @returns {AccessibilityInfo}
   */
  function getAccessibilityInfo(el) {
    const role = el.getAttribute("role") || getImplicitRole(el);
    const ariaExpanded = el.getAttribute("aria-expanded");
    const ariaPressed = el.getAttribute("aria-pressed");
    const ariaChecked = el.getAttribute("aria-checked");
    const ariaSelected = el.getAttribute("aria-selected");
    
    const parseAriaBoolean = (val) => val === "true" ? true : val === "false" ? false : undefined;
    
    return {
      role,
      name: getAccessibleName(el),
      description: getAccessibleDescription(el),
      focusable: isFocusable(el),
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      expanded: parseAriaBoolean(ariaExpanded),
      pressed: parseAriaBoolean(ariaPressed),
      checked: typeof el.checked === "boolean" ? el.checked : parseAriaBoolean(ariaChecked),
      selected: typeof el.selected === "boolean" ? el.selected : parseAriaBoolean(ariaSelected)
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // Key Styles (always captured)
  // ─────────────────────────────────────────────────────────────────────

  const KEY_STYLE_DEFAULTS = {
    position: new Set(["static"]),
    overflow: new Set(["visible"]),
    zIndex: new Set(["auto"]),
    opacity: new Set(["1"]),
    color: new Set(["rgb(0, 0, 0)"]),
    backgroundColor: new Set(["rgba(0, 0, 0, 0)", "transparent"]),
    fontSize: new Set(["16px"]),
    fontWeight: new Set(["400", "normal"]),
  };

  /**
   * Get a small set of layout-critical CSS properties (always captured)
   * @param {Element} el - Target element
   * @returns {Record<string, string>}
   */
  function getKeyStyles(el) {
    const computed = window.getComputedStyle(el);
    const styles = {};
    const display = computed.display;
    if (display) styles.display = display;
    for (const key of Object.keys(KEY_STYLE_DEFAULTS)) {
      const value = computed[key];
      if (value && !KEY_STYLE_DEFAULTS[key].has(value)) {
        styles[key] = value;
      }
    }
    return styles;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Debug Mode Helpers (v0.3.0)
  // ─────────────────────────────────────────────────────────────────────

  const COMPUTED_STYLE_KEYS = [
    // Layout
    "display", "position", "top", "right", "bottom", "left",
    "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
    // Flexbox
    "flexDirection", "flexWrap", "justifyContent", "alignItems", "alignSelf", "flex", "gap",
    // Grid
    "gridTemplateColumns", "gridTemplateRows", "gridColumn", "gridRow",
    // Visual
    "overflow", "overflowX", "overflowY", "zIndex", "opacity", "visibility",
    // Typography
    "color", "fontSize", "fontWeight", "fontFamily", "lineHeight", "textAlign",
    // Background & Border
    "backgroundColor", "backgroundImage", "borderRadius", "boxShadow",
    // Transform
    "transform", "transformOrigin",
    // Interaction
    "cursor", "pointerEvents", "userSelect"
  ];
  
  const DEFAULT_STYLE_VALUES = new Set([
    "none", "auto", "normal", "visible", "static", "baseline",
    "0px", "0", "1", "start", "stretch", "row", "nowrap",
    "rgba(0, 0, 0, 0)", "rgb(0, 0, 0)", "transparent"
  ]);
  
  /**
   * Get computed styles (debug mode only)
   * @param {Element} el - Target element
   * @returns {Record<string, string>}
   */
  function getComputedStyles(el) {
    const computed = window.getComputedStyle(el);
    const styles = {};
    
    for (const key of COMPUTED_STYLE_KEYS) {
      const value = computed[key];
      if (value && !DEFAULT_STYLE_VALUES.has(value)) {
        styles[key] = value.length > 150 ? value.slice(0, 150) + "…" : value;
      }
    }
    
    return styles;
  }
  
  /**
   * Get parent element context (debug mode only)
   * @param {Element} el - Target element
   * @returns {ParentContext|null}
   */
  function getParentContext(el) {
    let parent = el.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) {
      return null;
    }
    
    // Skip agent-annotation UI elements
    while (parent && isAgentElement(parent)) {
      parent = parent.parentElement;
    }
    if (!parent || parent === document.body || parent === document.documentElement) {
      return null;
    }
    
    const computed = window.getComputedStyle(parent);
    const styles = {};
    
    styles.display = computed.display;
    styles.position = computed.position;
    
    if (computed.display.includes("flex")) {
      styles.flexDirection = computed.flexDirection;
      styles.flexWrap = computed.flexWrap;
      styles.justifyContent = computed.justifyContent;
      styles.alignItems = computed.alignItems;
      if (computed.gap && computed.gap !== "normal") {
        styles.gap = computed.gap;
      }
    }
    
    if (computed.display.includes("grid")) {
      styles.gridTemplateColumns = computed.gridTemplateColumns;
      styles.gridTemplateRows = computed.gridTemplateRows;
      if (computed.gap && computed.gap !== "normal") {
        styles.gap = computed.gap;
      }
    }
    
    if (computed.overflow !== "visible") {
      styles.overflow = computed.overflow;
    }
    
    return {
      tag: parent.tagName.toLowerCase(),
      id: parent.id || undefined,
      classes: Array.from(parent.classList),
      styles
    };
  }
  
  /**
   * Discover all CSS variable names from stylesheets
   * @returns {Set<string>}
   */
  function discoverCSSVariables() {
    if (cachedCSSVarNames) return cachedCSSVarNames;
    
    const varNames = new Set();
    
    function extractFromRules(rules) {
      if (!rules) return;
      for (const rule of rules) {
        if (rule.style) {
          for (const prop of rule.style) {
            if (prop.startsWith("--")) {
              varNames.add(prop);
            }
          }
        }
        if (rule.cssRules) {
          extractFromRules(rule.cssRules);
        }
      }
    }
    
    for (const sheet of document.styleSheets) {
      try {
        extractFromRules(sheet.cssRules);
      } catch (e) {
        // CORS blocks access - skip this sheet
      }
    }
    
    cachedCSSVarNames = varNames;
    return varNames;
  }
  
  /**
   * Get CSS variables used by element (debug mode only)
   * @param {Element} el - Target element
   * @returns {Record<string, string>}
   */
  function getCSSVariables(el) {
    const style = window.getComputedStyle(el);
    const varNames = discoverCSSVariables();
    const variables = {};
    
    let count = 0;
    for (const name of varNames) {
      if (count >= 50) break;
      const value = style.getPropertyValue(name).trim();
      if (value) {
        variables[name] = value.length > 100 ? value.slice(0, 100) + "…" : value;
        count++;
      }
    }
    
    return variables;
  }
  
  /**
   * Reset CSS variable cache (call on deactivate)
   */
  function resetCSSVarCache() {
    cachedCSSVarNames = null;
  }
  
  function pruneStaleSelections() {
    if (!selectedElements.length) return;
    
    const nextSelections = [];
    const nextScreenshots = new Map();
    const nextComments = new Map();
    const nextPositions = new Map();
    const nextOpenNotes = new Set();
    
    selectedElements.forEach((sel, i) => {
      if (sel?.element && document.contains(sel.element)) {
        const nextIndex = nextSelections.length;
        nextSelections.push(sel);
        
        if (elementScreenshots.has(i)) {
          nextScreenshots.set(nextIndex, elementScreenshots.get(i));
        }
        if (elementComments.has(i)) {
          nextComments.set(nextIndex, elementComments.get(i));
        }
        if (notePositions.has(i)) {
          nextPositions.set(nextIndex, notePositions.get(i));
        }
        if (openNotes.has(i)) {
          nextOpenNotes.add(nextIndex);
        }
      } else if (openNotes.has(i)) {
        const card = notesContainer?.querySelector(`[data-index="${i}"]`);
        if (card) card.remove();
      }
    });
    
    if (nextSelections.length !== selectedElements.length) {
      selectedElements = nextSelections;
      elementScreenshots = nextScreenshots;
      elementComments = nextComments;
      notePositions = nextPositions;
      
      notesContainer.innerHTML = "";
      openNotes = new Set();
      nextOpenNotes.forEach(i => createNoteCard(i));
      
      updateBadges();
      updateConnectors();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Edit Capture
  // ─────────────────────────────────────────────────────────────────────

  function processEtchMutations(mutations) {
    for (const m of mutations) {
      if (isAgentElement(m.target) || isAgentElement(m.target.parentElement)) continue;

      if (m.type === "attributes") {
        if (m.attributeName === "data-agent-changed" || m.attributeName === REACT_COMPONENT_MARKER_ATTR) continue;

        if (m.attributeName === "style") {
          if (!etchStyleInitials.has(m.target)) {
            etchStyleInitials.set(m.target, m.oldValue);
            etchChangeCount++;
          }
        } else if (m.attributeName === "class") {
          if (!etchClassInitials.has(m.target)) {
            etchClassInitials.set(m.target, m.oldValue);
            etchChangeCount++;
          }
        } else {
          if (!etchAttrInitials.has(m.target)) {
            etchAttrInitials.set(m.target, new Map());
          }
          const attrs = etchAttrInitials.get(m.target);
          if (!attrs.has(m.attributeName)) {
            attrs.set(m.attributeName, m.oldValue);
            etchChangeCount++;
          }
        }
        if (!m.target.hasAttribute("data-agent-changed")) {
          m.target.setAttribute("data-agent-changed", "");
        }
      } else if (m.type === "characterData") {
        if (!etchTextInitials.has(m.target)) {
          etchTextInitials.set(m.target, m.oldValue);
          etchChangeCount++;
        }
        const parent = m.target.parentElement;
        if (parent && !isAgentElement(parent) && !parent.hasAttribute("data-agent-changed")) {
          parent.setAttribute("data-agent-changed", "");
        }
      } else if (m.type === "childList") {
        const hasNonAgentNodes = [...m.addedNodes, ...m.removedNodes].some(n =>
          n.nodeType !== Node.ELEMENT_NODE || !isAgentElement(n)
        );
        if (hasNonAgentNodes) {
          etchChildListMutations.push(m);
          etchChangeCount++;
          if (m.target.nodeType === Node.ELEMENT_NODE && !m.target.hasAttribute("data-agent-changed")) {
            m.target.setAttribute("data-agent-changed", "");
          }
        }
      }
    }
  }

  function clearEtchMarkers() {
    document.querySelectorAll("[data-agent-changed]").forEach(el => el.removeAttribute("data-agent-changed"));
  }

  function startEtchCapture() {
    clearEtchMarkers();
    etchMode = true;
    etchStartTime = Date.now();
    etchInitialRules = serializeAllStylesheets();
    etchStyleInitials.clear();
    etchClassInitials.clear();
    etchAttrInitials.clear();
    etchTextInitials.clear();
    etchChildListMutations = [];
    etchChangeCount = 0;
    updateEtchCounter();

    etchObserver = new MutationObserver((mutations) => {
      processEtchMutations(mutations);
      updateEtchCounter();
    });

    etchObserver.observe(document.documentElement, {
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    });
  }

  function stopEtchCapture() {
    if (etchObserver) {
      const pending = etchObserver.takeRecords();
      etchObserver.disconnect();
      if (pending.length) processEtchMutations(pending);
      etchObserver = null;
    }
    etchMode = false;
    updateEtchCounter();
  }

  function updateEtchCounter() {
    const counter = document.getElementById("agent-etch-count");
    if (!counter) return;
    const text = etchChangeCount > 0 ? `${etchChangeCount}` : "";
    const display = etchChangeCount > 0 ? "inline-flex" : "none";
    if (counter.textContent !== text) counter.textContent = text;
    if (counter.style.display !== display) counter.style.display = display;
  }

  function serializeAllStylesheets() {
    const sheets = [];
    let crossOriginCount = 0;

    for (let si = 0; si < document.styleSheets.length; si++) {
      const sheet = document.styleSheets[si];
      // Skip agent-annotation's own injected styles
      if (sheet.ownerNode?.id === "agent-styles") continue;

      try {
        const rules = sheet.cssRules;
        const sheetLabel = sheet.href || `inline stylesheet`;

        // Individual top-level rule strings for undo/redo (each passed directly to insertRule)
        const ruleTexts = [];
        for (let i = 0; i < rules.length; i++) {
          ruleTexts.push(rules[i].cssText);
        }

        // Per-rule breakdown for diffing (recurses into @media, @supports, etc.)
        const ruleData = [];
        serializeRulesRecursive(rules, ruleData);

        sheets.push({
          ownerNode: sheet.ownerNode,   // stable reference for matching
          label: sheetLabel,            // display label for diff output
          ruleTexts,                    // for undo/redo restoration
          rules: ruleData,              // for property-level diffing
        });
      } catch (e) {
        crossOriginCount++;
      }
    }

    return { sheets, crossOriginCount };
  }

  function serializeRulesRecursive(rules, output) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule.style && rule.selectorText) {
        // CSSStyleRule (or similar with a selector and style declaration)
        output.push({
          selectorText: rule.selectorText,
          properties: serializeRuleProperties(rule.style),
          // Walk up the full parentRule chain for nested context
          // e.g., "@layer base > @media (max-width: 768px)" for doubly-nested rules
          parentRule: getParentRuleContext(rule),
        });
      }
      // Recurse into grouping rules (@media, @supports, @layer, etc.)
      if (rule.cssRules) {
        serializeRulesRecursive(rule.cssRules, output);
      }
    }
  }

  function getParentRuleContext(rule) {
    const parts = [];
    let parent = rule.parentRule;
    while (parent) {
      // Extract the at-rule prefix (everything before the first "{")
      if (parent.cssText) {
        parts.unshift(parent.cssText.split("{")[0].trim());
      }
      parent = parent.parentRule;
    }
    return parts.length > 0 ? parts.join(" > ") : null;
  }

  function serializeRuleProperties(style) {
    const props = {};
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      props[prop] = style.getPropertyValue(prop);
    }
    return props;
  }

  function diffStylesheetRules(initial, current) {
    const changes = [];

    // Build lookup: ownerNode → sheet data
    const currentByNode = new Map();
    for (const sheet of current.sheets) {
      currentByNode.set(sheet.ownerNode, sheet);
    }

    for (const iniSheet of initial.sheets) {
      const curSheet = currentByNode.get(iniSheet.ownerNode);
      if (!curSheet) continue; // Sheet removed from DOM — skip

      // Group rules by selector (handles duplicate selectors within a sheet)
      const iniGroups = groupRulesByKey(iniSheet.rules);
      const curGroups = groupRulesByKey(curSheet.rules);

      // Find changed and added rules
      for (const [key, curRules] of curGroups) {
        const iniRules = iniGroups.get(key) || [];

        // Compare corresponding rules by position in the group
        const maxLen = Math.max(curRules.length, iniRules.length);
        for (let i = 0; i < maxLen; i++) {
          const ini = iniRules[i];
          const cur = curRules[i];

          if (!ini && cur) {
            // New rule
            changes.push({
              ruleSelector: formatRuleSelector(cur),
              sheet: curSheet.label,
              added: { ...cur.properties },
              changed: [],
              removed: [],
            });
          } else if (ini && !cur) {
            // Removed rule
            changes.push({
              ruleSelector: formatRuleSelector(ini),
              sheet: iniSheet.label,
              added: {},
              changed: [],
              removed: Object.keys(ini.properties),
            });
          } else if (ini && cur) {
            // Compare properties
            const added = {};
            const changed = [];
            const removed = [];

            for (const [prop, value] of Object.entries(cur.properties)) {
              if (!(prop in ini.properties)) {
                added[prop] = value;
              } else if (ini.properties[prop] !== value) {
                changed.push({ property: prop, from: ini.properties[prop], to: value });
              }
            }
            for (const prop of Object.keys(ini.properties)) {
              if (!(prop in cur.properties)) {
                removed.push(prop);
              }
            }

            if (Object.keys(added).length || changed.length || removed.length) {
              changes.push({
                ruleSelector: formatRuleSelector(cur),
                sheet: curSheet.label,
                added,
                changed,
                removed,
              });
            }
          }
        }
      }

      // Find selectors that existed initially but are completely gone now
      for (const [key, iniRules] of iniGroups) {
        if (!curGroups.has(key)) {
          for (const ini of iniRules) {
            changes.push({
              ruleSelector: formatRuleSelector(ini),
              sheet: iniSheet.label,
              added: {},
              changed: [],
              removed: Object.keys(ini.properties),
            });
          }
        }
      }
    }

    return changes;
  }

  function groupRulesByKey(rules) {
    const groups = new Map();
    for (const rule of rules) {
      // Include parentRule context in key so rules with the same selector but
      // different nesting (e.g., .card at top level vs .card inside @media) are
      // diffed independently rather than compared by position
      const key = (rule.parentRule || "") + "|||" + rule.selectorText;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rule);
    }
    return groups;
  }

  function formatRuleSelector(rule) {
    return rule.parentRule
      ? `${rule.parentRule} { ${rule.selectorText} }`
      : rule.selectorText;
  }

  function parseStyleAttribute(str) {
    if (!str) return {};
    const props = {};
    // Use a temporary element to parse reliably
    const tmp = document.createElement("div");
    tmp.style.cssText = str;
    for (let i = 0; i < tmp.style.length; i++) {
      const prop = tmp.style[i];
      props[prop] = tmp.style.getPropertyValue(prop);
    }
    return props;
  }

  function diffInlineStyles() {
    const changes = [];

    for (const [el, initialValue] of etchStyleInitials) {
      if (!document.contains(el)) continue;
      const currentValue = el.getAttribute("style");
      if (initialValue === currentValue) continue;

      const initial = parseStyleAttribute(initialValue);
      const current = parseStyleAttribute(currentValue);

      const added = {};
      const changed = [];
      const removed = [];

      for (const [prop, value] of Object.entries(current)) {
        if (!(prop in initial)) {
          added[prop] = value;
        } else if (initial[prop] !== value) {
          changed.push({ property: prop, from: initial[prop], to: value });
        }
      }
      for (const prop of Object.keys(initial)) {
        if (!(prop in current)) {
          removed.push(prop);
        }
      }

      if (Object.keys(added).length || changed.length || removed.length) {
        changes.push({
          selector: generateSelector(el),
          tag: el.tagName.toLowerCase(),
          added,
          changed,
          removed,
        });
      }
    }

    return changes;
  }

  function compileDOMChanges() {
    const changes = [];

    // Class changes
    for (const [el, initialValue] of etchClassInitials) {
      if (!document.contains(el)) continue;
      const currentValue = el.getAttribute("class");
      if (initialValue === currentValue) continue;

      const initialClasses = (initialValue || "").split(/\s+/).filter(Boolean);
      const currentClasses = (currentValue || "").split(/\s+/).filter(Boolean);
      const added = currentClasses.filter(c => !initialClasses.includes(c));
      const removed = initialClasses.filter(c => !currentClasses.includes(c));

      if (added.length || removed.length) {
        const parts = [];
        if (added.length) parts.push(`added: ${added.join(", ")}`);
        if (removed.length) parts.push(`removed: ${removed.join(", ")}`);
        changes.push({
          type: "attribute",
          selector: generateSelector(el),
          detail: `class ${parts.join("; ")}`,
        });
      }
    }

    // Other attribute changes (non-style, non-class: data-*, aria-*, href, src, etc.)
    for (const [el, attrs] of etchAttrInitials) {
      if (!document.contains(el)) continue;
      for (const [attrName, initialValue] of attrs) {
        const currentValue = el.getAttribute(attrName);
        if (initialValue === currentValue) continue;
        const truncate = (s) => s && s.length > 80 ? s.slice(0, 80) + "..." : (s || "");
        if (currentValue === null) {
          changes.push({
            type: "attribute",
            selector: generateSelector(el),
            detail: `${attrName} removed (was "${truncate(initialValue)}")`,
          });
        } else if (initialValue === null) {
          changes.push({
            type: "attribute",
            selector: generateSelector(el),
            detail: `${attrName} added: "${truncate(currentValue)}"`,
          });
        } else {
          changes.push({
            type: "attribute",
            selector: generateSelector(el),
            detail: `${attrName}: "${truncate(initialValue)}" → "${truncate(currentValue)}"`,
          });
        }
      }
    }

    // Text changes
    for (const [node, initialValue] of etchTextInitials) {
      if (!document.contains(node)) continue;
      const currentValue = node.data || node.textContent;
      if (initialValue === currentValue) continue;

      const parent = node.parentElement;
      if (!parent || isAgentElement(parent)) continue;

      const truncate = (s) => s && s.length > 80 ? s.slice(0, 80) + "..." : s;
      changes.push({
        type: "text",
        selector: generateSelector(parent),
        detail: `"${truncate(initialValue)}" → "${truncate(currentValue)}"`,
      });
    }

    // Structural changes (deduplicated by parent)
    const structuralParents = new Set();
    for (const m of etchChildListMutations) {
      if (isAgentElement(m.target)) continue;
      if (!document.contains(m.target)) continue;
      structuralParents.add(m.target);
    }
    for (const parent of structuralParents) {
      changes.push({
        type: "structural",
        selector: generateSelector(parent),
        detail: "DOM structure modified (children added/removed)",
      });
    }

    return changes;
  }

  async function captureBeforeAfterScreenshots() {
    clearEtchMarkers();

    const afterResp = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
    const afterScreenshot = afterResp?.dataUrl || null;

    // Record final values for redo
    const finalStyles = new Map();
    const finalClasses = new Map();
    for (const [el] of etchStyleInitials) {
      finalStyles.set(el, el.getAttribute("style"));
    }
    for (const [el] of etchClassInitials) {
      finalClasses.set(el, el.getAttribute("class"));
    }
    const currentRulesSnapshot = serializeAllStylesheets();

    // Inject transition/animation killer to prevent visual artifacts
    const transitionKiller = document.createElement("style");
    transitionKiller.id = "agent-etch-transition-killer";
    transitionKiller.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
    (document.head || document.documentElement).appendChild(transitionKiller);

    let beforeScreenshot = null;

    try {
      // UNDO: restore initial visual state
      for (const [el, initial] of etchStyleInitials) {
        if (!document.contains(el)) continue;
        if (initial === null) el.removeAttribute("style");
        else el.setAttribute("style", initial);
      }
      for (const [el, initial] of etchClassInitials) {
        if (!document.contains(el)) continue;
        if (initial === null) el.removeAttribute("class");
        else el.setAttribute("class", initial);
      }
      restoreStylesheetRules(etchInitialRules);

      // Force repaint: double-rAF guarantees at least one paint
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Capture "before" screenshot (page in original visual state)
      const beforeResp = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
      beforeScreenshot = beforeResp?.dataUrl || null;
    } finally {
      // REDO: always restore modified visual state, even if before screenshot failed.
      // Prevents leaving the page in the undone state with user's edits lost.
      for (const [el, final] of finalStyles) {
        if (!document.contains(el)) continue;
        if (final === null) el.removeAttribute("style");
        else el.setAttribute("style", final);
      }
      for (const [el, final] of finalClasses) {
        if (!document.contains(el)) continue;
        if (final === null) el.removeAttribute("class");
        else el.setAttribute("class", final);
      }
      restoreStylesheetRules(currentRulesSnapshot);

      // Always clean up transition killer
      transitionKiller.remove();

      // Force repaint to restore visual state
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }

    return { beforeScreenshot, afterScreenshot };
  }

  function restoreStylesheetRules(snapshot) {
    if (!snapshot?.sheets) return;

    // Build lookup from ownerNode → rule texts array
    const rulesByNode = new Map();
    for (const entry of snapshot.sheets) {
      rulesByNode.set(entry.ownerNode, entry.ruleTexts);
    }

    for (let si = 0; si < document.styleSheets.length; si++) {
      const sheet = document.styleSheets[si];
      // Skip sheets not in the snapshot (added by JS after recording started, or agent-annotation's own)
      if (!rulesByNode.has(sheet.ownerNode)) continue;

      try {
        const ruleTexts = rulesByNode.get(sheet.ownerNode);

        // Clear current rules
        while (sheet.cssRules.length > 0) {
          sheet.deleteRule(0);
        }
        // Re-insert each original rule directly (no parsing needed)
        for (const ruleStr of ruleTexts) {
          try {
            sheet.insertRule(ruleStr, sheet.cssRules.length);
          } catch (e) {
            // Rule might be invalid in current context, skip
          }
        }
      } catch (e) {
        // Cross-origin, skip
      }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // Screenshot Cropping
  // ─────────────────────────────────────────────────────────────────────
  
  async function cropToElement(dataUrl, element) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        
        const rect = element.getBoundingClientRect();
        
        let minX = Math.max(0, rect.left - SCREENSHOT_PADDING);
        let minY = Math.max(0, rect.top - SCREENSHOT_PADDING);
        let maxX = Math.min(window.innerWidth, rect.right + SCREENSHOT_PADDING);
        let maxY = Math.min(window.innerHeight, rect.bottom + SCREENSHOT_PADDING);
        
        const cropW = Math.max(1, (maxX - minX) * dpr);
        const cropH = Math.max(1, (maxY - minY) * dpr);
        
        if (maxX <= minX || maxY <= minY) {
          resolve(dataUrl);
          return;
        }
        
        const cropX = minX * dpr;
        const cropY = minY * dpr;
        
        const canvas = document.createElement("canvas");
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }
  
  /**
   * Add numbered badges to a full-page screenshot for selected elements
   * @param {string} dataUrl - Base64 screenshot data URL
   * @param {Array<{element: Element}>} elements - Selected elements with their DOM references
   * @returns {Promise<string>} Modified screenshot with badges
   */
  async function addBadgesToScreenshot(dataUrl, elements) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        
        // Draw the original screenshot
        ctx.drawImage(img, 0, 0);
        
        // Badge styling (matches .agent-marker-badge)
        const badgeSize = 28 * dpr;
        const fontSize = 13 * dpr;
        const bgColor = "#8abeb7";     // --agent-accent (teal)
        const textColor = "#1d1f21";   // --agent-bg-body (dark)
        
        elements.forEach((sel, i) => {
          const element = sel.element;
          if (!element || !document.contains(element)) return;
          
          const rect = element.getBoundingClientRect();
          
          // Badge center should be at element's top-right corner (matching DOM badge positioning)
          // DOM: badge.style.left = rect.right - 14, badge.style.top = rect.top - 14
          // This puts the 28px badge's CENTER at (rect.right, rect.top)
          const centerX = rect.right * dpr;
          const centerY = rect.top * dpr;
          
          // Clamp to keep badge fully visible within canvas
          const badgeX = Math.max(badgeSize / 2, Math.min(centerX, canvas.width - badgeSize / 2));
          const badgeY = Math.max(badgeSize / 2, Math.min(centerY, canvas.height - badgeSize / 2));
          
          // Badge shadow (set before fill so it applies to the shape)
          ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
          ctx.shadowBlur = 4 * dpr;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2 * dpr;
          
          // Badge background (circle)
          ctx.beginPath();
          ctx.arc(badgeX, badgeY, badgeSize / 2, 0, Math.PI * 2);
          ctx.fillStyle = bgColor;
          ctx.fill();
          
          // Reset shadow for text
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          
          // Badge number
          ctx.fillStyle = textColor;
          ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), badgeX, badgeY);
        });
        
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // Submit / Cancel
  // ─────────────────────────────────────────────────────────────────────
  
  async function handleSubmit() {
    const context = document.getElementById("agent-context")?.value?.trim() || "";
    
    // Re-capture debug data for all elements if debug mode is on at submit time
    // (handles elements selected before debug was enabled)
    pruneStaleSelections();
    if (debugMode) {
      selectedElements.forEach(sel => {
        if (sel.element && document.contains(sel.element)) {
          sel.computedStyles = getComputedStyles(sel.element);
          sel.parentContext = getParentContext(sel.element);
          sel.cssVariables = getCSSVariables(sel.element);
        }
      });
    }

    await enrichReactComponentInfo();

    const elements = selectedElements.map((sel, i) => {
      const { element, ...rest } = sel;
      return {
        ...rest,
        comment: elementComments.get(i) || ""
      };
    });
    
    // Hide UI for screenshot capture
    hideHighlight();
    hideTooltip();
    if (markersContainer) markersContainer.style.display = "none";
    if (notesContainer) notesContainer.style.display = "none";
    if (connectorsEl) connectorsEl.style.display = "none";
    if (panelEl) panelEl.style.display = "none";
    clearEtchMarkers();
    
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    
    let screenshot = null;
    let screenshots = [];
    
    if (screenshotMode !== "none") {
      try {
        const resp = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
        if (resp?.dataUrl) {
          const fullScreenshot = resp.dataUrl;
          
          if (screenshotMode === "full") {
            // Add numbered badges to the full screenshot so elements can be identified
            screenshot = await addBadgesToScreenshot(fullScreenshot, selectedElements);
          } else {
            for (let i = 0; i < selectedElements.length; i++) {
              const hasScreenshot = elementScreenshots.get(i) !== false;
              const element = selectedElements[i].element;
              if (hasScreenshot && element && document.contains(element)) {
                const cropped = await cropToElement(fullScreenshot, element);
                screenshots.push({ index: i + 1, dataUrl: cropped });
              }
            }
          }
        }
      } catch (err) {
        console.error("[agent-annotation] Screenshot failed:", err);
      }
    }

    // Edit capture
    let editCapture = null;
    if (etchStartTime) {
      // Disconnect observer first — must happen regardless of errors below
      stopEtchCapture();

      try {
        const inlineStyles = diffInlineStyles();
        const currentRulesSnapshot = serializeAllStylesheets();
        const rules = etchInitialRules ? diffStylesheetRules(etchInitialRules, currentRulesSnapshot) : [];
        const dom = compileDOMChanges();
        const changeCount = inlineStyles.length + rules.length + dom.length;
        const warnings = [];

        if (etchInitialRules?.crossOriginCount > 0) {
          warnings.push(`${etchInitialRules.crossOriginCount} cross-origin stylesheet(s) could not be tracked`);
        }

        let beforeScreenshot = null;
        let afterScreenshot = null;

        if (changeCount > 0) {
          // UI is already hidden from the annotation screenshot step above
          const shots = await captureBeforeAfterScreenshots();
          beforeScreenshot = shots.beforeScreenshot;
          afterScreenshot = shots.afterScreenshot;
        }

        editCapture = {
          inlineStyles,
          rules,
          dom,
          beforeScreenshot,
          afterScreenshot,
          duration: Date.now() - etchStartTime,
          changeCount,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      } catch (err) {
        console.error("[agent-annotation] Edit capture failed:", err);
      }
    }
    
    let delivery;
    try {
      delivery = await chrome.runtime.sendMessage({
        type: "ANNOTATIONS_COMPLETE",
        requestId,
        result: {
          success: true,
          elements,
          screenshot,
          screenshots,
          prompt: context,
          url: window.location.href,
          title: document.title,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          editCapture,
        },
      });
    } catch (err) {
      delivery = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (!delivery?.ok) {
      console.error("[agent-annotation] Submit failed:", delivery?.error || "Unknown error");
      if (markersContainer) markersContainer.style.display = "";
      if (notesContainer) notesContainer.style.display = "";
      if (connectorsEl) connectorsEl.style.display = "";
      if (panelEl) panelEl.style.display = "";
      alert(`Failed to submit annotations: ${delivery?.error || "Unknown error"}`);
      return;
    }

    deactivate();
  }
  
  function handleCancel() {
    const id = requestId;
    deactivate();
    
    try {
      chrome.runtime.sendMessage({
        type: "CANCEL",
        requestId: id,
        reason: "user",
      });
    } catch (e) {
      console.log("[agent-annotation] Could not send cancel (no connection)");
    }
  }
  
  console.log("[agent-annotation] Content script ready (v0.4.0)");
})();
