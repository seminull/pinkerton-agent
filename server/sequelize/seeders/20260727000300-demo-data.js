'use strict';

// Enough demo data to see every screen populated: a few contacts across the
// pipeline, listings in different statuses, and an activity trail. Safe to run
// on an empty dev database; `db:seed:undo` removes exactly these rows.
const CONTACT_IDS = {
  dana: '11111111-1111-4111-8111-111111111101',
  marcus: '11111111-1111-4111-8111-111111111102',
  priya: '11111111-1111-4111-8111-111111111103',
};

const LISTING_IDS = {
  oakBend: '22222222-2222-4222-8222-222222222201',
  crestview: '22222222-2222-4222-8222-222222222202',
};

const now = new Date();
const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000);

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert('contacts', [
      {
        id: CONTACT_IDS.dana,
        firstName: 'Dana',
        lastName: 'Reyes',
        email: 'dana.reyes@example.com',
        phone: '214-555-0134',
        type: 'seller',
        stage: 'active',
        source: 'Referral — J. Kim',
        notes: 'Relocating for work in the fall. Wants to close before October.',
        createdAt: daysAgo(40),
        updatedAt: daysAgo(3),
      },
      {
        id: CONTACT_IDS.marcus,
        firstName: 'Marcus',
        lastName: 'Webb',
        email: 'mwebb@example.com',
        phone: '469-555-0177',
        type: 'buyer',
        stage: 'qualified',
        source: 'Zillow',
        notes: 'Pre-approved to $550k. Looking in Frisco / Plano, 3+ bed.',
        createdAt: daysAgo(18),
        updatedAt: daysAgo(2),
      },
      {
        id: CONTACT_IDS.priya,
        firstName: 'Priya',
        lastName: 'Nair',
        email: 'priya.nair@example.com',
        phone: '972-555-0192',
        type: 'both',
        stage: 'new',
        source: 'Open house — 4/12',
        notes: 'Selling current home and trading up. Not yet listed.',
        createdAt: daysAgo(5),
        updatedAt: daysAgo(5),
      },
    ]);

    await queryInterface.bulkInsert('listings', [
      {
        id: LISTING_IDS.oakBend,
        addressLine1: '1420 Oak Bend Dr',
        city: 'Frisco',
        state: 'TX',
        postalCode: '75034',
        mlsNumber: '20458812',
        status: 'active',
        listPriceCents: 62500000,
        bedrooms: 4,
        bathrooms: 2.5,
        livingAreaSqft: 2840,
        lotAcres: 0.221,
        yearBuilt: 2016,
        listedOn: daysAgo(12),
        sellerContactId: CONTACT_IDS.dana,
        notes: 'Staged. Photos done. Two offers expected this weekend.',
        createdAt: daysAgo(14),
        updatedAt: daysAgo(1),
      },
      {
        id: LISTING_IDS.crestview,
        addressLine1: '908 Crestview Ln',
        addressLine2: 'Unit B',
        city: 'Plano',
        state: 'TX',
        postalCode: '75024',
        mlsNumber: null,
        status: 'coming_soon',
        listPriceCents: 41900000,
        bedrooms: 3,
        bathrooms: 2.0,
        livingAreaSqft: 1960,
        lotAcres: null,
        yearBuilt: 2004,
        listedOn: null,
        sellerContactId: CONTACT_IDS.priya,
        notes: 'Needs paint and a new water heater before it goes live.',
        createdAt: daysAgo(4),
        updatedAt: daysAgo(4),
      },
    ]);

    await queryInterface.bulkInsert('activities', [
      {
        id: '33333333-3333-4333-8333-333333333301',
        type: 'showing',
        subject: 'Showing — 1420 Oak Bend Dr',
        body: 'Buyers loved the kitchen. Asked about HOA dues.',
        occurredAt: daysAgo(2),
        completedAt: daysAgo(2),
        contactId: CONTACT_IDS.marcus,
        listingId: LISTING_IDS.oakBend,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
      },
      {
        id: '33333333-3333-4333-8333-333333333302',
        type: 'call',
        subject: 'Pricing conversation',
        body: 'Agreed to hold at $625k through the weekend.',
        occurredAt: daysAgo(1),
        completedAt: daysAgo(1),
        contactId: CONTACT_IDS.dana,
        listingId: LISTING_IDS.oakBend,
        createdAt: daysAgo(1),
        updatedAt: daysAgo(1),
      },
      {
        // Deliberately open (completedAt null) so ?open=true has something to
        // return and the follow-up queue isn't empty on a fresh seed.
        id: '33333333-3333-4333-8333-333333333303',
        type: 'task',
        subject: 'Send Marcus the Plano comps',
        body: null,
        occurredAt: now,
        completedAt: null,
        contactId: CONTACT_IDS.marcus,
        listingId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '33333333-3333-4333-8333-333333333304',
        type: 'task',
        subject: 'Schedule photographer for Crestview',
        body: 'After the paint is done.',
        occurredAt: daysAgo(-3),
        completedAt: null,
        contactId: CONTACT_IDS.priya,
        listingId: LISTING_IDS.crestview,
        createdAt: daysAgo(4),
        updatedAt: daysAgo(4),
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    // Children first — the activities FK would block the contact deletes.
    await queryInterface.bulkDelete('activities', {
      contactId: { [Sequelize.Op.in]: Object.values(CONTACT_IDS) },
    });
    await queryInterface.bulkDelete('listings', {
      id: { [Sequelize.Op.in]: Object.values(LISTING_IDS) },
    });
    await queryInterface.bulkDelete('contacts', {
      id: { [Sequelize.Op.in]: Object.values(CONTACT_IDS) },
    });
  },
};
