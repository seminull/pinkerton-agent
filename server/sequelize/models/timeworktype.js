'use strict';

// A Time Clock work type ("My work", "Assistant work"). One user's list.
// Entries refer to it by name, not id — see the create-time-options migration.
module.exports = (sequelize, DataTypes) => {
  const TimeWorkType = sequelize.define(
    'TimeWorkType',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(80), allowNull: false },
      countsAsOwnTime: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // Set = hidden from the dropdowns, kept for the entries that used it.
      archivedAt: { type: DataTypes.DATE },
    },
    { tableName: 'time_work_types' }
  );

  TimeWorkType.associate = (models) => {
    TimeWorkType.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return TimeWorkType;
};
