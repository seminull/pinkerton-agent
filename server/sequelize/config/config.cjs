'use strict';

// A .cjs config rather than the usual config.json, because sequelize-cli is a
// bare `node` process that loads no .env of its own — every `db:migrate` would
// otherwise fail with "Error parsing url: undefined". Requiring this file is
// the CLI's first action, so it's the only hook available before it connects.
//
// The API doesn't come through here; it gets the same values from
// `tsx --env-file-if-exists=.env` (see the dev:api script).
const fs = require('node:fs');
const path = require('node:path');

// Repo root, three levels up from server/sequelize/config/.
const envPath = path.resolve(__dirname, '..', '..', '..', '.env');
if (fs.existsSync(envPath)) {
  // Node 20.6+. Real env vars already set in the shell win — loadEnvFile does
  // not overwrite them — so CI and container envs override the file.
  process.loadEnvFile(envPath);
}

const common = {
  use_env_variable: 'DATABASE_URL',
  dialect: 'postgres',
  logging: false,
};

module.exports = {
  development: common,
  test: common,
  production: common,
};
