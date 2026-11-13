'use strict';

// A property can appear on several public and working sites at once. Keep the
// small ordered collection on the listing: it is edited and read with the
// listing, and does not yet need the lifecycle or metadata of a separate
// integration model.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('listings', 'externalLinks', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('listings', 'externalLinks');
  },
};
