/// English message catalog. Acts as the source of truth — every other
/// locale file is typed as `typeof en` so missing keys are a compile error.
///
/// Keys are flat and dotted (`home.title`). Keep them short and grouped
/// by screen so translators can scan them top-down.
export const en = {
  "common.open": "Open",
  "common.copy": "Copy path",
  "common.copied": "Copied",
  "common.loading": "Loading…",
  "common.cancel": "Cancel",
  "common.back": "Back",

  "language.label": "Language",
  "language.en": "English",
  "language.pt": "Português",
  "language.es": "Español",

  "home.subtitle": "Editing toolkit for the Atlas project",
  "home.tool.mapEditor.title": "Map Editor",
  "home.tool.mapEditor.description": "Edit .otbm world maps.",
  "home.tool.assetsEditor.title": "Assets Editor",
  "home.tool.assetsEditor.description":
    "Open a client assets bundle and edit appearances, sprites, and item attributes.",
  "home.tool.otbConverter.title": "OTB Converter",
  "home.tool.otbConverter.description":
    "Turn a legacy items.otb (plus client .dat/.spr) into a modern Tibia 12+ assets bundle.",
  "home.badge.comingSoon": "Coming soon",
  "home.badge.ready": "Ready",
  "home.badge.beta": "Beta",
  "home.footer": "Atlas Editor · v{version}",

  "launcher.title": "Assets Editor",
  "launcher.subtitle": "Tibia 12+/15.x · appearances + sprites",
  "launcher.openFolder": "Open assets folder",
  "launcher.repickFolder": "Re-pick assets folder",
  "launcher.openFolderHint":
    "Folder containing {file} — appearances and sprites live here. The Tibia client always reads from this.",
  "launcher.bundleLoaded": "Assets bundle loaded",
  "launcher.stat.objects": "Objects",
  "launcher.stat.outfits": "Outfits",
  "launcher.stat.effects": "Effects",
  "launcher.stat.missiles": "Missiles",
  "launcher.stat.spriteSheets": "Sprite sheets",
  "launcher.openEditor": "Open editor",
  "launcher.discard": "Discard the staged assets and start over",
  "launcher.recent": "Recent",
  "launcher.footer": "Atlas Editor · Assets",

  "list.searchPlaceholder": "Filter by id or name…",
  "list.newObject": "Create new object appearance",
  "list.filter": "Flag filter",
  "list.filter.clear": "Clear",
} as const;

export type MessageKey = keyof typeof en;
