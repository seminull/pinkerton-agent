'use strict';

// A normalized contact communication. SMS lands here first; calls and email
// use the same envelope later so the contact timeline does not need one table
// and one query per provider.
module.exports = (sequelize, DataTypes) => {
  const Communication = sequelize.define(
    'Communication',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      contactId: { type: DataTypes.UUID, allowNull: false },
      channel: {
        type: DataTypes.ENUM('sms', 'call', 'email'),
        allowNull: false,
      },
      direction: {
        type: DataTypes.ENUM('incoming', 'outgoing'),
        allowNull: false,
      },
      occurredAt: { type: DataTypes.DATE, allowNull: false },
      body: { type: DataTypes.TEXT },
      counterpartyAddress: { type: DataTypes.STRING, allowNull: false },
      durationSeconds: { type: DataTypes.INTEGER },
      deviceId: { type: DataTypes.STRING(128), allowNull: false },
      externalId: { type: DataTypes.STRING(255), allowNull: false },
    },
    {
      tableName: 'communications',
      indexes: [
        {
          name: 'communications_device_external_unique',
          unique: true,
          fields: ['deviceId', 'externalId'],
        },
      ],
    }
  );

  Communication.associate = (models) => {
    Communication.belongsTo(models.Contact, {
      foreignKey: 'contactId',
      as: 'contact',
    });
  };

  return Communication;
};
