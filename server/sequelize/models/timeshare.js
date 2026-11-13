'use strict';

// One unguessable, read-only view of a user's whole Time Clock calendar or one
// local day. The public token itself never reaches this table; only its hash.
module.exports = (sequelize, DataTypes) => {
  const TimeShare = sequelize.define(
    'TimeShare',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: { type: DataTypes.UUID, allowNull: false },
      tokenHash: { type: DataTypes.STRING(64), allowNull: false },
      scope: { type: DataTypes.STRING(16), allowNull: false },
      day: { type: DataTypes.DATEONLY, allowNull: false },
      timeZone: { type: DataTypes.STRING(100), allowNull: false },
      label: { type: DataTypes.STRING(120), allowNull: true },
      // Soft delete: a removed link stops working but keeps its access log.
      revokedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'time_shares' }
  );

  TimeShare.associate = (models) => {
    TimeShare.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    TimeShare.hasMany(models.TimeShareAccess, { foreignKey: 'timeShareId', as: 'accesses' });
  };

  return TimeShare;
};
