# DSH Teams Backup and Restore

The SQLite authority is stored at `$DSH_HOME/teams/teams.sqlite3`. Its `teams` and `backups` directories must be owned by the DSH Teams runtime user and use mode `0700`. The database, WAL, SHM, temporary backup, and encrypted backup files must be regular files owned by that user with mode `0600`.

The persistence layer checks these conditions, rejects symbolic links and unsafe existing artifacts, enables WAL and foreign keys, runs migrations, and verifies integrity before a service may become ready. Keep readiness unavailable when it reports a `StorageError`.

## Backup

1. Resolve the deployment's backup-key reference only in the process that performs the backup. It must produce a 32-byte value in memory for the backup API. Do not put the key in configuration files, shell history, source code, logs, diagnostics, or backup filenames.
2. Open the production database through the normal persistence startup path. Do not copy `teams.sqlite3` directly while WAL is active.
3. Call `createEncryptedBackup(opened, { destination, key })` with `destination` inside the returned `opened.backupDirectory`. The destination must not already exist.
4. Store only the resulting encrypted backup in the approved retention location. The API deletes its plaintext temporary SQLite copy on both success and failure.
5. Record the backup time, encrypted artifact identifier, software revision, and key-reference version in the protected operations log. Do not record the key value.

## Recovery Drill

Perform every recovery drill in an isolated DSH Teams home directory, never over an active production database.

1. Place the encrypted source backup in a runtime-user-owned, mode-`0600` regular file. Reject a file with different ownership, broader permissions, or a symbolic link.
2. Resolve the same 32-byte backup key through the deployment secret manager.
3. Call `restoreEncryptedBackup({ source, destination, key })` with an absent `destination` below an isolated `teams` directory. Restore authenticates the encrypted payload, checks SQLite integrity, and only then atomically places the database at the destination.
4. Start the isolated service using that destination. Successful startup reruns the migration compatibility and SQLite integrity checks. Verify the expected service data through normal read-only operations.
5. Remove the isolated restored database after the drill unless it is retained under the same owner and mode controls as production persistence.

## Failure Response and Retention

Treat an authentication failure, malformed encrypted backup, unsafe file, migration-history error, foreign-key error, or integrity failure as a failed recovery. Do not retry against the same production destination, bypass a failed check, relax file permissions, or attempt to recover with an alternate undocumented key. Preserve the encrypted source and the secret-free error code for investigation, then restore a different retained backup in a new isolated destination.

Retention is limited by the deployment's approved backup policy. Expired encrypted artifacts are removed using the retention process; plaintext SQLite backup intermediates are never retained.
