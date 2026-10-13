# MaiDeck encrypted production storage

Production personal data is stored in a gocryptfs vault on the server. The vault password is sealed to the server TPM with `systemd-creds`; the only plaintext recovery copy is kept off-host by the operator. The deployment was activated and verified on October 13, 2026.

## Protected paths

- bot `.env`, `data`, `logs`, and `backups`;
- linker `.env` and `logs`; and
- operator deployment backups.

The original application paths are symlinks into `/home/crimson/.maideck-vault.plain`. Both application services require `maideck-vault.service`, so they fail closed when the vault is unavailable.

## Recovery

The off-host recovery key is `~/Downloads/maideck-vault-recovery-key.txt` on the operator workstation. It must not be copied into the repository or left unencrypted on the server.

If TPM unsealing fails, mount manually after securely transferring the recovery key:

```sh
/home/crimson/.local/bin/gocryptfs \
  -passfile /path/to/recovery-key \
  /home/crimson/.maideck-vault.cipher \
  /home/crimson/.maideck-vault.plain
```

After recovery, reseal the credential to the active TPM before restoring automatic startup.

## Verification

```sh
systemctl is-active maideck-vault maimaifavbot maimaifavbot-linker
findmnt /home/crimson/.maideck-vault.plain
systemctl show maimaifavbot maimaifavbot-linker -p Requires -p After
```
