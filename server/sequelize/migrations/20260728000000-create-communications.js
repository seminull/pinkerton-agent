'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('communications', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      contactId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'contacts', key: 'id' },
        // Communications are part of the contact record. The existing app uses
        // hard deletes for contacts, so retaining detached message bodies would
        // violate both that behavior and the user's expectation.
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      channel: {
        type: Sequelize.ENUM('sms', 'call', 'email'),
        allowNull: false,
      },
      direction: {
        type: Sequelize.ENUM('incoming', 'outgoing'),
        allowNull: false,
      },
      occurredAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      body: { type: Sequelize.TEXT },
      counterpartyAddress: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      durationSeconds: { type: Sequelize.INTEGER },
      deviceId: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      externalId: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
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

    // Mobile delivery is at-least-once: a receiver upload, foreground catch-up,
    // and WorkManager run may all see the same item. Device + external ID makes
    // those retries safe without assuming Android row IDs are globally unique.
    await queryInterface.addIndex('communications', ['deviceId', 'externalId'], {
      name: 'communications_device_external_unique',
      unique: true,
    });
    await queryInterface.addIndex('communications', ['contactId', 'occurredAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('communications');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_communications_channel";'
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_communications_direction";'
    );
  },
};
