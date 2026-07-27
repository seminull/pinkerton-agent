'use strict';

// The interaction log — one row per call, email, showing, or note. This is the
// table an agent actually lives in day to day, so both foreign keys are
// nullable and independent: an activity can hang off a contact, a listing,
// both (a showing), or neither (a standalone reminder).
module.exports = (sequelize, DataTypes) => {
  const Activity = sequelize.define(
    'Activity',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      type: {
        type: DataTypes.ENUM('call', 'email', 'text', 'meeting', 'showing', 'note', 'task'),
        allowNull: false,
        defaultValue: 'note',
      },
      subject: { type: DataTypes.STRING, allowNull: false },
      body: { type: DataTypes.TEXT },
      // Doubles as "when it happened" for logged activity and "when it's due"
      // for an open task — one timeline column keeps the follow-up query simple.
      occurredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      // NULL means outstanding. This is what makes "what's overdue" a single
      // indexed predicate instead of a status enum that drifts out of sync.
      completedAt: { type: DataTypes.DATE },
      contactId: { type: DataTypes.UUID },
      listingId: { type: DataTypes.UUID },
    },
    { tableName: 'activities' }
  );

  Activity.associate = (models) => {
    Activity.belongsTo(models.Contact, { foreignKey: 'contactId', as: 'contact' });
    Activity.belongsTo(models.Listing, { foreignKey: 'listingId', as: 'listing' });
  };

  return Activity;
};
