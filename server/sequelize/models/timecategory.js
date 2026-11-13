'use strict';

// A Time Clock category ("Closing Preparation", "Lunch / Break"). One user's list.
// Entries refer to it by name, not id — see the create-time-options migration.
module.exports = (sequelize, DataTypes) => {
  const TimeCategory = sequelize.define(
    'TimeCategory',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(80), allowNull: false },
      isBreak: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // Set = hidden from the dropdowns, kept for the entries that used it.
      archivedAt: { type: DataTypes.DATE },
    },
    { tableName: 'time_categories' }
  );

  TimeCategory.associate = (models) => {
    TimeCategory.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return TimeCategory;
};
