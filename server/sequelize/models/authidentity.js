'use strict';

// A link between a user and an account at an external sign-in provider.
// Matched on (provider, providerUserId) — the provider's stable subject id —
// never on email, which a person can change at the provider.
module.exports = (sequelize, DataTypes) => {
  const AuthIdentity = sequelize.define(
    'AuthIdentity',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: { type: DataTypes.UUID, allowNull: false },
      provider: { type: DataTypes.STRING(32), allowNull: false },
      providerUserId: { type: DataTypes.STRING(255), allowNull: false },
      providerEmail: { type: DataTypes.STRING(254) },
      // Display snapshot only. No provider tokens are ever stored here.
      profile: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      lastUsedAt: { type: DataTypes.DATE },
    },
    { tableName: 'auth_identities' }
  );

  AuthIdentity.associate = (models) => {
    AuthIdentity.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return AuthIdentity;
};
