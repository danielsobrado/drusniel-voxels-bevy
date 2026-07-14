import {
  destroyGpuClodResidentPage,
  type GpuClodResidentPage,
  type GpuClodResidentPageLease,
} from "./gpu_clod_resident_types.js";

interface RegistryEntry {
  page: GpuClodResidentPage;
  leases: number;
  retired: boolean;
  destroyed: boolean;
  onFirstAcquire?: () => void;
  onFinalRelease?: () => void;
  onDestroyed?: () => void;
}

const entries = new Map<string, RegistryEntry>();

export function registerGpuClodResidentPage(
  page: GpuClodResidentPage,
  onFirstAcquire?: () => void,
  onFinalRelease?: () => void,
  onDestroyed?: () => void,
): void {
  const existing = entries.get(page.id);
  if (existing?.page === page) return;
  if (existing) retireEntry(existing);
  entries.set(page.id, {
    page,
    leases: 0,
    retired: false,
    destroyed: false,
    onFirstAcquire,
    onFinalRelease,
    onDestroyed,
  });
}

export function acquireGpuClodResidentPage(
  nodeId: string,
  revision?: number,
): GpuClodResidentPageLease | null {
  const entry = entries.get(nodeId);
  if (!entry || entry.retired) return null;
  if (revision !== undefined && entry.page.revision !== revision) return null;
  entry.leases++;
  const onFirstAcquire = entry.onFirstAcquire;
  entry.onFirstAcquire = undefined;
  onFirstAcquire?.();
  let released = false;
  return {
    page: entry.page,
    release() {
      if (released) return;
      released = true;
      entry.leases = Math.max(0, entry.leases - 1);
      if (entry.leases === 0 && !entry.retired) {
        try {
          entry.onFinalRelease?.();
        } finally {
          destroyIfUnused(entry);
        }
        return;
      }
      destroyIfUnused(entry);
    },
  };
}

export function peekGpuClodResidentPage(
  nodeId: string,
  revision?: number,
): GpuClodResidentPage | null {
  const entry = entries.get(nodeId);
  if (!entry || entry.retired) return null;
  if (revision !== undefined && entry.page.revision !== revision) return null;
  return entry.page;
}

export function isGpuClodResidentPageLeased(
  nodeId: string,
  page?: GpuClodResidentPage,
): boolean {
  const entry = entries.get(nodeId);
  if (!entry || entry.retired || (page && entry.page !== page)) return false;
  return entry.leases > 0;
}

export function retireGpuClodResidentPage(
  nodeId: string,
  page?: GpuClodResidentPage,
): void {
  const entry = entries.get(nodeId);
  if (!entry || (page && entry.page !== page)) return;
  entries.delete(nodeId);
  retireEntry(entry);
}

export function clearGpuClodResidentPages(): void {
  for (const [nodeId, entry] of entries) {
    entries.delete(nodeId);
    retireEntry(entry);
  }
}

function retireEntry(entry: RegistryEntry): void {
  entry.retired = true;
  entry.onFirstAcquire = undefined;
  entry.onFinalRelease = undefined;
  destroyIfUnused(entry);
}

function destroyIfUnused(entry: RegistryEntry): void {
  if (!entry.retired || entry.leases > 0 || entry.destroyed) return;
  entry.destroyed = true;
  const onDestroyed = entry.onDestroyed;
  entry.onDestroyed = undefined;
  try {
    destroyGpuClodResidentPage(entry.page);
  } finally {
    onDestroyed?.();
  }
}
