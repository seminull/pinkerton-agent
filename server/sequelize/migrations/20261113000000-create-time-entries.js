'use strict';

// The time clock: one row per task a user timed. A row with a NULL endedAt IS
// the running task — there is no separate "active" record to fall out of sync
// with the history, and it survives a closed tab or a different device because
// it lives here rather than in the browser.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('time_entries', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      // Whose time this is. Every query is scoped by it — this is the first
      // table in the app that belongs to one user rather than to everyone.
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Plain strings, validated against the lists in the route file. Not
      // ENUMs: the category list is the part of this feature most likely to be
      // edited, and changing a Postgres enum is a migration every time.
      category: { type: Sequelize.STRING(80), allowNull: false },
      task: { type: Sequelize.STRING(200), allowNull: false },
      // Meant to be an anonymous label ("File A"), not a client name.
      reference: { type: Sequelize.STRING(100) },
      workType: { type: Sequelize.STRING(80), allowNull: false },
      notes: { type: Sequelize.TEXT },
      startedAt: { type: Sequelize.DATE, allowNull: false },
      // NULL while the task is running.
      endedAt: { type: Sequelize.DATE },
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

    // History is always "this user's entries, newest first", and the totals
    // are "this user's entries in a date range" — both ride this index.
    await queryInterface.addIndex('time_entries', ['userId', 'startedAt']);

    // At most one running task per user, enforced by the database. The API
    // checks too, but two Start clicks from two tabs can both pass that check
    // before either inserts; this is what makes the second one fail.
    await queryInterface.addIndex('time_entries', ['userId'], {
      unique: true,
      where: { endedAt: null },
      name: 'uq_time_entries_one_running_per_user',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('time_entries');
  },
};
