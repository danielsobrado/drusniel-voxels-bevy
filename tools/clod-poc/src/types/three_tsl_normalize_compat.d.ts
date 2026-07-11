import "three/tsl";

declare module "three/tsl" {
  // Three.js r184 can infer a scalar overload after chained dynamic TSL mix nodes,
  // although the generated node remains vector-valued at runtime.
  export function normalize(value: any): any;
}
