# Third-party notices

MaiDeck's original source code is licensed under `AGPL-3.0-or-later`. That license applies only to material for which MaiDeck's contributors have the authority to grant it. Third-party material remains governed by its own license or terms.

## Tomomai-derived theme material

Files under `data/assets/tomomai/` and `data/theme/tomomai/` were sourced or adapted from the Tomomai project, including material from Tomomai commit `4390db9d`. Tomomai identifies its original software as AGPL-3.0 licensed.

Some images in those directories depict or reproduce maimai game artwork, interface elements, branding, or other material associated with SEGA. Tomomai's software license and MaiDeck's AGPL license do not grant permission to use third-party SEGA material. Review and replace these files before redistributing MaiDeck where you do not have the necessary rights.

The provenance details and file mapping for the bundled preset are recorded in [`data/theme/tomomai/README.md`](data/theme/tomomai/README.md).

## Runtime catalogs and artwork

MaiDeck can import song metadata, aliases, chart facts, logos, and jacket artwork from external community sources. Generated and downloaded imports are normally excluded from Git. Each operator is responsible for reviewing the source terms and determining whether they may download, use, or redistribute imported material.

## npm dependencies

MaiDeck depends on third-party npm packages. Their names, versions, integrity hashes, and dependency relationships are recorded in `package-lock.json`; their license texts are distributed with the installed packages. Those packages are not relicensed by MaiDeck.

The direct runtime dependencies at the time of this notice are:

- `better-sqlite3`
- `cheerio`
- `discord.js`
- `dotenv`
- `skia-canvas`

Run `npm ci` from a trusted registry and review the resulting dependency licenses when preparing a redistributed build.

## Names and trademarks

maimai, maimai DX, related logos, game artwork, and associated marks belong to SEGA or their respective owners. Discord and its marks belong to Discord Inc. Other names and marks belong to their respective owners.

MaiDeck is an independent community project. It is not affiliated with, sponsored by, endorsed by, or operated by SEGA, Discord, Tomomai, Rasmai, or the maintainers of its data sources.

## Rasmai

MaiDeck includes an adapted JavaScript port of Rasmai's prediction model in `src/rasmai-skill-model.js`. The adapter in `src/hybrid-skill-model.js` is original MaiDeck code.

The port was made on 2026-11-03 from Rasmai commit `52d8002b643f97ee3a73265dbef50cc5899b023a`, using these upstream files:

- `rasmai/engine/analysis/profile/fit.py`
- `rasmai/engine/analysis/profile/model.py`
- `rasmai/engine/analysis/profile/build.py`
- `rasmai/engine/analysis/planning/predict.py`
- `rasmai/engine/insights/calibration.py`

Rasmai is available at <https://github.com/Ne-k/Rasmai> under GPL-3.0-only. The adapted file remains GPL-3.0-only; its license is reproduced in [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt). MaiDeck's original code remains AGPL-3.0-or-later. GPLv3 section 13 permits linking or combining GPLv3 and AGPLv3 works, while preserving the GPL terms for the covered Rasmai-derived portion and applying the AGPL network-source requirement to the combination.

The selected prediction files do not include the alias, chart-pattern, scoring-loss, or image assets described in Rasmai's own third-party notice. No such Rasmai-bundled data or assets were copied into MaiDeck.
