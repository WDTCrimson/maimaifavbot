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

Rasmai inspired parts of MaiDeck's product and modeling research. MaiDeck's current implementation states that it was independently rebuilt without Rasmai source code. If Rasmai code is incorporated later, retain the applicable GPL notices, identify the copied or modified files here, and comply with both projects' license terms.
