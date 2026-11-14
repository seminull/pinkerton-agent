'use strict';

// A person in the agent's book of business — buyer, seller, or both. This is
// the root record everything else hangs off: listings point at their seller,
// activities point at whoever they were with.
module.exports = (sequelize, DataTypes) => {
  const Contact = sequelize.define(
    'Contact',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      firstName: { type: DataTypes.STRING, allowNull: false },
      lastName: { type: DataTypes.STRING, allowNull: false },
      // Email and phone are nullable and deliberately not unique: agents
      // routinely have one number for a household rather than per individual.
      email: { type: DataTypes.STRING },
      // E.164 is the storage/export representation; the UI formats it for
      // reading. The database migration adds the matching CHECK constraint.
      phone: {
        type: DataTypes.STRING(16),
        validate: { is: /^\+[1-9]\d{7,14}$/ },
      },
      type: {
        type: DataTypes.ENUM('buyer', 'seller', 'both'),
        allowNull: false,
        defaultValue: 'buyer',
      },
      // The pipeline column. Kept as a flat enum rather than a stages table
      // until there's a reason to let agents define their own.
      stage: {
        type: DataTypes.ENUM('new', 'contacted', 'qualified', 'active', 'closed', 'lost'),
        allowNull: false,
        defaultValue: 'new',
      },
      source: { type: DataTypes.STRING },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'contacts' }
  );

  Contact.associate = (models) => {
    Contact.hasMany(models.Listing, { foreignKey: 'sellerContactId', as: 'listings' });
    Contact.hasMany(models.Activity, { foreignKey: 'contactId', as: 'activities' });
  };

  return Contact;
};
