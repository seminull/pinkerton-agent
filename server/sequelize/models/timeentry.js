'use strict';

// One timed task on the Time Clock. `endedAt` NULL means it is still running;
// a partial unique index (see the migration) allows one such row per user.
module.exports = (sequelize, DataTypes) => {
  const TimeEntry = sequelize.define(
    'TimeEntry',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: { type: DataTypes.UUID, allowNull: false },
      category: { type: DataTypes.STRING(80), allowNull: false },
      task: { type: DataTypes.STRING(200), allowNull: false },
      // An anonymous label like "File A" — deliberately not a link to a
      // listing or contact, so a time study never has to carry client data.
      reference: { type: DataTypes.STRING(100) },
      workType: { type: DataTypes.STRING(80), allowNull: false },
      notes: { type: DataTypes.TEXT },
      startedAt: { type: DataTypes.DATE, allowNull: false },
      endedAt: { type: DataTypes.DATE },
    },
    { tableName: 'time_entries' }
  );

  TimeEntry.associate = (models) => {
    TimeEntry.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return TimeEntry;
};
