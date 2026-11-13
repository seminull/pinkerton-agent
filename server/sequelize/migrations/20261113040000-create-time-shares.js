'use strict';

// Capability links for read-only Time Clock views. The URL carries a random
// token; only its hash is stored, so a database leak cannot be turned into
// working public links.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('time_shares', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      tokenHash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      // calendar = every completed entry; day = only the local day below.
      scope: { type: Sequelize.STRING(16), allowNull: false },
      // Also serves as the initially selected day for a calendar share.
      day: { type: Sequelize.DATEONLY, allowNull: false },
      // A shared day must keep meaning the owner's day even when its viewer is
      // elsewhere. Postgres uses this zone for every public date boundary.
      timeZone: { type: Sequelize.STRING(100), allowNull: false },
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

    await queryInterface.sequelize.query(`
      ALTER TABLE time_shares
        ADD CONSTRAINT ck_time_shares_scope
          CHECK (scope IN ('calendar', 'day'))
    `);

    // Supports a future "manage shared links" screen without changing the
    // write path or scanning every user's links.
    await queryInterface.addIndex('time_shares', ['userId', 'createdAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('time_shares');
  },
};
