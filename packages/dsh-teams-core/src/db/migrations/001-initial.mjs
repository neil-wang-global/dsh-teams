// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export const initialMigration = Object.freeze({
  version: '001-initial',
  up(connection) {
    connection.exec(`
      CREATE TABLE site_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        multi_user_enabled INTEGER NOT NULL DEFAULT 0 CHECK (multi_user_enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email_normalized TEXT NOT NULL UNIQUE,
        email_display TEXT NOT NULL,
        system_role TEXT NOT NULL CHECK (system_role IN ('admin', 'user')),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        is_founder INTEGER NOT NULL DEFAULT 0 CHECK (is_founder IN (0, 1)),
        must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
        auth_version INTEGER NOT NULL DEFAULT 0 CHECK (auth_version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX one_founder ON users (is_founder) WHERE is_founder = 1;

      CREATE TABLE password_credentials (
        user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_digest BLOB NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX auth_sessions_by_user ON auth_sessions (user_id);

      CREATE TABLE one_time_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('password-reset', 'email-verification', 'invite')),
        token_digest BLOB NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX one_time_tokens_by_user ON one_time_tokens (user_id, purpose);

      CREATE TABLE totp_factors (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        encrypted_secret BLOB NOT NULL,
        key_version TEXT NOT NULL,
        enabled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX totp_factors_by_user ON totp_factors (user_id);

      CREATE TABLE passkeys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        credential_id BLOB NOT NULL UNIQUE,
        public_key BLOB NOT NULL,
        sign_count INTEGER NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
      CREATE INDEX passkeys_by_user ON passkeys (user_id);

      CREATE TABLE recovery_codes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        code_digest BLOB NOT NULL UNIQUE,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX recovery_codes_by_user ON recovery_codes (user_id);

      CREATE TABLE managed_workspace_roots (
        id TEXT PRIMARY KEY,
        canonical_realpath TEXT NOT NULL UNIQUE,
        stable_root_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
        created_by_user_id TEXT NOT NULL REFERENCES users (id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE team_workspaces (
        id TEXT PRIMARY KEY,
        dsh_workspace_id TEXT NOT NULL UNIQUE,
        creator_user_id TEXT NOT NULL REFERENCES users (id),
        root_id TEXT REFERENCES managed_workspace_roots (id),
        status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'deleted')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX team_workspaces_by_creator ON team_workspaces (creator_user_id);

      CREATE TABLE workspace_epochs (
        workspace_id TEXT PRIMARY KEY REFERENCES team_workspaces (id) ON DELETE CASCADE,
        epoch INTEGER NOT NULL DEFAULT 0 CHECK (epoch >= 0),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE principal_epochs (
        user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        epoch INTEGER NOT NULL DEFAULT 0 CHECK (epoch >= 0),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE managed_workspace_root_grants (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES managed_workspace_roots (id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        granted_by_user_id TEXT NOT NULL REFERENCES users (id),
        granted_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by_user_id TEXT REFERENCES users (id),
        UNIQUE (root_id, user_id)
      );

      CREATE TABLE workspace_memberships (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES team_workspaces (id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'guest')),
        joined_at TEXT NOT NULL,
        role_changed_at TEXT NOT NULL,
        UNIQUE (workspace_id, user_id)
      );
      CREATE INDEX workspace_memberships_by_user ON workspace_memberships (user_id);

      CREATE TABLE session_holders (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES team_workspaces (id) ON DELETE SET NULL,
        holder_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        session_epoch INTEGER NOT NULL DEFAULT 0 CHECK (session_epoch >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX session_holders_by_workspace ON session_holders (workspace_id);

      CREATE TABLE mail_outbox (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
        purpose TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
        available_at TEXT NOT NULL,
        sent_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX mail_outbox_dispatch ON mail_outbox (status, available_at);

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
        workspace_id TEXT REFERENCES team_workspaces (id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_events_by_workspace ON audit_events (workspace_id, created_at);

      CREATE TABLE operation_journal (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
        workspace_id TEXT REFERENCES team_workspaces (id) ON DELETE SET NULL,
        operation_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'compensating')),
        request_json TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX operation_journal_by_workspace ON operation_journal (workspace_id, created_at);
    `)
  },
})
