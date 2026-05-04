import type { BlockAtlasMap } from "../../types/world";

interface AtlasYamlPreviewProps {
  readonly atlasMapping: BlockAtlasMap;
}

function toYaml(mapping: BlockAtlasMap): string {
  const blocks: Array<keyof BlockAtlasMap> = ["grass", "dirt", "rock", "sand"];
  const lines = ["texture_atlas:"];
  for (const block of blocks) {
    const blockMapping = mapping[block];
    lines.push(`  ${block}:`);
    lines.push(`    top: ${blockMapping.top}`);
    lines.push(`    side: ${blockMapping.side}`);
    lines.push(`    bottom: ${blockMapping.bottom}`);
  }
  return `${lines.join("\n")}\n`;
}

export function AtlasYamlPreview({ atlasMapping }: AtlasYamlPreviewProps) {
  return (
    <section className="atlas-yaml-preview" data-testid="atlas-yaml-preview">
      <h3 className="inspector-section-title">YAML preview</h3>
      <pre>{toYaml(atlasMapping)}</pre>
    </section>
  );
}
