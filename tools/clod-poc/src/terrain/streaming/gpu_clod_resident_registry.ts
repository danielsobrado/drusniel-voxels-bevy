import {
  destroyGpuClodResidentPage,
  type GpuClodResidentPage,
  type GpuClodResidentPageLease,
} from "./gpu_clod_resident_types.js";

interface RegistryEntry {
  page: GpuClodResidentPage;
  leases: number;
  retired: boolean;
  onFirstAcquire?: () => void;
}

const entries = new Map<string, RegistryEntry>();

export function registerGpuClodResidentPage(
  page: GpuClodResidentPage,
  onFirstAcquire?: () => void,
): void {
  const existing = entries.get(page.id);
  if (existing?.page === page) return;
  if (existing) retireEntry(existing);
  entries.set(page.id, { page, leases: 0, retired: false, onFirstAcquire });
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
  destroyIfUnused(entry);
}

function destroyIfUnused(entry: RegistryEntry): void {
  if (!entry.retired || entry.leases > 0) return;
  destroyGpuClodResidentPage(entry.page);
}
