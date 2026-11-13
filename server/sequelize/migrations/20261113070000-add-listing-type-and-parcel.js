'use strict';

// Two things the MLS knows about a property that the table could not hold.
//
// listingType: a lease is listed, shown, and closed like a sale, so it is the
// same row — but its price is a monthly rent. Without a column saying so, a
// $3,400 lease reads as a $3,400 house and is added into sales volume. The
// price stays in listPriceCents either way; this column says which kind of
// number it is. Existing rows are all sales, hence the default.
//
// parcelNumber: the county appraisal district's id for the lot. It is the one
// key shared by the MLS and county records, so keeping it is what lets a
// listing be joined to appraisal data later without re-matching by address.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('listings', 'listingType', {
      type: Sequelize.ENUM('sale', 'lease'),
      allowNull: false,
      defaultValue: 'sale',
    });
    await queryInterface.addColumn('listings', 'parcelNumber', {
      type: Sequelize.STRING,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('listings', 'parcelNumber');
    await queryInterface.removeColumn('listings', 'listingType');
    // removeColumn leaves the Postgres enum type behind, and a second `up`
    // would then fail trying to create it again.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_listings_listingType";');
  },
};
