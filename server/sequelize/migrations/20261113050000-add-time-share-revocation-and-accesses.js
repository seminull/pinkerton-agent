'use strict';

// Share links become manageable: they can be removed, and every public request
// made with one is recorded.
//
// Removal is a soft delete (revokedAt) rather than a DELETE because the access
// log hangs off the share. Deleting the row would cascade the log away at
// exactly the moment someone wants to ask "who opened this before I pulled it,
// and has anyone tried since?"

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // NULL = active. A timestamp rather than a boolean so the list can say
      // when, and so blocked attempts can be read against it.
      await queryInterface.addColumn(
        'time_shares',
        'revokedAt',
        { type: Sequelize.DATE, allowNull: true },
        { transaction }
      );
      // The raw token is never stored, so a link cannot be shown again after
      // it is created. A label ("For Dana, Q3 hours") is what lets the owner
      // tell one link from another on the Shared links tab.
      await queryInterface.addColumn(
        'time_shares',
        'label',
        { type: Sequelize.STRING(120), allowNull: true },
        { transaction }
      );

      await queryInterface.createTable(
        'time_share_accesses',
        {
          id: {
            type: Sequelize.UUID,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
            primaryKey: true,
          },
          timeShareId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: { model: 'time_shares', key: 'id' },
            // Only reachable if a share row is hard-deleted by hand; the app
            // itself never deletes one.
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          // 45 characters fits the longest textual IPv6 form (IPv4-mapped).
          // Text rather than INET: it is displayed, never range-queried.
          ipAddress: { type: Sequelize.STRING(45), allowNull: true },
          userAgent: { type: Sequelize.STRING(500), allowNull: true },
          // Which public endpoint was hit: share | entries | daily | summary.
          resource: { type: Sequelize.STRING(16), allowNull: false },
          // The day or day range asked for, so the log can say what was looked
          // at ("2026-11-03"), not just that something was.
          detail: { type: Sequelize.STRING(40), allowNull: true },
          // allowed | revoked | owner_disabled. Refused requests are kept:
          // someone still trying a removed link is the thing worth seeing.
          outcome: { type: Sequelize.STRING(16), allowNull: false },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.fn('now'),
          },
        },
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE time_share_accesses
           ADD CONSTRAINT ck_time_share_accesses_resource
             CHECK (resource IN ('share', 'entries', 'daily', 'summary')),
           ADD CONSTRAINT ck_time_share_accesses_outcome
             CHECK (outcome IN ('allowed', 'revoked', 'owner_disabled'))`,
        { transaction }
      );

      // Serves both reads: the newest-first log for one share, and the
      // per-share aggregates on the list.
      await queryInterface.addIndex('time_share_accesses', ['timeShareId', 'createdAt'], {
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('time_share_accesses', { transaction });
      await queryInterface.removeColumn('time_shares', 'label', { transaction });
      await queryInterface.removeColumn('time_shares', 'revokedAt', { transaction });
    });
  },
};
