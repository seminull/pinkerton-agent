'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('activities', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      type: {
        type: Sequelize.ENUM('call', 'email', 'text', 'meeting', 'showing', 'note', 'task'),
        allowNull: false,
        defaultValue: 'note',
      },
      subject: { type: Sequelize.STRING, allowNull: false },
      body: { type: Sequelize.TEXT },
      occurredAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('now'),
      },
      completedAt: { type: Sequelize.DATE },
      contactId: {
        type: Sequelize.UUID,
        references: { model: 'contacts', key: 'id' },
        // Unlike listings, the interaction log has no meaning without its
        // subject — deleting the contact takes their history with them.
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      listingId: {
        type: Sequelize.UUID,
        references: { model: 'listings', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
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

    // The two timeline reads: "this contact's history" and "this listing's".
    await queryInterface.addIndex('activities', ['contactId', 'occurredAt']);
    await queryInterface.addIndex('activities', ['listingId', 'occurredAt']);
    // Partial index for the follow-up queue — it covers only open tasks, which
    // stay a small slice of a table that otherwise grows forever.
    await queryInterface.addIndex('activities', ['occurredAt'], {
      name: 'activities_open_tasks_idx',
      where: { completedAt: null },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('activities');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_activities_type";');
  },
};
