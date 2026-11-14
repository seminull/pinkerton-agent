'use strict';

const { parsePhoneNumberFromString } = require('libphonenumber-js');

// Store one unambiguous representation everywhere. PhoneInput emits E.164,
// and this migration brings existing imports/manual entries to the same form.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [contacts] = await queryInterface.sequelize.query(
        'SELECT "id", "phone" FROM "contacts" WHERE "phone" IS NOT NULL',
        { transaction }
      );

      const normalized = [];
      let invalid = 0;
      for (const contact of contacts) {
        const parsed = parsePhoneNumberFromString(String(contact.phone).trim(), 'US');
        if (!parsed?.isValid()) {
          invalid += 1;
          continue;
        }
        normalized.push({ id: contact.id, phone: String(parsed.number) });
      }

      // Never erase a number just to make a migration pass. Reporting only a
      // count lets an operator correct invalid rows without logging contacts.
      if (invalid > 0) {
        throw new Error(
          `Cannot normalize ${invalid} existing contact phone number${invalid === 1 ? '' : 's'}`
        );
      }

      for (const contact of normalized) {
        await queryInterface.bulkUpdate(
          'contacts',
          { phone: contact.phone },
          { id: contact.id },
          { transaction }
        );
      }

      await queryInterface.sequelize.query(
        `ALTER TABLE "contacts"
         ADD CONSTRAINT "contacts_phone_e164"
         CHECK ("phone" IS NULL OR "phone" ~ '^\\+[1-9][0-9]{7,14}$')`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    // The original punctuation was presentation, not data, so canonical values
    // stay canonical on rollback. Only remove the database guard.
    await queryInterface.removeConstraint('contacts', 'contacts_phone_e164');
  },
};
