export interface PointerLockRequester {
  requestPointerLock(): Promise<void> | void;
}

export async function tryRequestPlayerPointerLock(target: PointerLockRequester): Promise<boolean> {
  try {
    await target.requestPointerLock();
    return true;
  } catch {
    return false;
  }
}
