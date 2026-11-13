'use strict';

// Someone who can sign in to the CRM — an agent, not a contact. Contacts are
// the people in the book of business; users are the people working it.
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Always stored lowercased and trimmed (enforced again by a CHECK in the
      // migration), so the unique index means what it says.
      email: { type: DataTypes.STRING(254), allowNull: false },
      // NULL for an account that only signs in through a provider.
      passwordHash: { type: DataTypes.TEXT },
      firstName: { type: DataTypes.STRING(80), allowNull: false },
      lastName: { type: DataTypes.STRING(80), allowNull: false },
      avatarUrl: { type: DataTypes.TEXT },
      // user | admin. Nothing reads this yet; it exists so the first
      // admin-only screen doesn't need a migration to land.
      role: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'user' },
      // active | disabled. A disabled account keeps its rows (and its history)
      // but every session it holds stops working on the next request.
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'active' },
      emailVerifiedAt: { type: DataTypes.DATE },
      lastLoginAt: { type: DataTypes.DATE },
    },
    { tableName: 'users' }
  );

  User.associate = (models) => {
    User.hasMany(models.AuthIdentity, { foreignKey: 'userId', as: 'identities' });
    User.hasMany(models.UserSession, { foreignKey: 'userId', as: 'sessions' });
  };

  return User;
};
