import { useMemo } from "react";

import { useWorkspace } from "../stores/workspace";
import {
  ITEM_GROUPS,
  VOCATIONS,
  WEAPON_TYPES,
  readAssetId,
  type AppearanceFlagsDto,
  type AppearanceInfoDto,
  type ItemGroupEnum,
  type OtbItemDto,
  type OtbItemFlagsDto,
  type Vocation,
  type WeaponType,
} from "../types";
import { CATEGORY_META } from "./Tabs";
import { cn } from "../lib/utils";

// ---- common controls ----

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs uppercase tracking-wider text-atlas-muted font-semibold">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-atlas-ink-soft truncate">{label}</span>
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
    <div className="flex flex-wrap gap-1.5 justify-end">
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

// ---- section renderers ----

function AppearanceSection({ appearance }: { appearance: AppearanceInfoDto }) {
  const update = useWorkspace((s) => s.updateAppearanceField);
  const flags: AppearanceFlagsDto = appearance.flags;

  return (
    <div className="space-y-5">
      <Section title="Identity">
        <Field label="name">
          <TextInput
            value={appearance.name}
            onCommit={(v) => void update("name", v)}
          />
        </Field>
        <Field label="description">
          <TextInput
            value={appearance.description}
            onCommit={(v) => void update("description", v)}
          />
        </Field>
      </Section>

      <Section title="Behavior">
        {APPEARANCE_BOOL_FIELDS.map(([label, dtoKey, fieldPath]) => (
          <Field key={dtoKey} label={label}>
            <Toggle
              value={Boolean(flags[dtoKey])}
              onCommit={(v) => void update(`flags.${fieldPath}`, v)}
            />
          </Field>
        ))}
      </Section>

      <Section title="Combat / requirements">
        <Field label="weapon_type">
          <Select<WeaponType>
            value={flags.weaponType}
            options={WEAPON_TYPES}
            onCommit={(v) => void update("flags.weapon_type", v)}
          />
        </Field>
        <Field label="minimum_level">
          <NumberInput
            value={flags.minimumLevel}
            min={0}
            onCommit={(v) => void update("flags.minimum_level", v)}
          />
        </Field>
        <Field label="dual_wielding">
          <Toggle
            value={flags.dualWielding}
            onCommit={(v) => void update("flags.dual_wielding", v)}
          />
        </Field>
        <Field label="ammo">
          <Toggle
            value={flags.ammo}
            onCommit={(v) => void update("flags.ammo", v)}
          />
        </Field>
        <Field label="imbueable.slot_count">
          <NumberInput
            value={flags.imbueable?.slotCount ?? null}
            min={0}
            max={255}
            onCommit={(v) =>
              void update("flags.imbueable.slot_count", v == null ? null : v)
            }
          />
        </Field>
        <div className="col-span-2">
          <Field label="restrict_to_vocation">
            <VocationPicker
              value={flags.restrictToVocation}
              onCommit={(v) => void update("flags.restrict_to_vocation", v)}
            />
          </Field>
        </div>
      </Section>
    </div>
  );
}

function OtbSection({ item }: { item: OtbItemDto }) {
  const update = useWorkspace((s) => s.updateOtbItemField);
  const flags: OtbItemFlagsDto = item.flags;

  return (
    <div className="space-y-5">
      <Section title="OTB identity">
        <Field label="server_id">
          <NumberInput value={item.serverId} nullable={false} onCommit={() => {}} />
        </Field>
        <Field label="client_id">
          <NumberInput value={item.clientId} nullable={false} onCommit={() => {}} />
        </Field>
        <Field label="name">
          <TextInput value={item.name} onCommit={(v) => void update("name", v)} />
        </Field>
        <Field label="speed">
          <NumberInput
            value={item.speed}
            min={0}
            onCommit={(v) => void update("speed", v)}
          />
        </Field>
        <Field label="group">
          <Select<ItemGroupEnum>
            value={item.group}
            options={ITEM_GROUPS}
            nullable={false}
            onCommit={(v) => v && void update("group", v)}
          />
        </Field>
      </Section>

      <Section title="Tile / movement flags">
        {OTB_BOOL_FIELDS.map(([label, dtoKey, fieldPath]) => (
          <Field key={dtoKey} label={label}>
            <Toggle
              value={Boolean(flags[dtoKey])}
              onCommit={(v) => void update(`flags.${fieldPath}`, v)}
            />
          </Field>
        ))}
      </Section>

      <Section title="Atlas extensions">
        <Field label="weapon_type">
          <Select<WeaponType>
            value={item.weaponType}
            options={WEAPON_TYPES}
            onCommit={(v) => void update("weapon_type", v)}
          />
        </Field>
        <Field label="minimum_level">
          <NumberInput
            value={item.minimumLevel}
            min={0}
            onCommit={(v) => void update("minimum_level", v)}
          />
        </Field>
        <Field label="imbuement_slots">
          <NumberInput
            value={item.imbuementSlots}
            min={0}
            max={255}
            onCommit={(v) => void update("imbuement_slots", v)}
          />
        </Field>
        <Field label="dual_wielding">
          <Toggle
            value={item.dualWielding ?? false}
            onCommit={(v) => void update("dual_wielding", v)}
          />
        </Field>
        <div className="col-span-2">
          <Field label="vocations">
            <VocationPicker
              value={item.vocations}
              onCommit={(v) => void update("vocations", v)}
            />
          </Field>
        </div>
      </Section>
    </div>
  );
}

// Each row: [display label, DTO key (camelCase), backend field path
// (snake_case)]. The triple keeps the form schema next to both the
// shape the backend expects and the JSON key the read side returned.
const APPEARANCE_BOOL_FIELDS: [string, keyof AppearanceFlagsDto, string][] = [
  ["container", "container", "container"],
  ["cumulative", "cumulative", "cumulative"],
  ["usable", "usable", "usable"],
  ["forceuse", "forceuse", "forceuse"],
  ["multiuse", "multiuse", "multiuse"],
  ["unpass", "unpass", "unpass"],
  ["unmove", "unmove", "unmove"],
  ["unsight", "unsight", "unsight"],
  ["avoid", "avoid", "avoid"],
  ["take", "take", "take"],
  ["liquidcontainer", "liquidcontainer", "liquidcontainer"],
  ["liquidpool", "liquidpool", "liquidpool"],
  ["hang", "hang", "hang"],
  ["rotate", "rotate", "rotate"],
  ["ignore_look", "ignoreLook", "ignore_look"],
  ["show_off_socket", "showOffSocket", "show_off_socket"],
  ["reportable", "reportable", "reportable"],
  ["wrap", "wrap", "wrap"],
  ["unwrap", "unwrap", "unwrap"],
  ["corpse", "corpse", "corpse"],
  ["player_corpse", "playerCorpse", "player_corpse"],
];

const OTB_BOOL_FIELDS: [string, keyof OtbItemFlagsDto, string][] = [
  ["block_solid", "blockSolid", "block_solid"],
  ["block_projectile", "blockProjectile", "block_projectile"],
  ["block_pathfind", "blockPathfind", "block_pathfind"],
  ["has_height", "hasHeight", "has_height"],
  ["useable", "useable", "useable"],
  ["pickupable", "pickupable", "pickupable"],
  ["movable", "movable", "movable"],
  ["stackable", "stackable", "stackable"],
  ["rotatable", "rotatable", "rotatable"],
  ["hangable", "hangable", "hangable"],
  ["always_on_top", "alwaysOnTop", "always_on_top"],
  ["readable", "readable", "readable"],
  ["allow_dist_read", "allowDistRead", "allow_dist_read"],
  ["look_through", "lookThrough", "look_through"],
  ["animation", "animation", "animation"],
  ["force_use", "forceUse", "force_use"],
];

export function AttributeEditor() {
  const selectedId = useWorkspace((s) => s.selectedId);
  const category = useWorkspace((s) => s.category);
  const appearance = useWorkspace((s) => s.selectedAppearance);
  const otbItem = useWorkspace((s) => s.selectedOtbItem);
  const error = useWorkspace((s) => s.error);

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
        Select an item from the list to inspect it.
      </div>
    );
  }

  if (!appearance) {
    return (
      <div className="flex-1 flex items-center justify-center text-atlas-muted text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 space-y-6 max-w-3xl">
        <header className="flex items-center gap-3 pb-3 border-b border-atlas-border">
          <Icon className={cn("h-6 w-6 shrink-0", meta.iconClass)} />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold truncate">
              {headerInfo?.name ?? (
                <span className="italic text-atlas-muted">(unnamed)</span>
              )}
            </h2>
            <p className="text-xs text-atlas-muted font-mono">
              <span className={meta.textClass}>{category}</span>
              {" · "}id {headerInfo?.id}
              {otbItem?.serverId != null && <> · otb server_id {otbItem.serverId}</>}
              {" · "}
              {appearance.spriteIds.length} sprite(s)
            </p>
          </div>
        </header>

        {error && (
          <div className="px-3 py-2 rounded bg-rose-100 border border-rose-300 text-sm text-rose-900">
            {error}
          </div>
        )}

        <AppearanceSection appearance={appearance} />

        {otbItem && (
          <>
            <hr className="border-atlas-border" />
            <OtbSection item={otbItem} />
          </>
        )}

        {!otbItem && category === "object" && (
          <p className="text-xs text-atlas-muted italic">
            No OTB entry linked. Open an items.otb file to edit the server-side
            attributes.
          </p>
        )}
      </div>
    </div>
  );
}
