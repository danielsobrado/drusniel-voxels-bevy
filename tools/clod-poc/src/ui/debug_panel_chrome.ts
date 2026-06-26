const STORAGE_PREFIX = "clod-debug-panel-";

interface PersistedPanelState {
  left: number;
  top: number;
  minimized: boolean;
}

export interface DebugPanelChromeOptions {
  panelId: string;
  title: string;
  /** Fixed position + drag when true; stays in document flow when false. */
  floating?: boolean;
  defaultPosition?: { left: number; top: number };
  defaultMinimized?: boolean;
  closable?: boolean;
  onClose?: () => void;
}

export interface DebugPanelChrome {
  root: HTMLElement;
  body: HTMLElement;
  setMinimized(minimized: boolean): void;
  isMinimized(): boolean;
  setPosition(left: number, top: number): void;
  destroy(): void;
}

function storageKey(panelId: string): string {
  return `${STORAGE_PREFIX}${panelId}`;
}

function loadState(panelId: string): PersistedPanelState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(panelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPanelState;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveState(panelId: string, state: PersistedPanelState): void {
  try {
    sessionStorage.setItem(storageKey(panelId), JSON.stringify(state));
  } catch {
    // ignore
  }
}

function clearState(panelId: string): void {
  try {
    sessionStorage.removeItem(storageKey(panelId));
  } catch {
    // ignore
  }
}

function clampPosition(left: number, top: number, root: HTMLElement): { left: number; top: number } {
  const maxLeft = Math.max(0, window.innerWidth - root.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - root.offsetHeight);
  return {
    left: Math.min(maxLeft, Math.max(0, left)),
    top: Math.min(maxTop, Math.max(0, top)),
  };
}

function applyFloatingPosition(root: HTMLElement, left: number, top: number): void {
  root.style.position = "fixed";
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
  root.style.right = "auto";
  root.style.bottom = "auto";
}

function attachDrag(
  root: HTMLElement,
  handle: HTMLElement,
  panelId: string,
  readMinimized: () => boolean,
): void {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const next = clampPosition(originLeft + dx, originTop + dy, root);
    applyFloatingPosition(root, next.left, next.top);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(event.pointerId);
    handle.style.cursor = "grab";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    const rect = root.getBoundingClientRect();
    saveState(panelId, { left: rect.left, top: rect.top, minimized: readMinimized() });
  };

  handle.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    const rect = root.getBoundingClientRect();
    originLeft = rect.left;
    originTop = rect.top;
    handle.setPointerCapture(event.pointerId);
    handle.style.cursor = "grabbing";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    event.preventDefault();
  });
}

function styleChromeButton(btn: HTMLButtonElement): void {
  btn.style.cssText = `
    width: 22px; height: 22px; padding: 0; font-size: 14px; line-height: 1;
    border: 1px solid rgba(120,180,255,0.35); border-radius: 4px;
    background: rgba(20,30,45,0.9); color: #e8ddbd; cursor: pointer; flex: none;
  `;
}

/**
 * Adds a draggable title bar with minimize/close to a debug panel.
 * Moves existing host children into the panel body.
 */
export function attachDebugPanelChrome(
  host: HTMLElement,
  options: DebugPanelChromeOptions,
): DebugPanelChrome {
  const {
    panelId,
    title,
    floating = false,
    defaultPosition = { left: 12, top: 120 },
    defaultMinimized = false,
    closable = true,
    onClose,
  } = options;

  const persisted = loadState(panelId);
  let minimized = persisted?.minimized ?? defaultMinimized;

  const root = document.createElement("div");
  root.className = floating ? "debug-panel-chrome debug-panel-chrome--floating" : "debug-panel-chrome";
  root.dataset.panelId = panelId;

  const header = document.createElement("header");
  header.className = "debug-panel-chrome-header";
  header.dataset.dragHandle = "true";

  const titleEl = document.createElement("span");
  titleEl.className = "debug-panel-chrome-title";
  titleEl.textContent = title;

  const actions = document.createElement("div");
  actions.className = "debug-panel-chrome-actions";

  const minimizeBtn = document.createElement("button");
  minimizeBtn.type = "button";
  minimizeBtn.dataset.panelMinimize = "true";
  minimizeBtn.title = "Minimize";
  minimizeBtn.setAttribute("aria-label", "Minimize");
  styleChromeButton(minimizeBtn);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.dataset.panelClose = "true";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  styleChromeButton(closeBtn);

  actions.append(minimizeBtn);
  if (closable) actions.append(closeBtn);
  header.append(titleEl, actions);

  const body = document.createElement("div");
  body.className = "debug-panel-chrome-body";
  while (host.firstChild) body.appendChild(host.firstChild);

  root.append(header, body);
  host.appendChild(root);

  if (floating) {
    host.style.display = "contents";
    root.style.cssText = `
      position: fixed; z-index: 9000; pointer-events: auto;
      width: min(320px, calc(100vw - 24px));
      background: rgba(10,14,20,0.92); color: #c8e6ff;
      font: 11px/1.35 monospace; border: 1px solid rgba(120,180,255,0.35);
      border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    `;
    const initial = persisted ?? defaultPosition;
    applyFloatingPosition(root, initial.left, initial.top);
    attachDrag(root, header, panelId, () => minimized);
    window.addEventListener("resize", () => {
      const rect = root.getBoundingClientRect();
      const clamped = clampPosition(rect.left, rect.top, root);
      applyFloatingPosition(root, clamped.left, clamped.top);
      saveState(panelId, { left: clamped.left, top: clamped.top, minimized });
    });
  } else {
    root.style.pointerEvents = "auto";
  }

  const setMinimized = (next: boolean) => {
    minimized = next;
    body.hidden = next;
    minimizeBtn.textContent = next ? "+" : "−";
    minimizeBtn.title = next ? "Restore" : "Minimize";
    minimizeBtn.setAttribute("aria-label", next ? "Restore" : "Minimize");
    if (floating) {
      const rect = root.getBoundingClientRect();
      saveState(panelId, { left: rect.left, top: rect.top, minimized: next });
    } else {
      saveState(panelId, { left: 0, top: 0, minimized: next });
    }
  };

  minimizeBtn.onclick = () => setMinimized(!minimized);
  if (closable) {
    closeBtn.onclick = () => {
      if (onClose) onClose();
      else root.hidden = true;
      if (floating) clearState(panelId);
    };
  }

  setMinimized(minimized);

  const setPosition = (left: number, top: number) => {
    if (!floating) return;
    const clamped = clampPosition(left, top, root);
    applyFloatingPosition(root, clamped.left, clamped.top);
    saveState(panelId, { left: clamped.left, top: clamped.top, minimized });
  };

  return {
    root,
    body,
    setMinimized,
    isMinimized: () => minimized,
    setPosition,
    destroy() {
      root.remove();
    },
  };
}
