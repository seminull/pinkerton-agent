'use strict';

// Files live on the API's persistent media volume; Postgres keeps only the
// metadata and the opaque storage name. This makes listing reads cheap and
// keeps database backups from ballooning with image bytes.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('listing_photos', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      listingId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'listings', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Generated server-side and never accepted from a browser. Unique across
      // the whole media volume so a file cannot overwrite another listing's.
      storageKey: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      originalName: { type: Sequelize.STRING(255), allowNull: false },
      contentType: { type: Sequelize.STRING(80), allowNull: false },
      sizeBytes: { type: Sequelize.INTEGER, allowNull: false },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
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

    await queryInterface.addIndex('listing_photos', ['listingId', 'position', 'createdAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('listing_photos');
  },
};
