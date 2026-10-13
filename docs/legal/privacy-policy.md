# MaiDeck Privacy Policy

**Effective date:** October 13, 2026

**Operator:** MaiDeck, independently operated under the name WDT Crimson
**Website:** https://maideck.xyz  
**Preferred privacy contact:** `@wdtcrimson` on Discord  
**Email fallback:** wdtcrimson@gmail.com

This Privacy Policy explains how MaiDeck collects, uses, shares, retains, and deletes personal data when you use the MaiDeck Discord bot, account-linking website, public profiles, browser helpers, and related services (together, the "Service").

## 1. Data we collect

### Discord data

- Your Discord user ID, which associates stored data with you.
- Server and channel IDs in operational command logs.
- Command name, timestamp, duration, result, and limited feature details needed to diagnose and measure the Service. This can include item counts, provider or region, a playlist name, or an error message.
- Discord profile information supplied with an interaction when needed to respond.

MaiDeck does not intentionally store ordinary Discord message content, your Discord password, or your Discord authentication token.

### Data you provide or create

- Playlist names and contents, targets, profile-slot names, and settings.
- Account snapshots or exports you submit through an import or link flow.
- Your choices about automatic history collection and public sharing.

### Linked maimai data

Depending on what the linked source provides, MaiDeck may store your player name, region, title, supported avatar, rating, game version, play count, song and chart scores, achievements, DX scores, difficulty and chart type, combo and sync status, chart play counts, rating contribution, recent plays and timestamps, fast and late counts, periodic snapshots, collection status, and detected history gaps.

For supported International accounts, MaiDeck also stores a reusable maimai DX NET session token so it can perform syncs or other actions you request. The token is encrypted with AES-256-GCM before it is written to storage. MaiDeck does not ask for or store your maimai password. Raw account-import command payloads are processed into a normalized snapshot and are not intentionally retained as raw payloads.

### Public profiles

Public profiles are off by default. If you enable one, anyone with its link can view the maimai player name, region, title, supported avatar, rating, play count, update time, recent plays, scores, chart progress, fast and late counts where available, and related song or chart information shown on the page. The public-profile response does not include your Discord user ID.

### Technical data

The Discord bot retains daily operational logs containing the Discord identifiers and command details described above. The account linker retains daily event and error logs that can include request identifiers, client identifier, region, and error details. MaiDeck's Caddy web server is not configured to retain access logs.

Playit.gg carries public HTTPS traffic to the operator-controlled server and may process network data such as IP addresses and connection metadata under its own privacy policy. Tailscale is used for private operator administration and may process administrative connection metadata; it is not the public MaiDeck website path.

## 2. How we collect data

We receive data:

- from Discord when you use an application command;
- directly from you when you create content, import data, change settings, or enable public sharing;
- from the account-linking service and maimai DX NET when you choose to link or sync an account;
- through periodic maimai DX NET reads when you explicitly enable automatic history collection; and
- by deriving statistics, history records, recommendations, graphics, or model inputs from the above data.

## 3. Why we use data

We use personal data to provide requested features; authenticate account-link callbacks; maintain linked sessions; collect recent plays when enabled; save your content and preferences; operate, secure, debug, and measure the Service; prevent abuse; comply with legal obligations; and test or improve MaiDeck's chart, skill, and recommendation features.

When play data is used to evaluate or improve MaiDeck's models, model artifacts are designed not to contain Discord IDs or profile names. They may use salted profile fingerprints to keep training and validation groups separate. MaiDeck does not use Discord message content to train machine-learning or AI models and does not use your data to train a general-purpose AI model. Aggregated or de-identified results that can no longer reasonably identify you may be retained after deletion.

Where applicable law requires a legal basis, MaiDeck generally relies on performance of the agreement for features you request, consent for optional history collection and public sharing, legitimate interests in securing and improving the Service, or compliance with law. You can withdraw consent for an optional feature at any time.

## 4. How we share data

MaiDeck does not sell personal data, share it with data brokers, or use it for targeted advertising. Data may be shared or transmitted as follows:

- **Discord:** transmits commands and responses under Discord's own privacy policy.
- **MaiDeck account linker:** connects a short-lived link session to the bot through an authenticated callback.
- **SEGA and maimai DX NET:** receives the requests needed when you link, sync, collect history, or apply a playlist.
- **Playit.gg:** provides the public network tunnel to the operator-controlled server.
- **Tailscale:** provides private remote administration of the server.
- **Public visitors:** receive the public-profile fields described above only when you enable sharing.
- **Legal and safety disclosures:** may receive information where reasonably necessary to comply with law, protect rights or safety, investigate abuse, or defend a claim.
- **A future service operator:** may receive data if operation of MaiDeck is transferred, subject to this Policy and applicable law.

Third-party catalog and community sources provide song, artwork, alias, chart, and recommendation information but are not intended to receive linked account data. Catalog-only AI-assisted processing receives song metadata, not Discord identifiers or linked player data.

## 5. Storage, retention, and deletion

MaiDeck stores production data and backups on operator-controlled hardware. Production personal-data storage is encrypted at rest and is restricted to the operator and the service processes that need it.

Current retention periods are:

- pending account-link sessions expire after approximately 15 minutes and are cleaned up;
- linked profiles, scores, snapshots, recent-play history, collection state, saved authentication, sharing settings, playlists, and targets remain until you delete them or they are no longer needed to provide the Service;
- Discord bot usage logs and account-linker operational logs are automatically removed after 30 days; and
- local backups are automatically removed after 30 days.

`/account unlink` removes only the selected linked maimai profile and its associated authentication, score records, snapshots, recent-play history, collection state, and public-profile link. It does not remove separately saved playlists or operational usage logs.

`/account delete-data` permanently removes all live data associated with your Discord user ID, including every profile, saved authentication token, scores, snapshots and history, collection state, public-profile settings, pending link sessions, playlists, targets, preferences, and matching Discord bot usage-log events. Copies can remain in encrypted backups until their 30-day rotation expires. Aggregated or de-identified information that can no longer reasonably identify you may remain.

You can also request access, correction, export, restriction, objection, or deletion by contacting `@wdtcrimson` on Discord or wdtcrimson@gmail.com. Discord is preferred. MaiDeck may ask you to verify control of the relevant Discord account and may retain information where required by law or reasonably needed to protect the Service or defend legal claims.

## 6. Security

MaiDeck uses transport encryption for the public website, encrypted production storage, owner-restricted files, AES-256-GCM encryption for reusable maimai DX NET session tokens, short-lived signed link sessions, authenticated callbacks, and no-cache public-profile responses. Access to production administration is restricted.

No system is completely secure. Promptly unlink or delete your data and contact us if you believe your linked session, Discord account, or public-profile link has been compromised.

## 7. Your choices and rights

You can:

- disable automatic history collection through `/account settings`;
- disable a public profile through `/account public action:Disable`;
- unlink one maimai profile through `/account unlink`;
- delete individual playlists through the relevant playlist command;
- delete all MaiDeck data associated with your Discord account through `/account delete-data`; and
- contact MaiDeck to exercise privacy rights that apply where you live.

Depending on where you live, you may have rights to access, correct, receive, restrict, object to, or delete personal data and to complain to a data-protection authority. Legal exceptions may apply. MaiDeck will not discriminate against you for exercising a privacy right.

## 8. International processing

MaiDeck's primary server location is Indonesia. The operator sometimes travels with and temporarily operates that server from the United States. Data may therefore be processed in Indonesia and the United States, as well as in locations where Discord, Playit.gg, Tailscale, SEGA, or their infrastructure providers operate.

## 9. Children

MaiDeck is not intended for anyone under 13 or below the minimum age required to use Discord in their country, whichever is higher. If you believe MaiDeck collected data from someone who cannot lawfully use the Service, contact `@wdtcrimson` on Discord or wdtcrimson@gmail.com.

## 10. Third-party services and links

Discord, Playit.gg, Tailscale, SEGA, maimai DX NET, and linked websites have their own privacy practices. This Policy covers MaiDeck's processing, not independent processing by those third parties.

## 11. Changes to this Policy

MaiDeck may update this Policy as the Service or legal requirements change. The effective date will be updated and reasonable notice will be provided for material changes through the Service, its support server, or another appropriate channel.

## 12. Contact

For privacy questions or requests:

Discord: `@wdtcrimson` (preferred)  
Email: wdtcrimson@gmail.com
