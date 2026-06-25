export interface ClodCutFreezeState {
  frozen: boolean;
}

export function createCutFreezeState(): ClodCutFreezeState {
  return { frozen: false };
}

export function toggleCutFreeze(state: ClodCutFreezeState): void {
  state.frozen = !state.frozen;
}

export function setCutFreeze(state: ClodCutFreezeState, frozen: boolean): void {
  state.frozen = frozen;
}
