import { useEffect, useMemo, useRef, useState } from "react";
import { Clipboard, Play, RefreshCw } from "lucide-react";
import { useEditorClients } from "../../app/providers";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import type { TerrainGenerationConfig, TerrainPreviewResult, TerrainRecipe } from "../../types/world";
import {
  cloneTerrainConfig,
  decodeTerrainRecipe,
  encodeTerrainRecipe,
  randomTerrainSeed,
} from "./terrainRecipe";

type Mutable<T> = { -readonly [P in keyof T]: Mutable<T[P]> };
type MutableTerrainGenerationConfig = Mutable<TerrainGenerationConfig>;

const numberValue = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampInt = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

const sampleColor = (height: number, min: number, max: number, water: boolean, material: string): string => {
  if (water) {
    return "#2f7fb7";
  }
  if (material === "Rock") {
    return "#848990";
  }
  if (material === "Sand") {
    return "#d7c17f";
  }
  if (material === "Clay") {
    return "#a8735f";
  }
  const t = (height - min) / Math.max(1, max - min);
  if (t > 0.78) {
    return "#e1e7ec";
  }
  if (t > 0.56) {
    return "#7f704f";
  }
  return t > 0.32 ? "#5f9a45" : "#315f35";
};

const drawPreview = (canvas: HTMLCanvasElement, preview: TerrainPreviewResult): void => {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const size = preview.resolution;
  canvas.width = size;
  canvas.height = size;
  const image = ctx.createImageData(size, size);
  for (let index = 0; index < preview.samples.length; index += 1) {
    const sample = preview.samples[index];
    const color = sampleColor(sample.height, preview.stats.minHeight, preview.stats.maxHeight, sample.water, sample.material);
    const offset = index * 4;
    image.data[offset] = Number.parseInt(color.slice(1, 3), 16);
    image.data[offset + 1] = Number.parseInt(color.slice(3, 5), 16);
    image.data[offset + 2] = Number.parseInt(color.slice(5, 7), 16);
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
};

function NumberField({
  label,
  value,
  step = 1,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="terrain-field">
      <span>{label}</span>
      <Input type="number" value={value} step={step} onChange={(event) => onChange(numberValue(event.target.value, value))} />
    </label>
  );
}

function ToggleField({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; readonly onChange: (checked: boolean) => void }) {
  return (
    <label className="terrain-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function TerrainRecipePanel() {
  const { runtimeClient } = useEditorClients();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [seedInput, setSeedInput] = useState("0");
  const [originX, setOriginX] = useState(0);
  const [originZ, setOriginZ] = useState(0);
  const [size, setSize] = useState(256);
  const [resolution, setResolution] = useState(72);
  const [config, setConfig] = useState<TerrainGenerationConfig | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedText, setAdvancedText] = useState("");
  const [recipeInput, setRecipeInput] = useState("");
  const [preview, setPreview] = useState<TerrainPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const recipe = useMemo<TerrainRecipe | null>(() => {
    if (!config) {
      return null;
    }
    const seed = seedInput.trim() === "" ? 0 : clampInt(numberValue(seedInput, 0), -2_147_483_648, 2_147_483_647);
    return { version: 1, seed, config };
  }, [config, seedInput]);

  useEffect(() => {
    let active = true;
    void runtimeClient.getDefaultTerrainRecipe().then((result) => {
      if (!active) {
        return;
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const nextConfig = cloneTerrainConfig(result.data.recipe.config);
      setSeedInput(String(result.data.recipe.seed));
      setConfig(nextConfig);
      setAdvancedText(JSON.stringify(nextConfig, null, 2));
      setRecipeInput(encodeTerrainRecipe({ ...result.data.recipe, config: nextConfig }));
    });

    return () => {
      active = false;
    };
  }, [runtimeClient]);

  useEffect(() => {
    if (recipe) {
      setRecipeInput(encodeTerrainRecipe(recipe));
    }
  }, [recipe]);

  useEffect(() => {
    if (preview && canvasRef.current) {
      drawPreview(canvasRef.current, preview);
    }
  }, [preview]);

  const updateConfig = (mutator: (draft: MutableTerrainGenerationConfig) => void) => {
    if (!config) {
      return;
    }
    const next = cloneTerrainConfig(config) as MutableTerrainGenerationConfig;
    mutator(next);
    setConfig(next);
    setAdvancedText(JSON.stringify(next, null, 2));
  };

  const restoreRecipe = (value: string) => {
    setRecipeInput(value);
    if (value.trim() === "") {
      setError(null);
      return;
    }
    const decoded = decodeTerrainRecipe(value);
    if (!decoded) {
      setError("Invalid terrain recipe string.");
      return;
    }
    setSeedInput(String(decoded.seed));
    setConfig(cloneTerrainConfig(decoded.config));
    setAdvancedText(JSON.stringify(decoded.config, null, 2));
    setError(null);
  };

  const applyAdvancedConfig = () => {
    try {
      const parsed = JSON.parse(advancedText) as TerrainGenerationConfig;
      if (!Number.isFinite(parsed.height?.min) || !Number.isFinite(parsed.height?.max) || parsed.height.min >= parsed.height.max) {
        setError("Advanced config height range is invalid.");
        return;
      }
      setConfig(cloneTerrainConfig(parsed));
      setError(null);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "Invalid JSON.";
      setError(`Advanced config JSON is invalid: ${message}`);
    }
  };

  const runPreview = async () => {
    if (!recipe) {
      setError("Terrain defaults are still loading.");
      return;
    }
    setLoading(true);
    setError(null);
    const nextSeed = seedInput.trim() === "" ? randomTerrainSeed() : recipe.seed;
    const nextRecipe: TerrainRecipe = { ...recipe, seed: nextSeed };
    if (seedInput.trim() === "") {
      setSeedInput(String(nextSeed));
    }
    const result = await runtimeClient.previewTerrainRecipe({
      recipe: nextRecipe,
      origin: [Math.round(originX), Math.round(originZ)],
      size: [clampInt(size, 1, 2048), clampInt(size, 1, 2048)],
      resolution: clampInt(resolution, 4, 128),
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.validationErrors?.join(" ") ?? result.message);
      return;
    }
    setPreview(result.data);
  };

  const copyRecipe = () => {
    if (!recipe) {
      return;
    }
    const encoded = encodeTerrainRecipe(recipe);
    setRecipeInput(encoded);
    void navigator.clipboard?.writeText(encoded);
  };

  const controlsDisabled = loading || !config;

  return (
    <section className="panel-shell terrain-recipe-panel" data-testid="panel-terrain-recipe">
      <PanelTitleBar title="Terrain Recipe" />
      <div className="panel-body terrain-recipe-body">
        <div className="terrain-recipe-controls">
          <label className="terrain-field terrain-field-wide">
            <span>Recipe</span>
            <Input value={recipeInput} onChange={(event) => restoreRecipe(event.target.value)} data-testid="terrain-recipe-input" />
          </label>

          <div className="terrain-actions">
            <Button type="button" size="sm" onClick={copyRecipe}>
              <Clipboard size={13} aria-hidden="true" />
              Copy
            </Button>
            <Button type="button" size="sm" onClick={() => setSeedInput(String(randomTerrainSeed()))}>
              <RefreshCw size={13} aria-hidden="true" />
              Seed
            </Button>
            <Button type="button" size="sm" onClick={() => void runPreview()} disabled={controlsDisabled}>
              <Play size={13} aria-hidden="true" />
              {loading ? "Sampling" : "Preview"}
            </Button>
          </div>

          {config ? (
            <>
              <div className="terrain-grid">
                <label className="terrain-field">
                  <span>Seed</span>
                  <Input value={seedInput} placeholder="random" onChange={(event) => setSeedInput(event.target.value)} />
                </label>
                <NumberField label="Origin X" value={originX} onChange={setOriginX} />
                <NumberField label="Origin Z" value={originZ} onChange={setOriginZ} />
                <NumberField label="Size" value={size} onChange={(value) => setSize(clampInt(value, 1, 2048))} />
                <NumberField label="Resolution" value={resolution} onChange={(value) => setResolution(clampInt(value, 4, 128))} />
                <NumberField label="Height min" value={config.height.min} onChange={(value) => updateConfig((draft) => { draft.height.min = value; })} />
                <NumberField label="Height max" value={config.height.max} onChange={(value) => updateConfig((draft) => { draft.height.max = value; })} />
                <NumberField label="Continent" value={config.continent.amplitude} onChange={(value) => updateConfig((draft) => { draft.continent.amplitude = value; })} />
                <NumberField label="Mountains" value={config.mountains.amplitude} onChange={(value) => updateConfig((draft) => { draft.mountains.amplitude = value; })} />
                <NumberField label="Hills" value={config.hills.amplitude} onChange={(value) => updateConfig((draft) => { draft.hills.amplitude = value; })} />
                <NumberField label="Detail" value={config.detail.amplitude} step={0.25} onChange={(value) => updateConfig((draft) => { draft.detail.amplitude = value; })} />
              </div>

              <div className="terrain-toggle-row">
                <ToggleField label="Rivers" checked={config.rivers.enabled} onChange={(checked) => updateConfig((draft) => { draft.rivers.enabled = checked; })} />
                <ToggleField label="Lakes" checked={config.water_bodies.lakes.enabled} onChange={(checked) => updateConfig((draft) => { draft.water_bodies.lakes.enabled = checked; })} />
                <ToggleField label="Ponds" checked={config.water_bodies.ponds.enabled} onChange={(checked) => updateConfig((draft) => { draft.water_bodies.ponds.enabled = checked; })} />
                <ToggleField label="Aquifers" checked={config.water_bodies.aquifers.enabled} onChange={(checked) => updateConfig((draft) => { draft.water_bodies.aquifers.enabled = checked; })} />
              </div>

              <details className="terrain-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
                <summary>Advanced config</summary>
                <textarea value={advancedText} onChange={(event) => setAdvancedText(event.target.value)} spellCheck={false} />
                <Button type="button" size="sm" onClick={applyAdvancedConfig}>Apply Advanced</Button>
              </details>
            </>
          ) : (
            <div className="terrain-preview-empty">Loading terrain defaults.</div>
          )}

          {error && <div className="terrain-error" data-testid="terrain-recipe-error">{error}</div>}
        </div>

        <div className="terrain-preview">
          <canvas ref={canvasRef} className="terrain-preview-canvas" data-testid="terrain-preview-canvas" />
          {preview ? (
            <div className="terrain-preview-stats" data-testid="terrain-preview-stats">
              <span>Min {preview.stats.minHeight}</span>
              <span>Max {preview.stats.maxHeight}</span>
              <span>Avg {preview.stats.avgHeight.toFixed(1)}</span>
              <span>Water {preview.stats.waterCells}</span>
              <span>Trees {preview.stats.treeCells}</span>
              <span>{preview.fingerprint}</span>
              <span>{preview.timingMs.toFixed(2)} ms</span>
            </div>
          ) : (
            <div className="terrain-preview-empty">No preview sampled.</div>
          )}
        </div>
      </div>
    </section>
  );
}
