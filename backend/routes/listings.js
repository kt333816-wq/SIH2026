const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { geocodeAddress } = require('../utils/geocode');
const { attemptMatch } = require('../utils/matching');

const router = express.Router();
router.use(requireAuth);

// POST /api/listings  { food_quantity, address }
// Donor-only. Geocodes the address, saves the listing, then immediately tries
// to match it with the nearest human-feed receiver. If a match is found, the
// response includes a pickup OTP - the donor reads this out to the receiver
// in person at handover, and whoever's logged in at that point (either side)
// submits it back via /verify-pickup to confirm the food changed hands.
router.post('/', async (req, res) => {
    if (req.user.role !== 'donor') return res.status(403).json({ error: 'Donor accounts only' });

    const { food_quantity, address } = req.body;
    if (!food_quantity || !food_quantity.trim()) return res.status(400).json({ error: 'Food quantity is required' });
    if (!address || !address.trim()) return res.status(400).json({ error: 'Address is required' });

        let coords;
    try {
        coords = await geocodeAddress(address);
    } catch (err) {
        console.error('Geocoding failed for address:', address, '-', err.message);
        return res.status(400).json({ error: 'Could not locate that address - please check it and try again' });
    }

    const { rows } = await pool.query(
        `INSERT INTO food_listings (donor_id, food_quantity, address, latitude, longitude, location, feed_type, match_status)
         VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, 'human', 'searching_human')
         RETURNING id`,
        [req.user.sub, food_quantity.trim(), address.trim(), coords.lat, coords.lon]
    );
    const listingId = rows[0].id;

    const match = await attemptMatch(listingId, 'human');

    res.status(201).json({
        message: match
            ? 'Listing posted and matched with a nearby receiver - share this pickup code with them.'
            : 'Listing posted - searching for a nearby receiver. If none turns up within 2 hours, it moves to animal feed automatically.',
        listingId,
        matched: !!match,
        pickupOtp: match ? match.otp : undefined,
        otpExpiresAt: match ? match.expiresAt : undefined
    });
});

// GET /api/listings/:id/status - lightweight poll for the donate-form UI to
// check whether a still-searching listing has since been matched.
router.get('/:id/status', async (req, res) => {
    const { rows } = await pool.query(
        `SELECT id, donor_id, matched_receiver_id, feed_type, match_status, pickup_otp_expires_at
         FROM food_listings WHERE id = $1`,
        [req.params.id]
    );
    const listing = rows[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (req.user.sub !== listing.donor_id && req.user.sub !== listing.matched_receiver_id) {
        return res.status(403).json({ error: 'Not part of this listing' });
    }

    res.json({
        matchStatus: listing.match_status,
        feedType: listing.feed_type,
        otpExpiresAt: listing.pickup_otp_expires_at
    });
});

// GET /api/listings/:id/tracking
// Donor or matched receiver only. Returns the listing's fixed pickup point
// plus the receiver's most recent shared live location (if any), and the
// straight-line distance between them for the donor's map view.
router.get('/:id/tracking', async (req, res) => {
    const { rows } = await pool.query(
        `SELECT fl.donor_id, fl.matched_receiver_id, fl.latitude AS donor_lat, fl.longitude AS donor_lon,
                fl.match_status,
                u.live_latitude AS receiver_lat, u.live_longitude AS receiver_lon, u.live_location_updated_at,
                CASE WHEN u.live_latitude IS NOT NULL
                     THEN ST_Distance(fl.location, ST_SetSRID(ST_MakePoint(u.live_longitude, u.live_latitude), 4326)::geography)
                     ELSE NULL END AS distance_meters
         FROM food_listings fl
         LEFT JOIN users u ON u.id = fl.matched_receiver_id
         WHERE fl.id = $1`,
        [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Listing not found' });
    if (req.user.sub !== row.donor_id && req.user.sub !== row.matched_receiver_id) {
        return res.status(403).json({ error: 'Not part of this listing' });
    }

    res.json({
        matchStatus: row.match_status,
        donorLocation: { lat: row.donor_lat, lon: row.donor_lon },
        receiverLocation: row.receiver_lat
            ? { lat: row.receiver_lat, lon: row.receiver_lon, updatedAt: row.live_location_updated_at }
            : null,
        distanceMeters: row.distance_meters
    });
});

// POST /api/listings/:id/verify-pickup  { otp }
// Either party on the listing can submit the code. A correct match completes
// the listing, stops the search, and counts toward the donor's rating. Wrong
// attempts are capped well below the 2-hour window so the code can't just be
// brute-forced (it's 6 digits).
const MAX_OTP_ATTEMPTS = 5;

router.post('/:id/verify-pickup', async (req, res) => {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ error: 'OTP is required' });

    const { rows } = await pool.query(
        `SELECT id, donor_id, matched_receiver_id, pickup_otp_hash, pickup_otp_expires_at, pickup_otp_attempts, match_status
         FROM food_listings WHERE id = $1`,
        [req.params.id]
    );
    const listing = rows[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const isParty = req.user.sub === listing.donor_id || req.user.sub === listing.matched_receiver_id;
    if (!isParty) return res.status(403).json({ error: 'Not part of this listing' });

    if (listing.match_status !== 'matched_pending_pickup') {
        return res.status(400).json({ error: 'This listing is not currently awaiting pickup confirmation' });
    }
    if (new Date(listing.pickup_otp_expires_at) < new Date()) {
        return res.status(400).json({ error: 'This pickup code has expired' });
    }
    if (listing.pickup_otp_attempts >= MAX_OTP_ATTEMPTS) {
        return res.status(429).json({ error: 'Too many incorrect attempts for this code' });
    }

    const otpOk = await bcrypt.compare(otp, listing.pickup_otp_hash);
    if (!otpOk) {
        await pool.query(`UPDATE food_listings SET pickup_otp_attempts = pickup_otp_attempts + 1 WHERE id = $1`, [listing.id]);
        return res.status(400).json({ error: 'Incorrect pickup code' });
    }

    await pool.query(
        `UPDATE food_listings
         SET match_status = 'completed', status = 'completed', completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [listing.id]
    );
    await pool.query(
        `UPDATE users SET completed_donations_count = completed_donations_count + 1 WHERE id = $1`,
        [listing.donor_id]
    );
    await pool.query(
        `UPDATE users SET live_latitude = NULL, live_longitude = NULL, live_location_updated_at = NULL WHERE id = $1`,
        [listing.matched_receiver_id]
    );

    res.json({ message: 'Pickup confirmed - thank you!' });
});

module.exports = router;