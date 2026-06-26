export interface ProjectPropInstance {
  id: string;
  prefabId: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  anchor?: "world" | "terrain" | "voxel";
}

export const EMPTY_PROJECT_PROPS: readonly ProjectPropInstance[] = [];
