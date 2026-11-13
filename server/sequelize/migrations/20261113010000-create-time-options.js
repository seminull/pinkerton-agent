'use strict';

// The Time Clock's pick lists, as data instead of constants in the code: each
// user's own categories and work types, managed on the Setup tab.
//
// Each row also carries the one fact the totals need about it — whether a
// category is a break, whether a work type is the user's own time — so a
// custom "Coffee" category can count as a break without a code change.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const common = {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      // Per user, like the entries themselves: one person's time study doesn't
      // reshuffle another's dropdowns.
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Same width as time_entries.category / workType. Entries store the NAME,
      // not an id (see below), so the two must be able to hold the same text.
      name: { type: Sequelize.STRING(80), allowNull: false },
      // Order in the dropdown. Gaps and ties are fine; it is only ever sorted on.
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // Archived = hidden from the dropdowns but kept, because past entries
      // still use the name and still need to know whether it was a break.
      archivedAt: { type: Sequelize.DATE },
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
    };

    await queryInterface.createTable('time_categories', {
      ...common,
      // Break time is reported separately and left out of "my work time".
      isBreak: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
    });
    await queryInterface.createTable('time_work_types', {
      ...common,
      // False for work someone else did (an assistant): tracked, but not
      // counted as the user's own work time.
      countsAsOwnTime: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    });

    // time_entries keeps storing the category and work type as text and is
    // matched to these tables by (userId, name). That is deliberate: an entry
    // stays readable on its own, and the existing rows need no rewrite. The
    // price is that the name must be unique per user — which this enforces —
    // and that a rename has to update the entries too, which the API does in
    // one transaction.
    await queryInterface.addIndex('time_categories', ['userId', 'name'], {
      unique: true,
      name: 'uq_time_categories_user_name',
    });
    await queryInterface.addIndex('time_work_types', ['userId', 'name'], {
      unique: true,
      name: 'uq_time_work_types_user_name',
    });

    // No rows are inserted here. Each user's lists are created with the
    // standard defaults the first time they use the Time Clock (see
    // server/time-options.ts) — the defaults are the exact names existing
    // entries already use, so those entries line up with no data migration.
  },

  async down(queryInterface) {
    await queryInterface.dropTable('time_work_types');
    await queryInterface.dropTable('time_categories');
  },
};
