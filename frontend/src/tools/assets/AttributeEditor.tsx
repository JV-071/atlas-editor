import { useMemo, useState } from "react";
import { Download, HelpCircle } from "lucide-react";

import { ExportDialog } from "./ExportDialog";
import { useWorkspace } from "./store";
import {
  HOOK_DIRECTIONS,
  ITEM_CATEGORIES,
  PLAYER_ACTIONS,
  VOCATIONS,
  WEAPON_TYPES,
  readAssetId,
  type AppearanceFlagsDto,
  type AppearanceInfoDto,
  type HookDirection,
  type ItemCategoryEnum,
  type PlayerAction,
  type Vocation,
  type WeaponType,
} from "./types";
import { CATEGORY_META } from "./Tabs";
import { SpritePreview } from "./SpritePreview";
import { cn } from "../../shared/utils";
import { useT } from "../../i18n";

// ---- flag descriptions ----

const FLAG_DESCRIPTIONS: Record<string, string> = {
  container: "Item can hold other items inside (bags, backpacks, chests)",
  cumulative: "Item is stackable (gold coins, arrows, runes)",
  usable: "Item can be used via right-click \"Use\" (food, potions)",
  forceuse: "Item is used by clicking on it directly (levers, doors)",
  multiuse: "Item can be used with a crosshair on another target (ropes, shovels)",
  take: "Item can be picked up and moved to inventory",
  rotate: "Item can be rotated (furniture, decoration)",
  hang: "Item can be placed on a wall hook",
  wrap: "Item can be wrapped into a package",
  unwrap: "Item can be unwrapped from a package",
  liquidcontainer: "Item can hold liquids (troughs, vials)",
  liquidpool: "Item is a liquid splash on the ground (blood, water)",
  show_off_socket: "Item can be placed in a show-off socket (podiums)",
  reportable: "Item can be reported for rule violations",
  ignore_look: "\"Look\" action is suppressed for this item",
  deco_item_kit: "Item is a decoration kit that unpacks into furniture",
  unpass: "Item blocks creature movement (walls, fences)",
  unmove: "Item cannot be moved by players",
  unsight: "Item blocks projectile line-of-sight",
  avoid: "Pathfinder avoids this tile when possible",
  no_movement_animation: "Suppress walk animation when stepping on this tile",
  clip: "Item is drawn below the ground border (cave floors)",
  bottom: "Item is drawn on the bottom layer of the stack",
  top: "Item is drawn on the top layer of the stack (roofs, ceilings)",
  fullbank: "Item occupies the full tile ground slot",
  topeffect: "Item renders above creatures (tree tops, overhead arches)",
  lying_object: "Item lies flat on the ground (books on floor, papers)",
  translucent: "Item is rendered semi-transparent",
  dont_hide: "Item is never hidden by the auto-hide logic for top items",
  animate_always: "Animation plays continuously, not only when on-screen",
  corpse: "Item is a creature corpse (lootable body)",
  player_corpse: "Item is a player's dead body",
  wearout: "Item degrades with use until it expires",
  clockexpire: "Item expires after a real-time duration",
  expire: "Item expires after a certain server tick count",
  expirestop: "Expiration timer pauses when not in use",
  reverse_addons_south: "Render addon sprites in reverse order facing south",
  reverse_addons_east: "Render addon sprites in reverse order facing east",
  reverse_addons_north: "Render addon sprites in reverse order facing north",
  reverse_addons_west: "Render addon sprites in reverse order facing west",
  weapon_type: "The weapon class (sword, axe, club, bow, etc.)",
  minimum_level: "Minimum character level required to equip",
  dual_wielding: "Item can be wielded in the off-hand simultaneously",
  ammo: "Item is ammunition (arrows, bolts, throwing stars)",
  restrict_to_vocation: "Restrict usage to specific vocations",
  name: "Display name shown in-game on \"Look\"",
  description: "Longer description shown in cyclopedia or inspect",
  brightness: "Light radius intensity (0 = off, 10 = max)",
  color: "Light color index from the Tibia palette (0–215)",
  x: "Horizontal pixel offset for draw position",
  y: "Vertical pixel offset for draw position",
  elevation: "Visual height offset in pixels (makes items appear raised)",
  slot: "Equipment slot number (head, body, legs, etc.)",
  direction: "Which wall side the hook attaches to",
  action: "Default action when player clicks this item",
  category: "Market category for the trade/auction house",
  trade_as_object_id: "Object ID used for trade matching in the market",
  show_as_object_id: "Object ID whose sprite is shown in market listings",
  slot_count: "Number of imbument slots available",
  waypoints: "Pathfinding cost / waypoint weight for bank tiles",
  max_text_length: "Max characters writable on this item",
  max_text_length_once: "Max characters writable (one-time only, then read-only)",
  former_object_typeid: "Object ID this item reverts to when it expires",
  cyclopedia_type: "Cyclopedia classification type ID",
  upgrade_classification: "Tier classification level (0–4) for forge upgrades",
  gem_quality_id: "Skill wheel gem quality tier",
  vocation_id: "Vocation ID the gem is locked to",
  proficiency_id: "Proficiency skill identifier",
};

// ---- common controls ----

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-atlas-border bg-atlas-paper/50 overflow-hidden">
      <h3 className="text-xs uppercase tracking-wider text-atlas-muted font-semibold px-4 py-2 bg-atlas-sand/40 border-b border-atlas-border">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const desc = FLAG_DESCRIPTIONS[label];
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-1 text-atlas-ink-soft truncate">
        {desc && (
          <span className="relative shrink-0 flex group/tip">
            <HelpCircle className="h-3.5 w-3.5 text-atlas-muted/60 hover:text-atlas-ink cursor-help" />
            <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 z-30 w-max max-w-[220px] rounded bg-atlas-ink px-2 py-1 text-[11px] leading-tight text-atlas-cream shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity">
              {desc}
            </span>
          </span>
        )}
        {label}
      </span>
      <div className="flex-1 max-w-[160px]">{children}</div>
    </label>
  );
}

function TextInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => {
        const v = e.target.value;
        const next = v.length === 0 ? null : v;
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-full px-2 py-1 rounded border border-atlas-border bg-atlas-cream text-sm text-atlas-ink focus:outline-none focus:border-atlas-ink"
    />
  );
}

function NumberInput({
  value,
  onCommit,
  min,
  max,
  nullable = true,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  min?: number;
  max?: number;
  nullable?: boolean;
}) {
  return (
    <input
      type="number"
      defaultValue={value ?? ""}
      min={min}
      max={max}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") {
          if (nullable && value !== null) onCommit(null);
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="w-full px-2 py-1 rounded border border-atlas-border bg-atlas-cream text-sm text-atlas-ink tabular-nums focus:outline-none focus:border-atlas-ink"
    />
  );
}

function Toggle({
  value,
  onCommit,
}: {
  value: boolean;
  onCommit: (v: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onCommit(e.target.checked)}
      className="h-4 w-4 accent-atlas-ink cursor-pointer"
    />
  );
}

function Select<T extends string>({
  value,
  options,
  onCommit,
  nullable = true,
}: {
  value: T | null;
  options: readonly T[];
  onCommit: (v: T | null) => void;
  nullable?: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") {
          if (nullable) onCommit(null);
        } else {
          onCommit(v as T);
        }
      }}
      className="w-full px-2 py-1 rounded border border-atlas-border bg-atlas-cream text-sm text-atlas-ink focus:outline-none focus:border-atlas-ink"
    >
      {nullable && <option value="">—</option>}
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

function VocationPicker({
  value,
  onCommit,
}: {
  value: Vocation[];
  onCommit: (v: Vocation[]) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {VOCATIONS.map((voc) => {
        const isOn = value.includes(voc);
        return (
          <button
            key={voc}
            type="button"
            onClick={() => {
              const next = isOn ? value.filter((v) => v !== voc) : [...value, voc];
              onCommit(next);
            }}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
              isOn
                ? "bg-atlas-ink text-atlas-cream border-atlas-ink"
                : "bg-atlas-cream text-atlas-muted border-atlas-border hover:text-atlas-ink",
            )}
          >
            {voc}
          </button>
        );
      })}
    </div>
  );
}

/// Renders a list of boolean flag toggles in a 2-column grid, sourced
/// from `(label, dtoKey, fieldPath)` triples. Triples decouple the
/// frontend's camelCase DTO key from the backend's snake_case field
/// path so renames stay localized to this table.
function FlagGrid({
  flags,
  fields,
  onUpdate,
}: {
  flags: AppearanceFlagsDto;
  fields: ReadonlyArray<[label: string, dtoKey: keyof AppearanceFlagsDto, fieldPath: string]>;
  onUpdate: (field: string, value: unknown) => void;
}) {
  return (
    <>
      {fields.map(([label, dtoKey, fieldPath]) => (
        <Field key={String(dtoKey)} label={label}>
          <Toggle
            value={Boolean(flags[dtoKey])}
            onCommit={(v) => onUpdate(`flags.${fieldPath}`, v)}
          />
        </Field>
      ))}
    </>
  );
}

/// Generic "enable composite, then edit its scalars" widget. Toggling
/// the section header off sends `null` to the field path (clearing the
/// proto sub-message); toggling it on installs the supplied default
/// composite. Children render the inner field editors only when the
/// composite is present.
function CompositeSection({
  title,
  present,
  onToggle,
  defaultValue,
  children,
}: {
  title: string;
  present: boolean;
  onToggle: (value: unknown) => void;
  defaultValue: unknown;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-atlas-border bg-atlas-paper/50 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-atlas-sand/40 border-b border-atlas-border">
        <input
          type="checkbox"
          checked={present}
          onChange={(e) => onToggle(e.target.checked ? defaultValue : null)}
          className="h-4 w-4 accent-atlas-ink cursor-pointer"
        />
        <h3 className="text-xs uppercase tracking-wider text-atlas-muted font-semibold">
          {title}
        </h3>
      </div>
      {present && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3">{children}</div>
      )}
    </section>
  );
}

// ---- flag groupings (label, dtoKey, fieldPath) ----

const BEHAVIOR_FLAGS: ReadonlyArray<
  [string, keyof AppearanceFlagsDto, string]
> = [
  ["container", "container", "container"],
  ["cumulative", "cumulative", "cumulative"],
  ["usable", "usable", "usable"],
  ["forceuse", "forceuse", "forceuse"],
  ["multiuse", "multiuse", "multiuse"],
  ["take", "take", "take"],
  ["rotate", "rotate", "rotate"],
  ["hang", "hang", "hang"],
  ["wrap", "wrap", "wrap"],
  ["unwrap", "unwrap", "unwrap"],
  ["liquidcontainer", "liquidcontainer", "liquidcontainer"],
  ["liquidpool", "liquidpool", "liquidpool"],
  ["show_off_socket", "showOffSocket", "show_off_socket"],
  ["reportable", "reportable", "reportable"],
  ["ignore_look", "ignoreLook", "ignore_look"],
  ["deco_item_kit", "decoItemKit", "deco_item_kit"],
];

const MOVEMENT_FLAGS: ReadonlyArray<
  [string, keyof AppearanceFlagsDto, string]
> = [
  ["unpass", "unpass", "unpass"],
  ["unmove", "unmove", "unmove"],
  ["unsight", "unsight", "unsight"],
  ["avoid", "avoid", "avoid"],
  ["no_movement_animation", "noMovementAnimation", "no_movement_animation"],
];

const STACK_FLAGS: ReadonlyArray<
  [string, keyof AppearanceFlagsDto, string]
> = [
  ["clip", "clip", "clip"],
  ["bottom", "bottom", "bottom"],
  ["top", "top", "top"],
  ["fullbank", "fullbank", "fullbank"],
  ["topeffect", "topeffect", "topeffect"],
  ["lying_object", "lyingObject", "lying_object"],
  ["translucent", "translucent", "translucent"],
  ["dont_hide", "dontHide", "dont_hide"],
  ["animate_always", "animateAlways", "animate_always"],
];

const CORPSE_FLAGS: ReadonlyArray<
  [string, keyof AppearanceFlagsDto, string]
> = [
  ["corpse", "corpse", "corpse"],
  ["player_corpse", "playerCorpse", "player_corpse"],
];

const EXPIRATION_FLAGS: ReadonlyArray<
  [string, keyof AppearanceFlagsDto, string]
> = [
  ["wearout", "wearout", "wearout"],
  ["clockexpire", "clockexpire", "clockexpire"],
  ["expire", "expire", "expire"],
  ["expirestop", "expirestop", "expirestop"],
];

const REVERSE_ADDONS_FLAGS: ReadonlyArray<
  [string, keyof AppearanceFlagsDto, string]
> = [
  ["reverse_addons_south", "reverseAddonsSouth", "reverse_addons_south"],
  ["reverse_addons_east", "reverseAddonsEast", "reverse_addons_east"],
  ["reverse_addons_north", "reverseAddonsNorth", "reverse_addons_north"],
  ["reverse_addons_west", "reverseAddonsWest", "reverse_addons_west"],
];

// ---- section renderers ----

function AppearanceSection({ appearance }: { appearance: AppearanceInfoDto }) {
  const update = useWorkspace((s) => s.updateAppearanceField);
  const flags: AppearanceFlagsDto = appearance.flags;
  const t = useT();

  const onUpdate = (field: string, value: unknown) => {
    void update(field, value);
  };

  return (
    <div className="space-y-4">
      <Section title={t("attr.section.identity")}>
        <Field label="name">
          <TextInput
            value={appearance.name}
            onCommit={(v) => onUpdate("name", v)}
          />
        </Field>
        <Field label="description">
          <TextInput
            value={appearance.description}
            onCommit={(v) => onUpdate("description", v)}
          />
        </Field>
      </Section>

      <Section title={t("attr.section.behavior")}>
        <FlagGrid flags={flags} fields={BEHAVIOR_FLAGS} onUpdate={onUpdate} />
      </Section>

      <Section title={t("attr.section.movement")}>
        <FlagGrid flags={flags} fields={MOVEMENT_FLAGS} onUpdate={onUpdate} />
      </Section>

      <Section title={t("attr.section.stack")}>
        <FlagGrid flags={flags} fields={STACK_FLAGS} onUpdate={onUpdate} />
      </Section>

      <Section title={t("attr.section.corpse")}>
        <FlagGrid flags={flags} fields={CORPSE_FLAGS} onUpdate={onUpdate} />
      </Section>

      <Section title={t("attr.section.expiration")}>
        <FlagGrid flags={flags} fields={EXPIRATION_FLAGS} onUpdate={onUpdate} />
      </Section>

      <Section title={t("attr.section.reverseAddons")}>
        <FlagGrid
          flags={flags}
          fields={REVERSE_ADDONS_FLAGS}
          onUpdate={onUpdate}
        />
      </Section>

      <Section title={t("attr.section.combat")}>
        <Field label="weapon_type">
          <Select<WeaponType>
            value={flags.weaponType}
            options={WEAPON_TYPES}
            onCommit={(v) => onUpdate("flags.weapon_type", v)}
          />
        </Field>
        <Field label="minimum_level">
          <NumberInput
            value={flags.minimumLevel}
            min={0}
            onCommit={(v) => onUpdate("flags.minimum_level", v)}
          />
        </Field>
        <Field label="dual_wielding">
          <Toggle
            value={flags.dualWielding}
            onCommit={(v) => onUpdate("flags.dual_wielding", v)}
          />
        </Field>
        <Field label="ammo">
          <Toggle
            value={flags.ammo}
            onCommit={(v) => onUpdate("flags.ammo", v)}
          />
        </Field>
        <label className="col-span-2 flex items-center gap-3 text-sm">
          <span className="text-atlas-ink-soft shrink-0">restrict_to_vocation</span>
          <VocationPicker
            value={flags.restrictToVocation}
            onCommit={(v) => onUpdate("flags.restrict_to_vocation", v)}
          />
        </label>
      </Section>

      <CompositeSection
        title={t("attr.section.light")}
        present={flags.light != null}
        onToggle={(v) => onUpdate("flags.light", v)}
        defaultValue={{ brightness: 0, color: 0 }}
      >
        <Field label="brightness">
          <NumberInput
            value={flags.light?.brightness ?? null}
            min={0}
            max={10}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.light", {
                brightness: v ?? 0,
                color: flags.light?.color ?? 0,
              })
            }
          />
        </Field>
        <Field label="color">
          <NumberInput
            value={flags.light?.color ?? null}
            min={0}
            max={215}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.light", {
                brightness: flags.light?.brightness ?? 0,
                color: v ?? 0,
              })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.shift")}
        present={flags.shift != null}
        onToggle={(v) => onUpdate("flags.shift", v)}
        defaultValue={{ x: 0, y: 0 }}
      >
        <Field label="x">
          <NumberInput
            value={flags.shift?.x ?? null}
            min={0}
            max={32}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.shift", { x: v ?? 0, y: flags.shift?.y ?? 0 })
            }
          />
        </Field>
        <Field label="y">
          <NumberInput
            value={flags.shift?.y ?? null}
            min={0}
            max={32}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.shift", { x: flags.shift?.x ?? 0, y: v ?? 0 })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.height")}
        present={flags.height != null}
        onToggle={(v) => onUpdate("flags.height", v)}
        defaultValue={{ elevation: 0 }}
      >
        <Field label="elevation">
          <NumberInput
            value={flags.height?.elevation ?? null}
            min={0}
            max={32}
            nullable={false}
            onCommit={(v) => onUpdate("flags.height", { elevation: v ?? 0 })}
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.automap")}
        present={flags.automap != null}
        onToggle={(v) => onUpdate("flags.automap", v)}
        defaultValue={{ color: 0 }}
      >
        <Field label="color">
          <NumberInput
            value={flags.automap?.color ?? null}
            min={0}
            max={215}
            nullable={false}
            onCommit={(v) => onUpdate("flags.automap", { color: v ?? 0 })}
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.lenshelp")}
        present={flags.lenshelp != null}
        onToggle={(v) => onUpdate("flags.lenshelp", v)}
        defaultValue={{ id: 0 }}
      >
        <Field label="id">
          <NumberInput
            value={flags.lenshelp?.id ?? null}
            min={0}
            nullable={false}
            onCommit={(v) => onUpdate("flags.lenshelp", { id: v ?? 0 })}
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.clothes")}
        present={flags.clothes != null}
        onToggle={(v) => onUpdate("flags.clothes", v)}
        defaultValue={{ slot: 0 }}
      >
        <Field label="slot">
          <NumberInput
            value={flags.clothes?.slot ?? null}
            min={0}
            max={10}
            nullable={false}
            onCommit={(v) => onUpdate("flags.clothes", { slot: v ?? 0 })}
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.hook")}
        present={flags.hook != null}
        onToggle={(v) => onUpdate("flags.hook", v)}
        defaultValue={{ direction: "South" as HookDirection }}
      >
        <Field label="direction">
          <Select<HookDirection>
            value={flags.hook?.direction ?? null}
            options={HOOK_DIRECTIONS}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.hook", { direction: v ?? "South" })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.defaultAction")}
        present={flags.defaultAction != null}
        onToggle={(v) => onUpdate("flags.default_action", v)}
        defaultValue={{ action: "None" as PlayerAction }}
      >
        <Field label="action">
          <Select<PlayerAction>
            value={flags.defaultAction?.action ?? null}
            options={PLAYER_ACTIONS}
            onCommit={(v) =>
              onUpdate("flags.default_action", { action: v })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.market")}
        present={flags.market != null}
        onToggle={(v) => onUpdate("flags.market", v)}
        defaultValue={{
          category: null,
          tradeAsObjectId: null,
          showAsObjectId: null,
        }}
      >
        <Field label="category">
          <Select<ItemCategoryEnum>
            value={flags.market?.category ?? null}
            options={ITEM_CATEGORIES}
            onCommit={(v) =>
              onUpdate("flags.market", {
                category: v,
                tradeAsObjectId: flags.market?.tradeAsObjectId ?? null,
                showAsObjectId: flags.market?.showAsObjectId ?? null,
              })
            }
          />
        </Field>
        <Field label="trade_as_object_id">
          <NumberInput
            value={flags.market?.tradeAsObjectId ?? null}
            min={0}
            onCommit={(v) =>
              onUpdate("flags.market", {
                category: flags.market?.category ?? null,
                tradeAsObjectId: v,
                showAsObjectId: flags.market?.showAsObjectId ?? null,
              })
            }
          />
        </Field>
        <Field label="show_as_object_id">
          <NumberInput
            value={flags.market?.showAsObjectId ?? null}
            min={0}
            onCommit={(v) =>
              onUpdate("flags.market", {
                category: flags.market?.category ?? null,
                tradeAsObjectId: flags.market?.tradeAsObjectId ?? null,
                showAsObjectId: v,
              })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.imbueable")}
        present={flags.imbueable != null}
        onToggle={(v) => onUpdate("flags.imbueable", v)}
        defaultValue={{ slotCount: 0 }}
      >
        <Field label="slot_count">
          <NumberInput
            value={flags.imbueable?.slotCount ?? null}
            min={0}
            max={255}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.imbueable", { slotCount: v ?? 0 })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.bank")}
        present={flags.bank != null}
        onToggle={(v) => onUpdate("flags.bank", v)}
        defaultValue={{ waypoints: 0 }}
      >
        <Field label="waypoints">
          <NumberInput
            value={flags.bank?.waypoints ?? null}
            min={0}
            nullable={false}
            onCommit={(v) => onUpdate("flags.bank", { waypoints: v ?? 0 })}
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.write")}
        present={flags.write != null}
        onToggle={(v) => onUpdate("flags.write", v)}
        defaultValue={{ maxTextLength: 0 }}
      >
        <Field label="max_text_length">
          <NumberInput
            value={flags.write?.maxTextLength ?? null}
            min={0}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.write", { maxTextLength: v ?? 0 })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.writeOnce")}
        present={flags.writeOnce != null}
        onToggle={(v) => onUpdate("flags.write_once", v)}
        defaultValue={{ maxTextLengthOnce: 0 }}
      >
        <Field label="max_text_length_once">
          <NumberInput
            value={flags.writeOnce?.maxTextLengthOnce ?? null}
            min={0}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.write_once", { maxTextLengthOnce: v ?? 0 })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.changedToExpire")}
        present={flags.changedToExpire != null}
        onToggle={(v) => onUpdate("flags.changed_to_expire", v)}
        defaultValue={{ formerObjectTypeid: 0 }}
      >
        <Field label="former_object_typeid">
          <NumberInput
            value={flags.changedToExpire?.formerObjectTypeid ?? null}
            min={0}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.changed_to_expire", { formerObjectTypeid: v ?? 0 })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.cyclopediaItem")}
        present={flags.cyclopediaItem != null}
        onToggle={(v) => onUpdate("flags.cyclopedia_item", v)}
        defaultValue={{ cyclopediaType: 0 }}
      >
        <Field label="cyclopedia_type">
          <NumberInput
            value={flags.cyclopediaItem?.cyclopediaType ?? null}
            min={0}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.cyclopedia_item", { cyclopediaType: v ?? 0 })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.upgradeClassification")}
        present={flags.upgradeClassification != null}
        onToggle={(v) => onUpdate("flags.upgrade_classification", v)}
        defaultValue={{ upgradeClassification: 0 }}
      >
        <Field label="upgrade_classification">
          <NumberInput
            value={
              flags.upgradeClassification?.upgradeClassification ?? null
            }
            min={0}
            max={4}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.upgrade_classification", {
                upgradeClassification: v ?? 0,
              })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.skillwheelGem")}
        present={flags.skillwheelGem != null}
        onToggle={(v) => onUpdate("flags.skillwheel_gem", v)}
        defaultValue={{ gemQualityId: null, vocationId: null }}
      >
        <Field label="gem_quality_id">
          <NumberInput
            value={flags.skillwheelGem?.gemQualityId ?? null}
            min={0}
            onCommit={(v) =>
              onUpdate("flags.skillwheel_gem", {
                gemQualityId: v,
                vocationId: flags.skillwheelGem?.vocationId ?? null,
              })
            }
          />
        </Field>
        <Field label="vocation_id">
          <NumberInput
            value={flags.skillwheelGem?.vocationId ?? null}
            min={0}
            onCommit={(v) =>
              onUpdate("flags.skillwheel_gem", {
                gemQualityId: flags.skillwheelGem?.gemQualityId ?? null,
                vocationId: v,
              })
            }
          />
        </Field>
      </CompositeSection>

      <CompositeSection
        title={t("attr.section.proficiency")}
        present={flags.proficiency != null}
        onToggle={(v) => onUpdate("flags.proficiency", v)}
        defaultValue={{ proficiencyId: 0 }}
      >
        <Field label="proficiency_id">
          <NumberInput
            value={flags.proficiency?.proficiencyId ?? null}
            min={0}
            nullable={false}
            onCommit={(v) =>
              onUpdate("flags.proficiency", { proficiencyId: v ?? 0 })
            }
          />
        </Field>
      </CompositeSection>
    </div>
  );
}

export function AttributeEditor() {
  const selectedId = useWorkspace((s) => s.selectedId);
  const category = useWorkspace((s) => s.category);
  const appearance = useWorkspace((s) => s.selectedAppearance);
  const error = useWorkspace((s) => s.error);
  const t = useT();
  const [showExport, setShowExport] = useState(false);

  const meta = CATEGORY_META[category];
  const Icon = meta.icon;

  const headerInfo = useMemo(() => {
    if (!appearance) return null;
    const id = readAssetId(appearance.id);
    return { id, name: appearance.name };
  }, [appearance]);

  if (selectedId == null) {
    return (
      <div className="flex-1 flex items-center justify-center text-atlas-muted text-sm">
        {t("attr.selectHint")}
      </div>
    );
  }
  // The "sprites" category is browsed via the SpriteGrid, not the
  // attribute editor — bail out before we try to render export tooling
  // that doesn't apply.
  const exportableCategory =
    category === "object" || category === "outfit" || category === "effect" || category === "missile"
      ? category
      : null;

  if (!appearance) {
    return (
      <div className="flex-1 flex items-center justify-center text-atlas-muted text-sm">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 space-y-6 max-w-3xl">
        <header className="flex items-center gap-3 pb-3 border-b border-atlas-border">
          <Icon className={cn("h-6 w-6 shrink-0", meta.iconClass)} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold truncate">
              {headerInfo?.name ?? (
                <span className="italic text-atlas-muted">(unnamed)</span>
              )}
            </h2>
            <p className="text-xs text-atlas-muted font-mono">
              <span className={meta.textClass}>{category}</span>
              {" · "}id {headerInfo?.id}
              {" · "}
              {appearance.spriteIds.length} sprite(s)
            </p>
          </div>
          {exportableCategory && appearance.spriteIds.length > 0 && (
            <button
              type="button"
              onClick={() => setShowExport(true)}
              title={t("export.title")}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-atlas-border bg-atlas-paper text-sm text-atlas-ink hover:border-atlas-ink hover:bg-atlas-sand"
            >
              <Download className="h-4 w-4" />
              {t("export.button")}
            </button>
          )}
        </header>

        {error && (
          <div className="px-3 py-2 rounded bg-rose-100 border border-rose-300 text-sm text-rose-900">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-atlas-border bg-atlas-paper/50 overflow-hidden">
          <h3 className="text-xs uppercase tracking-wider text-atlas-muted font-semibold px-4 py-2 bg-atlas-sand/40 border-b border-atlas-border">
            {t("attr.section.sprites")}
          </h3>
          <div className="px-4 py-3">
            <SpritePreview appearance={appearance} />
          </div>
        </section>

        <AppearanceSection appearance={appearance} />
      </div>
      {showExport && exportableCategory && (
        <ExportDialog
          appearance={appearance}
          category={exportableCategory}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
