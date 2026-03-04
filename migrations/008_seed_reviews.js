/**
 * Migration 008: Seed reviews from public website
 *
 * Inserts the 6 reviews that are hardcoded in public/reviews.html into the
 * database so the admin panel can manage them. Uses INSERT WHERE NOT EXISTS
 * keyed on (guest_name + review_text) so re-running is safe.
 *
 * Reviews are seeded as approved + featured since they are already live on
 * the public website.
 */

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        if (typeof db.run === 'function') {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        } else {
            reject(new Error('db.run not available'));
        }
    });
}

function insertIfMissing(db, isPostgres, review) {
    const { guest_name, platform, rating, review_text, stay_date, property } = review;

    if (isPostgres) {
        return dbRun(db,
            `INSERT INTO reviews (guest_name, platform, rating, review_text, stay_date, property, status, is_featured, created_at, updated_at)
             SELECT $1, $2, $3, $4, $5, $6, 'approved', TRUE, NOW(), NOW()
             WHERE NOT EXISTS (
                 SELECT 1 FROM reviews WHERE guest_name = $1 AND review_text = $4
             )`,
            [guest_name, platform, rating, review_text, stay_date, property]
        );
    }
    return dbRun(db,
        `INSERT INTO reviews (guest_name, platform, rating, review_text, stay_date, property, status, is_featured, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, 'approved', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         WHERE NOT EXISTS (
             SELECT 1 FROM reviews WHERE guest_name = ? AND review_text = ?
         )`,
        [guest_name, platform, rating, review_text, stay_date, property, guest_name, review_text]
    );
}

const REVIEWS = [
    {
        guest_name:  'Sarah & James',
        platform:    'airbnb',
        rating:      5,
        review_text: 'Absolutely magical! The dome exceeded all expectations. Waking up to those lake views was incredible. Stephen and Sandy were wonderful hosts - their local recommendations for wineries were spot on. We\'ll definitely be back!',
        stay_date:   '2024-12-01',
        property:    'Dome Pinot',
    },
    {
        guest_name:  'Mike & Family',
        platform:    'direct',
        rating:      5,
        review_text: 'The Lakeside Cottage was perfect for our family. The kids loved swimming in the lake, and we appreciated the fully equipped kitchen. Being able to bring our dog was a huge bonus. The location is ideal for exploring the region.',
        stay_date:   '2024-11-01',
        property:    'Lakeside Cottage',
    },
    {
        guest_name:  'Emma',
        platform:    'airbnb',
        rating:      5,
        review_text: 'The private spa at Dome Rosé was heavenly! We spent hours soaking while watching the sunset over the vineyards. The attention to detail in the dome is impressive - from the quality linens to the thoughtful welcome basket.',
        stay_date:   '2024-10-01',
        property:    'Dome Rosé',
    },
    {
        guest_name:  'David & Lisa',
        platform:    'booking',
        rating:      5,
        review_text: 'We loved that Lakeside Retreat is solar-powered - it aligned perfectly with our values. The location is unbeatable: close enough to Queenstown for day trips but peaceful and quiet at night. The Rail Trail access was a bonus!',
        stay_date:   '2024-09-01',
        property:    'Dome Pinot',
    },
    {
        guest_name:  'Rachel',
        platform:    'direct',
        rating:      5,
        review_text: 'This was our third stay at Lakeside Retreat and it gets better every time. Stephen and Sandy remember us and always go above and beyond. The winter views of the snow-capped mountains from the hot tub were breathtaking.',
        stay_date:   '2024-08-01',
        property:    'Dome Rosé',
    },
    {
        guest_name:  'Tom & Anna',
        platform:    'airbnb',
        rating:      5,
        review_text: 'We celebrated our anniversary here and it was perfect. The dome felt like a luxury hotel but with so much more character. The wine recommendations were excellent - we discovered some new favourites at the local wineries.',
        stay_date:   '2024-07-01',
        property:    'Dome Pinot',
    },
];

module.exports = {
    async up(db, isPostgres) {
        for (const review of REVIEWS) {
            await insertIfMissing(db, isPostgres, review);
        }
    },

    async down(db, _isPostgres) {
        const names = REVIEWS.map(r => r.guest_name);
        const placeholders = names.map((_, i) => _isPostgres ? `$${i + 1}` : '?').join(', ');
        await dbRun(db,
            `DELETE FROM reviews WHERE guest_name IN (${placeholders})`,
            names
        );
    }
};
