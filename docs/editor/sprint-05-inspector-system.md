# Sprint 5 — Inspector system

Phase: 2 — Core Editor Workflows

## Goal
Build the right-side inspector as the main property editor.

## Subtasks
- Implement `InspectorPanel`.
- Add inspector routing:
  - `VoxelInspector`
  - `ChunkInspector`
  - `ProtectedAreaInspector`
  - `WaterBodyInspector`
  - `PropInspector`
  - `MaterialInspector`
  - `DebugInspector`
  - `EmptyInspector`
- Add shared inspector components:
  - `InspectorHeader`
  - `InspectorSection`
  - `PropertyRow`
  - `NumericField`
  - `Vector3Field`
  - `EnumSelect`
  - `BooleanToggle`
  - `SliderRow`
  - `ColorField`
  - `RuleMatrix`
- Implement protected-area fields:
  - name
  - kind
  - shape
  - bounds
  - priority
  - lock state
  - color
- Protected-area rule matrix:
  - can mine
  - can place
  - can paint
  - can spawn props
  - can edit water
  - can save modify
- Implement water inspector fields:
  - body kind
  - wave amplitude
  - wave speed
  - wave scale
  - wave count
  - reflection strength
  - Fresnel power
  - distortion strength
  - shallow color
  - deep color
  - clarity
  - murkiness
  - foam enabled
  - shore foam
  - wave crest foam
  - debug view mode
- Implement prop inspector:
  - transform
  - prop type
  - material
  - LOD state
  - billboard mode
  - collision
  - placement rules
  - terrain conform
- Implement chunk inspector:
  - chunk coordinate
  - dirty state
  - mesh mode
  - vertex count
  - triangle count
  - water mesh count
  - rebuild buttons

## Acceptance criteria
- Every selection kind has a useful inspector.
- Forms update Zustand state.
- Invalid fields show validation messages.
- Protected areas and water bodies can be edited with mock data.
