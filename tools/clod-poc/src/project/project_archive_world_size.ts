function validWorldPages(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! > 0;
}

export function resolveProjectArchiveWorldPages(
  startupPages: number,
  configuredPages?: number,
  diagnosticConfiguredPages?: number,
): number {
  if (validWorldPages(configuredPages)) return configuredPages;
  if (validWorldPages(diagnosticConfiguredPages)) return diagnosticConfiguredPages;
  if (validWorldPages(startupPages)) return startupPages;
  throw new Error("project archive world size is invalid");
}
