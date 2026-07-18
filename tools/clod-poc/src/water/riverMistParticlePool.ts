export interface RiverMistParticleSpawn {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly lifeS: number;
  readonly strength: number;
}

export class RiverMistParticlePool {
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly strength: Float32Array;
  private countValue = 0;
  private overwriteCursor = 0;

  constructor(readonly capacity: number) {
    const size = Math.max(0, Math.floor(capacity));
    this.x = new Float32Array(size);
    this.y = new Float32Array(size);
    this.z = new Float32Array(size);
    this.vx = new Float32Array(size);
    this.vy = new Float32Array(size);
    this.vz = new Float32Array(size);
    this.age = new Float32Array(size);
    this.life = new Float32Array(size);
    this.strength = new Float32Array(size);
  }

  get count(): number {
    return this.countValue;
  }

  clear(): void {
    this.countValue = 0;
    this.overwriteCursor = 0;
  }

  spawn(particle: RiverMistParticleSpawn): void {
    if (this.capacity <= 0 || !validSpawn(particle)) return;
    const index = this.countValue < this.capacity
      ? this.countValue++
      : this.nextOverwriteIndex();
    this.x[index] = particle.x;
    this.y[index] = particle.y;
    this.z[index] = particle.z;
    this.vx[index] = particle.vx;
    this.vy[index] = particle.vy;
    this.vz[index] = particle.vz;
    this.age[index] = 0;
    this.life[index] = particle.lifeS;
    this.strength[index] = particle.strength;
  }

  advance(deltaSeconds: number): void {
    if (!(deltaSeconds > 0) || !Number.isFinite(deltaSeconds)) return;
    let write = 0;
    for (let read = 0; read < this.countValue; read += 1) {
      const nextAge = this.age[read]! + deltaSeconds;
      if (nextAge >= this.life[read]!) continue;
      this.x[read] += this.vx[read]! * deltaSeconds;
      this.y[read] += this.vy[read]! * deltaSeconds;
      this.z[read] += this.vz[read]! * deltaSeconds;
      this.age[read] = nextAge;
      if (write !== read) this.copy(read, write);
      write += 1;
    }
    this.countValue = write;
    this.overwriteCursor = this.countValue > 0 ? this.overwriteCursor % this.countValue : 0;
  }

  write(
    positions: Float32Array,
    colors: Float32Array,
    color: readonly [number, number, number],
  ): number {
    const count = Math.min(this.countValue, Math.floor(positions.length / 3), Math.floor(colors.length / 3));
    for (let index = 0; index < count; index += 1) {
      const life = Math.max(0.001, this.life[index]!);
      const normalizedAge = clamp01(this.age[index]! / life);
      const fadeIn = smooth01(Math.min(1, normalizedAge / 0.16));
      const fadeOut = 1 - smooth01(Math.max(0, (normalizedAge - 0.48) / 0.52));
      const brightness = fadeIn * fadeOut * clamp01(this.strength[index]!);
      const offset = index * 3;
      positions[offset] = this.x[index]!;
      positions[offset + 1] = this.y[index]!;
      positions[offset + 2] = this.z[index]!;
      colors[offset] = color[0] * brightness;
      colors[offset + 1] = color[1] * brightness;
      colors[offset + 2] = color[2] * brightness;
    }
    return count;
  }

  private nextOverwriteIndex(): number {
    const index = this.overwriteCursor;
    this.overwriteCursor = (this.overwriteCursor + 1) % this.capacity;
    return index;
  }

  private copy(read: number, write: number): void {
    this.x[write] = this.x[read]!;
    this.y[write] = this.y[read]!;
    this.z[write] = this.z[read]!;
    this.vx[write] = this.vx[read]!;
    this.vy[write] = this.vy[read]!;
    this.vz[write] = this.vz[read]!;
    this.age[write] = this.age[read]!;
    this.life[write] = this.life[read]!;
    this.strength[write] = this.strength[read]!;
  }
}

function validSpawn(particle: RiverMistParticleSpawn): boolean {
  return Number.isFinite(particle.x)
    && Number.isFinite(particle.y)
    && Number.isFinite(particle.z)
    && Number.isFinite(particle.vx)
    && Number.isFinite(particle.vy)
    && Number.isFinite(particle.vz)
    && Number.isFinite(particle.lifeS)
    && particle.lifeS > 0
    && Number.isFinite(particle.strength)
    && particle.strength > 0;
}

function smooth01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
