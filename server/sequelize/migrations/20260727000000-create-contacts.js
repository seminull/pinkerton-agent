'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('contacts', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      firstName: { type: Sequelize.STRING, allowNull: false },
      lastName: { type: Sequelize.STRING, allowNull: false },
      email: { type: Sequelize.STRING },
      phone: { type: Sequelize.STRING },
      type: {
        type: Sequelize.ENUM('buyer', 'seller', 'both'),
        allowNull: false,
        defaultValue: 'buyer',
      },
      stage: {
        type: Sequelize.ENUM('new', 'contacted', 'qualified', 'active', 'closed', 'lost'),
        allowNull: false,
        defaultValue: 'new',
      },
      source: { type: Sequelize.STRING },
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

    // The pipeline board groups by stage, so this index backs the app's most
    // frequent read.
    await queryInterface.addIndex('contacts', ['stage']);
    // Lookup-by-email is how a duplicate lead gets caught on import. Not a
    // unique constraint — see the model for why.
    await queryInterface.addIndex('contacts', ['email']);
    await queryInterface.addIndex('contacts', ['lastName', 'firstName']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('contacts');
    // Postgres keeps the backing enum types after the table is gone; leaving
    // them behind makes the migration non-idempotent on re-run.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_contacts_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_contacts_stage";');
  },
};
