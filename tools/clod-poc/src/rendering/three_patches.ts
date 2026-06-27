import type { WebGPURenderer } from "three/webgpu";

interface RenderObjectShape {
  material: { version: number };
  renderer: { contextNode: { version: number } };
  getMaterialCacheKey(): number;
}

interface RenderObjectsShape {
  createRenderObject(...args: unknown[]): RenderObjectShape;
}

function freezeShadowAlphaTest(material: object): void {
  if (Object.prototype.hasOwnProperty.call(material, "alphaTest")) return;
  const current = (material as { alphaTest: number }).alphaTest;
  Object.defineProperty(material, "alphaTest", {
    value: current,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

export function installMaterialKeyMemo(renderer: WebGPURenderer): void {
  const objects = (renderer as unknown as { _objects?: RenderObjectsShape })._objects;
  if (!objects) return;

  const managerProto = Object.getPrototypeOf(objects) as RenderObjectsShape & {
    __drusnielKeyMemo?: boolean;
  };
  if (managerProto.__drusnielKeyMemo === true) return;
  managerProto.__drusnielKeyMemo = true;

  const memo = new WeakMap<object, { material: object; version: number; contextVersion: number; key: number }>();
  const originalCreate = managerProto.createRenderObject;
  let renderObjectProtoPatched = false;

  managerProto.createRenderObject = function (this: RenderObjectsShape, ...args: unknown[]): RenderObjectShape {
    const material = args[4] as { isShadowPassMaterial?: boolean } | undefined;
    if (material?.isShadowPassMaterial === true) freezeShadowAlphaTest(material);

    const renderObject = originalCreate.apply(this, args);
    if (!renderObjectProtoPatched) {
      renderObjectProtoPatched = true;
      const proto = Object.getPrototypeOf(renderObject) as RenderObjectShape;
      const originalKey = proto.getMaterialCacheKey;
      proto.getMaterialCacheKey = function (this: RenderObjectShape): number {
        const materialState = this.material as unknown as object & { version: number };
        const contextVersion = this.renderer.contextNode.version;
        const cached = memo.get(this);
        if (
          cached !== undefined
          && cached.material === materialState
          && cached.version === materialState.version
          && cached.contextVersion === contextVersion
        ) {
          return cached.key;
        }

        const key = originalKey.call(this);
        memo.set(this, { material: materialState, version: materialState.version, contextVersion, key });
        return key;
      };
    }

    return renderObject;
  };
}
