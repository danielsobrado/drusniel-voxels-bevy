import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";

if (typeof globalThis.FileReader === "undefined") {
  (globalThis as any).FileReader = class {
    onload: any = null;
    onerror: any = null;
    onloadend: any = null;
    result: string | ArrayBuffer | null = null;
    _fire(evt: string): void {
      const cb = (this as any)[evt];
      if (cb) cb({ target: this });
    }
    readAsDataURL(blob: Blob): void {
      blob.arrayBuffer().then(
        (ab: ArrayBuffer) => {
          const base64 = Buffer.from(ab).toString("base64");
          this.result = `data:${blob.type || "application/octet-stream"};base64,${base64}`;
          this._fire("onload");
          this._fire("onloadend");
        },
        () => { this._fire("onerror"); this._fire("onloadend"); }
      );
    }
    readAsArrayBuffer(blob: Blob): void {
      blob.arrayBuffer().then(
        (ab: ArrayBuffer) => {
          this.result = ab;
          this._fire("onload");
          this._fire("onloadend");
        },
        () => { this._fire("onerror"); this._fire("onloadend"); }
      );
    }
  };
}

const BASE = resolve(import.meta.dirname, "..");
const FBX_SRC = resolve(BASE, "assets_source/quaternius/rpg_items/FBX");
const GLB_DST = resolve(BASE, "public/assets/construction/quaternius/rpg_items/models");

const MODEL_NAMES = [
  "Chest_Closed", "Chest_Open", "Chest_Ingots",
  "Book1_Closed", "Book1_Open", "Book2_Closed", "Book2_Open",
  "Book3_Closed", "Book3_Open", "Book4_Closed", "Book4_Open",
  "Potion1_Filled", "Potion2_Filled", "Potion3_Filled",
  "Sword", "Sword_Golden", "Sword_big",
  "Axe_Double", "Axe_small",
  "Bow_Wooden", "Bow_Golden",
  "Dagger", "Dagger_Golden",
  "Arrow", "Arrow_Golden",
  "Shield_Wooden", "Shield_Metal",
  "Backpack", "Bag",
  "Coin", "Coin_Skull", "Coin_Star",
  "Key1", "Key2", "Key3", "Key4",
  "Gold_Ingots", "Chalice", "Scroll",
  "Crystal1", "Crystal2", "Crystal3",
  "Necklace1", "Necklace2", "Necklace3",
  "Ring1", "Ring2", "Ring3",
  "Crown", "Crown2", "Skull", "Skull2",
];

if (!existsSync(GLB_DST)) mkdirSync(GLB_DST, { recursive: true });

const loader = new FBXLoader();
const exporter = new GLTFExporter();

function createSceneFromFbx(fbxPath: string): Promise<THREE.Group> {
  const buf = readFileSync(fbxPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => {
    try {
      const group = loader.parse(ab, "");
      resolve(group);
    } catch (e) {
      reject(e);
    }
  });
}

async function convert() {
  for (const name of MODEL_NAMES) {
    const fbxFile = `${name}.fbx`;
    const fbxPath = join(FBX_SRC, fbxFile);
    if (!existsSync(fbxPath)) {
      console.warn(`SKIP: ${fbxFile} not found`);
      continue;
    }
    try {
      const group = await createSceneFromFbx(fbxPath);
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.computeVertexNormals();
        }
      });
      const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          group,
          (result) => resolve(result as ArrayBuffer),
          (error) => reject(error),
          { binary: true }
        );
      });
      const glbName = name.toLowerCase().replace(/\s+/g, "_") + ".glb";
      writeFileSync(join(GLB_DST, glbName), Buffer.from(glbBuffer));
      console.log(`OK: ${fbxFile} -> ${glbName}`);
    } catch (e) {
      console.error(`FAIL: ${fbxFile}: ${e}`);
    }
  }
}

convert().then(() => console.log("DONE")).catch(console.error);
