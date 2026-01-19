Performance Analysis and Optimization of the Voxel Game
Overview of the Performance Issue

Even on a high-end PC (e.g. an RTX 4080), the voxel game’s frame rate dips to ~20–30 FPS during normal gameplay (even when the player is idle). This suggests a significant bottleneck in the engine’s usage of Bevy’s ECS and rendering pipeline. Initial world generation is known to be heavy, but here we focus on post-generation performance problems. The likely culprits include an excessive number of rendered entities (draw calls), inefficient updates (e.g. transforms or visibility), and lack of batching/instancing in rendering. Below we analyze potential hotspots and propose both immediate and long-term optimizations.

Rendering Pipeline & ECS Hotspots

Draw Call Overhead: In Bevy, each rendered entity (with its own Mesh and Material) results in a separate draw call. The engine does not automatically batch or instance identical objects into one draw. Thus, if the game is rendering thousands of individual props (voxel blocks, trees, rocks, etc.), the CPU must issue thousands of draw calls per frame – overwhelming the render thread. As one community member noted, “spawning many objects without instancing/batching” is highly suboptimal because “each [object] will need its own setup and drawcall”. Bevy does not currently perform automatic instancing for identical meshes, meaning the onus is on the game to reduce draw call counts.

ECS Scheduling and System Overhead: A large number of entities can also strain Bevy’s ECS scheduling and systems:

Transform propagation: Every frame, Bevy updates entity global transforms if their parent or local transform changed. Newer Bevy versions use change detection and parallelism to make this efficient, but if many entities are moving or have parent-child hierarchies, the transform system can still consume significant CPU time.

Visibility checks: Bevy performs frustum culling each frame for 3D meshes using their Axis-Aligned Bounding Boxes (AABBs). Culling saves GPU work, but it means the CPU iterates over all meshes each frame to determine if they are in view. With tens of thousands of entities, this culling computation itself becomes a bottleneck.

Per-frame systems: Any game-specific systems that run every frame (e.g. updating prop states, AI, physics, or the prop persistence logic) can contribute to frame drops if they iterate over too many entities or do expensive work.

In our case, the low CPU/GPU utilization combined with low FPS indicates the game is likely CPU-bound – spending a lot of time each frame doing book-keeping (ECS scheduling, culling, issuing draw calls) rather than saturating the GPU. This aligns with reports from similar Bevy projects: e.g. ~10,000 simple cubes dragging FPS down because of CPU draw-call overhead, whereas engines with instancing can handle far more. In short, the game is likely rendering too many individual objects and running too many per-entity updates for the CPU to handle efficiently.

Prop Spawning and Transform Updates

Prop Spawning: The “prop” system (which handles environmental objects like foliage, items, etc.) could be causing issues in two ways:

Spawning in Bulk: If a very large number of prop entities are spawned into the world (either all at once after generation, or continuously as the player moves), it can cause frame stutters and memory overhead. Creating thousands of entities is not free – it incurs allocation and setup cost. Ideally, prop spawning should be spread out or done during a loading screen/background thread. The question indicates the big drops are not during initial generation, so the concern is more about ongoing load from having so many props active.

No Despawning/Pooling: If props remain spawned even when far away or not needed, they still contribute to the engine’s workload (e.g. culling checks, transform updates). It’s important that the prop system despawns or deactivates props that are outside the active gameplay area (for example, in chunks far from the player). Otherwise, the engine might be tracking thousands of props that the player can’t even see.

Transform Updates: We should check how often prop or voxel transforms are changing:

Static props (e.g. a tree or rock that just sits there) should ideally not be updated every frame. If there is a system inadvertently modifying or animating them each frame (even a tiny oscillation), that will force the transform propagation system to recalculate and potentially flag them for rendering changes constantly. Ensure that static props are truly static (no Transform change each frame).

Parent-Child hierarchies: If props are attached as children to moving entities, their transforms will update whenever the parent moves. In a voxel game, typically the terrain chunks or world origin might be static, so this may not be an issue. But if, for example, props are all children of a “world” entity that moves or rotates, that would be very costly (since moving the parent forces recomputation of every child transform). It’s better to keep props either un-parented (in world coordinates) or parented only under static groupings (like an immobile chunk).

Parallel transform propagation: Make sure you are on a recent Bevy version, as improvements have been made (e.g. parallelizing transform updates in Bevy 0.11+). This can help utilize multiple CPU cores for large scene graphs.

Inefficient Prop Updates: Beyond transforms, consider if any per-prop logic runs each frame (e.g. checking if a prop should despawn or toggling visibility). Such logic should be minimized or moved to events. For example, instead of every prop checking distance to player each frame, a centralized system could periodically check chunks and enable/disable props in bulk. The goal is to avoid O(n) work every frame over thousands of props.

Entity Count and Scene Instances

High Entity Count: The total number of entities in play (especially renderable entities) is a baseline factor in performance. Each entity has some overhead in the ECS scheduler. If the world has, say, 50,000+ entities (including each voxel, prop, particle, etc.), it can strain the scheduler and caches. Bevy’s EntityCountDiagnosticsPlugin can be used to monitor total entity count at runtime. We should identify how many entities exist and how many are rendered at once. In testing, 20–25k entities visible at once can drop FPS into the teens on current hardware if not optimized.

Scene/Model Instancing: How props are represented might inflate entity counts:

If each prop is loaded as a separate 3D model or scene (e.g. using Bevy’s scene spawning from glTF or GLB files), each such scene may consist of multiple child entities (one per mesh or object in the file). For example, a tree model might have a trunk mesh and dozens of leaf meshes as children. Spawning 100 trees that way could actually spawn several thousand entities (100 * dozens per tree). This dramatically increases draw calls and update overhead.

Optimization: For complex prop models, consider combining meshes in the 3D art stage (e.g. merge the tree’s sub-meshes into one mesh if possible). Or, if you need them separate (for say different materials), consider at least reducing their count (e.g. simplify foliage representation). Another approach is to load the scene once and then clone its entities or re-use the meshes rather than repeatedly parsing the scene file for each prop.

If each voxel is an entity: It sounds like you are using chunked meshing for terrain (since the issue is not during generation). That’s good: one mesh per chunk of voxels is far better than one entity per voxel. Ensure the same principle is applied to props: if there are clusters of identical props, try to group them.

Too Many Separate Meshes: The fundamental issue is that each individual mesh = one draw call. So performance will tank if, for example, the game is trying to draw 10,000 separate objects every frame. Unity or Unreal handle this via built-in instancing and batching, but Bevy requires manual handling. A community example noted 10k cubes in Bevy (each as a separate PBR entity) yielded ~28 FPS on a GTX 1660Ti, whereas with instancing a million cubes could be drawn in Unity at higher FPS. The difference is purely due to instancing/batching. In our game, it’s likely that the combination of many props + perhaps chunk meshes + any other objects pushes the draw count into the thousands, overwhelming the renderer.

Instancing, Batching, and Culling Efficiency

To address the above, we need to leverage instancing, batching, and smarter culling:

GPU Instancing: This is the process of rendering many copies of the same mesh in one draw call by providing an array of transforms (and other per-instance data) to the GPU. Bevy’s renderer will not automatically instance identical meshes for you, so you currently must implement this yourself or via a third-party plugin. There are community solutions: for example, the bevy_instancing prototype or the bevy-aabb-instancing crate for drawing many cubes. One user suggests that using instancing “skyrockets the performance” for large numbers of identical objects. If your game has many repeated props (trees, crates, etc.), instancing those could hugely increase FPS by reducing tens of thousands of draw calls down to a handful.

Example: Instead of spawning 5,000 tree entities, you could maintain a single “tree batch” entity per chunk or per tree type, with a custom shader that draws the tree mesh 5,000 times at all the required positions in one go. This requires writing some shader code or using an existing instancing crate, but the payoff is massive.

Crates: The warbler_grass plugin is an example that renders grass blades with GPU instancing (and wind animation) – it can render huge numbers of grass instances very efficiently by batching them. While grass is a special case, the principle can be applied to any prop. Another crate, bevy_aabb_instancing, is geared towards drawing lots of cubes (AABBs) in one call. These examples show that millions of simple instances per frame are possible if done correctly, versus the current situation of thousands of separate draws.

Engine development: There is an open Bevy issue to add instancing support natively, but until it’s integrated, manual instancing is the way forward for extreme entity counts.

Dynamic Batching: Batching is combining distinct objects into one mesh at runtime. Unlike instancing (which requires objects to share a mesh and material), batching could combine different props that are close together into one draw. Bevy doesn’t do automatic dynamic batching either, so this too would be manual. This is more complex (especially with different materials), so focusing on instancing identical props is usually more practical.

Frustum Culling: Bevy’s built-in frustum culling is already enabled for 3D by default – it uses each mesh’s bounding box to determine if it’s in the camera’s view. Ensure that all your meshes have a correct Aabb (axis-aligned bounding box) set. Usually, when you add a mesh asset to an entity, Bevy sets up its AABB automatically. Culling will ensure off-screen chunks/props aren’t drawing. However, note that culling operates per entity. If you have 20,000 entities, the engine still checks each one every frame (even if they’re off-screen). This can eat CPU. Two ways to improve this:

Spatial partitioning: In the long term, you could partition props by space (octree, quadtree, or chunk-based culling). For example, maintain a structure of chunks that contain props, and only consider culling the props in chunks near the camera. If a chunk is entirely outside the frustum, you could skip iterating its children individually. Implementing this is non-trivial (it essentially means hierarchial culling), but it’s something to consider if entity counts remain high.

Chunk-level culling hack: If props are already organized by chunk, one idea is to have each chunk entity hold all props as children and also have its own bounding volume covering that chunk’s extents. You could then potentially cull whole chunks far away (maybe by controlling the Visibility of the child props when the chunk is out of range). This is somewhat redundant with built-in culling, but the idea is to reduce per-prop checks.

In practice, simply limiting view distance is an effective form of culling. For example, don’t even spawn or keep props beyond a certain distance. Many voxel games use fog or draw distance limits to cap how many objects need to be considered. If your game currently loads an extremely large area around the player with props, consider tightening that radius.

Transform Propagation: Ensure that transform updates are efficient:

If most props are static, the transform system will mostly just verify nothing changed each frame (which is cheap). However, if you have any large moving structures or lots of dynamic objects (perhaps not, since it’s voxel terrain), be aware of their cost. Thousands of moving entities (like animals or physics objects) will stress the transform update and physics systems.

One optimization for largely static scenes: you could disable the built-in transform propagation system and update transforms manually when needed. This is advanced and usually unnecessary with Bevy’s change-detection, but it’s an idea if profiling shows transform_propagate_system taking a lot of time.

Upgrading to the latest Bevy engine version can bring performance improvements here (for instance, Bevy 0.11 introduced parallel transform calculation across threads, which helps with lots of entities).

Debugging and Profiling Tools

To pinpoint the bottlenecks and verify improvements, use Bevy’s diagnostics and external profilers:

Monitoring Entity and Draw Counts: Enable Bevy’s diagnostic plugins to get real-time stats. For example, EntityCountDiagnosticsPlugin will track the total entity count. The FrameTimeDiagnosticsPlugin gives FPS and frame time. You can combine these with LogDiagnosticsPlugin to print to console, or use an on-screen UI (e.g., via bevy_inspector_egui or a simple text system) to display them. In particular, tracking:

Total entities.

Total rendered entities (you can count entities with a Handle<Mesh> and ComputedVisibility that is visible).

Maybe number of draw calls (not directly exposed, but you can infer it from visible entity count if each is one draw).

These diagnostics will let you see, for example, how many props are currently active and how that correlates with FPS.

Counting Visible Props: You can add a system like:

fn count_visible_props(query: Query<&ComputedVisibility, With<PropTag>>) {
    let visible = query.iter().filter(|cv| cv.is_visible()).count();
    info!("Visible props: {}", visible);
}


Run this each frame (or whenever) to log how many prop entities are actually being drawn. If that number is extremely high (e.g. many thousands), it reinforces that draw call count is an issue. You might tie this into the F3 debug overlay so you can see it live in-game.

CPU Profiling (Bevy Tracing): Bevy has built-in support for tracing its schedules and systems. Enabling certain Cargo features will produce a profiling trace you can load into viewer tools:

Run the game with --features bevy/trace_chrome to generate a Chrome tracing .json file. After you exit the game, you’ll find a file (often named trace.json or similar). Open Chrome and go to chrome://tracing (or use the Perfetto trace viewer) and load this file. It will show a timeline of all systems running each frame, how long they took, and on which thread. This is extremely useful: you might discover, for example, that the bevy::render::draw systems are taking most of the frame, or that a custom prop_cleanup_system is unexpectedly heavy.

Alternatively, run with --features bevy/trace_tracy to connect to the Tracy profiler (you’ll need the Tracy client application to view data). Tracy gives live profiling and deep inspection, which can be more interactive.

Ensure you run a release build when profiling performance (cargo run --release ...), because debug builds distort the picture (Bevy in debug is much slower). The traces will be more representative in release mode.

Using these tools, identify which systems are the top consumers of time. Is it the rendering phase? The visibility phase? A game-specific system? This guides your optimization focus.

GPU Profiling (WGPU and RenderDoc): If the CPU side looks fine, you’ll want to see if the GPU is the bottleneck (e.g., too many vertices/pixels).

You can enable WGPU’s built-in GPU trace capture by running with --features wgpu_trace. For example: cargo run --release --features wgpu_trace. The game will generate a wgpu_trace/ directory containing a trace of all GPU commands and pipeline usage. This can be opened with the wgpu tools (or potentially in Chrome trace if converted). Admittedly, interpreting this raw trace is advanced, so if you’re not familiar, a simpler method is the next bullet:

Use RenderDoc (a graphics debugger) to capture a frame of your running game. In RenderDoc, you can inspect every draw call, see how many triangles it rendered, and check GPU timings. This will quickly show if, for instance, you have 5,000 draw calls where you expected 500. It will also show if some draws are particularly heavy (high triangle count or expensive fragment shaders).

With RenderDoc or the WGPU trace, you can also see how uniform buffers and instance buffers are set. For example, if you implement instancing later, you could verify that multiple instances are being drawn in one call.

Shader profiling: If you suspect the GPU is struggling (which on a 4080 is less likely unless you have absurd view distances or expensive effects), check things like fill rate (are you overdrawing with lots of transparent objects like semi-transparent leaves?), shadow map resolution and passes (cascaded shadow maps can multiply the draw cost), and post-processing effects (SSAO, SSR, volumetric fog, etc. can all be expensive). Disabling some effects temporarily can identify if they are a culprit. Given the description (“even when idle”), it sounds more like object count is the problem rather than a specific shader effect.

By combining these profiling approaches, you should be able to isolate whether the bottleneck is rendering too many objects (most likely), inefficient systems (like a runaway prop update loop), or something on the GPU (like fill-rate issues).

For example, if the Chrome trace shows the renderer’s draw preparing systems taking e.g. 25 ms/frame, and RenderDoc shows ~3000 draw calls, then you know draw call count is the issue. If instead the trace shows a game logic system using 20 ms (and draw calls are modest), then that system needs optimization.

Impact of the Prop Persistence System

The prop persistence system is responsible for saving and loading props (and possibly modified voxels) so that changes persist across sessions. This is often implemented by storing changes in a data structure (e.g., a HashMap of modified blocks or a list of placed objects) separate from the base procedural generation. While necessary for gameplay, this system can contribute to performance issues if not designed carefully:

Bulk Spawn/Despawn: When loading a world or moving to a new area, the persistence system might spawn a large number of props that had been saved. If it tries to spawn, say, 5,000 props in one frame as the player enters an area, you’ll get a big frame drop. To mitigate this, spawn props incrementally – spread the work over multiple frames (e.g., spawn 100 props per tick until done) or load them during a loading screen before gameplay. Likewise, if despawning, avoid deleting thousands of entities in one frame (which can also hitch); stagger their removal if possible.

Lifecycle Management: Ensure that when a chunk is unloaded, you actually despawn its props. A bug here could mean props accumulate in memory and in the entity list even when far away. If the game is suffering from “entity leak” where old props persist globally, that would explain low FPS. Use logging or diagnostics to confirm that when you move far from an area, the entity count drops as expected (meaning props were removed). If not, fix the unloading logic in the persistence system.

Non-instanced Props: The persistence system might currently spawn each prop as an independent entity with its own mesh. As discussed, this is costly. In the long run, consider augmenting this system to support instanced prop spawning. For example, instead of: for each saved tree position -> spawn Tree entity with mesh, you could do: group saved tree positions by tree type -> for each type, spawn one batch entity with all positions. The saved data structure could even be adapted to store props in a chunk-wise manner to facilitate this grouping.

Frequency of Saving/Updating: If the persistence system writes to disk or updates a file frequently (say every few seconds or every time a prop moves), that could cause stutters. It’s better to buffer changes and save periodically (or on certain events like pausing or quitting). Writing to disk or serialization should be done on a separate thread if possible so it doesn’t block the main thread.

Collision/Physics: If props have colliders or physics bodies (for example, if every prop rock or tree has a RigidBody), that introduces another performance dimension. A large number of colliders can slow down the physics engine. You might need to turn off physics for far-away props or use simpler bounding volumes. Since the focus here is on frame rendering, I mention this only for completeness – if physics were an issue, you’d likely see high CPU usage even with nothing visible, and the bottleneck would be in the physics step.

Memory Usage: A HashMap of modified voxels or props is fine, but monitor its size. If the player travels a lot and changes many things, the persistent data might grow. This can affect iteration times when the system queries it. Use profiling to ensure any iteration over the persistence data is not happening every frame unnecessarily. Ideally, the persistence data is only accessed on chunk load/unload events, not constantly during gameplay.

In summary, the persistence system should be as passive as possible during runtime: apply changes when chunks load, store changes when events happen, but otherwise not iterate over all stored data every frame. If you find it is doing heavy work each frame, refactor it to be event-driven (e.g., only check when player breaks/places a block or enters a new area).

Recommendations and Optimizations
Short-Term Optimizations

These are relatively quick wins that can improve performance immediately:

Limit Visible Props: Reduce how much content is on-screen or active. For instance, shorten the view distance for props (you can keep far terrain geometry perhaps, but omit small props beyond a distance). This will lower the number of entities the engine must process each frame. It might be acceptable to have distant areas look barren until the player gets closer. This is essentially a LOD (Level of Detail) strategy – simplest form is turning things off at distance.

Disable Costly Effects: Temporarily disable or reduce expensive rendering features to gauge impact. e.g., turn off shadows, or make only the closest few hundred objects cast shadows and mark others cast_shadows = false. Shadow mapping in particular can greatly multiply draw calls (each shadow-casting object is rendered into the shadow map). If your game had all props casting shadows, try disabling shadows on the most numerous props (grass, small rocks) or globally lowering shadow resolution/cascade count. This can yield a quick FPS boost. The visual difference is often negligible for small/distant objects.

Asset Sharing (No Duplicates): Ensure that identical meshes and materials are re-used rather than duplicated in memory. For example, if you spawn 1000 rocks, do something like:

let rock_mesh_handle = asset_server.load("Rock.gltf#Mesh0");
let rock_material_handle = asset_server.load("Rock.gltf#Material0");
for pos in positions {
    commands.spawn(PbrBundle {
       mesh: rock_mesh_handle.clone(), 
       material: rock_material_handle.clone(),
       transform: Transform::from_translation(pos),
       ..Default::default()
    });
}


This way all rocks share one mesh and one material in GPU memory. If instead you were loading or creating a mesh for each, that’s a huge waste. Using Handle::clone_weak() for assets will let you reuse the handle without forcing a new copy. Note that this doesn’t reduce draw calls by itself, but it’s a prerequisite for instancing and ensures the engine can at least group some work. It also reduces asset load stuttering and memory use.

Gradual Loading: If you identify spikes when many props spawn, change the spawning to be gradual. For example, after terrain generation, instead of inserting all props immediately, spread them over a few seconds of frames. This can prevent a big hitch and keep the frame rate more consistent.

Reduce Entity Overhead: If some entities are purely data (no render component, no logic), consider if you can remove them or merge them. For example, if you have empty parent entities just for hierarchy, they might be unnecessary – you could instead encode grouping in a component or resource.

Use Built-in Diagnostics: Keep the LogDiagnosticsPlugin active during testing (it prints FPS, etc., to console). It’s a low-overhead way to notice if some change you made improved things (e.g., you’ll see FPS jump or entity count drop in the logs). Remove it for final release, but for now it’s helpful.

Long-Term Optimizations

These require more effort but will dramatically improve the game’s ability to handle a complex scene:

Implement GPU Instancing for Props: This is the most impactful optimization for rendering many objects. There are a few ways to do it:

Shader Instancing: Write a custom shader/material that takes an array of instance data (such as an Array<Mat4> of transforms or, more practically, use vertex attributes with per-instance stride). Bevy’s example shader_instancing.rs (in the official repo) demonstrates the technique. Essentially, you create a Mesh that’s just one instance of the model, then use the instanced drawing API to render many at once. You would maintain a buffer of transforms (updated when props move or spawn/despawn) and feed it to the GPU. This is complex but yields massive gains.

Community Crates: As mentioned, you could leverage existing solutions. For example, bevy_instancing (a prototype by Shfty) or bevy_aabb_instancing (for cubes) can serve as a starting point. These show how to integrate with Bevy’s render pipeline to issue instanced draws. Another crate bevy_mesh_instancer (if available) might generalize the approach. Since your game likely uses many repeating meshes (voxels and certain prop models), instancing them will cut down the draw calls from N to 1 per mesh type.

Instanced LODs: You can combine instancing with LOD – e.g., far away trees could be drawn as simple billboards via instancing, while near ones are full models. This way, you can still batch them and also simplify their geometry for distance.

Expected result: With instancing, it’s realistic to draw tens of thousands of simple objects at 60+ FPS, even on moderate hardware, because the CPU only issues a few draw calls. The RTX 4080 GPU itself can easily handle millions of triangles, so the key is feeding it efficiently. Instancing does exactly that.

Merge Static Geometry by Chunk: This is an alternative/complement to instancing for static props. You could, during the chunk generation phase, merge all static meshes in a chunk into a single combined mesh (or a few meshes). For example, take all rocks in the chunk and make them one mesh asset (by transforming their vertices to world positions). This way, one entity represents all those rocks. This sacrifices the ability to individually animate or remove a single rock (unless you regenerate the mesh), but it greatly reduces draw calls. Given a voxel game often has mostly static scenery, this trade-off can be worth it. You’d likely do this for terrain decorations that don’t change often.

One approach: when generating a chunk, collect all small prop geometry, and use something like Mesh::extend (if using custom mesh generation) to build one mesh. Assign a single material (or if different materials are needed, group by material into a few meshes). This is similar to how chunk meshing works for voxels, but extended to props.

Be cautious of very large meshes – merging everything into one mega-mesh can actually hurt culling (because one large mesh covering a huge area is always considered visible if the player sees any part of it). So, do this at a reasonable granularity (chunk-size is a good granularity).

Leverage Occlusion Culling / LOD in the future: Beyond frustum culling, future enhancements could involve occlusion culling (not rendering objects hidden behind terrain or other objects) – Bevy doesn’t have this out-of-the-box yet, but you could incorporate simpler methods (e.g., for caves or indoor areas, manually toggle sections off when not visible). Also, as the game evolves, consider adding LOD models: simpler mesh or impostor (billboard) for far props. This reduces GPU vertex workload and can be used in conjunction with instancing (since you’d instance the low-poly or billboard for far distances).

Parallelize Chunk/Prop Updates: If you have any heavy computation (meshing, pathfinding, etc.), ensure it runs on background threads (e.g., via Bevy’s AsyncComputeTaskPool). For instance, procedural mesh generation for chunks can be done asynchronously and then the mesh asset fed back to the main thread. This prevents stalling the main thread. Many voxel engines do this to generate terrain in the background. Since your question is about regular gameplay, I assume chunk generation is already done asynchronously (given “not during initial generation” is fine). But if not, definitely offload that.

Optimize the Prop Persistence Data: Over time, as more props are added, the data structure might slow down if it grows huge. Potential long-term improvements:

Use spatial indexing for props in the persistence layer (so queries like “what props to spawn in this area?” are quick).

If the persistent data (HashMap of modified voxels/props) becomes too large, consider splitting it by regions (so you load/unload subsets as needed).

Ensure saving/loading this data is efficient (binary formats, compression if needed) but these affect loading times more than frame rate.

Engine Updates: Keep an eye on Bevy engine releases and upstream improvements. The Bevy community is actively improving performance (for example, more efficient rendering, better use of ECS for large numbers of entities, etc.). Upgrading from Bevy 0.9 -> 0.10 -> 0.11, etc., has brought gains. In particular, future Bevy versions might introduce automated instancing or improved batching. The open issue on GPU instancing suggests it’s on the roadmap. When that lands, it could transparently improve games like yours (by reducing those thousands of draw calls under the hood).

Validating Improvements

For each change, use the profiling tools to validate the impact:

After implementing instancing or batching, capture a frame in RenderDoc to ensure the draw call count dropped (e.g., “before: 5,000 draws, after: 500 draws”). Check the FPS and frame timings to see the improvement.

Use the Bevy trace to see if the time spent in rendering systems decreased.

Monitor memory and entity count to ensure you’re not leaking entities or consuming excessive RAM (especially if combining meshes, watch out for memory spikes).

Test idle vs moving scenarios: perhaps the idle case was bad, but also test running around (to ensure no new bottleneck appears, like slow chunk loading).

Conclusion

The performance bottlenecks in the current implementation are primarily due to rendering too many individual entities and possibly inefficient per-frame processing of those entities. By focusing on reducing the number of draw calls (through instancing and batching) and cutting down unnecessary work (through effective culling and optimized systems), the game’s frame rate can be greatly improved. On a system as powerful as a 4080, we should expect very high FPS for a mostly static voxel world – achieving that will require grouping rendering work (so the GPU is utilized fully without the CPU becoming the limiter).

In summary, concentrate on drawing fewer things per frame (even if the world contains many objects, draw them in groups) and profile to find any other hotspots. Implement quick fixes like view distance limitation and asset sharing now, and plan for deeper architectural changes like instanced rendering as a longer-term project. With these optimizations, the voxel game will be much better equipped to maintain a smooth frame rate during regular gameplay, delivering a better experience on all hardware tiers.

Sources: Analysis based on Bevy engine behavior and community guidance on performance optimization. Key insights on instancing and batching drawn from Bevy community discussions and StackOverflow advice. Bevy’s default frustum culling and diagnostic features referenced from official documentation. Persistent voxel world design inspired by open-source voxel engine implementations.
