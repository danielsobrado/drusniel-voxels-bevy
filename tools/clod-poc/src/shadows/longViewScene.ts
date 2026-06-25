const STREAMING_LONG_VIEW_SCENES = new Set([
  "infinite-stream-straight",
  "infinite-stream-fast-turn",
  "infinite-stream-far-summary",
  "infinite-stream-slow-builds",
  "infinite-far-shell-straight",
  "infinite-far-shell-fast-turn",
  "infinite-far-shell-mountain-approach",
]);

/** Long-view scenes that use InfiniteFarShell instead of the finite far-shell skirt. */
export function isStreamingLongViewScene(scene: string | null): boolean {
  return scene !== null && STREAMING_LONG_VIEW_SCENES.has(scene);
}
