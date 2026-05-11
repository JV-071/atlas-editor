# Icons

App icons should live in this directory. They are not committed to the
repository because they are binary artifacts derived from a single
1024x1024 source image.

## Generating icons

Once you have a `source.png` (1024x1024, transparent background):

```bash
npx @tauri-apps/cli icon path/to/source.png
```

This populates `icons/` with `32x32.png`, `128x128.png`, `128x128@2x.png`,
`icon.icns` (macOS), and `icon.ico` (Windows).

After generation, update `src-tauri/tauri.conf.json` `bundle.icon` to:

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```
