const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { geocodeAddress } = require('../utils/geocode');

const router = express.Router();
router.use(requireAuth);

// GET /api/receiver/profile - the logged-in receiver's saved profile, if any
router.get('/profile', async (req, res) => {
    if (req.user.role !== 'receiver') return res.status(403).json({ error: 'Receiver accounts only' });

    const { rows } = await pool.query(
        `SELECT full_address, feed_preference, latitude, longitude, updated_at
         FROM receiver_profiles WHERE user_id = $1`,
        [req.user.sub]
    );
    res.json({ profile: rows[0] || null });
});

// POST /api/receiver/profile  { full_address, feed_preference }
// Creates or updates the receiver's profile. Geocodes the address server-side
// so the distance-matching step (added next) has coordinates to work with.
router.post('/profile', async (req, res) => {
    if (req.user.role !== 'receiver') return res.status(403).json({ error: 'Receiver accounts only' });

    const { full_address, feed_preference } = req.body;
    if (!full_address || !full_address.trim()) {
        return res.status(400).json({ error: 'Full address is required' });
    }
    if (!['human', 'animal', 'both'].includes(feed_preference)) {
        return res.status(400).json({ error: 'feed_preference must be human, animal, or both' });
    }

    let coords;
    try {
        coords = await geocodeAddress(full_address);
    } catch (err) {
        return res.status(400).json({ error: 'Could not locate that address - please check it and try again' });
    }

    await pool.query(
        `INSERT INTO receiver_profiles (user_id, full_address, feed_preference, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
         SET full_address = EXCLUDED.full_address,
             feed_preference = EXCLUDED.feed_preference,
             latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude,
             updated_at = now()`,
        [req.user.sub, full_address.trim(), feed_preference, coords.lat, coords.lon]
    );

    res.json({ message: 'Receiver profile saved', location: coords });
});

// GET /api/receiver/current-match - does this receiver currently have a
// listing matched and awaiting pickup? Used to decide whether to show the
// "share my live location" control at all.
router.get('/current-match', async (req, res) => {
    if (req.user.role !== 'receiver') return res.status(403).json({ error: 'Receiver accounts only' });

    const { rows } = await pool.query(
        `SELECT id AS listing_id, feed_type, pickup_otp_expires_at
         FROM food_listings
         WHERE matched_receiver_id = $1 AND match_status = 'matched_pending_pickup'
         ORDER BY matched_at DESC LIMIT 1`,
        [req.user.sub]
    );
    res.json({ match: rows[0] || null });
});

// POST /api/receiver/live-location  { lat, lon }
// Only accepted while the receiver has an active matched_pending_pickup
// listing - there's no reason to store or expose a receiver's location
// outside an active handover.
router.post('/live-location', async (req, res) => {
    if (req.user.role !== 'receiver') return res.status(403).json({ error: 'Receiver accounts only' });

    const { lat, lon } = req.body;
    if (typeof lat !== 'number' || typeof lon !== 'number') {
        return res.status(400).json({ error: 'lat and lon must be numbers' });
    }

    const { rows } = await pool.query(
        `SELECT id FROM food_listings WHERE matched_receiver_id = $1 AND match_status = 'matched_pending_pickup' LIMIT 1`,
        [req.user.sub]
    );
    if (!rows[0]) {
        return res.status(400).json({ error: 'No active pickup to share your location for' });
    }

    await pool.query(
        `UPDATE users SET live_latitude = $1, live_longitude = $2, live_location_updated_at = now() WHERE id = $3`,
        [lat, lon, req.user.sub]
    );
    res.json({ message: 'Location updated' });
});

module.exports = router;