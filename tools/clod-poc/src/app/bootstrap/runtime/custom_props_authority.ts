export interface DefaultCustomPropsFallbackInput {
  hasImportedProps: boolean;
  hasProjectProps: boolean;
  hasLoadedSavePropAuthority: boolean;
}

export function shouldRestoreDefaultCustomProps(input: DefaultCustomPropsFallbackInput): boolean {
  return !input.hasImportedProps && !input.hasProjectProps && !input.hasLoadedSavePropAuthority;
}

