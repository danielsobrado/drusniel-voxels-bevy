import { iconDataUrl, type ClodIconKind } from "./icons/index.js";

const ICON_CLASS = "clod-icon-label";
const BUTTON_CLASS = "clod-icon-button";
const ICON_ONLY_CLASS = "clod-icon-only";
const TEXT_CLASS = "clod-button-text";
const SR_CLASS = "clod-visually-hidden";

function directChildWithClass(button: HTMLElement, className: string): HTMLElement | null {
  return Array.from(button.children).find((child) => child.classList.contains(className)) as HTMLElement | undefined ?? null;
}

function ensureIconSpan(button: HTMLElement, kind: ClodIconKind, id: string): HTMLSpanElement {
  let icon = directChildWithClass(button, ICON_CLASS) as HTMLSpanElement | null;
  if (!icon) {
    icon = document.createElement("span");
    icon.className = ICON_CLASS;
    icon.setAttribute("aria-hidden", "true");
    button.insertBefore(icon, button.firstChild);
  }
  icon.style.backgroundImage = `url("${iconDataUrl(kind, id)}")`;
  return icon;
}

function removeDirectTextNodes(button: HTMLElement): void {
  for (const node of Array.from(button.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) node.remove();
  }
}

function setButtonTitle(button: HTMLElement, label: string): void {
  button.setAttribute("aria-label", label);
  if (!button.getAttribute("title")) button.setAttribute("title", label);
}

export function setButtonIcon(button: HTMLElement, kind: ClodIconKind, id: string, label: string): void {
  button.classList.add(BUTTON_CLASS);
  button.classList.remove(ICON_ONLY_CLASS);
  setButtonTitle(button, label);
  ensureIconSpan(button, kind, id);
  removeDirectTextNodes(button);

  let text = directChildWithClass(button, TEXT_CLASS);
  if (!text) {
    text = document.createElement("span");
    text.className = TEXT_CLASS;
    button.appendChild(text);
  }
  text.textContent = label;
}

export function setIconOnlyButton(button: HTMLElement, kind: ClodIconKind, id: string, ariaLabel: string): void {
  button.classList.add(BUTTON_CLASS, ICON_ONLY_CLASS);
  setButtonTitle(button, ariaLabel);
  ensureIconSpan(button, kind, id);

  let sr = directChildWithClass(button, SR_CLASS);
  if (!sr) {
    sr = document.createElement("span");
    sr.className = SR_CLASS;
    button.appendChild(sr);
  }
  sr.textContent = ariaLabel;
}
