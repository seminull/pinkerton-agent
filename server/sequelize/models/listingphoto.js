'use strict';

module.exports = (sequelize, DataTypes) => {
  const ListingPhoto = sequelize.define(
    'ListingPhoto',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      listingId: { type: DataTypes.UUID, allowNull: false },
      storageKey: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      originalName: { type: DataTypes.STRING(255), allowNull: false },
      contentType: { type: DataTypes.STRING(80), allowNull: false },
      sizeBytes: { type: DataTypes.INTEGER, allowNull: false },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { tableName: 'listing_photos' }
  );

  ListingPhoto.associate = (models) => {
    ListingPhoto.belongsTo(models.Listing, { foreignKey: 'listingId', as: 'listing' });
  };

  return ListingPhoto;
};
