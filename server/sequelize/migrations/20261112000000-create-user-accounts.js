'use strict';

// Accounts, sign-in identities, and sessions.
//
// Password credentials sit on the user row; external identities (Google today)
// get their own table so a second provider links to the same account instead
// of widening `users` with a column pair per provider.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      // 254 is the longest address SMTP can actually deliver to.
      email: { type: Sequelize.STRING(254), allowNull: false, unique: true },
      // Nullable: an account that only ever signs in with Google has no
      // password, and NULL (not "") is what makes password login impossible
      // for it rather than merely unlikely.
      passwordHash: { type: Sequelize.TEXT },
      firstName: { type: Sequelize.STRING(80), allowNull: false },
      lastName: { type: Sequelize.STRING(80), allowNull: false },
      avatarUrl: { type: Sequelize.TEXT },
      // Plain strings with CHECK constraints rather than ENUMs: adding a value
      // to a Postgres enum can't run inside a transaction, and both of these
      // lists are expected to grow.
      role: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'user' },
      status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'active' },
      // Set only when something has proven the address is theirs (Google's
      // email_verified claim). An operator typing an address proves nothing.
      emailVerifiedAt: { type: Sequelize.DATE },
      lastLoginAt: { type: Sequelize.DATE },
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

    // The unique index is only as good as the normalisation in front of it:
    // without this, "Sam@x.com" and "sam@x.com" are two accounts. The app
    // lowercases before writing; this makes the database refuse anything that
    // slipped past it.
    await queryInterface.sequelize.query(`
      ALTER TABLE users
        ADD CONSTRAINT ck_users_email_normalized
          CHECK (email = lower(email) AND email = btrim(email)),
        ADD CONSTRAINT ck_users_role
          CHECK (role IN ('user', 'admin')),
        ADD CONSTRAINT ck_users_status
          CHECK (status IN ('active', 'disabled'))
    `);

    await queryInterface.createTable('auth_identities', {
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
      provider: { type: Sequelize.STRING(32), allowNull: false },
      // The provider's stable subject id. This — not the email — is what
      // identifies a returning user, because people change their address.
      providerUserId: { type: Sequelize.STRING(255), allowNull: false },
      providerEmail: { type: Sequelize.STRING(254) },
      // A small display snapshot (name, picture). Provider access and refresh
      // tokens are deliberately never stored: sign-in needs them for one
      // request, and a table of live tokens is a liability with no use.
      profile: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      lastUsedAt: { type: Sequelize.DATE },
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
    // One Google account maps to exactly one user...
    await queryInterface.addIndex('auth_identities', ['provider', 'providerUserId'], {
      unique: true,
      name: 'uq_auth_identities_provider_subject',
    });
    // ...and one user has at most one identity per provider.
    await queryInterface.addIndex('auth_identities', ['userId', 'provider'], {
      unique: true,
      name: 'uq_auth_identities_user_provider',
    });

    await queryInterface.createTable('user_sessions', {
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
      // SHA-256 of the cookie value, hex. The token itself is never stored, so
      // a leaked copy of this table cannot be replayed as a login.
      tokenHash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      userAgent: { type: Sequelize.STRING(500) },
      lastSeenAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('now'),
      },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      // Sign-out sets this instead of deleting the row, so "when did this
      // session end" stays answerable.
      revokedAt: { type: Sequelize.DATE },
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
    // Backs "this user's live sessions" — the query a sign-out-everywhere or
    // session-review screen will run.
    await queryInterface.addIndex('user_sessions', ['userId', 'expiresAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_sessions');
    await queryInterface.dropTable('auth_identities');
    await queryInterface.dropTable('users');
  },
};
