export interface CanopySourceConfig {
  mode: string;
  allowSyntheticDebugFallback: boolean;
  debugFallbackWarning: boolean;
}

export interface CanopyDistanceConfig {
  realTreeEndM: number;
  impostorEndM: number;
  shellStartM: number;
  shellFullM: number;
  shellEndM: number;
  fadeBandM: number;
}

export interface CanopyClipmapRingConfig {
  startM: number;
  endM: number;
  cellSizeM: number;
}

export interface CanopyClipmapConfig {
  enabled: boolean;
  tileSizeM: number;
  cellSizeM: number;
  evictionGraceSeconds: number;
  evictionGraceTiles: number;
  rings: CanopyClipmapRingConfig[];
}

export interface CanopyTreeDistributionConfig {
  densityScale: number;
  forestThreshold: number;
  slopeRejectStart: number;
  slopeRejectEnd: number;
  waterReject: boolean;
  minCanopyHeightM: number;
  maxCanopyHeightM: number;
  crownRadiusMinM: number;
  crownRadiusMaxM: number;
}

export interface CanopyMaterialConfig {
  baseTint: [number, number, number];
  pineTint: [number, number, number];
  broadleafTint: [number, number, number];
  deadwoodTint: [number, number, number];
  coverageAlphaPower: number;
  crownBumpStrengthM: number;
  horizonHazeStrength: number;
  normalStrength: number;
  ditherStrength: number;
}

export interface CanopyDebugConfig {
  showTileBounds: boolean;
  showCoverageHeatmap: boolean;
  showShellWireframe: boolean;
  showFadeZone: boolean;
  freezeClipCenter: boolean;
  forceSyntheticSource: boolean;
}

export interface CanopyBudgetConfig {
  maxTilesBuiltPerFrame: number;
  maxTextureUploadsPerFrame: number;
  maxShellTris: number;
}

export interface CanopyShellConfig {
  enabled: boolean;
  seed: number;
  source: CanopySourceConfig;
  distances: CanopyDistanceConfig;
  clipmap: CanopyClipmapConfig;
  treeDistribution: CanopyTreeDistributionConfig;
  material: CanopyMaterialConfig;
  debug: CanopyDebugConfig;
  budgets: CanopyBudgetConfig;
}
