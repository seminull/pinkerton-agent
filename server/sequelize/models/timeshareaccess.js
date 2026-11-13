'use strict';

// One public request made with a share link, allowed or refused. Append-only:
// nothing updates a row, so there is no updatedAt.
module.exports = (sequelize, DataTypes) => {
  const TimeShareAccess = sequelize.define(
    'TimeShareAccess',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      timeShareId: { type: DataTypes.UUID, allowNull: false },
      ipAddress: { type: DataTypes.STRING(45), allowNull: true },
      userAgent: { type: DataTypes.STRING(500), allowNull: true },
      resource: { type: DataTypes.STRING(16), allowNull: false },
      detail: { type: DataTypes.STRING(40), allowNull: true },
      outcome: { type: DataTypes.STRING(16), allowNull: false },
    },
    { tableName: 'time_share_accesses', updatedAt: false }
  );

  TimeShareAccess.associate = (models) => {
    TimeShareAccess.belongsTo(models.TimeShare, { foreignKey: 'timeShareId', as: 'share' });
  };

  return TimeShareAccess;
};
