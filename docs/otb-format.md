# OTB Format — Atlas Extensions

This document specifies the **Atlas-extended `items.otb` format**. It is
the source of truth for both the `atlas-otb` crate (used by this editor)
and any server implementation that wants to consume OTBs written by
Atlas Assets Editor — for example, the companion
[**atlas**](https://github.com/atlas-kit/atlas) OT server.

The document is intentionally license-neutral: it describes facts (byte
values, layouts) and may be freely re-implemented from scratch in any
project.

## Overview

OTB is a binary container of nested **nodes**, each with a type byte, a
flag region, and a list of **attributes** (TLV: type, length, value). The
classic TFS format defines attributes 0x10–0x2F. Atlas reserves 0x80
onward for extensions that mirror modern `appearances.dat` fields.

Atlas-compatible OTB readers MUST ignore unknown attributes, so the
extensions are forward-compatible with any TFS-derived server.

## Root version

Root attribute `0x01` (ROOT_ATTR_VERSION) preserves the classic TFS
payload layout — `u32 major`, `u32 minor`, `u32 build`, and a fixed
128-byte `csdVersion` buffer — for a total length of 140 bytes. Atlas
keeps `major`/`minor`/`build` untouched and writes its detection tag
into `csdVersion`:

| Field         | Bytes | Value                              |
|---------------|-------|------------------------------------|
| major         | 4     | _unchanged_                        |
| minor         | 4     | _unchanged_                        |
| build         | 4     | _unchanged_                        |
| **csdVersion**| 128   | ASCII `ATLA` + 124 zero bytes      |

Readers detect Atlas extensions by checking that the first four bytes
of `csdVersion` equal `b"ATLA"`. Classic TFS readers ignore the buffer
contents, so the layout stays binary-compatible — they keep parsing the
file as a normal OTB.

If the tag is absent, the file is a classic OTB and only attributes
0x10–0x2F should be expected.

## Extended item attributes

All Atlas extensions live in the 0x80–0x9F range. Stability promise: byte
assignments below are stable and will not be reordered. New attributes
will only be appended.

### Combat

| Byte | Name              | Value type | Description                                           |
|------|-------------------|------------|-------------------------------------------------------|
| 0x80 | `WEAPONTYPE`      | `u8`       | Mapped from `WEAPON_TYPE` enum (see proto).           |
| 0x81 | `MINIMUMLEVEL`    | `u32`      | Required level to equip.                              |
| 0x82 | `VOCATIONS`       | `u8 + u8[n]` | Length prefix, then list of `VOCATION` enum values. |
| 0x88 | `DUALWIELDING`    | `u8` (0/1) | Whether the item supports dual wielding.              |

### Imbue / gems / proficiency

| Byte | Name              | Value type | Description                                           |
|------|-------------------|------------|-------------------------------------------------------|
| 0x83 | `IMBUEMENTSLOTS`  | `u8`       | Number of imbuement slots (0 means none).             |
| 0x84 | `GEMQUALITYID`    | `u16`      | Skill-wheel gem quality identifier.                   |
| 0x85 | `GEMVOCATIONID`   | `u16`      | Vocation identifier for the gem.                      |
| 0x86 | `PROFICIENCYID`   | `u16`      | Proficiency system identifier.                        |

### Cyclopedia / decay / transform

| Byte | Name                | Value type | Description                                         |
|------|---------------------|------------|-----------------------------------------------------|
| 0x87 | `CYCLOPEDIATYPE`    | `u16`      | Cyclopedia categorization id.                       |
| 0x89 | `EXPIREFLAGS`       | `u8`       | Bitfield: `wearout=1`, `clockExpire=2`, `expire=4`, `expireStop=8`. |
| 0x8A | `FORMEROBJECTTYPEID`| `u16`      | Item this one transforms back to on expire.         |

### Visual / hook

| Byte | Name             | Value type | Description                                          |
|------|------------------|------------|------------------------------------------------------|
| 0x8B | `HOOKDIRECTION`  | `u8`       | `HOOK_TYPE` enum (`SOUTH=1`, `EAST=2`).              |

## Mapping to `appearances.dat`

For every Atlas extension above there is a corresponding field in
[`appearances.proto`](../crates/atlas-appearances/proto/appearances.proto)
(see `AppearanceFlags`). The editor populates these attributes when
syncing OTB ← appearances, and reads them back identically when loading.

| OTB byte | proto field                       |
|----------|-----------------------------------|
| 0x80     | `AppearanceFlags.weapon_type`     |
| 0x81     | `AppearanceFlags.minimum_level`   |
| 0x82     | `AppearanceFlags.restrict_to_vocation` |
| 0x83     | `AppearanceFlags.imbueable.slot_count` |
| 0x84     | `AppearanceFlags.skillwheel_gem.gem_quality_id` |
| 0x85     | `AppearanceFlags.skillwheel_gem.vocation_id` |
| 0x86     | `AppearanceFlags.proficiency.proficiency_id` |
| 0x87     | `AppearanceFlags.cyclopediaitem.cyclopedia_type` |
| 0x88     | `AppearanceFlags.dual_wielding`   |
| 0x89     | `AppearanceFlags.{wearout, clockexpire, expire, expirestop}` |
| 0x8A     | `AppearanceFlags.changedtoexpire.former_object_typeid` |
| 0x8B     | `AppearanceFlags.hook.direction`  |

## Backwards compatibility

A classic TFS server reading an Atlas-extended OTB will:

- See the new version magic but ignore the `csdVersion` value.
- Skip every 0x80+ attribute via the standard "unknown attribute" branch.
- Operate identically to before.

This means servers can opt into Atlas extensions at their own pace
without breaking existing deployments.
