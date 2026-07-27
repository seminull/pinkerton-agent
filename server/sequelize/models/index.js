'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
// config.cjs, not config.json — it loads .env before exporting (see the file).
const config = require(__dirname + '/../config/config.cjs')[env];
const db = {};

let sequelize;
if (config.use_env_variable) {
  // Fail at startup, not on the first query: an unset DATABASE_URL would
  // otherwise surface much later as a connection error to "undefined".
  if (!process.env[config.use_env_variable]) {
    throw new Error(
      `${config.use_env_variable} must be set when NODE_ENV=${env} (see .env.example)`
    );
  }
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
