import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CloudFog, Download, Moon, Sparkles, Sun, Upload } from "lucide-react";
import { useEditorClients } from "../../app/providers";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";
import type { AtmospherePreset, GlobalLightAtmospherePreset, LightAtmospherePatch, LightAtmosphereSettings, LightPreset } from "../../types/runtime";
import type { LightAtmosphereTemplate } from "../../runtime/runtimeSchemas";

const defaultSettings: LightAtmosphereSettings = {
  cycleEnabled: false,
  lightEnabled: true,
  lightPreset: "sun",
  atmospherePreset: "hazy",
  globalPreset: "default",
  lightColor: "#fff8f0",
  lightIlluminance: 100000,
  lightAzimuthDegrees: 0,
  lightElevationDegrees: 70,
  lightDirection: [0, 0.94, 0.34],
  atmosphereAmount: 1,
  atmosphereHalfLength: 220,
  fogActive: true,
  godRaysEnabled: false,
  ambientColor: "#ffffff",
  ambientBrightness: 1200,
};

const directionFromAngles = (azimuthDegrees: number, elevationDegrees: number): readonly [number, number, number] => {
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  const elevation = (Math.max(-90, Math.min(90, elevationDegrees)) * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  return [horizontal * Math.sin(azimuth), Math.sin(elevation), horizontal * Math.cos(azimuth)];
};

const anglesFromDirection = (direction: readonly [number, number, number]) => {
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const x = direction[0] / length;
  const y = direction[1] / length;
  const z = direction[2] / length;
  return {
    azimuth: (Math.atan2(x, z) * 180) / Math.PI,
    elevation: (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI,
  };
};

const numberValue = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const presetLabels: Record<LightPreset | AtmospherePreset | GlobalLightAtmospherePreset, string> = {
  sun: "Sun",
  moon: "Moon",
  noneEmissivesOnly: "None",
  void: "Void",
  clear: "Clear",
  hazy: "Hazy",
  fog: "Fog",
  default: "Default",
  neutral: "Neutral",
};

export function LightAtmospherePanel() {
  const { runtimeClient } = useEditorClients();
  const runtimeMetrics = useEditorStore((state) => state.runtimeMetrics);
  const [settings, setSettings] = useState<LightAtmosphereSettings>(runtimeMetrics.lightingAtmosphere.settings ?? defaultSettings);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastMutationSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const requestSeq = lastMutationSeqRef.current;
    void runtimeClient.getLightAtmosphere().then((result) => {
      if (result.ok && !cancelled && requestSeq === lastMutationSeqRef.current) {
        setSettings(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runtimeClient]);

  useEffect(() => {
    if (runtimeMetrics.lightingAtmosphere.settings) {
      setSettings(runtimeMetrics.lightingAtmosphere.settings);
    }
  }, [runtimeMetrics.lightingAtmosphere.settings]);

  const extinction = useMemo(() => {
    if (settings.atmosphereAmount <= 0) {
      return 0;
    }
    return Math.log(2) / Math.max(1, settings.atmosphereHalfLength) * settings.atmosphereAmount;
  }, [settings.atmosphereAmount, settings.atmosphereHalfLength]);

  const applyPatch = async (patch: LightAtmospherePatch) => {
    const mutationSeq = lastMutationSeqRef.current + 1;
    lastMutationSeqRef.current = mutationSeq;
    const result = await runtimeClient.updateLightAtmosphere(patch);
    if (mutationSeq !== lastMutationSeqRef.current) {
      return;
    }
    if (result.ok) {
      setSettings(result.data.settings);
      useEditorStore.setState((state) => ({
        runtimeMetrics: {
          ...state.runtimeMetrics,
          lightingAtmosphere: result.data.metrics.lightingAtmosphere,
        },
      }));
    }
  };

  const exportTemplate = async () => {
    const result = await runtimeClient.exportLightAtmosphereTemplate();
    if (!result.ok) {
      return;
    }
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "drusniel-light-atmosphere.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importTemplate = () => {
    fileInputRef.current?.click();
  };

  const handleTemplateFile = (file: File | undefined) => {
    if (!file) {
      return;
    }
    void (async () => {
      try {
        const template = JSON.parse(await file.text()) as LightAtmosphereTemplate;
        const mutationSeq = lastMutationSeqRef.current + 1;
        lastMutationSeqRef.current = mutationSeq;
        const result = await runtimeClient.importLightAtmosphereTemplate(template);
        if (mutationSeq !== lastMutationSeqRef.current) {
          return;
        }
        if (result.ok) {
          setSettings(result.data.settings);
          useEditorStore.setState((state) => ({
            runtimeMetrics: {
              ...state.runtimeMetrics,
              lightingAtmosphere: result.data.metrics.lightingAtmosphere,
            },
          }));
        } else {
          toast.error(result.message);
        }
      } catch (error) {
        toast.error(error instanceof SyntaxError ? "Template JSON is malformed." : "Template could not be loaded.");
      }
    })();
  };

  return (
    <section className="panel-shell" data-testid="panel-light-atmosphere" aria-labelledby="light-atmosphere-title">
      <PanelTitleBar title="Light and Atmosphere" />
      <div className="panel-body light-atmosphere-panel">
        <h2 id="light-atmosphere-title" className="placeholder-heading">
          Light and Atmosphere
        </h2>

        <section className="light-atmosphere-section">
          <div className="light-atmosphere-section-title">
            <Sun size={15} aria-hidden="true" />
            <h3>Light</h3>
          </div>
          <div className="light-atmosphere-preset-row">
            {(["sun", "moon", "noneEmissivesOnly"] as const).map((preset) => (
              <button key={preset} type="button" className={`toolbar-button ${settings.lightPreset === preset ? "toolbar-button-active" : ""}`} onClick={() => void applyPatch({ lightPreset: preset })}>
                {preset === "moon" ? <Moon size={14} aria-hidden="true" /> : preset === "noneEmissivesOnly" ? <Sparkles size={14} aria-hidden="true" /> : <Sun size={14} aria-hidden="true" />}
                {presetLabels[preset]}
              </button>
            ))}
          </div>
          <div className="light-atmosphere-grid">
            <label className="light-atmosphere-field">
              <span>Enabled</span>
              <input type="checkbox" checked={settings.lightEnabled} onChange={(event) => void applyPatch({ lightEnabled: event.currentTarget.checked })} />
            </label>
            <label className="light-atmosphere-field">
              <span>Color</span>
              <input type="color" value={settings.lightColor} onChange={(event) => void applyPatch({ lightColor: event.currentTarget.value })} />
            </label>
            <label className="light-atmosphere-field">
              <span>Illuminance</span>
              <input type="number" min={0} step={100} value={settings.lightIlluminance} onChange={(event) => void applyPatch({ lightIlluminance: numberValue(event.currentTarget.value, settings.lightIlluminance) })} />
            </label>
            <label className="light-atmosphere-field">
              <span>Azimuth</span>
              <input
                type="number"
                min={-360}
                max={360}
                step={1}
                value={settings.lightAzimuthDegrees}
                onChange={(event) => {
                  const lightAzimuthDegrees = numberValue(event.currentTarget.value, settings.lightAzimuthDegrees);
                  void applyPatch({ lightAzimuthDegrees, lightDirection: directionFromAngles(lightAzimuthDegrees, settings.lightElevationDegrees) });
                }}
              />
            </label>
            <label className="light-atmosphere-field">
              <span>Elevation</span>
              <input
                type="number"
                min={-90}
                max={90}
                step={1}
                value={settings.lightElevationDegrees}
                onChange={(event) => {
                  const lightElevationDegrees = numberValue(event.currentTarget.value, settings.lightElevationDegrees);
                  void applyPatch({ lightElevationDegrees, lightDirection: directionFromAngles(settings.lightAzimuthDegrees, lightElevationDegrees) });
                }}
              />
            </label>
          </div>
          <div className="light-atmosphere-vector-grid">
            {(["x", "y", "z"] as const).map((axis, index) => (
              <label key={axis} className="light-atmosphere-field">
                <span>Direction {axis.toUpperCase()}</span>
                <input
                  type="number"
                  step={0.01}
                  value={settings.lightDirection[index].toFixed(3)}
                  onChange={(event) => {
                    const next = [...settings.lightDirection] as [number, number, number];
                    next[index] = numberValue(event.currentTarget.value, settings.lightDirection[index]);
                    const angles = anglesFromDirection(next);
                    void applyPatch({ lightDirection: next, lightAzimuthDegrees: angles.azimuth, lightElevationDegrees: angles.elevation });
                  }}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="light-atmosphere-section">
          <div className="light-atmosphere-section-title">
            <CloudFog size={15} aria-hidden="true" />
            <h3>Atmosphere</h3>
          </div>
          <div className="light-atmosphere-preset-row">
            {(["void", "clear", "hazy", "fog"] as const).map((preset) => (
              <button key={preset} type="button" className={`toolbar-button ${settings.atmospherePreset === preset ? "toolbar-button-active" : ""}`} onClick={() => void applyPatch({ atmospherePreset: preset })}>
                {presetLabels[preset]}
              </button>
            ))}
          </div>
          <div className="light-atmosphere-grid">
            <label className="light-atmosphere-field">
              <span>Amount</span>
              <input type="number" min={0} max={8} step={0.05} value={settings.atmosphereAmount} onChange={(event) => void applyPatch({ atmosphereAmount: numberValue(event.currentTarget.value, settings.atmosphereAmount) })} />
            </label>
            <label className="light-atmosphere-field">
              <span>Half Length</span>
              <input type="number" min={1} step={5} value={settings.atmosphereHalfLength} onChange={(event) => void applyPatch({ atmosphereHalfLength: numberValue(event.currentTarget.value, settings.atmosphereHalfLength) })} />
            </label>
            <label className="light-atmosphere-field">
              <span>Ambient</span>
              <input type="color" value={settings.ambientColor} onChange={(event) => void applyPatch({ ambientColor: event.currentTarget.value })} />
            </label>
            <label className="light-atmosphere-field">
              <span>Ambient Brightness</span>
              <input type="number" min={0} step={50} value={settings.ambientBrightness} onChange={(event) => void applyPatch({ ambientBrightness: numberValue(event.currentTarget.value, settings.ambientBrightness) })} />
            </label>
          </div>
          <div className="light-atmosphere-readouts">
            <span>Extinction {extinction.toFixed(5)}</span>
            <span>{settings.fogActive ? "Fog on" : "Fog off"}</span>
            <span>{settings.godRaysEnabled ? "God rays on" : "God rays off"}</span>
          </div>
        </section>

        <section className="light-atmosphere-section">
          <div className="light-atmosphere-section-title">
            <Sparkles size={15} aria-hidden="true" />
            <h3>Global</h3>
          </div>
          <div className="light-atmosphere-preset-row">
            {(["default", "neutral"] as const).map((preset) => (
              <button key={preset} type="button" className={`toolbar-button ${settings.globalPreset === preset ? "toolbar-button-active" : ""}`} onClick={() => void applyPatch({ globalPreset: preset })}>
                {presetLabels[preset]}
              </button>
            ))}
          </div>
          <div className="light-atmosphere-preset-row">
            <button type="button" className="toolbar-button" onClick={importTemplate}>
              <Upload size={14} aria-hidden="true" />
              Load Template
            </button>
            <button type="button" className="toolbar-button" onClick={() => void exportTemplate()}>
              <Download size={14} aria-hidden="true" />
              Save Template
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept=".json,application/json" className="sr-only" onChange={(event) => handleTemplateFile(event.currentTarget.files?.[0])} />
        </section>
      </div>
    </section>
  );
}
