export function composeShader(label: string, chunks: readonly string[]): string {
  const source = chunks.join("\n\n");
  if (source.includes("[object Object]")) {
    throw new Error(`${label} contains unresolved shader module object`);
  }
  return source;
}
