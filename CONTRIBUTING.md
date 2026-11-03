# Contributing to MaiDeck

Thank you for helping improve MaiDeck.

## Before you start

- Open an issue before making a large behavioral, storage, account-linking, or prediction-model change.
- Never post Discord tokens, maimai DX NET cookies, account-link secrets, production databases, private player data, or unredacted logs.
- Use fixtures and a development Discord application. Do not test against somebody else's account or the public MaiDeck service.
- Only contribute code, data, translations, and media that you have the right to submit. Identify third-party sources and their licenses in the pull request.

## Development setup

MaiDeck requires Node.js 20 or newer.

```bash
npm ci
cp .env.example .env
npm test
npm run check
```

Fill `.env` with credentials from a development Discord application. Generated catalogs, runtime databases, logs, reports, and local secrets are ignored by Git.

The test suite uses synthetic fixtures and should not require a live Discord bot, a production database, or a maimai DX NET account. New features that process player data should include a synthetic fixture covering their storage and deletion behavior.

## Pull requests

Keep changes focused and explain:

- what user-facing behavior changes;
- how the change was tested;
- whether it changes stored or transmitted data;
- whether it adds an external service, dataset, model, font, image, or other dependency;
- any deployment or migration steps.

Run these checks before submitting:

```bash
npm test
npm run check
```

## Licensing contributions

Unless a file says otherwise, contributions submitted to this repository are licensed under `AGPL-3.0-or-later`. By submitting a contribution, you confirm that you have the right to provide it on those terms. Third-party material remains under its own license and must be clearly identified.

MaiDeck does not require copyright assignment. Contributors retain copyright in their work.
