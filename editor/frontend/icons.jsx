// Lucide-style line icons. All take size + optional color via currentColor.
// Stroke 1.5 for crispness at small sizes.

const I = ({ d, size = 14, fill = 'none', sw = 1.5, children, ...p }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    {d ? <path d={d} /> : children}
  </svg>
);

const Icons = {
  // chevrons & arrows
  ChevR: (p) => <I d="M9 6l6 6-6 6" {...p} />,
  ChevD: (p) => <I d="M6 9l6 6 6-6" {...p} />,
  ChevL: (p) => <I d="M15 6l-6 6 6 6" {...p} />,
  ChevU: (p) => <I d="M6 15l6-6 6 6" {...p} />,
  ArrowR: (p) => <I {...p}><path d="M5 12h14M13 6l6 6-6 6" /></I>,
  // file
  Save: (p) => <I {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M7 3v6h10V3M7 21v-7h10v7"/></I>,
  Folder: (p) => <I d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" {...p} />,
  File: (p) => <I {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></I>,
  // playback
  Play: (p) => <I {...p}><path d="M6 4l14 8-14 8z" fill="currentColor"/></I>,
  Pause: (p) => <I {...p}><rect x="6" y="5" width="4" height="14" fill="currentColor" rx="1"/><rect x="14" y="5" width="4" height="14" fill="currentColor" rx="1"/></I>,
  Square: (p) => <I {...p}><rect x="6" y="6" width="12" height="12" rx="1.5"/></I>,
  // history
  Undo: (p) => <I {...p}><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H10"/></I>,
  Redo: (p) => <I {...p}><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0-5 5v0a5 5 0 0 0 5 5h5"/></I>,
  // tools
  Cursor: (p) => <I {...p}><path d="M5 3l6.5 18 2.5-7 7-2.5z"/></I>,
  Sculpt: (p) => <I {...p}><circle cx="12" cy="12" r="6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></I>,
  Paint: (p) => <I {...p}><path d="M9 3h12v6H9z"/><path d="M15 9v3a2 2 0 0 1-2 2H6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4v-4"/></I>,
  AreaBox: (p) => <I {...p}><path d="M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" /></I>,
  Tree: (p) => <I {...p}><path d="M12 22V13"/><path d="M7 13l5-9 5 9z"/><path d="M5 18l7-7 7 7"/></I>,
  Water: (p) => <I {...p}><path d="M3 14c2 2 4 2 6 0s4-2 6 0 4 2 6 0"/><path d="M3 18c2 2 4 2 6 0s4-2 6 0 4 2 6 0"/><path d="M3 10c2 2 4 2 6 0s4-2 6 0 4 2 6 0"/></I>,
  Build: (p) => <I {...p}><path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9 21v-6h6v6"/></I>,
  Ruler: (p) => <I {...p}><path d="M3 17l4 4 14-14-4-4z"/><path d="M7 14l2 2M10 11l2 2M13 8l2 2M16 5l2 2"/></I>,
  Camera: (p) => <I {...p}><path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/></I>,
  Move: (p) => <I {...p}><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3-3M2 12h20M12 2v20"/></I>,
  Rotate: (p) => <I {...p}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></I>,
  Scale: (p) => <I {...p}><path d="M21 3l-7 7M21 3v7M21 3h-7M3 21l7-7M3 21v-7M3 21h7"/></I>,
  // misc
  Eye: (p) => <I {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></I>,
  EyeOff: (p) => <I {...p}><path d="M3 3l18 18"/><path d="M10.5 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.4 5.3A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.8 4.6M6.1 6.6A17 17 0 0 0 2 12s4 7 10 7c1 0 2-.2 2.9-.5"/></I>,
  Lock: (p) => <I {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></I>,
  LockOpen: (p) => <I {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/></I>,
  Search: (p) => <I {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></I>,
  Filter: (p) => <I d="M3 4h18l-7 9v7l-4-2v-5z" {...p} />,
  Plus: (p) => <I {...p}><path d="M12 5v14M5 12h14"/></I>,
  Minus: (p) => <I d="M5 12h14" {...p} />,
  X: (p) => <I {...p}><path d="M6 6l12 12M18 6L6 18"/></I>,
  More: (p) => <I {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/></I>,
  MoreV: (p) => <I {...p}><circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/></I>,
  Pin: (p) => <I {...p}><path d="M12 17v5"/><path d="M9 3h6l-1 4 3 3v3H7v-3l3-3z"/></I>,
  Cog: (p) => <I {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09c0 .67.39 1.27 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82c.24.61.84 1 1.51 1H21a2 2 0 0 1 0 4h-.09c-.67 0-1.27.39-1.51 1z"/></I>,
  Globe: (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></I>,
  Cube: (p) => <I {...p}><path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></I>,
  Layers: (p) => <I {...p}><path d="M12 2l10 6-10 6L2 8z"/><path d="M2 14l10 6 10-6M2 18l10 6 10-6"/></I>,
  Grid: (p) => <I {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></I>,
  Sun: (p) => <I {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></I>,
  Cloud: (p) => <I d="M17 18a4 4 0 1 0-3-7 5 5 0 0 0-9 1 4 4 0 0 0 1 8z" {...p} />,
  Sparkle: (p) => <I {...p}><path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4"/></I>,
  Bot: (p) => <I {...p}><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01M9 17h6"/></I>,
  Terminal: (p) => <I {...p}><path d="M4 17l5-5-5-5M12 19h8"/></I>,
  Activity: (p) => <I d="M3 12h4l3-9 4 18 3-9h4" {...p} />,
  Zap: (p) => <I d="M13 2L3 14h7l-1 8 10-12h-7z" {...p} />,
  Beaker: (p) => <I {...p}><path d="M9 3h6M10 3v7L4 21h16L14 10V3"/></I>,
  Map: (p) => <I {...p}><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v16M15 6v16"/></I>,
  Compass: (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6z"/></I>,
  Brush: (p) => <I {...p}><path d="M9 11V5a3 3 0 0 1 6 0v6"/><path d="M5 11h14v3a7 7 0 0 1-7 7v0a7 7 0 0 1-7-7v-3z"/></I>,
  Droplet: (p) => <I d="M12 2s7 8 7 13a7 7 0 1 1-14 0c0-5 7-13 7-13z" {...p} />,
  Flag: (p) => <I {...p}><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></I>,
  Shield: (p) => <I d="M12 2l8 3v7c0 5-4 9-8 10-4-1-8-5-8-10V5z" {...p} />,
  ShieldOff: (p) => <I {...p}><path d="M3 3l18 18"/><path d="M19.7 14.5C19.9 13.7 20 12.9 20 12V5l-8-3-3.5 1.3M5.7 5.6L4 5v7c0 5 4 9 8 10 1.5-.4 2.9-1.1 4-2"/></I>,
  Atom: (p) => <I {...p}><circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/></I>,
  Check: (p) => <I d="M5 12l5 5L20 7" {...p} />,
  CheckCircle: (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></I>,
  AlertTriangle: (p) => <I {...p}><path d="M12 3l10 17H2z"/><path d="M12 9v5M12 17v.01"/></I>,
  Info: (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v5h1"/></I>,
  Hash: (p) => <I {...p}><path d="M5 9h14M5 15h14M9 4l-2 16M17 4l-2 16"/></I>,
  Boxes: (p) => <I {...p}><path d="M3 7l4-2 4 2v5l-4 2-4-2z"/><path d="M13 7l4-2 4 2v5l-4 2-4-2z"/><path d="M8 17l4-2 4 2v5l-4 2-4-2z"/></I>,
  Branch: (p) => <I {...p}><circle cx="6" cy="3" r="2"/><circle cx="6" cy="21" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 5v14M6 12a6 6 0 0 0 6 6h2M18 11a6 6 0 0 1-6 6"/></I>,
  Wand: (p) => <I {...p}><path d="M3 21l13-13M14 6l4 4M16 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/></I>,
  Pipette: (p) => <I {...p}><path d="M14 4l6 6-3 3-1-1-7 7-4 1 1-4 7-7-1-1z"/></I>,
  Crosshair: (p) => <I {...p}><circle cx="12" cy="12" r="9"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/></I>,
  ListTree: (p) => <I {...p}><path d="M3 5h6M3 12h4M3 19h4M11 12h10M11 19h10M11 5h10"/></I>,
  Bug: (p) => <I {...p}><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M8 13H4M16 13h4M8 9L4 6M16 9l4-3M8 17l-4 3M16 17l4 3M9 6V4a3 3 0 0 1 6 0v2"/></I>,
  History: (p) => <I {...p}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 7v5l3 2"/></I>,
  Gizmo: (p) => <I {...p}><path d="M12 12L4 8M12 12l8-4M12 12v9" stroke-width="1.5"/></I>,
  RuleScale: (p) => <I {...p}><path d="M2 12h20M6 12V8M10 12V6M14 12V8M18 12V6"/></I>,
  Snap: (p) => <I {...p}><path d="M3 9h6V3M21 9h-6V3M3 15h6v6M21 15h-6v6"/></I>,
  Refresh: (p) => <I {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></I>,
  Erase: (p) => <I {...p}><path d="M19 13L11 5l-8 8 6 6h6z"/><path d="M14 19h7"/></I>,
  Stack: (p) => <I {...p}><path d="M3 6l9-4 9 4-9 4z"/><path d="M3 12l9 4 9-4M3 18l9 4 9-4"/></I>,
  Spray: (p) => <I {...p}><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="10" cy="9" r="1" fill="currentColor"/><circle cx="6" cy="14" r="1" fill="currentColor"/><path d="M14 4l6 6-9 9-4 1 1-4z"/></I>,
};

window.Icons = Icons;
