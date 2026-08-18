const express = require('express');
const router = express.Router();
const db = require('../db'); // Your PostgreSQL pool instance

// Helper function: Find closest receiver based on coordinates and feed type
async function findNearestReceiver(lat, lng, preferredType) {
    // 1. Try finding primary match (Human or Animal)
    const matchQuery = `
        SELECT rp.user_id, rp.full_address,
               earth_distance(ll_to_earth($1, $2), ll_to_earth(rp.latitude, rp.longitude)) AS distance_meters
        FROM receiver_profiles rp
        WHERE (rp.feed_preference = $3 OR rp.feed_preference = 'both')
        ORDER BY distance_meters ASC
        LIMIT 1;
    `;
    let res = await db.query(matchQuery, [lat, lng, preferredType]);

    if (res.rows.length > 0) {
        return { receiverId: res.rows[0].user_id, finalFeedType: preferredType };
    }

    // 2. Fallback: If no human receiver is found, look for animal feed receivers
    if (preferredType === 'human') {
        const animalFallbackQuery = `
            SELECT rp.user_id,
                   earth_distance(ll_to_earth($1, $2), ll_to_earth(rp.latitude, rp.longitude)) AS distance_meters
            FROM receiver_profiles rp
            WHERE rp.feed_preference IN ('animal', 'both')
            ORDER BY distance_meters ASC
            LIMIT 1;
        `;
        let fallbackRes = await db.query(animalFallbackQuery, [lat, lng]);
        if (fallbackRes.rows.length > 0) {
            return { receiverId: fallbackRes.rows[0].user_id, finalFeedType: 'animal' };
        }
    }

    return { receiverId: null, finalFeedType: preferredType };
}

// Route 1: Save or Update Receiver Profile
router.post('/receiver/profile', async (req, res) => {
    const { userId, fullAddress, feedPreference, latitude, longitude } = req.body;
    try {
        const query = `
            INSERT INTO receiver_profiles (user_id, full_address, feed_preference, latitude, longitude, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (user_id) DO UPDATE 
            SET full_address = EXCLUDED.full_address,
                feed_preference = EXCLUDED.feed_preference,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                updated_at = NOW()
            RETURNING *;
        `;
        const result = await db.query(query, [userId, fullAddress, feedPreference, latitude, longitude]);
        res.json({ success: true, profile: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 2: Donor posts food and system assigns closest receiver
router.post('/listings/create', async (req, res) => {
    const { donorId, foodQuantity, address, feedType, latitude, longitude } = req.body;

    try {
        // Insert new food listing with 2-hour human expiration
        const insertQuery = `
            INSERT INTO food_listings (donor_id, food_quantity, address, feed_type, latitude, longitude, expires_for_human_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '2 hours')
            RETURNING *;
        `;
        const listingRes = await db.query(insertQuery, [donorId, foodQuantity, address, feedType || 'human', latitude, longitude]);
        const listing = listingRes.rows[0];

        // Search nearest receiver
        const { receiverId, finalFeedType } = await findNearestReceiver(latitude, longitude, listing.feed_type);

        if (receiverId) {
            await db.query(
                `UPDATE food_listings SET matched_receiver_id = $1, feed_type = $2, status = 'claimed' WHERE id = $3`,
                [receiverId, finalFeedType, listing.id]
            );
        }

        res.json({
            success: true,
            listingId: listing.id,
            matchedReceiverId: receiverId,
            assignedFeedType: finalFeedType
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 3: Cron background task to convert >2 hour old human food into animal feed
router.post('/listings/check-expirations', async (req, res) => {
    try {
        const updateQuery = `
            UPDATE food_listings 
            SET feed_type = 'animal' 
            WHERE status = 'available' 
              AND feed_type = 'human' 
              AND NOW() > expires_for_human_at;
        `;
        const result = await db.query(updateQuery);
        res.json({ success: true, updatedListings: result.rowCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;