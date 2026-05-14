# Icons

App icons live in this directory. They are derived from a single
1024×1024 `source.png` (the Atlas figure on a cream background).

## Regenerating

```bash
npx @tauri-apps/cli icon src-tauri/icons/source.png -o src-tauri/icons
```

This produces:

- Desktop: `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`,
  `icon.icns`, `icon.ico`
- Microsoft Store: `Square*.png`, `StoreLogo.png`
- iOS: `AppIcon-*` (currently unused — Atlas is desktop-only)
- Android: `mipmap-*/ic_launcher*` (currently unused)

`src-tauri/tauri.conf.json` only references the desktop set under
`bundle.icon`. The mobile artifacts are kept in the tree to make a
future `cargo tauri android init` / `tauri ios init` painless.

## Source image guidelines

- 1024×1024 PNG with transparency or a solid backdrop
- The Atlas figure should sit centered with ~8% margin so it survives
  the rounded-square mask Apple/Microsoft apply
- The frontend launcher uses `frontend/src/assets/logo.png` (a copy
  without padding); update both when the brand mark changes.
