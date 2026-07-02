import { AXIS_X, AXIS_Y, AXIS_Z, INF } from "./hddaConstants.js";

export class HddaSpanStepper {
  readonly cellX: number;
  readonly cellY: number;
  readonly cellZ: number;
  readonly stepX: number;
  readonly stepY: number;
  readonly stepZ: number;
  readonly t: number;
  readonly tMax: number;
  readonly nextX: number;
  readonly nextY: number;
  readonly nextZ: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly spanDim: number;

  private constructor(params: {
    cellX: number;
    cellY: number;
    cellZ: number;
    stepX: number;
    stepY: number;
    stepZ: number;
    t: number;
    tMax: number;
    nextX: number;
    nextY: number;
    nextZ: number;
    deltaX: number;
    deltaY: number;
    deltaZ: number;
    spanDim: number;
  }) {
    this.cellX = params.cellX;
    this.cellY = params.cellY;
    this.cellZ = params.cellZ;
    this.stepX = params.stepX;
    this.stepY = params.stepY;
    this.stepZ = params.stepZ;
    this.t = params.t;
    this.tMax = params.tMax;
    this.nextX = params.nextX;
    this.nextY = params.nextY;
    this.nextZ = params.nextZ;
    this.deltaX = params.deltaX;
    this.deltaY = params.deltaY;
    this.deltaZ = params.deltaZ;
    this.spanDim = params.spanDim;
  }

  static init(params: {
    originX: number;
    originY: number;
    originZ: number;
    dirX: number;
    dirY: number;
    dirZ: number;
    t0: number;
    tMax: number;
    spanDim: number;
    cellSizeM: number;
  }): HddaSpanStepper {
    const spanDim = Math.max(1, Math.floor(params.spanDim));
    const posX = params.originX + params.dirX * params.t0;
    const posY = params.originY + params.dirY * params.t0;
    const posZ = params.originZ + params.dirZ * params.t0;
    const voxelX = voxelIndexForPosition(posX, params.dirX, params.cellSizeM);
    const voxelY = voxelIndexForPosition(posY, params.dirY, params.cellSizeM);
    const voxelZ = voxelIndexForPosition(posZ, params.dirZ, params.cellSizeM);
    const cellX = alignVoxel(voxelX, spanDim);
    const cellY = alignVoxel(voxelY, spanDim);
    const cellZ = alignVoxel(voxelZ, spanDim);
    const stepX = axisStep(params.dirX);
    const stepY = axisStep(params.dirY);
    const stepZ = axisStep(params.dirZ);
    const deltaX = axisDelta(params.dirX, params.cellSizeM);
    const deltaY = axisDelta(params.dirY, params.cellSizeM);
    const deltaZ = axisDelta(params.dirZ, params.cellSizeM);

    return new HddaSpanStepper({
      cellX,
      cellY,
      cellZ,
      stepX,
      stepY,
      stepZ,
      t: params.t0,
      tMax: params.tMax,
      nextX: nextBoundaryT(posX, params.dirX, params.t0, cellX, spanDim, params.cellSizeM),
      nextY: nextBoundaryT(posY, params.dirY, params.t0, cellY, spanDim, params.cellSizeM),
      nextZ: nextBoundaryT(posZ, params.dirZ, params.t0, cellZ, spanDim, params.cellSizeM),
      deltaX,
      deltaY,
      deltaZ,
      spanDim,
    });
  }

  reinitAtT(params: {
    originX: number;
    originY: number;
    originZ: number;
    dirX: number;
    dirY: number;
    dirZ: number;
    t: number;
    spanDim: number;
    cellSizeM: number;
  }): HddaSpanStepper {
    return HddaSpanStepper.init({
      originX: params.originX,
      originY: params.originY,
      originZ: params.originZ,
      dirX: params.dirX,
      dirY: params.dirY,
      dirZ: params.dirZ,
      t0: Math.max(this.t, params.t),
      tMax: this.tMax,
      spanDim: params.spanDim,
      cellSizeM: params.cellSizeM,
    });
  }

  nextAxis(): number {
    if (this.nextX <= this.nextY && this.nextX <= this.nextZ) return AXIS_X;
    if (this.nextY <= this.nextZ) return AXIS_Y;
    return AXIS_Z;
  }

  distanceToNextBoundary(epsilonM: number): number {
    const next = Math.min(this.nextX, this.nextY, this.nextZ, this.tMax);
    if (!Number.isFinite(next)) return Math.max(epsilonM, this.tMax - this.t);
    return Math.max(epsilonM, next - this.t);
  }

  stepSpan(epsilonM: number): HddaSpanStepper {
    const axis = this.nextAxis();
    const nextT = Math.min(this.tMax, Math.max(this.t + epsilonM, axis === AXIS_X ? this.nextX : axis === AXIS_Y ? this.nextY : this.nextZ));
    return new HddaSpanStepper({
      cellX: axis === AXIS_X ? this.cellX + this.spanDim * this.stepX : this.cellX,
      cellY: axis === AXIS_Y ? this.cellY + this.spanDim * this.stepY : this.cellY,
      cellZ: axis === AXIS_Z ? this.cellZ + this.spanDim * this.stepZ : this.cellZ,
      stepX: this.stepX,
      stepY: this.stepY,
      stepZ: this.stepZ,
      t: nextT,
      tMax: this.tMax,
      nextX: axis === AXIS_X ? this.nextX + this.spanDim * this.deltaX : this.nextX,
      nextY: axis === AXIS_Y ? this.nextY + this.spanDim * this.deltaY : this.nextY,
      nextZ: axis === AXIS_Z ? this.nextZ + this.spanDim * this.deltaZ : this.nextZ,
      deltaX: this.deltaX,
      deltaY: this.deltaY,
      deltaZ: this.deltaZ,
      spanDim: this.spanDim,
    });
  }
}

function voxelIndexForPosition(position: number, dir: number, cellSizeM: number): number {
  const scaled = position / cellSizeM;
  if (dir < 0 && Math.abs(scaled - Math.round(scaled)) < 1e-8) {
    return Math.round(scaled) - 1;
  }
  return Math.floor(scaled);
}

function alignVoxel(voxel: number, spanDim: number): number {
  return Math.floor(voxel / spanDim) * spanDim;
}

function axisStep(dir: number): number {
  if (dir > 1e-10) return 1;
  if (dir < -1e-10) return -1;
  return 0;
}

function axisDelta(dir: number, cellSizeM: number): number {
  return Math.abs(dir) > 1e-10 ? cellSizeM / Math.abs(dir) : INF;
}

function nextBoundaryT(
  position: number,
  dir: number,
  t: number,
  cell: number,
  spanDim: number,
  cellSizeM: number,
): number {
  if (Math.abs(dir) <= 1e-10) return INF;
  const boundaryVoxel = dir > 0 ? cell + spanDim : cell;
  const boundary = boundaryVoxel * cellSizeM;
  const result = t + (boundary - position) / dir;
  if (!Number.isFinite(result)) return INF;
  return result <= t ? t + axisDelta(dir, cellSizeM) * spanDim : result;
}
