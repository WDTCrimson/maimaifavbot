# MaiDeck legal-document publishing checklist

The Terms of Service and Privacy Policy are operationally tailored drafts, not a substitute for advice from a lawyer familiar with the operator's jurisdiction and audience.

Before publishing them:

- [x] Add the public operator identity (`WDT Crimson`). The legal name is intentionally not published.
- [x] Add a preferred Discord contact (`@wdtcrimson`) and monitored email fallback (`wdtcrimson@gmail.com`).
- [ ] Have local counsel confirm whether `WDT Crimson` plus the listed Discord/email contacts sufficiently identifies the controller, or whether additional legal identity/contact details are required.
- [x] Choose an effective date: October 13, 2026.
- [x] Publish an Indonesia-law clause, competent-court wording, mandatory consumer-law savings clause, and IDR 1,000,000 liability cap. Local-counsel review remains recommended.
- [x] Identify personal-data infrastructure: operator-controlled server, Playit.gg public tunnel, Tailscale private administration, Discord, and SEGA/maimai DX NET. The server is primarily in Indonesia and may temporarily operate from the United States.
- [x] Confirm web access logging: Caddy has no access-log directive. Bot and linker operational logs are documented separately.
- [x] Confirm production personal data, secrets, operational logs, and backups are stored in a TPM-unlocked gocryptfs vault; reusable maimai tokens also retain application-level AES-256-GCM encryption.
- [x] Set and document a 30-day usage/linker-log retention period with automatic pruning.
- [x] Set and document a 30-day local-backup retention period and automatic pruning.
- [x] Provide `/account delete-data` for full live-data and matching usage-log deletion.
- [ ] Decide whether to implement a user-facing data export command.
- [x] Verify that public-profile fields match `src/public-profile.js` and remain opt-in.
- [x] Verify that automatic history collection remains opt-in and its command wording matches this Policy.
- [ ] Confirm every infrastructure provider has suitable data-processing and security terms.
- [ ] Put a public Privacy Policy URL in the Discord Developer Portal and make both documents easy to reach from the bot or its support page.
- [ ] Review the current Discord Developer Terms and Developer Policy before launch and after material platform changes.
- [ ] Review the applicable SEGA/maimai DX NET terms before offering account automation publicly.
- [ ] Arrange legal review for the countries in which the operator is established or actively offers the Service.

Primary references used for this draft:

- [Discord Developer Terms of Service](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)
- [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)
- [EU General Data Protection Regulation](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/)
- [Indonesia Law No. 27 of 2022 on Personal Data Protection](https://jdih.komdigi.go.id/produk_hukum/view/id/832/t/crc32/)
