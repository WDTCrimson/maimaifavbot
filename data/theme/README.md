# Loadout Graphic Theme Assets

Place custom files here to change `/playlist graphic` visuals.

## Supported image formats

- `.png`
- `.jpg` / `.jpeg`
- `.webp`

## Asset filenames

Use these exact base names (extension can vary):

- `background` : full-canvas background image
- `header-overlay` : image clipped to top header bar
- `logo` : top-right logo image
- `watermark` : full-canvas overlay image (low opacity)
- `card-bg` : image used inside each song card
- `card-frame` : image drawn over each card (for borders/decor)

Examples:

- `background.png`
- `logo.webp`
- `card-frame.png`

## Optional color overrides

Create `theme.json` in this folder. Any missing keys fall back to defaults.

See `theme.json.example` for available keys.

## Optional custom fonts

You can add a `fonts/` subfolder inside this theme directory.

Supported font formats:

- `.ttf`
- `.otf`
- `.woff`
- `.woff2`

All font files found in `fonts/` are registered automatically by the graphic renderer.
