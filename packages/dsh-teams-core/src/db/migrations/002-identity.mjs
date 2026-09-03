// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export const identityMigration = Object.freeze({
  version: '002-identity',
  up(connection) {
    connection.exec(`
      ALTER TABLE auth_sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0 CHECK (auth_version >= 0);
      ALTER TABLE auth_sessions ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0 CHECK (restricted IN (0, 1));

      CREATE TABLE login_rate_limits (
        key_digest BLOB PRIMARY KEY,
        failure_count INTEGER NOT NULL CHECK (failure_count >= 0),
        window_started_at TEXT NOT NULL,
        blocked_until TEXT,
        updated_at TEXT NOT NULL
      );
    `)
  },
})
