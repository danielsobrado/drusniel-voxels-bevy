import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import GUI from "lil-gui";
import { type ClodPagesConfig, parseConfig } from "../config.js";
import { initSimplifier } from "../simplify.js";
import { buildTestHierarchy, type TestBuildResult } from "./buildTestHierarchy.js";
import { ALL_FIXTURES, type FixtureDef, fixtureByName } from "./stressFixtures.js";
import { formatBuildStats } from "./stats.js";
import { buildDebugSummary } from "./debugExport.js";
import configText from "../../config/clod_pages.yaml?raw";
import { buildOuterBorderLocks } from "../lock.js";

function heightfieldPageMesh(fixture: FixtureDef, pageX: number, pageZ: number, cellsPerSide: number) {
  const baseX = pageX * cellsPerSide;
  const baseZ = pageZ * cellsPerSide;
  const side = cellsPerSide + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const materials: number[] = [];

  for (let j = 0; j <= cellsPerSide; j++) {
    for (let i = 0; i <= cellsPerSide; i++) {
      const wx = baseX + i;
      const wz = baseZ + j;
      const h = fixture.height(wx, wz);
      const m = fixture.material(wx, wz);
      positions.push(wx, h, wz);
      normals.push(0, 1, 0);
      materials.push(m);
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < cellsPerSide; j++) {
    for (let i = 0; i < cellsPerSide; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = (j + 1) * side + i;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const nv = materials.length;
  const materialWeights = new Float32Array(nv * 4);
  for (let i = 0; i < nv; i++) {
    const slot = Math.min(Math.max(0, materials[i]), 3);
    materialWeights[i * 4 + slot] = 1.0;
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    paintSlots: new Float32Array(materials),
    materialWeights,
    materialWeightStride: 4,
    indices: new Uint32Array(indices),
  };
}

function buildFixtureWorld(
  fixture: FixtureDef,
  worldPagesX: number,
  worldPagesZ: number,
  cfg: ClodPagesConfig,
): TestBuildResult {
  const cellsPerPage = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const meshProvider = (px: number, pz: number) => heightfieldPageMesh(fixture, px, pz, cellsPerPage);
  return buildTestHierarchy(worldPagesX, worldPagesZ, cfg, meshProvider);
}

interface BuilderViewerState {
  fixtureName: string;
  worldSize: number;
  showLevels: Record<string, boolean>;
  wireframe: boolean;
  showLockedBorders: boolean;
  showPageBounds: boolean;
}

const LOD_COLORS = [0x4488ff, 0x44ff88, 0xff8844, 0xff4488];

export async function runBuilderViewer(): Promise<void> {
  await initSimplifier();

  const cfg = parseConfig(configText);
  const container = document.getElementById("app") ?? document.body;
  const infoEl = document.getElementById("info");

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222233);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(80, 60, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(32, 0, 32);
  controls.update();

  const ambientLight = new THREE.AmbientLight(0x404060);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(50, 100, 50);
  scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-50, 50, -50);
  scene.add(fillLight);

  const gridHelper = new THREE.GridHelper(128, 32);
  scene.add(gridHelper);

  let meshes: THREE.Mesh[] = [];
  let boundsHelpers: THREE.LineSegments[] = [];
  let lockHelpers: THREE.Points[] = [];

  const state: BuilderViewerState = {
    fixtureName: ALL_FIXTURES[0].name,
    worldSize: 4,
    showLevels: { "0": true, "1": true, "2": true, "3": true },
    wireframe: false,
    showLockedBorders: false,
    showPageBounds: false,
  };

  function rebuild(): void {
    for (const m of meshes) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    for (const h of boundsHelpers) h.geometry.dispose();
    for (const h of lockHelpers) h.geometry.dispose();
    meshes = [];
    boundsHelpers = [];
    lockHelpers = [];

    const fixture = fixtureByName(state.fixtureName) ?? ALL_FIXTURES[0];
    const result = buildFixtureWorld(fixture, state.worldSize, state.worldSize, cfg);
    const statsText = formatBuildStats(result.stats);
    const debugSummary = buildDebugSummary(result.nodesByLevel);

    const infoText = [
      `Fixture: ${fixture.name}`,
      `World: ${state.worldSize}x${state.worldSize}`,
      `Total nodes: ${debugSummary.totalNodes}`,
      `Max level: ${debugSummary.maxLevel}`,
      "",
      statsText,
    ].join("\n");
    if (infoEl) infoEl.textContent = infoText;
    console.log(statsText);

    for (const [, nodes] of result.nodesByLevel) {
      for (const node of nodes) {
        if (!state.showLevels[String(node.level)]) continue;

        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(node.mesh.positions.slice(), 3));
        geom.setAttribute("normal", new THREE.BufferAttribute(node.mesh.normals.slice(), 3));
        geom.setIndex(new THREE.BufferAttribute(node.mesh.indices.slice(), 1));

        const color = LOD_COLORS[node.level % LOD_COLORS.length];
        const mat = new THREE.MeshStandardMaterial({
          color,
          flatShading: true,
          wireframe: state.wireframe,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.name = node.id;
        meshes.push(mesh);
        scene.add(mesh);

        if (state.showPageBounds) {
          const f = node.footprint;
          const y = node.bounds.minY;
          const pts = [
            new THREE.Vector3(f.minX, y, f.minZ),
            new THREE.Vector3(f.maxX, y, f.minZ),
            new THREE.Vector3(f.maxX, y, f.maxZ),
            new THREE.Vector3(f.minX, y, f.maxZ),
            new THREE.Vector3(f.minX, y, f.minZ),
          ];
          const bg = new THREE.BufferGeometry().setFromPoints(pts);
          const bl = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false }));
          boundsHelpers.push(bl);
          scene.add(bl);
        }

        if (state.showLockedBorders && node.level > 0) {
          const locks = buildOuterBorderLocks(node.mesh);
          const lockPositions: number[] = [];
          for (let i = 0; i < locks.length; i++) {
            if (locks[i]) {
              lockPositions.push(node.mesh.positions[i * 3], node.mesh.positions[i * 3 + 1], node.mesh.positions[i * 3 + 2]);
            }
          }
          if (lockPositions.length > 0) {
            const lg = new THREE.BufferGeometry();
            lg.setAttribute("position", new THREE.Float32BufferAttribute(lockPositions, 3));
            const lp = new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xff0000, size: 0.3, depthTest: false }));
            lockHelpers.push(lp);
            scene.add(lp);
          }
        }
      }
    }
  }

  const gui = new GUI({ title: "Builder Inspector" });

  gui.add(state, "fixtureName", ALL_FIXTURES.map((f) => f.name)).name("fixture").onChange(rebuild);
  gui.add(state, "worldSize", [2, 4, 8]).name("world size").onChange(rebuild);
  gui.add(state, "wireframe").name("wireframe").onChange(rebuild);
  gui.add(state, "showPageBounds").name("page bounds").onChange(rebuild);
  gui.add(state, "showLockedBorders").name("locked borders").onChange(rebuild);

  const levelFolder = gui.addFolder("level visibility");
  for (let i = 0; i <= 3; i++) {
    levelFolder.add(state.showLevels, String(i)).name(`LOD${i}`).onChange(rebuild);
  }
  levelFolder.open();

  gui.add({ rebuild }, "rebuild").name("rebuild").onChange(rebuild);

  rebuild();

  function onResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  function animate(): void {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}
