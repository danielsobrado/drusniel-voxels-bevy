const BUILD_MENU_STYLE_ID = "construction-build-menu-layout-fix";

export function installConstructionBuildMenuLayout(): void {
  if (document.getElementById(BUILD_MENU_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = BUILD_MENU_STYLE_ID;
  style.textContent = `
    #construction-build-menu {
      width: min(680px, calc(100vw - 24px)) !important;
      bottom: 22px !important;
      padding: 8px !important;
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
