# Community Recommendation Dataset

This directory holds the offline recommendation dataset used by `/song suggest`.

Why this exists:
- live forum scraping is brittle
- title matching across communities is messy
- curated notes are easier to review and trust

Recommended workflow:

```bash
cp data/recommendations/sources.example.json data/recommendations/sources.json
npm run import:recommendations
```

That generates:
- `data/recommendations/community.json`
- `data/recommendations/import-report.json`

GitHub Actions workflow:
- `.github/workflows/import-recommendations.yml`
- runs manually or on a daily schedule
- uses the tracked source config when `sources.json` is not present
- commits updated recommendation outputs back into the repository
- can use Reddit OAuth via GitHub secrets `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and `REDDIT_USER_AGENT`

Expected runtime file:

```json
data/recommendations/community.json
```

Tracked example files:

```json
data/recommendations/community.example.json
data/recommendations/sources.example.json
```

Minimal entry shape:

```json
{
  "entries": [
    {
      "songId": "12345",
      "tags": ["entry", "tech"],
      "note": "Comfortable 12.7 pick with readable patterns.",
      "sources": ["Reddit thread 2026-04", "Friend notes"],
      "weight": 2
    }
  ]
}
```

Supported fields per entry:
- `songId`: preferred, exact favorite ID from the local catalog
- `title`: fallback if you do not have a `songId`
- `artist`: optional helper for title matching
- `query`: fallback fuzzy query if needed
- `tags`: freeform labels like `entry`, `tech`, `stamina`, `accuracy`, `speed`
- `note`: short reason shown in the suggestion output
- `sources`: array of source labels or source objects
- `weight`: optional numeric rank multiplier, default `1`

Matching advice:
- prefer `songId` whenever possible
- keep tags normalized and short
- keep notes concise, one sentence is enough

Automatic importer:
- current implementation supports `reddit-search` sources
- it searches configured subreddit queries, optionally reads comments, detects song title mentions against the local catalog, infers coarse tags, and writes weighted recommendation entries
- use the import report to see how many discussion items were matched

Future direction:
- user-linked profiles from Tomomai or mimixd-style data can later supply the target range automatically
- this dataset can remain the recommendation layer even after profile linking is added
