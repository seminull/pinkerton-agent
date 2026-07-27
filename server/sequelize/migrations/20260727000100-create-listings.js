'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('listings', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      addressLine1: { type: Sequelize.STRING, allowNull: false },
      addressLine2: { type: Sequelize.STRING },
      city: { type: Sequelize.STRING, allowNull: false },
      state: { type: Sequelize.STRING(2), allowNull: false },
      postalCode: { type: Sequelize.STRING(10), allowNull: false },
      mlsNumber: { type: Sequelize.STRING, unique: true },
      status: {
        type: Sequelize.ENUM(
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
      listPriceCents: { type: Sequelize.BIGINT },
      bedrooms: { type: Sequelize.INTEGER },
      bathrooms: { type: Sequelize.DECIMAL(3, 1) },
      livingAreaSqft: { type: Sequelize.INTEGER },
      lotAcres: { type: Sequelize.DECIMAL(10, 4) },
      yearBuilt: { type: Sequelize.INTEGER },
      listedOn: { type: Sequelize.DATEONLY },
      sellerContactId: {
        type: Sequelize.UUID,
        references: { model: 'contacts', key: 'id' },
        // Deleting a contact must not silently delete their listing history.
        // The listing survives with a null seller and can be reassigned.
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      notes: { type: Sequelize.TEXT },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('now'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('now'),
      },
    });

    await queryInterface.addIndex('listings', ['status']);
    await queryInterface.addIndex('listings', ['sellerContactId']);
    // "Everything I have in Frisco" — the city/postal pair is the natural
    // geographic filter until there's real geocoding.
    await queryInterface.addIndex('listings', ['city', 'postalCode']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('listings');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_listings_status";');
  },
};
