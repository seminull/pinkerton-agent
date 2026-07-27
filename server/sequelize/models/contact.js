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
      // Nullable and deliberately not unique: agents routinely have a phone
      // number and nothing else for a fresh lead, and spouses share addresses.
      email: { type: DataTypes.STRING },
      phone: { type: DataTypes.STRING },
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
