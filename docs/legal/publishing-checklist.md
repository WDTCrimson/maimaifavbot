# MaiDeck legal-document publishing checklist

The Terms of Service and Privacy Policy are operationally tailored drafts, not a substitute for advice from a lawyer familiar with the operator's jurisdiction and audience.

Before publishing them:

- [x] Add the public operator identity (`WDT Crimson`). The legal name is intentionally not published.
- [x] Add a preferred Discord contact (`@wdtcrimson`) and monitored email fallback (`wdtcrimson@gmail.com`).
- [ ] Have local counsel confirm whether `WDT Crimson` plus the listed Discord/email contacts sufficiently identifies the controller, or whether additional legal identity/contact details are required.
- [ ] Choose an effective date.
- [ ] Have local counsel choose the governing law, venue, and appropriate liability cap.
- [ ] Identify the web-link host, reverse proxy/CDN, network, domain, and backup providers. The operator-controlled server is primarily in Indonesia and may temporarily operate from the United States.
- [ ] Confirm web access-log fields and retention.
- [ ] Confirm the production volumes and backups provide encryption at rest for Discord API data, as required by Discord's Developer Terms; application-level encryption currently covers the reusable maimai token specifically.
- [ ] Set and document a concrete usage-log retention period; there is currently no automatic expiry.
- [ ] Set and document a concrete backup retention period and deletion process.
- [ ] Provide an accessible full-account deletion route. `/account unlink` deletes linked profile data but not playlists or usage logs.
- [ ] Decide whether to implement a user-facing data export command.
- [ ] Verify that public-profile fields still match `src/public-profile.js`.
- [ ] Verify that automatic history collection remains opt-in and its command wording matches this Policy.
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
