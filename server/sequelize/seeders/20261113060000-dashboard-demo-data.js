'use strict';

// A year of believable activity for one busy agent, so the dashboard charts
// have shapes to show: leads arriving month by month from a handful of
// sources, a pipeline with people at every stage, a dozen weeks of calls,
// texts and showings, and an inventory where some homes are sitting.
//
// Everything is generated from a fixed-seed PRNG, so every run produces the
// same rows (and the same charts) and `db:seed:undo` removes exactly these.
// Dates are relative to "now", so the data never goes stale.
//
// Run on its own, beside the original demo data:
//   pnpm exec sequelize-cli db:seed --seed 20261113060000-dashboard-demo-data.js
//   pnpm exec sequelize-cli db:seed:undo --seed 20261113060000-dashboard-demo-data.js

// Fixed prefixes keep these ids clear of the original demo seed and make the
// undo a simple range of known ids.
const id = (prefix, n) => `${prefix}-4444-4444-8444-${String(n).padStart(12, '0')}`;
const CONTACT = '44444444';
const LISTING = '55555555';
const ACTIVITY = '66666666';

const CONTACTS = 110;
const LISTINGS = 16;
const WEEKS_OF_ACTIVITY = 13;

// mulberry32: tiny, fast, and good enough for demo data. Math.random would
// give a different dataset (and different charts) on every seed.
const prng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const weighted = (random, entries) => {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1][0];
};

const pick = (random, list) => list[Math.floor(random() * list.length)];

const FIRST = ['Avery', 'Jordan', 'Taylor', 'Morgan', 'Riley', 'Casey', 'Jamie', 'Quinn', 'Rowan',
  'Elena', 'Marco', 'Aisha', 'Wei', 'Sofia', 'Diego', 'Hannah', 'Omar', 'Grace', 'Luis', 'Mei',
  'Noah', 'Fatima', 'Ethan', 'Chloe', 'Samir', 'Leah', 'Andre', 'Nina', 'Tomas', 'Ruth'];
const LAST = ['Alvarez', 'Bennett', 'Chen', 'Dawson', 'Ellis', 'Foster', 'Garcia', 'Hughes',
  'Iqbal', 'Jensen', 'Kowalski', 'Lam', 'Moreno', 'Nguyen', 'Okafor', 'Patel', 'Quintero',
  'Russo', 'Singh', 'Torres', 'Underwood', 'Vasquez', 'Whitaker', 'Yamamoto', 'Zimmerman'];

// "Kind — detail", the convention the dashboard groups on. Referrals close
// best and portal leads worst, which is the pattern an agent expects to see.
const SOURCES = [
  // [kind, weight, chance a lead from it ends up closed]
  ['Referral', 26, 0.34, ['past client', 'J. Kim', 'lender', 'neighbor']],
  ['Zillow', 22, 0.08, []],
  ['Open house', 15, 0.16, ['Oak Bend', 'Crestview', 'Lakeside']],
  ['Sphere', 13, 0.28, []],
  ['Realtor.com', 9, 0.07, []],
  ['Instagram', 8, 0.1, []],
  ['Sign call', 5, 0.18, []],
  ['Website', 2, 0.12, []],
];

const CITIES = [
  ['Frisco', '75034'], ['Plano', '75024'], ['McKinney', '75070'], ['Allen', '75013'],
  ['Prosper', '75078'], ['Richardson', '75080'], ['Little Elm', '75068'], ['Celina', '75009'],
];
const STREETS = ['Willow Creek', 'Stonebridge', 'Meadow Glen', 'Ridgeview', 'Cottonwood',
  'Saddle Brook', 'Prairie Wind', 'Juniper', 'Lone Star', 'Hollow Oak', 'Briar Ridge', 'Red Bud'];
const SUFFIX = ['Dr', 'Ln', 'Ct', 'Way', 'Trl', 'Blvd'];

const buildRows = (now) => {
  const random = prng(20261113);
  const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000);

  // ---- contacts --------------------------------------------------------
  // Lead flow grows through the year (a newer agent building a book), with a
  // spring bump — so the monthly chart has a trend and a season, not noise.
  const contacts = [];
  for (let n = 1; n <= CONTACTS; n += 1) {
    const growth = Math.sqrt(random()); // skews toward recent
    let age = Math.round((1 - growth) * 360);
    // Pull a share of leads into March–May for the spring market.
    if (random() < 0.18) {
      const spring = new Date(now.getFullYear(), 3, 15);
      if (spring > now) spring.setFullYear(spring.getFullYear() - 1);
      age = Math.max(0, Math.round((now - spring) / 86_400_000 + (random() - 0.5) * 50));
    }
    const created = daysAgo(age + random());

    const [kind, , closeRate, details] = weighted(
      random,
      SOURCES.map((source) => [source, source[1]])
    );
    const source = details.length ? `${kind} — ${pick(random, details)}` : kind;

    // Stage follows age: a lead from last week is new or just contacted; one
    // from last spring has either closed, gone cold, or is still shopping.
    let stage;
    if (age < 10) stage = weighted(random, [['new', 6], ['contacted', 3], ['qualified', 1]]);
    else if (age < 45)
      stage = weighted(random, [['new', 1], ['contacted', 4], ['qualified', 4], ['active', 3], ['lost', 1]]);
    else if (random() < closeRate * (age > 120 ? 1.6 : 0.9)) stage = 'closed';
    else stage = weighted(random, [['contacted', 2], ['qualified', 2], ['active', 3], ['lost', 5]]);

    const firstName = pick(random, FIRST);
    const lastName = pick(random, LAST);
    contacts.push({
      id: id(CONTACT, n),
      firstName,
      lastName,
      email: `${firstName}.${lastName}.${n}@example.com`.toLowerCase(),
      phone: `+1${pick(random, ['214', '469', '972'])}555${String(1000 + n).slice(-4)}`,
      type: weighted(random, [['buyer', 55], ['seller', 25], ['both', 20]]),
      stage,
      source,
      notes: null,
      createdAt: created,
      updatedAt: daysAgo(Math.max(0, age - Math.floor(random() * age))),
    });
  }

  // ---- listings --------------------------------------------------------
  // Mostly active, with a few that have sat for months: the days-on-market
  // chart is about spotting those.
  const sellers = contacts.filter((contact) => contact.type !== 'buyer');
  const STATUSES = ['active', 'active', 'active', 'active', 'active', 'active', 'active',
    'active', 'pending', 'pending', 'sold', 'sold', 'sold', 'coming_soon', 'withdrawn', 'expired'];
  const listings = STATUSES.slice(0, LISTINGS).map((status, index) => {
    const [city, postalCode] = pick(random, CITIES);
    const sqft = 1500 + Math.round(random() * 2600);
    const pricePerSqft = 180 + random() * 140;
    // Rounded to the nearest $5,000, the way list prices are actually set.
    const listPriceCents = Math.round((sqft * pricePerSqft) / 5000) * 5000 * 100;
    const onMarket =
      status === 'coming_soon'
        ? null
        : status === 'active'
          ? // A long tail: most under a month or two, one or two going stale.
            Math.round(4 + Math.pow(random(), 2.2) * 150)
          : 30 + Math.round(random() * 140);
    return {
      id: id(LISTING, index + 1),
      addressLine1: `${1000 + Math.floor(random() * 8900)} ${pick(random, STREETS)} ${pick(random, SUFFIX)}`,
      addressLine2: null,
      city,
      state: 'TX',
      postalCode,
      // 21… so a seeded MLS number can't collide with the original seed's.
      mlsNumber: status === 'coming_soon' ? null : String(21000000 + index * 7919),
      status,
      listPriceCents,
      bedrooms: 3 + Math.floor(sqft / 1200),
      bathrooms: 2 + Math.floor(random() * 3) * 0.5,
      livingAreaSqft: sqft,
      lotAcres: Math.round((0.12 + random() * 0.3) * 1000) / 1000,
      yearBuilt: 1995 + Math.floor(random() * 29),
      listedOn: onMarket === null ? null : daysAgo(onMarket).toISOString().slice(0, 10),
      sellerContactId: pick(random, sellers).id,
      externalLinks: JSON.stringify([]),
      notes: null,
      createdAt: daysAgo((onMarket ?? 5) + 3),
      updatedAt: daysAgo(Math.floor(random() * 4)),
    };
  });

  // ---- activities ------------------------------------------------------
  // Weekdays are busy, weekends lighter but not empty (showings happen on
  // Saturdays). A couple of quiet weeks make the trend chart worth reading.
  const activities = [];
  const pipelineContacts = contacts.filter((contact) => contact.stage !== 'lost');
  const activeListings = listings.filter((listing) => listing.status === 'active');
  const quietWeeks = new Set([3, 8]);
  const SUBJECTS = {
    call: ['Check-in call', 'Pricing conversation', 'Lender intro call', 'Follow-up on showing feedback'],
    text: ['Sent new listings', 'Confirmed showing time', 'Quick check-in'],
    email: ['Sent comps', 'Market update', 'Offer summary', 'Disclosure packet'],
    showing: ['Showing', 'Second showing'],
    meeting: ['Buyer consultation', 'Listing presentation', 'Inspection walk-through'],
    note: ['Preferences updated', 'Called back — left voicemail'],
  };
  let activityN = 0;
  for (let day = WEEKS_OF_ACTIVITY * 7; day >= 1; day -= 1) {
    const date = daysAgo(day);
    const weekday = date.getDay();
    const week = Math.floor(day / 7);
    const base = weekday === 0 ? 1 : weekday === 6 ? 3 : 6;
    const count = Math.round(base * (quietWeeks.has(week) ? 0.45 : 0.8 + random() * 0.6));
    for (let k = 0; k < count; k += 1) {
      const type = weighted(random, [
        ['call', 28], ['text', 22], ['email', 18],
        ['showing', weekday === 6 ? 30 : 10], ['meeting', 6], ['note', 6],
      ]);
      const contact = pick(random, pipelineContacts);
      const listing = type === 'showing' && activeListings.length ? pick(random, activeListings) : null;
      const at = new Date(date);
      at.setHours(8 + Math.floor(random() * 11), Math.floor(random() * 60), 0, 0);
      activityN += 1;
      activities.push({
        id: id(ACTIVITY, activityN),
        type,
        subject: listing
          ? `${pick(random, SUBJECTS.showing)} — ${listing.addressLine1}`
          : pick(random, SUBJECTS[type]),
        body: null,
        occurredAt: at,
        completedAt: at,
        contactId: contact.id,
        listingId: listing ? listing.id : null,
        createdAt: at,
        updatedAt: at,
      });
    }
  }

  // Open follow-ups: some missed, some coming up, so the follow-up tile has
  // something to say in both directions.
  const FOLLOW_UPS = ['Send updated comps', 'Call about pre-approval', 'Schedule listing photos',
    'Ask for a review', 'Check on appraisal', 'Send closing gift', 'Re-engage cold lead'];
  [-6, -3, -2, -1, 1, 2, 4, 6, 9].forEach((offset) => {
    activityN += 1;
    const due = daysAgo(-offset);
    due.setHours(10, 0, 0, 0);
    activities.push({
      id: id(ACTIVITY, activityN),
      type: 'task',
      subject: pick(random, FOLLOW_UPS),
      body: null,
      occurredAt: due,
      completedAt: null,
      contactId: pick(random, pipelineContacts).id,
      listingId: null,
      createdAt: daysAgo(Math.max(1, -offset + 5)),
      updatedAt: daysAgo(Math.max(1, -offset + 5)),
    });
  });

  return { contacts, listings, activities };
};

const idRange = (prefix) => ({
  // Every generated id shares its prefix, so LIKE matches exactly this seed's
  // rows and nothing a person created by hand.
  where: `id::text LIKE '${prefix}-4444-4444-8444-%'`,
});

module.exports = {
  async up(queryInterface) {
    const { contacts, listings, activities } = buildRows(new Date());
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.bulkInsert('contacts', contacts, { transaction });
      await queryInterface.bulkInsert('listings', listings, { transaction });
      await queryInterface.bulkInsert('activities', activities, { transaction });
    });
  },

  async down(queryInterface) {
    // Children first — the activity and listing FKs would block the contact
    // deletes.
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const [table, prefix] of [
        ['activities', ACTIVITY],
        ['listings', LISTING],
        ['contacts', CONTACT],
      ]) {
        await queryInterface.sequelize.query(
          `DELETE FROM ${table} WHERE ${idRange(prefix).where}`,
          { transaction }
        );
      }
    });
  },
};
