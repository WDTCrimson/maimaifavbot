# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose account credentials, player data, Discord tokens, encryption keys, account-link sessions, or the production service.

Contact `@wdtcrimson` on Discord. If Discord is unavailable, email `wdtcrimson@gmail.com` with the subject `MaiDeck security report`.

Include the affected component, impact, reproduction steps that use synthetic data where possible, and any suggested mitigation. Do not include real cookies, tokens, secrets, or somebody else's personal data. You may encrypt sensitive supporting material after arranging a secure channel with the maintainer.

Please allow a reasonable period to investigate and deploy a fix before public disclosure. MaiDeck does not currently operate a paid bug-bounty program and cannot authorize testing against Discord, SEGA, maimai DX NET, Playit.gg, or other third-party infrastructure.

## Supported version

Security fixes target the current `main` branch and the production version operated at `maideck.xyz`. Older commits and independently operated forks may not receive fixes.

## Safe testing boundaries

- Use accounts and Discord applications that you control.
- Do not access, change, retain, or disclose another person's data.
- Do not degrade availability or generate high-volume traffic.
- Stop testing and report the issue if you encounter production credentials or private data.
- Follow the applicable rules of every third-party service involved.

Good-faith reports that stay within these boundaries are welcome, but this policy cannot authorize activity against systems MaiDeck does not own.
