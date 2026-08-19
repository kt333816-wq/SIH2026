const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

// Matches the listing's expires_for_human_at window from schema.sql - the OTP
// is valid exactly as long as the listing is allowed to keep targeting human feed.
const OTP_VALIDITY_MS = 2 * 60 * 60 * 1000; // 2 hours

function generateOtpCode() {
    return crypto.randomInt(100000, 999999).toString();
}

// Finds the nearest receiver whose feed_preference matches feedType
// ('human' | 'animal', or receivers who marked 'both'), and - if found -
// marks the listing matched and generates a pickup OTP.
//
// Returns { receiverId, otp, expiresAt } on a match, or null if no receiver
// was found (the listing is left in a "searching" state either way).
//
// Note: this doesn't yet account for a receiver already sitting on another
// matched_pending_pickup listing - first pass just picks nearest by feed
// preference. Worth revisiting once listing volume is high enough for that
// to matter.
async function attemptMatch(listingId, feedType) {
    const client = await pool.connect();
    try {
        const { rows: listingRows } = await client.query(
            `SELECT id, donor_id, location FROM food_listings WHERE id = $1`,
            [listingId]
        );
        const listing = listingRows[0];
        if (!listing || !listing.location) return null;

        const { rows: matchRows } = await client.query(
            `SELECT rp.user_id
             FROM receiver_profiles rp
             WHERE rp.feed_preference IN ($1, 'both')
             ORDER BY rp.location <-> $2
             LIMIT 1`,
            [feedType, listing.location]
        );
        const receiver = matchRows[0];

        if (!receiver) {
            await client.query(
                `UPDATE food_listings
                 SET match_status = $1, feed_type = $2, updated_at = now()
                 WHERE id = $3`,
                [feedType === 'human' ? 'searching_human' : 'searching_animal', feedType, listingId]
            );
            return null;
        }

        const otp = generateOtpCode();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + OTP_VALIDITY_MS);

        await client.query(
            `UPDATE food_listings
             SET matched_receiver_id = $1,
                 feed_type = $2,
                 match_status = 'matched_pending_pickup',
                 pickup_otp_hash = $3,
                 pickup_otp_expires_at = $4,
                 pickup_otp_attempts = 0,
                 matched_at = now(),
                 updated_at = now()
             WHERE id = $5`,
            [receiver.user_id, feedType, otpHash, expiresAt, listingId]
        );

        return { receiverId: receiver.user_id, otp, expiresAt };
    } finally {
        client.release();
    }
}

module.exports = { attemptMatch, generateOtpCode, OTP_VALIDITY_MS };