'use strict';

// Properties are recoverable for now: Sequelize's paranoid mode sets this
// timestamp instead of deleting the row, its activities, or its photos.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('listings', 'deletedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addIndex('listings', ['deletedAt'], {
      name: 'listings_deleted_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('listings', 'listings_deleted_at');
    await queryInterface.removeColumn('listings', 'deletedAt');
  },
};
