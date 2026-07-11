import type Node from "three/src/nodes/core/Node.js";
import "three/src/nodes/math/MathNode.js";

declare module "three/src/nodes/math/MathNode.js" {
  interface Normalize {
    // Three.js r184 can infer a chained vector mix as float even though the
    // generated TSL node remains vec3. Preserve the runtime vector contract.
    (value: Node<"float">): Node<"vec3">;
  }
}
