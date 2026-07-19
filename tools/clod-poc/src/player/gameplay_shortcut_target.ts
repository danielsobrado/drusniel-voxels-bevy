export function consumesGameplayShortcut(
  tagName: string,
  inputType: string,
  contentEditable: boolean,
): boolean {
  if (contentEditable) return true;
  if (tagName === "textarea" || tagName === "select") return true;
  if (tagName !== "input") return false;
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(inputType.toLowerCase());
}
