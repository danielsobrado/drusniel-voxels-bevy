export function extractWgslFunction(source: string, name: string): string {
  const signature = `fn ${name}`;
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`WGSL function '${name}' was not found`);
  const bodyStart = source.indexOf("{", start + signature.length);
  if (bodyStart < 0) throw new Error(`WGSL function '${name}' has no body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`WGSL function '${name}' has an unterminated body`);
}
