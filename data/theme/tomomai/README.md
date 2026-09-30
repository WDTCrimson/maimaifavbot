# tomomai Theme Preset

This preset is populated from:

- `/home/crimson/PersonalProjects/tomomai/public/res`

## Use this preset

Set in `.env`:

```env
GRAPHIC_THEME_DIR=./data/theme/tomomai
```

Then restart bot and run:

```text
/playlist graphic name:<your_playlist>
```

## Main mapped files

- `background.png` <- `res/bg/12.png`
- `header-overlay.png` <- `res/character/12.png`
- `logo.png` <- `res/logo/12.png`
- `watermark.png` <- `res/star/white_tail.png`
- `card-bg.png` <- `res/bg/12_long.png`
- `card-frame.png` <- `res/songs/music_jacket_master.png`

## Extra version assets copied

- `bg-10.png`, `bg-11.png`, `bg-12.png`, `bg-13.png`, `bg-14.png`
- `bg-11-long.png`, `bg-12-long.png`, `bg-13-long.png`, `bg-14-long.png`
- `logo-10.png`, `logo-11.png`, `logo-12.png`, `logo-13.png`, `logo-14.png`
- `character-10.png`, `character-11.png`, `character-12.png`, `character-13.png`, `character-14.png`

Version 14 is staged for MAGiCAL prototyping. It is selected only when a snapshot explicitly reports game version 14; current International profiles remain on CiRCLE PLUS assets.

The MAGiCAL files were copied from sibling Tomomai commit `4390db9d` (`apps/render/public/res`). Tomomai is AGPL-3.0; maimai artwork and branding remain third-party SEGA material. Keep this provenance note with redistributed copies.

## Fonts

Theme fonts are copied into `fonts/` and auto-registered by renderer.
