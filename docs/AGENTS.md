# Markdown Organization Policy for docs/

This file defines conventions for markdown in `docs/` to keep documentation and
investigations easy to find and harder to drift.

## 1) Folder-by-topic structure

- Keep broad topic folders (`rendering`, `physics`, `editor`, `lod`, `building`,
  etc.).
- Place new files in the most specific topic folder (`docs/rendering/naadf/...`,
  `docs/lod/...`) rather than the `docs/` root.

## 2) Naming conventions

- Use kebab-case file names.
- Prefer descriptive names by area and intent (for example
  `path-a-contact-shadows-and-ao.md` rather than generic abbreviations).
- Avoid ad-hoc root-level files for ongoing work unless they are globally shared.

## 3) Lifecycle state tags

- Active documentation belongs in the normal topic folder with no suffix.
- WIP/investigative content should include `-investigation` or `-review` in the file name.
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
