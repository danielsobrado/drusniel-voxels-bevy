export function withGravelBarFieldSampling(source: string): string {
  const search = `  if (params.counts_a.w != 0u) {
    hydro_fields = hydrology_fields_at(wpos.x, wpos.y);
  }`;
  if (!source.includes(search)) {
    throw new Error("stone gravel-bar field sampling anchor missing");
  }
  return source.replace(
    search,
    `  if (params.counts_a.w != 0u || GRAVEL_BAR_ENABLED) {
    hydro_fields = hydrology_fields_at(wpos.x, wpos.y);
  }`,
  );
}
