'use strict';

// Matrix duplicate resolution includes an explicit "Add New" choice. The old
// database constraint made that choice impossible for an exact MLS match, so
// MLS stays indexed for lookup but is no longer unique.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeConstraint('listings', 'listings_mlsNumber_key');
    await queryInterface.addIndex('listings', ['mlsNumber'], {
      name: 'listings_mls_number',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('listings', 'listings_mls_number');
    await queryInterface.addConstraint('listings', {
      fields: ['mlsNumber'],
      type: 'unique',
      name: 'listings_mlsNumber_key',
    });
  },
};
