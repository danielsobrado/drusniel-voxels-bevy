// World Outliner — left dock tree
const { useState: oUseState } = React;

const TREE_DATA = [
  { id: 'world', name: 'Drusniel World', I: Icons.Globe, depth: 0, expanded: true, meta: '32 km²', children: [
    { id: 'terrain', name: 'Terrain', I: Icons.Layers, depth: 1, expanded: true, children: [
      { id: 'regions', name: 'Regions', I: Icons.Map, depth: 2, expanded: false, meta: '8' },
      { id: 'chunks', name: 'Chunks', I: Icons.Boxes, depth: 2, expanded: true, meta: '1.2k', children: [
        { id: 'chunk-16-3-4', name: 'Chunk [16, 3, −4]', I: Icons.Cube, depth: 3, selected: true, dirty: true },
        { id: 'chunk-15-3-4', name: 'Chunk [15, 3, −4]', I: Icons.Cube, depth: 3 },
        { id: 'chunk-17-3-4', name: 'Chunk [17, 3, −4]', I: Icons.Cube, depth: 3, dirty: true },
      ]},
      { id: 'dirty', name: 'Dirty Chunks', I: Icons.AlertTriangle, depth: 2, meta: '3' },
      { id: 'lod', name: 'LOD Groups', I: Icons.Stack, depth: 2, meta: '4' },
    ]},
    { id: 'areas', name: 'Protected Areas', I: Icons.Shield, depth: 1, expanded: true, meta: '7', children: [
      { id: 'spawn', name: 'Spawn Area', I: Icons.Flag, depth: 2 },
      { id: 'story-locks', name: 'Story Lock Areas', I: Icons.Lock, depth: 2, meta: '2' },
      { id: 'no-dig', name: 'No-Dig Zones', I: Icons.ShieldOff, depth: 2, meta: '3' },
      { id: 'no-build', name: 'No-Build Zones', I: Icons.ShieldOff, depth: 2, meta: '1' },
      { id: 'no-prop', name: 'No-Prop Zones', I: Icons.ShieldOff, depth: 2, meta: '1' },
    ]},
    { id: 'water', name: 'Water Bodies', I: Icons.Droplet, depth: 1, expanded: true, meta: '12', children: [
      { id: 'ocean', name: 'Ocean', I: Icons.Water, depth: 2 },
      { id: 'lakes', name: 'Lakes', I: Icons.Water, depth: 2, expanded: true, meta: '4', children: [
        { id: 'lake-03', name: 'Lake LK_03 — Mirror Pond', I: Icons.Droplet, depth: 3 },
      ]},
      { id: 'rivers', name: 'Rivers', I: Icons.Water, depth: 2, meta: '5' },
      { id: 'ponds', name: 'Ponds', I: Icons.Water, depth: 2, meta: '2' },
    ]},
    { id: 'props', name: 'Props', I: Icons.Tree, depth: 1, expanded: false, meta: '4.2k', children: [
      { id: 'trees', name: 'Trees', I: Icons.Tree, depth: 2, meta: '2.1k' },
      { id: 'rocks', name: 'Rocks', I: Icons.Cube, depth: 2, meta: '1.4k' },
      { id: 'bushes', name: 'Bushes', I: Icons.Tree, depth: 2, meta: '482' },
      { id: 'flowers', name: 'Flowers', I: Icons.Sparkle, depth: 2, meta: '198' },
      { id: 'buildings', name: 'Buildings', I: Icons.Build, depth: 2, meta: '24' },
    ]},
    { id: 'lighting', name: 'Lighting', I: Icons.Sun, depth: 1, expanded: false, children: [
      { id: 'sun', name: 'Sun', I: Icons.Sun, depth: 2 },
      { id: 'fog', name: 'Fog Volume', I: Icons.Cloud, depth: 2 },
      { id: 'gi', name: 'GI Probes', I: Icons.Atom, depth: 2, meta: '32' },
    ]},
    { id: 'cameras', name: 'Cameras', I: Icons.Camera, depth: 1, expanded: false, children: [
      { id: 'player-cam', name: 'Player Camera', I: Icons.Camera, depth: 2 },
      { id: 'photo-cam', name: 'Photo Mode Camera', I: Icons.Camera, depth: 2 },
      { id: 'reflect-cam', name: 'Reflection Camera', I: Icons.Camera, depth: 2 },
    ]},
  ]}
];

function flatten(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    if (n.expanded && n.children) flatten(n.children, out);
  }
  return out;
}

function WorldOutliner({ selectedId, onSelect, override }) {
  const data = override || flatten(TREE_DATA);
  const [tab, setTab] = oUseState('world');
  return (
    <Panel
      title=""
      tabs={[
        { id: 'world', label: 'World' },
        { id: 'chunks', label: 'Chunks', badge: 1218 },
        { id: 'areas', label: 'Areas', badge: 7 },
        { id: 'props', label: 'Props', badge: '4.2k' },
        { id: 'water', label: 'Water', badge: 12 },
      ]}
      activeTab={tab}
      onTab={setTab}
      hint={{ text: 'Tree of every world entity. Right-click for context actions. Drag to re-parent.' }}
      testid="panel-outliner"
    >
      <div className="tree-search">
        <Icons.Search size={11} />
        <input placeholder="Filter… (chunks, dirty, area:lock)" data-testid="outliner-search" />
        <button className="ibtn sm" title="Filters"><Icons.Filter size={11} /></button>
      </div>
      <div className="tree" data-testid="outliner-tree">
        {data.map((n) => (
          <TreeItem
            key={n.id}
            depth={n.depth}
            icon={n.I}
            name={n.name}
            meta={n.meta}
            selected={n.id === selectedId || n.selected}
            expanded={n.children ? !!n.expanded : undefined}
            dirty={n.dirty}
            onClick={() => onSelect && onSelect(n.id)}
          />
        ))}
      </div>
    </Panel>
  );
}

window.WorldOutliner = WorldOutliner;
window.TREE_DATA_FLAT = flatten(TREE_DATA);
