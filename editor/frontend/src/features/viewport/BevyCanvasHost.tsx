export function BevyCanvasHost() {
  return (
    <div className="bevy-canvas-host" data-testid="bevy-canvas-host" aria-label="Mocked Bevy canvas host">
      <div className="voxel-sky" />
      <div className="voxel-world">
        {Array.from({ length: 36 }, (_, index) => (
          <span key={index} className={`voxel-block voxel-block-${index % 5}`} />
        ))}
      </div>
      <div className="canvas-reticle" aria-hidden="true" />
      <div className="canvas-label">Mock voxel viewport. Runtime bridge intentionally disabled.</div>
    </div>
  );
}
