# MaiDeck Privacy Policy

**Effective date:** [INSERT EFFECTIVE DATE]

**Data controller/operator:** WDT Crimson ("MaiDeck," "we," "us," or "our")  
**Website:** https://maideck.xyz  
**Preferred privacy contact:** `@wdtcrimson` on Discord  
**Email fallback:** wdtcrimson@gmail.com

This Privacy Policy explains how MaiDeck collects, uses, shares, retains, and deletes personal data when you use the MaiDeck Discord bot, account-linking website, public profiles, browser helpers, and related services (together, the "Service").

This is a project-specific draft, not legal advice. The bracketed details must be completed before publication.

## 1. Data we collect

We collect only the data needed to provide and maintain MaiDeck's features.

### Discord data

- Your Discord user ID, used to associate stored data with you.
- Server and channel IDs for commands whose operation or diagnostic logs need that context.
- Command names, subcommands, timestamps, duration, success or error status, and limited feature-specific details such as a playlist name, item counts, provider/region, or error message.
- Discord profile information made available with an interaction when needed to respond to it. MaiDeck does not intentionally store ordinary Discord message content.

### Data you create or submit

- Playlist names, playlist songs, targets, settings, and profile-slot names.
- Account snapshots or exports that you submit through an import command or account-link flow.
- Choices such as whether automatic play-history collection or public sharing is enabled.

### Linked maimai data

Depending on what the linked source provides, this may include:

- player name, region, title, avatar URL, rating, game version, and play count;
- song and chart scores, achievement values, DX scores, chart type and difficulty;
- full-combo and full-sync status, per-chart play counts, rating contribution, and similar game statistics;
- recent plays and their timestamps, track number, fast/late counts, and rating changes;
- periodic account snapshots, collection status, and detected gaps in play history; and
- a reusable maimai DX NET session token for supported International accounts.

MaiDeck does not ask for or store your Discord password or maimai password. Raw account-import command payloads are processed to create a normalized snapshot and are not intentionally retained as raw payloads.

### Public profile data

Public profiles are off by default. If you enable one, anyone with the link can view the maimai player name, region, title, supported avatar, rating, play count, update time, recent plays, scores, chart progress, fast/late counts where available, and related song or chart information shown on that page. A public profile does not expose your Discord user ID through the public-profile payload.

### Technical and security data

Our hosting systems may process IP addresses, request timestamps, user-agent information, error logs, and similar technical data needed to serve web requests, prevent abuse, and diagnose failures. [CONFIRM THE HOSTING/PROXY LOGS AND THEIR RETENTION BEFORE PUBLICATION.]

## 2. How we collect data

We receive data:

- from Discord when you use an application command;
- directly from you when you create content, import data, change settings, or enable public sharing;
- from the account-linking service and maimai DX NET when you choose to link or sync an account;
- through periodic maimai DX NET reads when you explicitly enable automatic history collection; and
- by deriving statistics, history records, recommendations, graphics, or model inputs from the above data.

## 3. Why we use data

We use personal data to:

- respond to commands and provide playlists, account views, syncs, graphics, recommendations, public profiles, and other requested features;
- authenticate account-link callbacks and maintain linked sessions;
- perform periodic recent-play collection when enabled;
- save your preferences and content between sessions;
- operate, secure, debug, and measure the Service;
- prevent abuse and enforce the Terms of Service;
- comply with legal obligations; and
- test and improve MaiDeck's own chart, skill, and recommendation features.

When play data is used to evaluate or improve MaiDeck's models, model artifacts are designed not to contain Discord IDs or profile names. They may contain salted profile fingerprints needed to keep training and validation groups separate. We do not use Discord message content to train machine-learning or AI models, and we do not use your data to train a general-purpose AI model.

Where laws such as the GDPR require a legal basis, the basis will generally be:

- performance of our agreement with you for features you request;
- your consent for optional automatic history collection and public sharing;
- our legitimate interests in securing, maintaining, and improving the Service, balanced against your rights; or
- compliance with a legal obligation.

You can withdraw consent for an optional feature at any time. Withdrawal does not make earlier lawful processing unlawful.

## 4. How we share data

We do not sell your personal data, share it with data brokers, or use it for targeted advertising.

We may share or transmit data in these circumstances:

- **Discord:** Commands and responses are transmitted through Discord. Discord processes that data under its own privacy policy.
- **Account-linking service:** A one-time link session uses an external web service to connect the result to your Discord account. The service sends the normalized account snapshot and supported authentication data to MaiDeck through an authenticated callback.
- **SEGA/maimai DX NET:** When you link, sync, collect history, or apply a playlist, the Service sends requests needed to perform that action to maimai DX NET.
- **Hosting and infrastructure providers:** MaiDeck is primarily hosted on operator-controlled hardware in Indonesia. The same hardware may temporarily be operated from the United States when the operator travels. Network, proxy, domain, or backup providers may also process limited data on our behalf. [LIST THOSE ACTUAL PROVIDERS BEFORE PUBLICATION.]
- **Public profile visitors:** If you enable public sharing, the public profile data described above is shared at your direction.
- **Legal and safety reasons:** We may disclose information when reasonably necessary to comply with law, protect rights or safety, investigate abuse, or defend legal claims.
- **Service transfer:** If operation of MaiDeck is transferred, data may be transferred with the Service, subject to this Policy and applicable law.

MaiDeck uses third-party catalog and community sources for song, artwork, alias, chart, and recommendation data. Those sources are not intended to receive your linked personal account data. Any catalog-only AI-assisted process receives song metadata rather than Discord account data or linked player data.

## 5. Storage, retention, and deletion

MaiDeck stores bot data in an operator-controlled database and local operational files. Current account snapshots and collected play history are retained without a fixed automatic expiry while they remain needed to provide history features and evaluate the developing models. We will review and reduce that retention as the Service matures. This Policy will be updated before a new retention schedule takes effect.

Current retention behavior is:

- pending account-link sessions expire after approximately 15 minutes by default and are cleaned up;
- linked profile data, scores, snapshots, recent-play history, collection state, saved authentication, and public-sharing settings remain until you unlink that profile, request deletion, or they are no longer needed;
- playlists and targets remain until you delete them or request full deletion;
- operational usage logs are stored as daily files and currently have no automated expiry; and
- backups may retain a copy until they expire under the operator's backup rotation or are securely overwritten. [INSERT THE ACTUAL BACKUP RETENTION PERIOD BEFORE PUBLICATION.]

Using `/account unlink` deletes the selected linked maimai profile and its associated authentication, score records, snapshots, recent-play history, collection state, and public-profile link from the live bot database. It does not delete separately saved playlists or operational usage logs.

To request deletion of all personal data associated with your Discord account, contact `@wdtcrimson` on Discord or email wdtcrimson@gmail.com and include your Discord user ID. Discord is the preferred contact method. We may ask you to verify control of that account. We will delete or de-identify the data unless retention is required by law, needed to protect the Service or others, or permitted for legal claims. Residual copies may remain temporarily in backups until the normal backup cycle completes.

## 6. Security

Reusable maimai DX NET session tokens are encrypted at the application level using AES-256-GCM. Account-link callbacks use a shared secret, public-profile callback responses are not cached, and access controls are intended to restrict production storage to the operator and authorized infrastructure.

No system is completely secure. You should promptly unlink your profile and contact us if you believe your linked session, Discord account, or public-profile link has been compromised.

## 7. Your choices and rights

You can:

- disable automatic history collection through `/account settings`;
- disable a public profile through `/account public action:Disable`;
- unlink a selected maimai profile through `/account unlink`;
- delete individual playlists with the relevant playlist command; and
- contact us to request access, correction, export, restriction, objection, or deletion where applicable.

Depending on where you live, you may have additional rights, including the right to complain to a data-protection authority. These rights may have legal exceptions. We will not discriminate against you for exercising a privacy right.

## 8. International processing

MaiDeck's primary server location is Indonesia. The operator sometimes travels with and temporarily operates the server from the United States. As a result, your data may be processed in Indonesia and the United States, as well as in countries where the Service's network or infrastructure providers operate. Where required, we will use an approved transfer mechanism and appropriate safeguards. [LIST THE ACTUAL INFRASTRUCTURE PROVIDERS AND ANY REQUIRED TRANSFER SAFEGUARDS BEFORE PUBLICATION.]

## 9. Children

MaiDeck is not intended for anyone under 13 or below the minimum age required to use Discord in their country, whichever is higher. We do not knowingly collect personal data from a person who cannot lawfully use the Service. If you believe this has happened, contact `@wdtcrimson` on Discord or email wdtcrimson@gmail.com so we can investigate and delete the data as appropriate.

## 10. Third-party services and links

Discord, maimai DX NET, public links, and other third-party services have their own privacy practices. This Policy covers MaiDeck's processing, not how those third parties process data independently.

## 11. Changes to this Policy

We may update this Policy as the Service changes or legal requirements develop. We will update the effective date and, for material changes, provide reasonable notice through the Service, its support server, or another appropriate channel.

## 12. Contact

For privacy questions or requests, contact:

WDT Crimson  
Discord: `@wdtcrimson` (preferred)  
Email: wdtcrimson@gmail.com
