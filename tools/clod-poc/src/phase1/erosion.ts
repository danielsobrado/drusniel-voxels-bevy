export function buildFlowAccumulation(heights: Float32Array, size: number): Float32Array {
  const flow = new Float32Array(size * size);
  for (let z = 1; z < size - 1; z++) {
    const row = z * size;
    for (let x = 1; x < size - 1; x++) {
      const i = row + x;
      const h = heights[i];
      let wet = 0;
      wet += Math.max(0, heights[i - 1] - h);
      wet += Math.max(0, heights[i + 1] - h);
      wet += Math.max(0, heights[i - size] - h);
      wet += Math.max(0, heights[i + size] - h);
      wet += Math.max(0, heights[i - size - 1] - h) * 0.707;
      wet += Math.max(0, heights[i - size + 1] - h) * 0.707;
      wet += Math.max(0, heights[i + size - 1] - h) * 0.707;
      wet += Math.max(0, heights[i + size + 1] - h) * 0.707;
      flow[i] = wet;
    }
  }
  let maxFlow = 0;
  for (let i = 0; i < flow.length; i++) maxFlow = Math.max(maxFlow, flow[i]);
  if (maxFlow > 0) {
    const inv = 1 / maxFlow;
    for (let i = 0; i < flow.length; i++) flow[i] = Math.sqrt(flow[i] * inv);
  }
  return flow;
}
