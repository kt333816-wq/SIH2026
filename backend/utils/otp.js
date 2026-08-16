const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const OTP_LENGTH = parseInt(process.env.OTP_LENGTH || '6', 10);
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
const MAX_ATTEMPTS = 5;

function generateCode() {
    const max = 10 ** OTP_LENGTH;
    const code = crypto.randomInt(0, max).toString().padStart(OTP_LENGTH, '0');
    return code;
}

async function createOtp(userId, purpose = 'email_verification') {
    const code = generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await pool.query(
        `UPDATE otp_codes SET consumed = TRUE WHERE user_id = $1 AND purpose = $2 AND consumed = FALSE`,
        [userId, purpose]
    );

    await pool.query(
        `INSERT INTO otp_codes (user_id, code_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)`,
        [userId, codeHash, purpose, expiresAt]
    );

    return code; // plaintext, only ever used to send the email - never stored or logged
}

async function verifyOtp(userId, purpose, submittedCode) {
    const { rows } = await pool.query(
        `SELECT * FROM otp_codes
         WHERE user_id = $1 AND purpose = $2 AND consumed = FALSE
         ORDER BY created_at DESC LIMIT 1`,
        [userId, purpose]
    );

    const record = rows[0];
    if (!record) return { ok: false, reason: 'no_active_code' };
    if (new Date(record.expires_at) < new Date()) return { ok: false, reason: 'expired' };
    if (record.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

    const match = await bcrypt.compare(submittedCode, record.code_hash);

    if (!match) {
        await pool.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [record.id]);
        return { ok: false, reason: 'incorrect' };
    }

    await pool.query(`UPDATE otp_codes SET consumed = TRUE WHERE id = $1`, [record.id]);
    return { ok: true };
}

module.exports = { createOtp, verifyOtp };