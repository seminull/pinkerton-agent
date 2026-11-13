'use strict';

// One signed-in browser. The cookie holds a random token; this row holds only
// its SHA-256, so the table can't be replayed as logins if it ever leaks.
module.exports = (sequelize, DataTypes) => {
  const UserSession = sequelize.define(
    'UserSession',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: { type: DataTypes.UUID, allowNull: false },
      tokenHash: { type: DataTypes.STRING(64), allowNull: false },
      userAgent: { type: DataTypes.STRING(500) },
      lastSeenAt: { type: DataTypes.DATE, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      // Set on sign-out. A session is live only while this is NULL and
      // expiresAt is in the future.
      revokedAt: { type: DataTypes.DATE },
    },
    { tableName: 'user_sessions' }
  );

  UserSession.associate = (models) => {
    UserSession.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return UserSession;
};
