# Phase 7 — Sprite editor TODOs

The current build can **read** sprite sheets and **edit attributes** but
not yet **create or modify sprites**. This document captures what needs
to land for Phase 7 to be considered done. Each item is sized to be
independently shippable — there is no global blocker between them.

## 1. Sprite sheet writer

**Where:** `crates/atlas-sprites/src/writer.rs` (new file).

The reader assumes the modern Tibia 12+ layout: a 32-byte header
followed by raw BGRA pixel data for a 384×384 sheet. The writer needs
to:

- Allocate a new sheet for a given `spritetype`.
- Pack input RGBA sprites into the sheet at the correct tile positions.
- Re-emit the 32-byte header. The exact contents of those bytes are not
  documented anywhere we control; a clean-room investigation against
  the official client is the first step.
- LZMA-compress the output.
- Update `catalog-content.json` to reference the new sheet's file name
  and id range.

## 2. PNG → sprite import

**Where:** new Tauri command + UI affordance in `AttributeEditor`.

Flow:
1. User clicks "Import sprite" on a selected appearance.
2. Tauri command takes the chosen PNG path, decodes it, resizes/crops
   to one of the supported tile sizes (32×32 / 32×64 / 64×32 / 64×64).
3. Atlas writer allocates a new sprite id in an existing sheet that
   matches the dimensions and has free slots; if none, allocate a new
   sheet.
4. Append the id to the appearance's `sprite_ids` list.

## 3. Sprite cut tool

**Where:** new `SpriteCanvas` component + canvas-based interactions.

For users who want to slice a larger PNG into multiple sprite tiles:
- Render the source PNG on an HTML canvas.
- Draw a draggable grid overlay sized to the chosen sprite type.
- Let the user pick which cells to keep; produce N sprite ids in order.

## 4. Animation editor

**Where:** new section in `AttributeEditor` for animated objects.

The proto model has `SpriteAnimation { sprite_phase: [{ duration_min,
duration_max }] }` per `FrameGroup`. The current neutral model flattens
frame groups, so the writer-side animation data is lost. Phase 7 needs
to either:
- Stop flattening, and surface frame groups to the editor; or
- Keep flattening but preserve the source `proto::Appearance` alongside
  the neutral view and reapply animation metadata on save.

UI: a strip of mini sprite previews with per-frame min/max duration
inputs, plus a loop type select (PingPong / Infinite / Counted).

## 5. Sheet management

**Where:** new dedicated screen, probably its own tab or modal.

Today the sprite atlas is opaque: you can read sprites by id but not
see which sheet they live in, repack sheets, or move sprites between
sheets. Phase 7 should expose:
- Sheet inventory (id ranges, fill rate, dimensions).
- Move sprite id X to sheet Y (with id reassignment).
- Compact sheet Z (remove unused tiles).

## 6. Outfit/effect/missile editing parity

The attribute editor currently only surfaces appearance flags relevant
for objects. Outfits have their own concerns (frame groups for idle vs.
moving, addon layers, mounted variants). Effects and missiles have
animation timings. These need either dedicated editor sections or a
schema-driven generic editor that adapts to the appearance's category.

## 7. Round-trip preservation

A few v0 shortcuts will need revisiting before sprite editing is safe:

- Frame group metadata (animation timings, bounding boxes, pattern
  dimensions, opacity flag) is dropped on the way through the neutral
  model. Saving currently collapses everything into a single anonymous
  group.
- Unknown OTB attribute bytes are dropped on read. The model needs a
  "raw extras" pocket per item to round-trip future server attributes.
- Recent files persistence assumes ASCII paths; verify on machines
  with non-Latin user directory names.

## 8. Performance

For very large catalogs (~100k objects), the current eager `list_*`
pull becomes slow. Worth measuring before optimizing, but likely
candidates:
- Paginate `list_appearances`.
- Stream sheet decompression on a worker thread instead of blocking
  the IPC reply.
- Cap the undo history at fewer snapshots and use a diff-based history
  format instead of full `Workspace` clones.
