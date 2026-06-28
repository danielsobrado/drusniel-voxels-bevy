const BUILD_MENU_STYLE_ID = "construction-build-menu-layout-fix";
const HUD_EDGE_PX = 8;
const HUD_GAP_PX = 12;
const BUILD_MENU_BOTTOM_PX = 86;
const BUILD_MENU_MAX_WIDTH_PX = 940;
const BUILD_MENU_MIN_WIDTH_PX = 520;
const MOBILE_BREAKPOINT_PX = 760;
const CACHE_PANEL_MIN_HEIGHT_PX = 32;

export function installConstructionBuildMenuLayout(): void {
  if (!document.getElementById(BUILD_MENU_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = BUILD_MENU_STYLE_ID;
    style.textContent = `
      #construction-build-menu {
        padding: 8px !important;
        max-height: min(46vh, 440px);
        overflow: hidden;
      }

      #construction-build-menu .header {
        align-items: flex-start !important;
      }

      #construction-build-menu .hint {
        max-width: 430px;
        text-align: right;
        line-height: 1.25;
      }

      #construction-build-menu .piece-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
      }

      #construction-build-menu .piece-button {
        min-width: 0;
        justify-content: flex-start;
        white-space: nowrap;
      }

      #construction-build-menu .piece-button span:last-child,
      #construction-build-menu .material-chip span:last-child {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }

      #construction-build-menu .material-row {
        grid-template-columns: 72px minmax(0, 1fr) !important;
      }

      #construction-build-menu .material-strip {
        overflow-x: auto !important;
        padding-bottom: 2px;
        scrollbar-width: thin;
      }

      #construction-build-menu .material-chip {
        min-width: 82px !important;
        max-width: 82px;
      }

      #construction-build-menu .status-line {
        display: grid !important;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 4px 10px !important;
      }

      #construction-build-menu .status-line span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media (max-width: 760px) {
        #construction-build-menu {
          max-height: 46vh;
          overflow-y: auto;
        }

        #construction-build-menu .piece-grid,
        #construction-build-menu .status-line {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }

        #construction-build-menu .hint {
          max-width: 280px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  installHudDragMarkers();
  installCalculatedHudLayout();
}

function installHudDragMarkers(): void {
  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;

    const spellMenu = target.closest<HTMLElement>("#spell-menu");
    if (spellMenu && target.closest(".spell-menu-title")) {
      spellMenu.dataset.hudDragged = "true";
      return;
    }

    const buildMenu = target.closest<HTMLElement>("#construction-build-menu");
    if (buildMenu && target.closest("[data-drag-handle]")) {
      buildMenu.dataset.hudDragged = "true";
      return;
    }

    const cachePanel = target.closest<HTMLElement>(".debug-panel-chrome--floating[data-panel-id='clod-cache']");
    if (cachePanel && target.closest(".debug-panel-chrome-header") && !target.closest("button")) {
      cachePanel.dataset.hudDragged = "true";
    }
  }, true);
}

function installCalculatedHudLayout(): void {
  const positionHud = () => {
    positionSpellMenu();
    positionBuildMenu();
    positionCachePanel();
  };
  const schedulePositionHud = () => requestAnimationFrame(positionHud);

  schedulePositionHud();
  window.addEventListener("resize", () => {
    clearCalculatedPositionMarkers();
    schedulePositionHud();
  });

  const observer = new MutationObserver(schedulePositionHud);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
}

function positionSpellMenu(): void {
  const menu = document.getElementById("spell-menu");
  const textureMenu = document.getElementById("terraform-menu");
  if (!menu || menu.dataset.hudDragged === "true" || menu.dataset.hudPositioned === "true") return;

  const menuRect = menu.getBoundingClientRect();
  if (menuRect.width <= 0 || menuRect.height <= 0) return;

  if (window.innerWidth <= MOBILE_BREAKPOINT_PX || !textureMenu) {
    setFixedRect(menu, (window.innerWidth - menuRect.width) * 0.5, window.innerHeight - menuRect.height - 76);
    return;
  }

  const textureRect = textureMenu.getBoundingClientRect();
  const left = clamp(textureRect.right + HUD_GAP_PX, HUD_EDGE_PX, window.innerWidth - menuRect.width - HUD_EDGE_PX);
  const top = clamp(textureRect.top + (textureRect.height - menuRect.height) * 0.5, HUD_EDGE_PX, window.innerHeight - menuRect.height - HUD_EDGE_PX);
  setFixedRect(menu, left, top);
}

function positionBuildMenu(): void {
  const menu = document.getElementById("construction-build-menu");
  if (!menu || menu.dataset.hudDragged === "true" || menu.dataset.hudPositioned === "true") return;

  const menuRect = menu.getBoundingClientRect();
  if (menuRect.height <= 0) return;

  const rightRailLeft = rightControlRailLeft();
  const availableWidth = Math.max(0, rightRailLeft - HUD_EDGE_PX - HUD_GAP_PX);
  const width = window.innerWidth <= MOBILE_BREAKPOINT_PX
    ? Math.max(0, window.innerWidth - HUD_EDGE_PX * 2)
    : clamp(availableWidth - HUD_GAP_PX, BUILD_MENU_MIN_WIDTH_PX, BUILD_MENU_MAX_WIDTH_PX);
  const left = window.innerWidth <= MOBILE_BREAKPOINT_PX
    ? HUD_EDGE_PX
    : clamp(rightRailLeft - width - HUD_GAP_PX, HUD_EDGE_PX, window.innerWidth - width - HUD_EDGE_PX);
  const top = window.innerHeight - BUILD_MENU_BOTTOM_PX - menuRect.height;

  menu.style.width = `${width}px`;
  setFixedRect(menu, left, Math.max(HUD_EDGE_PX, top));
}

function positionCachePanel(): void {
  const panel = document.querySelector<HTMLElement>(".debug-panel-chrome--floating[data-panel-id='clod-cache']");
  if (!panel || panel.dataset.hudDragged === "true" || panel.dataset.hudPositioned === "true") return;

  const leftStack = document.getElementById("clod-left-stack");
  const stackRect = leftStack?.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const panelHeight = Math.max(CACHE_PANEL_MIN_HEIGHT_PX, panelRect.height);
  const top = clamp((stackRect?.bottom ?? HUD_EDGE_PX) + HUD_GAP_PX, HUD_EDGE_PX, window.innerHeight - panelHeight - HUD_EDGE_PX);

  panel.style.opacity = "0.78";
  panel.style.background = "rgba(10, 14, 20, 0.64)";
  panel.style.backdropFilter = "blur(3px)";
  setFixedRect(panel, HUD_EDGE_PX, top);

  const body = panel.querySelector<HTMLElement>(".debug-panel-chrome-body");
  const minimizeButton = panel.querySelector<HTMLButtonElement>("[data-panel-minimize]");
  if (body && !body.hidden) minimizeButton?.click();
}

function clearCalculatedPositionMarkers(): void {
  for (const selector of ["#spell-menu", "#construction-build-menu", ".debug-panel-chrome--floating[data-panel-id='clod-cache']"]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element && element.dataset.hudDragged !== "true") delete element.dataset.hudPositioned;
  }
}

function setFixedRect(element: HTMLElement, left: number, top: number): void {
  element.style.position = "fixed";
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
  element.style.right = "auto";
  element.style.bottom = "auto";
  element.style.transform = "none";
  element.dataset.hudPositioned = "true";
}

function rightControlRailLeft(): number {
  const gui = document.querySelector<HTMLElement>("body > .lil-gui.root");
  const rect = gui?.getBoundingClientRect();
  return rect && rect.width > 0 ? rect.left : window.innerWidth;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
