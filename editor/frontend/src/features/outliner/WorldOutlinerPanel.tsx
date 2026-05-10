import { type ChangeEvent, type ReactNode, useMemo, useState } from "react";
import { Eye, EyeOff, Lock, LockOpen, Search } from "lucide-react";
import { PanelTitleBar } from "../../components/editor/PanelTitleBar";
import { useEditorStore } from "../../state/editorStore";
import { getVisibleOutlinerNodes, type OutlinerNode } from "../../state/editorSelectors";
import type { Selection } from "../../types/editor";

type OutlinerSelectionKind = Exclude<Selection["kind"], "voxel">;
const selectionId = (selection: Selection): string => (selection.kind === "voxel" ? selection.chunkId : selection.id);

interface OutlinerFilters {
  search: string;
  dirtyOnly: boolean;
  lockedOnly: boolean;
  chunks: boolean;
  areas: boolean;
  water: boolean;
  props: boolean;
  materials: boolean;
}

const areaKindLabels: Record<string, string> = {
  spawn: "Spawn Areas",
  story_lock: "Story Lock Areas",
  no_dig: "No-Dig Zones",
  no_build: "No-Build Zones",
  no_prop: "No-Prop Zones",
};

const waterKindLabels: Record<string, string> = {
  Ocean: "Ocean",
  Lake: "Lakes",
  River: "Rivers",
  Pond: "Ponds",
  Unknown: "Unknown",
};

const propTypeLabels: Record<string, string> = {
  tree: "Trees",
  rock: "Rocks",
  bush: "Bushes",
  flower: "Flowers",
  building: "Buildings",
};

const iconByKind: Record<OutlinerNode["kind"], string> = {
  voxel: "[VX]",
  chunk: "[CH]",
  area: "[AR]",
  prop: "[PR]",
  water: "[WT]",
  material: "[MT]",
  debug_resource: "[DB]",
};
const OUTLINER_VISIBLE_NODE_LIMIT = 500;

function OutlinerSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <details open className="outliner-details">
      <summary className="outliner-heading">{title}</summary>
      <div className="outliner-subsection">{children}</div>
    </details>
  );
}

function OutlinerRow({
  node,
  selected,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onOpenContextMenu,
  labelPrefix,
  testIdScope,
}: {
  readonly node: OutlinerNode;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onToggleVisibility: () => void;
  readonly onToggleLock: () => void;
  readonly onOpenContextMenu: () => void;
  readonly labelPrefix?: string;
  readonly testIdScope?: string;
}) {
  const scopedKind = testIdScope ? `${node.kind}-${testIdScope}` : node.kind;
  const selectLabel = labelPrefix ? `Select ${labelPrefix} ${node.label}` : `Select ${node.label}`;

  return (
    <div className={`outliner-row ${selected ? "active" : ""}`}>
      <button
        type="button"
        className="outliner-row-select"
        data-testid={`outliner-item-${scopedKind}-${node.id}`}
        aria-label={selectLabel}
        onClick={onSelect}
      >
        <span className="outliner-row-icon" aria-hidden="true">
          {iconByKind[node.kind]}
        </span>
        <div className="outliner-row-main">
          <span className="outliner-row-copy">
            <span>{node.label}</span>
            <small>{node.detail}</small>
          </span>
          <span className="outliner-row-type-badge">{node.typeBadge}</span>
          {node.dirty ? <span className="outliner-row-dirty-badge">DIRTY</span> : null}
        </div>
      </button>
      <div className="outliner-row-actions">
        <button
          type="button"
          className="outliner-row-action"
          data-testid={`outliner-item-${node.kind}-${node.id}-visibility`}
          aria-label={`Toggle visibility for ${node.label}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleVisibility();
          }}
        >
          {node.visible ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="outliner-row-action"
          data-testid={`outliner-item-${node.kind}-${node.id}-lock`}
          aria-label={`Toggle lock for ${node.label}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleLock();
          }}
        >
          {node.locked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="outliner-row-action"
          data-testid={`outliner-item-${node.kind}-${node.id}-context`}
          aria-label={`Open context menu for ${node.label}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenContextMenu();
          }}
        >
          ...
        </button>
      </div>
    </div>
  );
}

function OutlinerPlaceholder({ label }: { readonly label: string }) {
  return <div className="outliner-placeholder">{label}</div>;
}

export function WorldOutlinerPanel({ onClose }: { readonly onClose?: () => void } = {}) {
  const editorState = useEditorStore();
  const allNodes = getVisibleOutlinerNodes(editorState);

  const [filters, setFilters] = useState<OutlinerFilters>({
    search: "",
    dirtyOnly: false,
    lockedOnly: false,
    chunks: false,
    areas: false,
    water: false,
    props: false,
    materials: false,
  });

  const changeFilter = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, checked, value } = event.target;
    if (name === "search") {
      setFilters((previous) => ({ ...previous, search: value }));
      return;
    }

    setFilters((previous) => ({ ...previous, [name]: checked }));
  };

  const filterGroups = filters.chunks || filters.areas || filters.water || filters.props || filters.materials;
  const searchText = filters.search.trim().toLowerCase();
  const visibleNodes = useMemo(() => {
    return allNodes.filter((node) => {
      if (filters.dirtyOnly && !node.dirty) {
        return false;
      }

      if (filters.lockedOnly && !node.locked) {
        return false;
      }

      if (filterGroups) {
        const matchesFilterGroup =
          (filters.chunks && node.kind === "chunk") ||
          (filters.areas && node.kind === "area") ||
          (filters.water && node.kind === "water") ||
          (filters.props && node.kind === "prop") ||
          (filters.materials && node.kind === "material");
        if (!matchesFilterGroup) {
          return false;
        }
      }

      if (!searchText) {
        return true;
      }

      const haystack = `${node.label} ${node.detail} ${node.typeBadge}`.toLowerCase();
      return haystack.includes(searchText);
    });
  }, [allNodes, filterGroups, filters.areas, filters.chunks, filters.dirtyOnly, filters.lockedOnly, filters.materials, filters.props, filters.search, filters.water]);

  const displayNodes = visibleNodes.slice(0, OUTLINER_VISIBLE_NODE_LIMIT);
  const hiddenNodeCount = Math.max(0, visibleNodes.length - displayNodes.length);
  const chunks = displayNodes.filter((node) => node.kind === "chunk");
  const dirtyChunks = chunks.filter((node) => node.dirty);
  const areas = displayNodes.filter((node) => node.kind === "area");
  const water = displayNodes.filter((node) => node.kind === "water");
  const props = displayNodes.filter((node) => node.kind === "prop");
  const materials = displayNodes.filter((node) => node.kind === "material");

  const chunksByLod = useMemo(() => {
    const map = new Map<number, typeof chunks>();
    for (const chunk of chunks) {
      const source = editorState.chunks.find((candidate) => candidate.id === chunk.id);
      if (!source) {
        continue;
      }

      const group = source.lodGroup;
      const list = map.get(group) ?? [];
      list.push(chunk);
      map.set(group, list);
    }

    return map;
  }, [chunks, editorState.chunks]);

  const chunksByBiome = useMemo(() => {
    const map = new Map<string, typeof chunks>();
    for (const chunk of chunks) {
      const source = editorState.chunks.find((candidate) => candidate.id === chunk.id);
      if (!source) {
        continue;
      }

      const list = map.get(source.biome) ?? [];
      list.push(chunk);
      map.set(source.biome, list);
    }
    return map;
  }, [chunks, editorState.chunks]);

  const areasByKind = useMemo(() => {
    const map = new Map<string, OutlinerNode[]>();
    for (const area of areas) {
      const source = editorState.protectedAreas.find((candidate) => candidate.id === area.id);
      const label = source ? areaKindLabels[source.kind] : "Areas";
      const list = map.get(label) ?? [];
      list.push(area);
      map.set(label, list);
    }
    return map;
  }, [areas, editorState.protectedAreas]);

  const waterByKind = useMemo(() => {
    const map = new Map<string, OutlinerNode[]>();
    for (const item of water) {
      const source = editorState.waterBodies.find((candidate) => candidate.id === item.id);
      const label = source ? waterKindLabels[source.kind] : "Water";
      const list = map.get(label) ?? [];
      list.push(item);
      map.set(label, list);
    }
    return map;
  }, [editorState.waterBodies, water]);

  const propsByType = useMemo(() => {
    const map = new Map<string, OutlinerNode[]>();
    for (const propNode of props) {
      const source = editorState.props.find((candidate) => candidate.id === propNode.id);
      const label = source ? propTypeLabels[source.type] : "Props";
      const list = map.get(label) ?? [];
      list.push(propNode);
      map.set(label, list);
    }
    return map;
  }, [editorState.props, props]);

  const renderRows = (items: readonly OutlinerNode[], options: { readonly labelPrefix?: string; readonly testIdScope?: string } = {}) =>
    items
      .filter((node): node is Omit<OutlinerNode, "kind"> & { readonly kind: OutlinerSelectionKind } => node.kind !== "voxel")
      .map((node) => {
      const selected = editorState.selection.kind === node.kind && selectionId(editorState.selection) === node.id;
      return (
        <OutlinerRow
          key={`${node.kind}-${node.id}`}
          node={node}
          selected={selected}
          onSelect={() => editorState.setSelection({ kind: node.kind, id: node.id, label: node.label })}
          onToggleVisibility={() => editorState.toggleOutlinerNodeVisibility(node.kind, node.id)}
          onToggleLock={() => editorState.toggleOutlinerNodeLock(node.kind, node.id)}
          onOpenContextMenu={() =>
            editorState.pushAgentTimelineEvent({ kind: "command", message: `Context menu requested for ${node.label}.` })
          }
          labelPrefix={options.labelPrefix}
          testIdScope={options.testIdScope}
        />
      );
    });

  const selectionKind = (kind: OutlinerSelectionKind, id: string, label: string) => editorState.setSelection({ kind, id, label });

  return (
    <section className="panel-shell" data-testid="panel-world-outliner" aria-labelledby="outliner-title">
      <PanelTitleBar title="World Outliner" titleId="outliner-title" onClose={onClose} />
      <div className="panel-body">
        <div className="outliner-toolbar">
          <label className="outliner-search">
            <Search size={14} aria-hidden="true" />
            <input
              id="outliner-search"
              name="search"
              data-testid="outliner-search-input"
              type="search"
              value={filters.search}
              placeholder="Search outliner..."
              onChange={changeFilter}
            />
          </label>
          <label>
            <input name="dirtyOnly" type="checkbox" checked={filters.dirtyOnly} onChange={changeFilter} />
            dirty only
          </label>
          <label>
            <input name="lockedOnly" type="checkbox" checked={filters.lockedOnly} onChange={changeFilter} />
            locked only
          </label>
          <label>
            <input name="chunks" type="checkbox" checked={filters.chunks} onChange={changeFilter} />
            chunks
          </label>
          <label>
            <input name="areas" type="checkbox" checked={filters.areas} onChange={changeFilter} />
            areas
          </label>
          <label>
            <input name="water" type="checkbox" checked={filters.water} onChange={changeFilter} />
            water
          </label>
          <label>
            <input name="props" type="checkbox" checked={filters.props} onChange={changeFilter} />
            props
          </label>
          <label>
            <input name="materials" type="checkbox" checked={filters.materials} onChange={changeFilter} />
            materials
          </label>
        </div>
        {hiddenNodeCount > 0 ? (
          <p className="muted" data-testid="outliner-large-world-cap">
            {`Showing first ${displayNodes.length} of ${visibleNodes.length} matching objects. Use search or type filters to narrow the list.`}
          </p>
        ) : null}

        <OutlinerSection title="Drusniel World">
          <OutlinerSection title="Terrain">
            <OutlinerSection title="Regions">
              {chunksByBiome.size ? Array.from(chunksByBiome.entries()).map(([region, regionChunks]) => (
                <div className="outliner-subgroup" key={region}>
                  <div className="outliner-subheading">{region}</div>
                  {renderRows(regionChunks, { labelPrefix: `region ${region}`, testIdScope: `region-${region.replace(/\s+/g, "-")}` })}
                </div>
              )) : <OutlinerPlaceholder label="No terrain regions found." />}
            </OutlinerSection>
            <OutlinerSection title="Chunks">{chunks.length ? renderRows(chunks) : <OutlinerPlaceholder label="No chunks found in loaded world." />}</OutlinerSection>
            <OutlinerSection title="Dirty Chunks">
              {dirtyChunks.length ? renderRows(dirtyChunks) : <OutlinerPlaceholder label="No matching dirty chunks." />}
            </OutlinerSection>
            <OutlinerSection title="LOD Groups">
              {chunksByLod.size ? Array.from(chunksByLod.entries()).map(([lod, lodNodes]) => (
                <div className="outliner-subgroup" key={lod}>
                  <div className="outliner-subheading">LOD {lod}</div>
                  {renderRows(lodNodes, { labelPrefix: `LOD ${lod}`, testIdScope: `lod-${lod}` })}
                </div>
              )) : <OutlinerPlaceholder label="No LOD groups found." />}
            </OutlinerSection>
          </OutlinerSection>

          <OutlinerSection title="Protected Areas">
            {areasByKind.size ? Array.from(areasByKind.entries()).map(([label, areaNodes]) => (
              <OutlinerSection title={label} key={label}>
                {areaNodes.length ? renderRows(areaNodes) : <OutlinerPlaceholder label={`No ${label} areas match current filter.`} />}
              </OutlinerSection>
            )) : <OutlinerPlaceholder label="No protected areas found in loaded world." />}
          </OutlinerSection>

          <OutlinerSection title="Water Bodies">
            {waterByKind.size ? Array.from(waterByKind.entries()).map(([label, waterNodes]) => (
              <OutlinerSection title={label} key={label}>
                {waterNodes.length ? renderRows(waterNodes) : <OutlinerPlaceholder label={`No ${label} water bodies match current filter.`} />}
              </OutlinerSection>
            )) : <OutlinerPlaceholder label="No water bodies found in loaded world." />}
          </OutlinerSection>

          <OutlinerSection title="Props">
            {propsByType.size ? Array.from(propsByType.entries()).map(([label, propNodes]) => (
              <OutlinerSection title={label} key={label}>
                {propNodes.length ? renderRows(propNodes) : <OutlinerPlaceholder label={`No ${label} props match current filter.`} />}
              </OutlinerSection>
            )) : <OutlinerPlaceholder label="No props found in loaded world." />}
          </OutlinerSection>
          <OutlinerSection title="Materials">
            {materials.length ? renderRows(materials) : <OutlinerPlaceholder label="No materials match current filter." />}
          </OutlinerSection>
          <OutlinerSection title="Lighting">
            <OutlinerPlaceholder label="No lighting resources found." />
          </OutlinerSection>
          <OutlinerSection title="Cameras">
            <button
              type="button"
              className="outliner-placeholder"
              onClick={() => selectionKind("debug_resource", "main-camera", "Main Camera")}
              data-testid="outliner-item-debug_resource-main-camera"
            >
              Main Camera
            </button>
            <button
              type="button"
              className="outliner-placeholder"
              onClick={() => selectionKind("debug_resource", "debug-camera", "Debug Camera")}
              data-testid="outliner-item-debug_resource-debug-camera"
            >
              Debug Camera
            </button>
          </OutlinerSection>
          <OutlinerSection title="Debug Resources">
            <button
              type="button"
              className="outliner-placeholder"
              onClick={() => selectionKind("debug_resource", "profiler", "Profiler Stats")}
              data-testid="outliner-item-debug_resource-profiler"
            >
              Profiler Stats
            </button>
          </OutlinerSection>
        </OutlinerSection>
      </div>
    </section>
  );
}

