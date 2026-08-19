const pool = require('../db/pool');
const { attemptMatch } = require('./matching');

// Runs periodically (see server.js). Any listing still targeting human feed
// once its 2-hour window has passed - whether it was never matched at all,
// or was matched but the pickup OTP was never confirmed in time - falls
// through to animal feed instead.
async function runExpirySweep() {
    const { rows: expired } = await pool.query(
        `SELECT id, matched_receiver_id FROM food_listings
         WHERE feed_type = 'human'
           AND match_status IN ('searching_human', 'matched_pending_pickup')
           AND expires_for_human_at <= now()`
    );

    for (const { id, matched_receiver_id } of expired) {
        await pool.query(
            `UPDATE food_listings
             SET matched_receiver_id = NULL,
                 pickup_otp_hash = NULL,
                 pickup_otp_expires_at = NULL,
                 pickup_otp_attempts = 0,
                 feed_type = 'animal',
                 match_status = 'searching_animal',
                 updated_at = now()
             WHERE id = $1`,
            [id]
        );

        if (matched_receiver_id) {
            await pool.query(
                `UPDATE users SET live_latitude = NULL, live_longitude = NULL, live_location_updated_at = NULL WHERE id = $1`,
                [matched_receiver_id]
            );
        }

        await attemptMatch(id, 'animal').catch(err =>
            console.error(`Animal-feed match failed for listing ${id}:`, err.message)
        );
    }

    if (expired.length) {
        console.log(`Expiry sweep: moved ${expired.length} listing(s) to animal feed`);
    }
}

module.exports = { runExpirySweep };