const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { computeDonorRating } = require('../utils/rating');

const router = express.Router();
router.use(requireAuth);

// GET /api/donor/profile - donation count + calculated rating. Shown on both
// donor sub-interfaces (Public and Restaurant/Govt Canteen); showSurplusPrediction
// tells the frontend whether to render the AI panel for this account.
router.get('/profile', async (req, res) => {
    if (req.user.role !== 'donor') return res.status(403).json({ error: 'Donor accounts only' });

    const { rows } = await pool.query(
        `SELECT sub_role, completed_donations_count FROM users WHERE id = $1`,
        [req.user.sub]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
        subRole: user.sub_role,
        completedDonationsCount: user.completed_donations_count,
        rating: computeDonorRating(user.completed_donations_count),
        showSurplusPrediction: user.sub_role === 'restaurant_canteen'
    });
});

// GET /api/donor/surplus-prediction
// Restaurant/govt canteen accounts only. This is a starting heuristic, not a
// trained model: it looks at this donor's own past listings on the same day
// of the week and surfaces the most common quantity they've listed before.
// There's no cross-donor data yet to justify a real ML model - once there's
// enough listing volume, swap this out and keep the same response shape
// (surplus_predictions table already exists for logging predictions to
// evaluate against later).
router.get('/surplus-prediction', async (req, res) => {
    if (req.user.role !== 'donor') return res.status(403).json({ error: 'Donor accounts only' });

    const { rows: userRows } = await pool.query(`SELECT sub_role FROM users WHERE id = $1`, [req.user.sub]);
    if (userRows[0]?.sub_role !== 'restaurant_canteen') {
        return res.status(403).json({ error: 'Surplus prediction is available for restaurant / govt canteen accounts only' });
    }

    const dayOfWeek = new Date().getDay(); // 0 = Sunday ... 6 = Saturday
    const { rows } = await pool.query(
        `SELECT food_quantity FROM food_listings
         WHERE donor_id = $1 AND EXTRACT(DOW FROM created_at) = $2
         ORDER BY created_at DESC LIMIT 10`,
        [req.user.sub, dayOfWeek]
    );

    if (rows.length === 0) {
        return res.json({
            method: 'heuristic_avg',
            hasEnoughData: false,
            message: 'Not enough listing history yet on this day of the week to predict - once you list a few more times, this will start suggesting amounts.'
        });
    }

    const counts = {};
    rows.forEach(r => { counts[r.food_quantity] = (counts[r.food_quantity] || 0) + 1; });
    const [mostCommonQuantity, occurrences] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const confidence = Math.round((occurrences / rows.length) * 100) / 100;

    await pool.query(
        `INSERT INTO surplus_predictions (donor_id, predicted_for_date, predicted_quantity_hint, confidence)
         VALUES ($1, CURRENT_DATE, $2, $3)
         ON CONFLICT (donor_id, predicted_for_date) DO UPDATE
         SET predicted_quantity_hint = EXCLUDED.predicted_quantity_hint, confidence = EXCLUDED.confidence`,
        [req.user.sub, mostCommonQuantity, confidence]
    );

    res.json({
        method: 'heuristic_avg',
        hasEnoughData: true,
        predictedQuantityHint: mostCommonQuantity,
        confidence,
        basedOnListings: rows.length,
        message: `Based on your last ${rows.length} listing(s) on this day of the week, expect around "${mostCommonQuantity}" - list it early so we can start matching before it goes to waste.`
    });
});

module.exports = router;