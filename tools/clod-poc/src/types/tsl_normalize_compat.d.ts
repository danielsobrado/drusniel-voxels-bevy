declare module "three/tsl" {
  export * from "three/src/Three.TSL.js";

  // @types/three can infer a chained vec3 mix as Node<"float">. The runtime
  // TSL node remains vector-valued, so keep normalize permissive at this API.
  export const normalize: (value: any) => any;
}
