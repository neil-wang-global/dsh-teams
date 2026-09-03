// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export class ConfigurationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ConfigurationError'
    this.code = code
  }
}

export class StorageError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StorageError'
    this.code = code
  }
}

export class IdentityError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'IdentityError'
    this.code = code
    this.status = status
  }
}
