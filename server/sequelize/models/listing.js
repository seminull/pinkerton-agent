'use strict';

// A property the agent represents. Address fields are stored in parts rather
// than one blob so they can be searched, deduped, and geocoded later.
module.exports = (sequelize, DataTypes) => {
  const Listing = sequelize.define(
    'Listing',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      addressLine1: { type: DataTypes.STRING, allowNull: false },
      addressLine2: { type: DataTypes.STRING },
      city: { type: DataTypes.STRING, allowNull: false },
      state: { type: DataTypes.STRING(2), allowNull: false },
      postalCode: { type: DataTypes.STRING(10), allowNull: false },
      // Assigned by the MLS only once the listing goes live, so it's nullable —
      // but unique, because two rows sharing one MLS number is always a bug.
      mlsNumber: { type: DataTypes.STRING, unique: true },
      status: {
        type: DataTypes.ENUM(
          'draft',
          'coming_soon',
          'active',
          'pending',
          'sold',
          'withdrawn',
          'expired'
        ),
        allowNull: false,
        defaultValue: 'draft',
      },
      // Money is an integer count of cents. Storing dollars as a float means
      // $1,299,900.00 eventually prints as $1,299,899.99.
      listPriceCents: { type: DataTypes.BIGINT },
      bedrooms: { type: DataTypes.INTEGER },
      // DECIMAL, not INTEGER: half-baths are real and 2.5 must round-trip.
      bathrooms: { type: DataTypes.DECIMAL(3, 1) },
      livingAreaSqft: { type: DataTypes.INTEGER },
      lotAcres: { type: DataTypes.DECIMAL(10, 4) },
      yearBuilt: { type: DataTypes.INTEGER },
      // DATEONLY: the day a listing hit the market is a calendar date, and
      // giving it a timezone only invites off-by-one-day bugs.
      listedOn: { type: DataTypes.DATEONLY },
      sellerContactId: { type: DataTypes.UUID },
      notes: { type: DataTypes.TEXT },
    },
    { tableName: 'listings' }
  );

  Listing.associate = (models) => {
    Listing.belongsTo(models.Contact, { foreignKey: 'sellerContactId', as: 'seller' });
    Listing.hasMany(models.Activity, { foreignKey: 'listingId', as: 'activities' });
  };

  return Listing;
};
