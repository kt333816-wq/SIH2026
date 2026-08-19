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

module.exports = router;