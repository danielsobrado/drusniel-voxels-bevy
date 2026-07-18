# Markdown Organization Policy for docs/

Document status (2026-05-17): current index/reference.

This file defines conventions for markdown in `docs/` to keep documentation and
investigations easy to find and harder to drift.

## 1) Folder-by-topic structure

- Keep broad topic folders (`rendering`, `physics`, `editor`, `lod`, `building`,
  etc.).
- Place new files in the most specific topic folder (`docs/rendering/naadf/...`,
  `docs/lod/...`) rather than the `docs/` root.

## 2) Naming conventions

- Use lowercase kebab-case file names. `README.md` is the only docs/index exception.
- Prefer descriptive names by area and intent (for example
  `path-a-contact-shadows-and-ao.md` rather than generic abbreviations).
- Avoid ad-hoc root-level files for ongoing work unless they are globally shared.

## 3) Lifecycle state tags

- Every committed markdown file in `docs/` should declare a lifecycle status near the top.
- Active documentation belongs in the normal topic folder with no suffix.
- Temporary or investigative content should include `-investigation` or `-review` in the file name and a lifecycle note at the top.
- Completed temporary notes should be moved to `docs/archive/` (create if needed).
- Long-lived references should be consolidated behind topic indexes (for example
  `docs/rendering/README.md`, `docs/lod/README.md`).

## 4) Stable anchors and discoverability

- New or updated major docs should be linked from the relevant topic README.
- Keep root `docs/README.md` as a curated entry list; avoid overloading it with
  one-off artifacts.
- When a section moves, leave a short note in the source and link to the new
  location from the old topic if both versions must coexist briefly.

## 5) Temporary and generated markdown

- Mark temporary investigation notes with clear headers (`Status: temporary`,
  explicit expected cleanup date, and owner).
- Do not commit generated runtime/debug logs.
- Keep binary artifacts and debug dumps out of docs unless they are intentionally
  attached as references under an archive or run-output path.

"Do not consider backward compatibility.Ignore legacy code/libraries"
