import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Camera, ExternalLink, Eye, EyeOff, Maximize2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { BlockAtlasMap, BlockType, ChunkSummary, PropInstance, ViewportExposedVoxel, ViewportMeshPayload, ViewportSnapshot, WorldSurfaceSample, WorldViewportPreview } from "../../types/world";
import type { BrushSettings, EditorMode, RuntimeState, Selection, ViewportModifierKey, ViewportOverlayState } from "../../types/editor";
import { LITE_VOXEL_VIEWPORT_CONTRACT } from "./viewportArchitecture";
import {
  ATLAS_IMAGE_URLS,
  MATERIAL_COLORS,
  atlasTileIndexForMaterial,
  collectExposedVoxels,
  collectSamples,
  createViewportMeshGeometry,
  exposedVoxelMaterialKey,
  exposedVoxelTransform,
  sampleColumnTransform,
  sampleMaterialKey,
  tileTextureForIndex,
  viewportBoundsFromSamples,
} from "./voxelGeometry";
import { buildAffectedVoxelPositions, type PendingVoxelEdit, shouldShowBrushPreview } from "./voxelEditPreview";
import { chunkIdForVoxel, placementFromSelection, selectionFromPoint, selectionFromSample } from "./voxelPicking";
import { boundsCenter, boundsSize, type LiteProtectedAreaOverlay, overlayColor } from "./protectedAreaMeshes";
import {
  DETACHED_GAME_CAMERA_CHANNEL,
  DETACHED_GAME_CAMERA_STORAGE_KEY,
  DETACHED_GAME_CAMERA_WINDOW_LABEL,
  drawGameCameraPreview,
  renderGameCameraPreviewCanvas,
  type DetachedGameCameraSnapshot,
  type GameCameraState,
} from "./gameCameraPreview";

export { collectSamples } from "./voxelGeometry";
export {
  DETACHED_GAME_CAMERA_CHANNEL,
  DETACHED_GAME_CAMERA_STORAGE_KEY,
  drawGameCameraPreview,
  type DetachedGameCameraSnapshot,
  type GameCameraState,
} from "./gameCameraPreview";

export interface LiteVoxelViewportProps {
  readonly chunks: readonly ChunkSummary[];
  readonly props: readonly PropInstance[];
  readonly worldViewport: WorldViewportPreview | null;
  readonly viewportSnapshot: ViewportSnapshot | null;
  readonly atlasMapping: BlockAtlasMap;
  readonly runtimeState: RuntimeState;
  readonly activeMode: EditorMode;
  readonly brushSettings: BrushSettings;
  readonly selection: Selection;
  readonly targetedVoxel: readonly [number, number, number];
  readonly viewportOverlays: ViewportOverlayState;
  readonly areaOverlays?: readonly LiteProtectedAreaOverlay[];
  readonly propPlacementEnabled?: boolean;
  readonly onPlaceProp?: (position: readonly [number, number, number]) => void;
  readonly onSelectVoxel?: (selection: LiteVoxelSelection) => void;
  readonly onSetVoxel?: (edit: LiteVoxelEditRequest) => Promise<LiteVoxelEditResponse>;
  readonly onToggleChunkBounds?: () => void;
  readonly selectedPropRotationY?: number;
  readonly selectedPropUniformScale?: number;
  readonly propRotateDragModifier?: ViewportModifierKey;
  readonly propFineScaleModifier?: ViewportModifierKey;
  readonly propRotationSensitivity?: number;
  readonly propRotationSnapDegrees?: number;
  readonly propScaleStep?: number;
  readonly propScaleMin?: number;
  readonly propScaleMax?: number;
  readonly onAdjustSelectedProp?: (adjustment: { readonly rotationY?: number; readonly uniformScale?: number }) => void;
}

export interface LiteVoxelSelection {
  readonly position: [number, number, number];
  readonly chunkId: string;
  readonly face: "top" | "side" | "bottom";
}

export interface LiteVoxelEditRequest extends LiteVoxelSelection {
  readonly block: BlockType;
}

export interface LiteVoxelEditResponse {
  readonly ok: boolean;
  readonly message?: string;
  readonly chunkId?: string;
  readonly voxel?: string;
}

interface ViewState {
  readonly target: readonly [number, number, number];
  readonly zoom: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly heightOffset: number;
}

type ViewportDragState =
  | { readonly kind: "pan"; readonly x: number; readonly y: number; readonly view: ViewState }
  | { readonly kind: "orbit"; readonly x: number; readonly y: number; readonly view: ViewState }
  | { readonly kind: "prop-rotate"; readonly x: number; readonly startRotationY: number };

interface ModifierState {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

type ViewportKeyAction =
  | "panForward"
  | "panBackward"
  | "panLeft"
  | "panRight"
  | "orbitLeft"
  | "orbitRight"
  | "tiltDown"
  | "tiltUp"
  | "fit"
  | "reset"
  | "zoomIn"
  | "zoomOut";

type ViewportKeyBindings = Record<ViewportKeyAction, string>;

interface SampleGroup {
  readonly key: string;
  readonly material: WorldSurfaceSample["material"];
  readonly samples: readonly WorldSurfaceSample[];
  readonly tileIndex: number | null;
}

interface VoxelGroup {
  readonly key: string;
  readonly material: ViewportExposedVoxel["material"];
  readonly voxels: readonly ViewportExposedVoxel[];
  readonly tileIndex: number | null;
}

type VoxelIntersectionEvent = {
  readonly face?: { readonly normal: THREE.Vector3 } | null;
  readonly instanceId?: number;
  readonly object: THREE.Object3D;
  readonly point: THREE.Vector3;
};

const DEFAULT_VIEW: ViewState = { target: [32, 8, 32], zoom: 8, yaw: Math.PI * 0.25, pitch: 0.72, heightOffset: 0 };
const MIN_VIEW_PITCH = 0.12;
const MAX_VIEW_PITCH = 1.18;
const VIEW_HEIGHT_STEP = 8;

const DEFAULT_VIEWPORT_KEY_BINDINGS: ViewportKeyBindings = {
  panForward: "w",
  panBackward: "s",
  panLeft: "a",
  panRight: "d",
  orbitLeft: "q",
  orbitRight: "e",
  tiltDown: "z",
  tiltUp: "x",
  fit: "f",
  reset: "r",
  zoomIn: "=",
  zoomOut: "-",
};

const VIEWPORT_KEY_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: "w", label: "W" },
  { value: "a", label: "A" },
  { value: "s", label: "S" },
  { value: "d", label: "D" },
  { value: "q", label: "Q" },
  { value: "e", label: "E" },
  { value: "z", label: "Z" },
  { value: "x", label: "X" },
  { value: "r", label: "R" },
  { value: "f", label: "F" },
  { value: "=", label: "+" },
  { value: "-", label: "-" },
  { value: "arrowup", label: "Up" },
  { value: "arrowdown", label: "Down" },
  { value: "arrowleft", label: "Left" },
  { value: "arrowright", label: "Right" },
];

const VIEWPORT_BINDING_LABELS: readonly { readonly action: ViewportKeyAction; readonly label: string }[] = [
  { action: "panForward", label: "Pan forward" },
  { action: "panBackward", label: "Pan back" },
  { action: "panLeft", label: "Pan left" },
  { action: "panRight", label: "Pan right" },
  { action: "orbitLeft", label: "Orbit left" },
  { action: "orbitRight", label: "Orbit right" },
  { action: "tiltDown", label: "Tilt down" },
  { action: "tiltUp", label: "Tilt up" },
  { action: "fit", label: "Fit world" },
  { action: "reset", label: "Reset view" },
  { action: "zoomIn", label: "Zoom in" },
  { action: "zoomOut", label: "Zoom out" },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;
const normalizeKeyboardKey = (key: string) => (key === "+" ? "=" : key.toLowerCase());

const modifierMatches = (event: ModifierState, key: ViewportModifierKey = "none") => {
  switch (key) {
    case "shift":
      return event.shiftKey;
    case "alt":
      return event.altKey;
    case "control":
      return event.ctrlKey;
    case "meta":
      return event.metaKey;
    case "none":
      return true;
  }
};

const fitViewForSamples = (samples: readonly WorldSurfaceSample[], width: number, height: number, current: ViewState = DEFAULT_VIEW): ViewState => {
  const bounds = viewportBoundsFromSamples(samples);
  const shortestViewportSide = Math.max(1, Math.min(width, height));
  const zoom = clamp(shortestViewportSide / (bounds.radius * 2.25), 1.4, 64);
  return {
    ...current,
    target: [bounds.center.x, bounds.center.y, bounds.center.z],
    zoom,
  };
};

const viewWithCamera = (view: ViewState, patch: Partial<ViewState>): ViewState => ({
  ...view,
  ...patch,
  zoom: clamp(patch.zoom ?? view.zoom, 1.2, 96),
  pitch: clamp(patch.pitch ?? view.pitch, MIN_VIEW_PITCH, MAX_VIEW_PITCH),
});

const panView = (view: ViewState, deltaX: number, deltaY: number): ViewState => {
  const panScale = 1 / Math.max(1, view.zoom);
  const right = new THREE.Vector3(Math.cos(view.yaw - Math.PI * 0.5), 0, Math.sin(view.yaw - Math.PI * 0.5));
  const forward = new THREE.Vector3(Math.cos(view.yaw), 0, Math.sin(view.yaw));
  const target = new THREE.Vector3(...view.target);
  target.addScaledVector(right, deltaX * panScale);
  target.addScaledVector(forward, deltaY * panScale);
  return { ...view, target: [target.x, target.y, target.z] };
};

const cameraPositionForView = (view: ViewState, radius: number) => {
  const target = new THREE.Vector3(view.target[0], view.target[1] + view.heightOffset, view.target[2]);
  const distance = Math.max(32, radius * 2.5);
  const horizontalDistance = Math.cos(view.pitch) * distance;
  return target.clone().add(new THREE.Vector3(
    Math.cos(view.yaw) * horizontalDistance,
    Math.sin(view.pitch) * distance,
    Math.sin(view.yaw) * horizontalDistance,
  ));
};

const gameYawForView = (view: ViewState) => view.yaw + Math.PI;

const intersectionFromEvent = (event: ThreeEvent<PointerEvent | MouseEvent>) => event as ThreeEvent<PointerEvent | MouseEvent> & VoxelIntersectionEvent;

const normalFromEvent = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
  const intersection = intersectionFromEvent(event);
  if (!intersection.face) {
    return null;
  }

  return intersection.face.normal.clone().transformDirection(intersection.object.matrixWorld);
};

const groupSamples = (
  samples: readonly WorldSurfaceSample[],
  atlasMapping: BlockAtlasMap,
  atlasPreviewEnabled: boolean,
): readonly SampleGroup[] => {
  const groups = new Map<string, { material: WorldSurfaceSample["material"]; samples: WorldSurfaceSample[]; tileIndex: number | null }>();

  for (const sample of samples) {
    const key = sampleMaterialKey(sample, atlasMapping, atlasPreviewEnabled);
    const tileIndex = atlasPreviewEnabled && !sample.water ? atlasTileIndexForMaterial(atlasMapping, sample.material, "top") : null;
    const group = groups.get(key) ?? { material: sample.material, samples: [], tileIndex };
    group.samples.push(sample);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
};

const groupVoxels = (
  voxels: readonly ViewportExposedVoxel[],
  atlasMapping: BlockAtlasMap,
  atlasPreviewEnabled: boolean,
): readonly VoxelGroup[] => {
  const groups = new Map<string, { material: ViewportExposedVoxel["material"]; voxels: ViewportExposedVoxel[]; tileIndex: number | null }>();

  for (const voxel of voxels) {
    const key = exposedVoxelMaterialKey(voxel, atlasMapping, atlasPreviewEnabled);
    const tileIndex = atlasPreviewEnabled && !voxel.water ? atlasTileIndexForMaterial(atlasMapping, voxel.material, "top") : null;
    const group = groups.get(key) ?? { material: voxel.material, voxels: [], tileIndex };
    group.voxels.push(voxel);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
};

const useAtlasTexture = () => {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    let nextUrlIndex = 0;
    const loader = new THREE.TextureLoader();

    const loadNext = () => {
      loader.load(
        ATLAS_IMAGE_URLS[nextUrlIndex],
        (loadedTexture) => {
          if (cancelled) {
            loadedTexture.dispose();
            return;
          }
          loadedTexture.colorSpace = THREE.SRGBColorSpace;
          loadedTexture.magFilter = THREE.NearestFilter;
          loadedTexture.minFilter = THREE.NearestFilter;
          textureRef.current?.dispose();
          textureRef.current = loadedTexture;
          setTexture(loadedTexture);
        },
        undefined,
        () => {
          nextUrlIndex += 1;
          if (!cancelled && nextUrlIndex < ATLAS_IMAGE_URLS.length) {
            loadNext();
          }
        },
      );
    };

    loadNext();

    return () => {
      cancelled = true;
      textureRef.current?.dispose();
      textureRef.current = null;
    };
  }, []);

  return texture;
};

function CameraController({ view, samples }: { readonly view: ViewState; readonly samples: readonly WorldSurfaceSample[] }) {
  const { camera, invalidate } = useThree();
  const bounds = useMemo(() => viewportBoundsFromSamples(samples), [samples]);

  useEffect(() => {
    const target = new THREE.Vector3(view.target[0], view.target[1] + view.heightOffset, view.target[2]);
    camera.position.copy(cameraPositionForView(view, bounds.radius));
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = view.zoom;
      camera.near = -2000;
      camera.far = 5000;
      camera.updateProjectionMatrix();
    }
    invalidate();
  }, [bounds.radius, camera, invalidate, view]);

  return null;
}

function ViewportMeshLayer({
  payload,
  targetFace,
  onHover,
  onPick,
  onPlace,
  suppressClickRef,
}: {
  readonly payload: ViewportMeshPayload;
  readonly targetFace: BrushSettings["targetFace"];
  readonly onHover: (selection: LiteVoxelSelection | null) => void;
  readonly onPick: (selection: LiteVoxelSelection) => void;
  readonly onPlace: (position: readonly [number, number, number]) => void;
  readonly suppressClickRef: MutableRefObject<boolean>;
}) {
  const terrainGeometry = useMemo(() => createViewportMeshGeometry(payload.terrain), [payload.terrain]);
  const waterGeometry = useMemo(() => createViewportMeshGeometry(payload.water), [payload.water]);

  useEffect(() => () => {
    terrainGeometry?.dispose();
    waterGeometry?.dispose();
  }, [terrainGeometry, waterGeometry]);

  const handlePointer = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(selectionFromPoint(intersectionFromEvent(event).point, targetFace, normalFromEvent(event)));
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onPick(selectionFromPoint(intersectionFromEvent(event).point, targetFace, normalFromEvent(event)));
  };

  const handleDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onPlace(placementFromSelection(selectionFromPoint(intersectionFromEvent(event).point, targetFace, normalFromEvent(event))));
  };

  return (
    <>
      {terrainGeometry ? (
        <mesh geometry={terrainGeometry} onPointerMove={handlePointer} onClick={handleClick} onDoubleClick={handleDoubleClick}>
          <meshStandardMaterial color="#6e7782" roughness={0.92} metalness={0} vertexColors={Boolean(payload.terrain.colors?.length)} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
      {waterGeometry ? (
        <mesh geometry={waterGeometry} onPointerMove={handlePointer} onClick={handleClick} onDoubleClick={handleDoubleClick}>
          <meshStandardMaterial color="#3aa7df" transparent opacity={0.58} roughness={0.35} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
    </>
  );
}

function SampleInstances({
  group,
  atlasTexture,
  cellSize,
  targetFace,
  onHover,
  onPick,
  onPlace,
  suppressClickRef,
}: {
  readonly group: SampleGroup;
  readonly atlasTexture: THREE.Texture | null;
  readonly cellSize: number;
  readonly targetFace: BrushSettings["targetFace"];
  readonly onHover: (selection: LiteVoxelSelection | null) => void;
  readonly onPick: (selection: LiteVoxelSelection) => void;
  readonly onPlace: (position: readonly [number, number, number]) => void;
  readonly suppressClickRef: MutableRefObject<boolean>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tileTexture = useMemo(
    () => (atlasTexture && group.tileIndex !== null ? tileTextureForIndex(atlasTexture, group.tileIndex) : null),
    [atlasTexture, group.tileIndex],
  );

  useEffect(() => () => tileTexture?.dispose(), [tileTexture]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const dummy = new THREE.Object3D();
    group.samples.forEach((sample, index) => {
      const { position, scale } = sampleColumnTransform(sample, cellSize);
      dummy.position.copy(position);
      dummy.scale.copy(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [cellSize, group.samples]);

  const selectionForEvent = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const instanceId = intersectionFromEvent(event).instanceId ?? 0;
    const sample = group.samples[instanceId];
    return sample ? selectionFromSample(sample, targetFace, normalFromEvent(event)) : null;
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(selectionForEvent(event));
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const selection = selectionForEvent(event);
    if (!selection) {
      return;
    }

    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    onPick(selection);
  };

  const handleDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const selection = selectionForEvent(event);
    if (selection) {
      onPlace(placementFromSelection(selection));
    }
  };

  const color = MATERIAL_COLORS[group.material] ?? MATERIAL_COLORS.Rock;
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, group.samples.length]}
      onPointerMove={handlePointerMove}
      onPointerOut={() => onHover(null)}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={tileTexture ? "#ffffff" : color}
        map={tileTexture ?? undefined}
        transparent={group.material === "Water"}
        opacity={group.material === "Water" ? 0.68 : 1}
        roughness={0.86}
        metalness={0}
      />
    </instancedMesh>
  );
}

function ExactVoxelInstances({
  group,
  atlasTexture,
  targetFace,
  onHover,
  onPick,
  onPlace,
  suppressClickRef,
}: {
  readonly group: VoxelGroup;
  readonly atlasTexture: THREE.Texture | null;
  readonly targetFace: BrushSettings["targetFace"];
  readonly onHover: (selection: LiteVoxelSelection | null) => void;
  readonly onPick: (selection: LiteVoxelSelection) => void;
  readonly onPlace: (position: readonly [number, number, number]) => void;
  readonly suppressClickRef: MutableRefObject<boolean>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tileTexture = useMemo(
    () => (atlasTexture && group.tileIndex !== null ? tileTextureForIndex(atlasTexture, group.tileIndex) : null),
    [atlasTexture, group.tileIndex],
  );

  useEffect(() => () => tileTexture?.dispose(), [tileTexture]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const dummy = new THREE.Object3D();
    group.voxels.forEach((voxel, index) => {
      const { position, scale } = exposedVoxelTransform(voxel);
      dummy.position.copy(position);
      dummy.scale.copy(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [group.voxels]);

  const selectionForEvent = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const instanceId = intersectionFromEvent(event).instanceId ?? 0;
    const voxel = group.voxels[instanceId];
    if (!voxel) {
      return null;
    }
    const [x, y, z] = voxel.position;
    return selectionFromPoint(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), targetFace, normalFromEvent(event));
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(selectionForEvent(event));
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const selection = selectionForEvent(event);
    if (!selection) {
      return;
    }

    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    onPick(selection);
  };

  const handleDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const selection = selectionForEvent(event);
    if (selection) {
      onPlace(placementFromSelection(selection));
    }
  };

  const color = MATERIAL_COLORS[group.material] ?? MATERIAL_COLORS.Rock;
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, group.voxels.length]}
      onPointerMove={handlePointerMove}
      onPointerOut={() => onHover(null)}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={tileTexture ? "#ffffff" : color}
        map={tileTexture ?? undefined}
        transparent={group.material === "Water"}
        opacity={group.material === "Water" ? 0.68 : 1}
        roughness={0.86}
        metalness={0}
      />
    </instancedMesh>
  );
}

function BoxWire({
  center,
  size,
  color,
  opacity = 0.9,
  testId,
}: {
  readonly center: THREE.Vector3;
  readonly size: THREE.Vector3;
  readonly color: string;
  readonly opacity?: number;
  readonly testId?: string;
}) {
  return (
    <mesh position={center} userData={testId ? { testId } : undefined}>
      <boxGeometry args={[size.x, size.y, size.z]} />
      <meshBasicMaterial color={color} wireframe transparent opacity={opacity} depthTest={false} />
    </mesh>
  );
}

function ChunkBoundsLayer({ chunks, selection, visible }: { readonly chunks: readonly ChunkSummary[]; readonly selection: Selection; readonly visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <>
      {chunks.map((chunk) => {
        const [x, y, z] = chunk.coordinate;
        const dirty = chunk.dirty || chunk.meshStatus === "dirty" || chunk.meshStatus === "queued";
        const selected = selection.kind === "chunk" && selection.id === chunk.id;
        const center = new THREE.Vector3(x * 16 + 8, y * 16 + 8, z * 16 + 8);
        return (
          <group key={chunk.id}>
            <BoxWire center={center} size={new THREE.Vector3(16, 16, 16)} color={selected ? "#2cb8ff" : dirty ? "#f5a524" : "#8f95a3"} opacity={selected || dirty ? 0.96 : 0.42} />
            {dirty ? (
              <mesh position={center}>
                <boxGeometry args={[16, 16, 16]} />
                <meshBasicMaterial color="#f5a524" transparent opacity={0.08} depthWrite={false} />
              </mesh>
            ) : null}
          </group>
        );
      })}
    </>
  );
}

function ProtectedAreaLayer({ areas, visible }: { readonly areas: readonly LiteProtectedAreaOverlay[]; readonly visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <>
      {areas.map((area) => {
        const center = boundsCenter(area.bounds);
        const size = boundsSize(area.bounds);
        const color = overlayColor(area);
        return (
          <group key={area.id}>
            <mesh position={center}>
              <boxGeometry args={[size.x, size.y, size.z]} />
              <meshBasicMaterial color={color} transparent opacity={area.kind === "selected" ? 0.17 : 0.09} depthWrite={false} />
            </mesh>
            <BoxWire center={center} size={size} color={color} opacity={area.kind === "selected" ? 0.95 : 0.58} />
          </group>
        );
      })}
    </>
  );
}

function SelectionLayer({
  selection,
  hoveredVoxel,
  pendingVoxelEdits,
}: {
  readonly selection: Selection;
  readonly hoveredVoxel: LiteVoxelSelection | null;
  readonly pendingVoxelEdits: readonly PendingVoxelEdit[];
}) {
  const selectedPosition = selection.kind === "voxel" ? selection.position : null;
  return (
    <>
      {selectedPosition ? (
        <BoxWire center={new THREE.Vector3(selectedPosition[0] + 0.5, selectedPosition[1] + 0.5, selectedPosition[2] + 0.5)} size={new THREE.Vector3(1.08, 1.08, 1.08)} color="#2cb8ff" opacity={1} />
      ) : null}
      {hoveredVoxel ? (
        <BoxWire center={new THREE.Vector3(hoveredVoxel.position[0] + 0.5, hoveredVoxel.position[1] + 0.5, hoveredVoxel.position[2] + 0.5)} size={new THREE.Vector3(1.08, 1.08, 1.08)} color="#f5f7fb" opacity={0.72} />
      ) : null}
      {pendingVoxelEdits.map((edit) => {
        const color = edit.status === "applied" ? "#22c55e" : edit.status === "rejected" ? "#ef4444" : "#f5a524";
        return (
          <mesh key={edit.id} position={[edit.position[0] + 0.5, edit.position[1] + 0.5, edit.position[2] + 0.5]}>
            <boxGeometry args={[1.16, 1.16, 1.16]} />
            <meshBasicMaterial color={color} transparent opacity={0.32} />
          </mesh>
        );
      })}
    </>
  );
}

function BrushPreviewLayer({
  brushSettings,
  targetedVoxel,
  activeMode,
}: {
  readonly brushSettings: BrushSettings;
  readonly targetedVoxel: readonly [number, number, number];
  readonly activeMode: EditorMode;
}) {
  const affected = useMemo(() => buildAffectedVoxelPositions(brushSettings, targetedVoxel, activeMode), [activeMode, brushSettings, targetedVoxel]);
  if (!shouldShowBrushPreview(activeMode)) {
    return null;
  }

  const center = new THREE.Vector3(targetedVoxel[0] + 0.5, targetedVoxel[1] + 0.5, targetedVoxel[2] + 0.5);
  const invalid = targetedVoxel[1] <= 0;
  return (
    <group>
      {brushSettings.brushShape === "sphere" ? (
        <mesh position={center}>
          <sphereGeometry args={[brushSettings.radius, 24, 16]} />
          <meshBasicMaterial color={invalid ? "#ef4444" : "#2cb8ff"} wireframe transparent opacity={0.46} depthTest={false} />
        </mesh>
      ) : (
        <BoxWire
          center={center}
          size={
            brushSettings.brushShape === "single"
              ? new THREE.Vector3(1, 1, 1)
              : brushSettings.brushShape === "box"
                ? new THREE.Vector3(brushSettings.size[0], brushSettings.size[1], brushSettings.size[2])
                : new THREE.Vector3(brushSettings.radius * 2, brushSettings.size[1], brushSettings.radius * 2)
          }
          color={invalid ? "#ef4444" : "#2cb8ff"}
          opacity={0.62}
        />
      )}
      {affected.map((point, index) => (
        <mesh key={`${point.x}-${point.y}-${point.z}-${index}`} position={point}>
          <boxGeometry args={[0.24, 0.24, 0.24]} />
          <meshBasicMaterial color={invalid ? "#ef4444" : "#9de7ff"} transparent opacity={0.82} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

function PropBoundsLayer({ props, selection, visible }: { readonly props: readonly PropInstance[]; readonly selection: Selection; readonly visible: boolean }) {
  if (!visible && selection.kind !== "prop") {
    return null;
  }

  return (
    <>
      {props.map((prop) => {
        const position = prop.transform.position ?? prop.position;
        const selected = selection.kind === "prop" && selection.id === prop.id;
        if (!visible && !selected) {
          return null;
        }
        const radius = Math.max(0.8, 1 + (prop.transform.scale[0] ?? 1) * 1.8);
        return (
          <mesh key={prop.id} position={[position[0], position[1] + radius * 0.5, position[2]]}>
            <sphereGeometry args={[radius, 16, 10]} />
            <meshBasicMaterial color={selected ? "#2cb8ff" : "#a26cff"} wireframe transparent opacity={selected ? 0.86 : 0.38} depthTest={false} />
          </mesh>
        );
      })}
    </>
  );
}

function AuthoringScene({
  chunks,
  props,
  meshChunks,
  samples,
  sampleGroups,
  voxelGroups,
  sampleCellSize,
  atlasTexture,
  view,
  viewportOverlays,
  areaOverlays,
  selection,
  hoveredVoxel,
  pendingVoxelEdits,
  brushSettings,
  targetedVoxel,
  activeMode,
  suppressClickRef,
  onHover,
  onPick,
  onPlace,
}: {
  readonly chunks: readonly ChunkSummary[];
  readonly props: readonly PropInstance[];
  readonly meshChunks: NonNullable<ViewportSnapshot["chunks"]>;
  readonly samples: readonly WorldSurfaceSample[];
  readonly sampleGroups: readonly SampleGroup[];
  readonly voxelGroups: readonly VoxelGroup[];
  readonly sampleCellSize: number;
  readonly atlasTexture: THREE.Texture | null;
  readonly view: ViewState;
  readonly viewportOverlays: ViewportOverlayState;
  readonly areaOverlays: readonly LiteProtectedAreaOverlay[];
  readonly selection: Selection;
  readonly hoveredVoxel: LiteVoxelSelection | null;
  readonly pendingVoxelEdits: readonly PendingVoxelEdit[];
  readonly brushSettings: BrushSettings;
  readonly targetedVoxel: readonly [number, number, number];
  readonly activeMode: EditorMode;
  readonly suppressClickRef: MutableRefObject<boolean>;
  readonly onHover: (selection: LiteVoxelSelection | null) => void;
  readonly onPick: (selection: LiteVoxelSelection) => void;
  readonly onPlace: (position: readonly [number, number, number]) => void;
}) {
  return (
    <>
      <color attach="background" args={["#0b0d12"]} />
      <ambientLight intensity={0.72} />
      <directionalLight position={[72, 120, 84]} intensity={1.7} />
      <CameraController view={view} samples={samples} />
      {viewportOverlays.voxelGrid ? <gridHelper args={[256, 64, "#4a5361", "#29303a"]} position={[64, 0.02, 64]} /> : null}
      {voxelGroups.length > 0
        ? voxelGroups.map((group) => (
            <ExactVoxelInstances
              key={group.key}
              group={group}
              atlasTexture={atlasTexture}
              targetFace={brushSettings.targetFace}
              onHover={onHover}
              onPick={onPick}
              onPlace={onPlace}
              suppressClickRef={suppressClickRef}
            />
          ))
        : (
            <>
              {meshChunks.map((chunk) => (
                <ViewportMeshLayer
                  key={chunk.payloadId}
                  payload={chunk.mesh}
                  targetFace={brushSettings.targetFace}
                  onHover={onHover}
                  onPick={onPick}
                  onPlace={onPlace}
                  suppressClickRef={suppressClickRef}
                />
              ))}
              {sampleGroups.map((group) => (
                <SampleInstances
                  key={group.key}
                  group={group}
                  atlasTexture={atlasTexture}
                  cellSize={sampleCellSize}
                  targetFace={brushSettings.targetFace}
                  onHover={onHover}
                  onPick={onPick}
                  onPlace={onPlace}
                  suppressClickRef={suppressClickRef}
                />
              ))}
            </>
          )}
      <ChunkBoundsLayer chunks={chunks} selection={selection} visible={viewportOverlays.chunkBounds} />
      <ProtectedAreaLayer areas={areaOverlays} visible={viewportOverlays.protectedAreas} />
      <SelectionLayer selection={selection} hoveredVoxel={hoveredVoxel} pendingVoxelEdits={pendingVoxelEdits} />
      <BrushPreviewLayer brushSettings={brushSettings} targetedVoxel={targetedVoxel} activeMode={activeMode} />
      <PropBoundsLayer props={props} selection={selection} visible={viewportOverlays.propBounds} />
    </>
  );
}

export const LiteVoxelViewport = Object.assign(
  function LiteVoxelViewport({
    chunks,
    props,
    worldViewport,
    viewportSnapshot,
    atlasMapping,
    runtimeState,
    activeMode,
    brushSettings,
    selection,
    targetedVoxel,
    viewportOverlays,
    areaOverlays = [],
    propPlacementEnabled = false,
    onPlaceProp,
    onSelectVoxel,
    onSetVoxel,
    onToggleChunkBounds,
    selectedPropRotationY,
    selectedPropUniformScale,
    propRotateDragModifier = "shift",
    propFineScaleModifier = "alt",
    propRotationSensitivity = 0.45,
    propRotationSnapDegrees = 5,
    propScaleStep = 0.1,
    propScaleMin = 0.25,
    propScaleMax = 4,
    onAdjustSelectedProp,
  }: LiteVoxelViewportProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const gameCameraCanvasRef = useRef<HTMLCanvasElement>(null);
    const dragRef = useRef<ViewportDragState | null>(null);
    const suppressClickRef = useRef(false);
    const continuousEditingRef = useRef(false);
    const lastContinuousEditRef = useRef<string | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
    const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
    const [cameraSlots, setCameraSlots] = useState<ReadonlyArray<ViewState | null>>([null, null, null]);
    const [keysPanelOpen, setKeysPanelOpen] = useState(false);
    const [keyBindings, setKeyBindings] = useState<ViewportKeyBindings>(DEFAULT_VIEWPORT_KEY_BINDINGS);
    const [gameCameraEnabled, setGameCameraEnabled] = useState(false);
    const [gameCameraPlacementArmed, setGameCameraPlacementArmed] = useState(false);
    const [gameCamera, setGameCamera] = useState<GameCameraState | null>(null);
    const [hoveredVoxel, setHoveredVoxel] = useState<LiteVoxelSelection | null>(null);
    const [pendingVoxelEdits, setPendingVoxelEdits] = useState<readonly PendingVoxelEdit[]>([]);
    const atlasTexture = useAtlasTexture();
    const exposedVoxels = useMemo(() => collectExposedVoxels(worldViewport), [worldViewport]);
    const samples = useMemo(() => collectSamples(chunks, worldViewport), [chunks, worldViewport]);
    const viewportChunkSize = viewportSnapshot?.chunkSize ?? worldViewport?.chunkSize ?? 16;
    const sampleCellSize = useMemo(() => {
      const sampleResolution = viewportSnapshot?.sampleResolution ?? worldViewport?.sampleResolution ?? 1;
      return sampleResolution > 0 ? viewportChunkSize / sampleResolution : viewportChunkSize;
    }, [viewportChunkSize, viewportSnapshot, worldViewport]);
    const meshChunks = useMemo(() => viewportSnapshot?.chunks.filter((chunk) => chunk.mesh.included) ?? [], [viewportSnapshot]);
    const hasExactVoxelPreview = exposedVoxels.length > 0;
    const hasRenderableMesh = !hasExactVoxelPreview && meshChunks.some((chunk) => Boolean(chunk.mesh.terrain.positions?.length || chunk.mesh.water.positions?.length));
    const hasBackendPreview = Boolean(worldViewport && worldViewport.chunks.length > 0);
    const atlasPreviewEnabled = viewportOverlays.atlasPreview || activeMode === "voxel_paint" || activeMode === "material";
    const sampleGroups = useMemo(() => groupSamples(samples, atlasMapping, atlasPreviewEnabled), [atlasMapping, atlasPreviewEnabled, samples]);
    const voxelGroups = useMemo(() => groupVoxels(exposedVoxels, atlasMapping, atlasPreviewEnabled), [atlasMapping, atlasPreviewEnabled, exposedVoxels]);
    const waterSampleCount = samples.filter((sample) => sample.water).length;

    const updateKeyBinding = useCallback((action: ViewportKeyAction, nextKey: string) => {
      setKeyBindings((current) => {
        const next = normalizeKeyboardKey(nextKey);
        const previous = current[action];
        const conflictingAction = VIEWPORT_BINDING_LABELS.find((binding) => binding.action !== action && current[binding.action] === next)?.action;
        return {
          ...current,
          ...(conflictingAction ? { [conflictingAction]: previous } : {}),
          [action]: next,
        };
      });
    }, []);

    const placeGameCamera = useCallback(
      (position: readonly [number, number, number]) => {
        setGameCamera({
          position: [position[0], position[1] + 1.7, position[2]],
          yaw: gameYawForView(view),
        });
        setGameCameraEnabled(true);
        setGameCameraPlacementArmed(false);
      },
      [view],
    );

    const placeGameCameraAtTarget = useCallback(() => {
      const target = hoveredVoxel?.position ?? targetedVoxel;
      placeGameCamera([target[0], target[1], target[2]]);
    }, [hoveredVoxel, placeGameCamera, targetedVoxel]);

    const queueVoxelEdit = useCallback(
      async (voxelSelection: LiteVoxelSelection) => {
        if (!onSetVoxel) {
          return;
        }

        const block = brushSettings.materialBlockId;
        const editId = `voxel-edit-${Date.now()}-${voxelSelection.position.join("-")}`;
        setPendingVoxelEdits((current) => [
          ...current,
          {
            id: editId,
            position: voxelSelection.position,
            block,
            status: "pending",
          },
        ]);

        let result: LiteVoxelEditResponse;
        try {
          result = await onSetVoxel({ ...voxelSelection, block });
        } catch (error) {
          result = { ok: false, message: error instanceof Error ? error.message : "runtime edit failed" };
        }
        setPendingVoxelEdits((current) =>
          current.map((edit) =>
            edit.id === editId
              ? {
                  ...edit,
                  status: result.ok ? "applied" : "rejected",
                  message: result.message,
                }
              : edit,
          ),
        );
        window.setTimeout(() => {
          setPendingVoxelEdits((current) => current.filter((edit) => edit.id !== editId));
        }, result.ok ? 900 : 2200);
      },
      [brushSettings.materialBlockId, onSetVoxel],
    );

    const fitView = useCallback(() => {
      setView((current) => fitViewForSamples(samples, canvasSize.width, canvasSize.height, current));
    }, [canvasSize.height, canvasSize.width, samples]);

    const publishDetachedGameCameraSnapshot = useCallback(
      (camera: GameCameraState) => {
        const snapshot: DetachedGameCameraSnapshot = {
          camera,
          samples,
          cellSize: sampleCellSize,
          updatedAt: Date.now(),
        };

        try {
          window.localStorage.setItem(DETACHED_GAME_CAMERA_STORAGE_KEY, JSON.stringify(snapshot));
        } catch {
          // Detached preview is best-effort; the inline preview still works without storage.
        }

        if ("BroadcastChannel" in window) {
          const channel = new BroadcastChannel(DETACHED_GAME_CAMERA_CHANNEL);
          channel.postMessage(snapshot);
          channel.close();
        }
      },
      [sampleCellSize, samples],
    );

    const openDetachedGameCamera = useCallback(async () => {
      setGameCameraEnabled(true);

      if (gameCamera) {
        publishDetachedGameCameraSnapshot(gameCamera);
      }

      const url = new URL(window.location.href);
      url.searchParams.set("window", "game-camera");
      url.hash = "";

      const isTauriDesktop = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
      if (isTauriDesktop) {
        try {
          const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          const existingWindow = await WebviewWindow.getByLabel(DETACHED_GAME_CAMERA_WINDOW_LABEL);
          if (existingWindow) {
            await existingWindow.setFocus();
            return;
          }

          const detachedWindow = new WebviewWindow(DETACHED_GAME_CAMERA_WINDOW_LABEL, {
            url: `${url.pathname}${url.search}`,
            title: "Game Camera",
            width: 640,
            height: 360,
            minWidth: 360,
            minHeight: 220,
            resizable: true,
            focus: true,
            center: true,
          });
          void detachedWindow.once("tauri://error", () => {
            window.open(url.toString(), DETACHED_GAME_CAMERA_WINDOW_LABEL, "popup,width=640,height=360,resizable=yes");
          });
          return;
        } catch {
          // Browser fallback below also covers test runs.
        }
      }

      window.open(url.toString(), DETACHED_GAME_CAMERA_WINDOW_LABEL, "popup,width=640,height=360,resizable=yes");
    }, [gameCamera, publishDetachedGameCameraSnapshot]);

    const handlePick = useCallback(
      (voxelSelection: LiteVoxelSelection) => {
        if (gameCameraPlacementArmed) {
          placeGameCamera(voxelSelection.position);
          return;
        }

        onSelectVoxel?.(voxelSelection);
        if (activeMode === "voxel_paint" || activeMode === "voxel_sculpt") {
          void queueVoxelEdit(voxelSelection);
        }
      },
      [activeMode, gameCameraPlacementArmed, onSelectVoxel, placeGameCamera, queueVoxelEdit],
    );

    const handleHover = useCallback(
      (voxelSelection: LiteVoxelSelection | null) => {
        setHoveredVoxel(voxelSelection);
        if (
          !voxelSelection ||
          !continuousEditingRef.current ||
          !brushSettings.continuous ||
          (activeMode !== "voxel_paint" && activeMode !== "voxel_sculpt")
        ) {
          return;
        }

        const key = `${voxelSelection.position.join(",")}:${brushSettings.action}:${brushSettings.materialBlockId}`;
        if (lastContinuousEditRef.current === key) {
          return;
        }
        lastContinuousEditRef.current = key;
        onSelectVoxel?.(voxelSelection);
        void queueVoxelEdit(voxelSelection);
      },
      [activeMode, brushSettings.action, brushSettings.continuous, brushSettings.materialBlockId, onSelectVoxel, queueVoxelEdit],
    );

    const handlePlace = useCallback(
      (position: readonly [number, number, number]) => {
        if (activeMode === "voxel_paint" || activeMode === "voxel_sculpt") {
          const voxelPosition: [number, number, number] = [Math.floor(position[0]), Math.floor(position[1]), Math.floor(position[2])];
          const selection: LiteVoxelSelection = {
            position: voxelPosition,
            chunkId: chunkIdForVoxel(voxelPosition),
            face: "top",
          };
          onSelectVoxel?.(selection);
          void queueVoxelEdit(selection);
          return;
        }

        if (propPlacementEnabled && onPlaceProp) {
          onPlaceProp(position);
        }
      },
      [activeMode, onPlaceProp, onSelectVoxel, propPlacementEnabled, queueVoxelEdit],
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) {
        return;
      }

      const observer = new ResizeObserver(([entry]) => {
        const rect = entry.contentRect;
        setCanvasSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
      });
      observer.observe(host);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      setView((current) => fitViewForSamples(samples, canvasSize.width, canvasSize.height, current));
    }, [canvasSize.height, canvasSize.width, samples]);

    useEffect(() => {
      const canvas = gameCameraCanvasRef.current;
      if (!canvas || !gameCameraEnabled || !gameCamera) {
        return;
      }

      const width = 320;
      const height = 180;
      renderGameCameraPreviewCanvas(canvas, samples, gameCamera, sampleCellSize, width, height);
    }, [gameCamera, gameCameraEnabled, sampleCellSize, samples]);

    useEffect(() => {
      if (!gameCamera) {
        return;
      }

      publishDetachedGameCameraSnapshot(gameCamera);
    }, [gameCamera, publishDetachedGameCameraSnapshot]);

    useEffect(() => {
      if (!keysPanelOpen) {
        return;
      }

      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape") {
          return;
        }

        event.preventDefault();
        setKeysPanelOpen(false);
      };

      document.addEventListener("keydown", closeOnEscape, true);
      return () => document.removeEventListener("keydown", closeOnEscape, true);
    }, [keysPanelOpen]);

    return (
      <>
        <div
          ref={hostRef}
          className="world-viewport-canvas"
          data-testid="world-viewport-canvas"
          data-atlas-preview-enabled={String(atlasPreviewEnabled)}
          data-renderable-mesh={String(hasRenderableMesh)}
          data-surface-preview-mode={hasExactVoxelPreview ? "webgl-exposed-voxels" : hasRenderableMesh ? "webgl-mesh" : "webgl-sampled"}
          data-visible-surface-samples={samples.length}
          data-visible-surface-walls={0}
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            suppressClickRef.current = false;
            if (
              propPlacementEnabled &&
              onAdjustSelectedProp &&
              selectedPropRotationY !== undefined &&
              modifierMatches(event, propRotateDragModifier)
            ) {
              event.preventDefault();
              dragRef.current = { kind: "prop-rotate", x: event.clientX, startRotationY: selectedPropRotationY };
              return;
            }

            if (event.button === 1 || event.button === 2 || event.altKey || event.ctrlKey) {
              event.preventDefault();
              dragRef.current = { kind: "orbit", x: event.clientX, y: event.clientY, view };
              return;
            }

            if (
              event.button === 0 &&
              brushSettings.continuous &&
              (activeMode === "voxel_paint" || activeMode === "voxel_sculpt")
            ) {
              continuousEditingRef.current = true;
              lastContinuousEditRef.current = null;
              event.preventDefault();
              return;
            }

            dragRef.current = { kind: "pan", x: event.clientX, y: event.clientY, view };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) {
              return;
            }
            const dragDistance = drag.kind === "pan"
              ? Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y)
              : Math.abs(event.clientX - drag.x);
            if (dragDistance > 4) {
              suppressClickRef.current = true;
            }
            if (drag.kind === "prop-rotate") {
              event.preventDefault();
              const rawRotation = drag.startRotationY + (event.clientX - drag.x) * propRotationSensitivity;
              const snappedRotation =
                propRotationSnapDegrees > 0 ? Math.round(rawRotation / propRotationSnapDegrees) * propRotationSnapDegrees : rawRotation;
              onAdjustSelectedProp?.({ rotationY: normalizeDegrees(snappedRotation) });
              return;
            }
            if (drag.kind === "orbit") {
              event.preventDefault();
              setView(
                viewWithCamera(drag.view, {
                  yaw: drag.view.yaw - (event.clientX - drag.x) / 220,
                  pitch: drag.view.pitch + (event.clientY - drag.y) / 360,
                }),
              );
              return;
            }

            setView(panView(drag.view, event.clientX - drag.x, event.clientY - drag.y));
          }}
          onPointerUp={() => {
            dragRef.current = null;
            continuousEditingRef.current = false;
            lastContinuousEditRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            continuousEditingRef.current = false;
            lastContinuousEditRef.current = null;
            handleHover(null);
          }}
          onPointerLeave={() => {
            dragRef.current = null;
            continuousEditingRef.current = false;
            lastContinuousEditRef.current = null;
            handleHover(null);
          }}
          onWheel={(event) => {
            event.preventDefault();
            if (propPlacementEnabled && onAdjustSelectedProp && selectedPropUniformScale !== undefined) {
              const direction = event.deltaY < 0 ? 1 : -1;
              const fineMultiplier = propFineScaleModifier !== "none" && modifierMatches(event, propFineScaleModifier) ? 0.25 : 1;
              const nextScale = clamp(selectedPropUniformScale + direction * propScaleStep * fineMultiplier, propScaleMin, propScaleMax);
              onAdjustSelectedProp({ uniformScale: nextScale });
              return;
            }

            if (event.altKey) {
              const direction = event.deltaY < 0 ? 1 : -1;
              setView((current) => viewWithCamera(current, { heightOffset: current.heightOffset + direction * VIEW_HEIGHT_STEP }));
              return;
            }

            if (event.ctrlKey) {
              const direction = event.deltaY < 0 ? 1 : -1;
              setView((current) => viewWithCamera(current, { pitch: current.pitch + direction * 0.04 }));
              return;
            }

            const zoomMultiplier = event.deltaY < 0 ? 1.1 : 0.9;
            setView((current) => viewWithCamera(current, { zoom: current.zoom * zoomMultiplier }));
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && keysPanelOpen) {
              event.preventDefault();
              setKeysPanelOpen(false);
              return;
            }

            const key = normalizeKeyboardKey(event.key);
            if (event.key === "Home" || key === keyBindings.fit) {
              event.preventDefault();
              fitView();
              return;
            }
            if (key === keyBindings.zoomIn) {
              event.preventDefault();
              setView((current) => viewWithCamera(current, { zoom: current.zoom * 1.15 }));
              return;
            }
            if (key === keyBindings.zoomOut) {
              event.preventDefault();
              setView((current) => viewWithCamera(current, { zoom: current.zoom * 0.85 }));
              return;
            }
            const panStep = event.altKey ? 18 : event.shiftKey ? 96 : 48;
            const rotateStep = event.shiftKey ? 0.5 : 1 / 6;
            const tiltStep = event.shiftKey ? 0.12 : 0.04;
            const digitSlotMatch = /^digit([1-3])$/.exec(event.code.toLowerCase());
            if (event.ctrlKey && digitSlotMatch) {
              event.preventDefault();
              const slotIndex = Number.parseInt(digitSlotMatch[1], 10) - 1;
              setCameraSlots((current) => current.map((slot, index) => (index === slotIndex ? view : slot)));
              return;
            }
            if (!event.ctrlKey && !event.metaKey && digitSlotMatch) {
              const slotIndex = Number.parseInt(digitSlotMatch[1], 10) - 1;
              const slot = cameraSlots[slotIndex];
              if (slot) {
                event.preventDefault();
                setView(slot);
                return;
              }
            }
            if (event.ctrlKey && (key === "arrowleft" || key === "arrowright")) {
              event.preventDefault();
              const direction = key === "arrowleft" ? -1 : 1;
              setView((current) => viewWithCamera(current, { yaw: current.yaw + direction * rotateStep }));
              return;
            }
            if (event.ctrlKey && (key === "arrowup" || key === "arrowdown")) {
              event.preventDefault();
              const direction = key === "arrowup" ? 1 : -1;
              setView((current) => viewWithCamera(current, { pitch: current.pitch + direction * tiltStep }));
              return;
            }
            if (event.altKey && (key === "arrowup" || key === "arrowdown")) {
              event.preventDefault();
              const direction = key === "arrowup" ? 1 : -1;
              setView((current) => viewWithCamera(current, { heightOffset: current.heightOffset + direction * VIEW_HEIGHT_STEP }));
              return;
            }
            const panByKey: Record<string, readonly [number, number]> = {
              arrowup: [0, panStep],
              arrowdown: [0, -panStep],
              arrowleft: [panStep, 0],
              arrowright: [-panStep, 0],
              [keyBindings.panForward]: [0, panStep],
              [keyBindings.panBackward]: [0, -panStep],
              [keyBindings.panLeft]: [panStep, 0],
              [keyBindings.panRight]: [-panStep, 0],
            };
            const pan = panByKey[key];
            if (pan && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              setView((current) => panView(current, pan[0], pan[1]));
              return;
            }
            if ((key === keyBindings.orbitLeft || key === keyBindings.orbitRight) && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              const direction = key === keyBindings.orbitLeft ? -1 : 1;
              setView((current) => viewWithCamera(current, { yaw: current.yaw + direction * rotateStep }));
              return;
            }
            if ((key === keyBindings.tiltDown || key === keyBindings.tiltUp) && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              const direction = key === keyBindings.tiltDown ? -1 : 1;
              setView((current) => viewWithCamera(current, { pitch: current.pitch + direction * tiltStep }));
              return;
            }
            if ((key === keyBindings.reset) && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              setView((current) => fitViewForSamples(samples, canvasSize.width, canvasSize.height, { ...DEFAULT_VIEW, yaw: current.yaw }));
            }
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <Canvas
            orthographic
            camera={{ position: [96, 96, 96], zoom: view.zoom, near: -2000, far: 5000 }}
            gl={{ antialias: false, powerPreference: "high-performance" }}
            frameloop="demand"
            style={{ width: "100%", height: "100%" }}
            onPointerMissed={() => handleHover(null)}
          >
            <AuthoringScene
              chunks={chunks}
              props={props}
              meshChunks={meshChunks}
              samples={samples}
              sampleGroups={sampleGroups}
              voxelGroups={voxelGroups}
              sampleCellSize={sampleCellSize}
              atlasTexture={atlasTexture}
              view={view}
              viewportOverlays={viewportOverlays}
              areaOverlays={areaOverlays}
              selection={selection}
              hoveredVoxel={hoveredVoxel}
              pendingVoxelEdits={pendingVoxelEdits}
              brushSettings={brushSettings}
              targetedVoxel={targetedVoxel}
              activeMode={activeMode}
              suppressClickRef={suppressClickRef}
              onHover={handleHover}
              onPick={handlePick}
              onPlace={handlePlace}
            />
          </Canvas>
        </div>

        {viewportOverlays.voxelGrid ? <div className="lite-viewport-grid-overlay" aria-hidden="true" data-testid="viewport-voxel-grid-overlay" /> : null}

        {viewportOverlays.wireframe ? <div className="lite-viewport-wire-overlay" aria-hidden="true" data-testid="viewport-wireframe-overlay" /> : null}

        <svg
          className="lite-viewport-authoring-overlay"
          data-testid="lite-viewport-authoring-overlay"
          data-chunk-bounds-visible={String(viewportOverlays.chunkBounds)}
          aria-hidden="true"
        >
          {viewportOverlays.chunkBounds &&
            chunks.map((chunk) => <g key={chunk.id} data-testid={`viewport-chunk-overlay-${chunk.id}`} />)}
        </svg>

        <div className="viewport-canvas-controls" aria-label="Viewport controls">
          <button type="button" className="icon-button" title="Fit loaded world" aria-label="Fit loaded world" onClick={fitView}>
            <Maximize2 size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Orbit left"
            aria-label="Orbit left"
            onClick={() => setView((current) => viewWithCamera(current, { yaw: current.yaw - 1 / 6 }))}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Orbit right"
            aria-label="Orbit right"
            onClick={() => setView((current) => viewWithCamera(current, { yaw: current.yaw + 1 / 6 }))}
          >
            <RotateCw size={14} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => setView((current) => viewWithCamera(current, { zoom: current.zoom * 1.15 }))}>
            <ZoomIn size={14} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => setView((current) => viewWithCamera(current, { zoom: current.zoom * 0.85 }))}>
            <ZoomOut size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`icon-button ${gameCameraEnabled ? "icon-button-active" : ""}`}
            title="Toggle game camera preview"
            aria-label="Toggle game camera preview"
            aria-pressed={gameCameraEnabled}
            data-testid="viewport-game-camera-toggle"
            onClick={() => {
              if (!gameCamera) {
                placeGameCameraAtTarget();
                return;
              }
              setGameCameraEnabled((enabled) => !enabled);
            }}
          >
            <Camera size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`viewport-keys-badge ${keysPanelOpen ? "viewport-keys-badge-active" : ""}`}
            aria-expanded={keysPanelOpen}
            aria-controls="viewport-key-bindings-panel"
            onClick={() => setKeysPanelOpen((open) => !open)}
          >
            Keys
          </button>
        </div>

        {keysPanelOpen ? (
          <section
            id="viewport-key-bindings-panel"
            className="viewport-key-bindings-panel"
            aria-label="Author viewport key bindings"
            data-testid="viewport-key-bindings-panel"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                setKeysPanelOpen(false);
              }
            }}
          >
            <div className="viewport-key-bindings-header">
              <strong>Author Keys</strong>
              <button type="button" className="viewport-key-reset" onClick={() => setKeyBindings(DEFAULT_VIEWPORT_KEY_BINDINGS)}>
                Reset
              </button>
            </div>
            <div className="viewport-key-bindings-list">
              {VIEWPORT_BINDING_LABELS.map((binding) => (
                <label key={binding.action} className="viewport-key-binding-row">
                  <span>{binding.label}</span>
                  <select value={keyBindings[binding.action]} onChange={(event) => updateKeyBinding(binding.action, event.target.value)}>
                    {VIEWPORT_KEY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="viewport-fixed-bindings">
              <span>Alt/Ctrl drag: orbit + tilt</span>
              <span>Alt wheel: vertical offset</span>
              <span>Ctrl + 1/2/3: save view</span>
              <span>1/2/3: recall view</span>
            </div>
          </section>
        ) : null}

        {onToggleChunkBounds ? (
          <div className={`viewport-chunk-bounds-badge ${viewportOverlays.chunkBounds ? "viewport-chunk-bounds-badge-active" : ""}`} data-testid="viewport-chunk-bounds-badge">
            <span className="viewport-chunk-bounds-swatch" aria-hidden="true" />
            <span>{viewportOverlays.chunkBounds ? "Chunk bounds" : "Bounds hidden"}</span>
            <button
              type="button"
              className="icon-button viewport-chunk-bounds-toggle"
              title={viewportOverlays.chunkBounds ? "Hide chunk bounds" : "Show chunk bounds"}
              aria-label={viewportOverlays.chunkBounds ? "Hide chunk bounds" : "Show chunk bounds"}
              data-testid="viewport-chunk-bounds-badge-toggle"
              onClick={onToggleChunkBounds}
            >
              {viewportOverlays.chunkBounds ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
            </button>
          </div>
        ) : null}

        {gameCameraEnabled ? (
          <section className="viewport-game-camera-preview" data-testid="viewport-game-camera-preview" aria-label="Game camera voxel preview">
            <div className="viewport-game-camera-header">
              <strong>Game Camera</strong>
              <div className="viewport-game-camera-actions">
                <button
                  type="button"
                  className={gameCameraPlacementArmed ? "viewport-game-camera-action viewport-game-camera-action-active" : "viewport-game-camera-action"}
                  data-testid="viewport-game-camera-place"
                  onClick={() => setGameCameraPlacementArmed((armed) => !armed)}
                >
                  {gameCameraPlacementArmed ? "Click map" : "Place"}
                </button>
                <button type="button" className="viewport-game-camera-action" onClick={placeGameCameraAtTarget}>
                  Target
                </button>
                <button
                  type="button"
                  className="viewport-game-camera-action"
                  data-testid="viewport-game-camera-detach"
                  title="Open game camera in a separate window"
                  aria-label="Open game camera in a separate window"
                  onClick={() => void openDetachedGameCamera()}
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  Detach
                </button>
              </div>
            </div>
            <canvas ref={gameCameraCanvasRef} className="viewport-game-camera-canvas" data-testid="viewport-game-camera-canvas" />
            {gameCamera ? (
              <div className="viewport-game-camera-readout">
                {gameCamera.position.map((value) => value.toFixed(1)).join(", ")}
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="canvas-reticle" aria-hidden="true" />
        <div className="canvas-label">
          {hasExactVoxelPreview ? "Exact voxel viewport" : hasRenderableMesh ? "Runtime mesh viewport" : hasBackendPreview ? "Loaded world viewport" : "World summary viewport"} / {runtimeState}
        </div>
        <div className="minimap-canvas" aria-label="World viewport summary">
          <div className="minimap-grid">
            <strong>{chunks.length}</strong>
            <span>chunks</span>
            <span>{exposedVoxels.length} exposed voxels</span>
            <span>{samples.length} samples</span>
            <span>{meshChunks.length} mesh payloads</span>
            <span>{waterSampleCount} water</span>
          </div>
        </div>
      </>
    );
  },
  { contract: LITE_VOXEL_VIEWPORT_CONTRACT },
);
