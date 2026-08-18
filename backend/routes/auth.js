const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const rateLimit = require('express-rate-limit');

const pool = require('../db/pool');
const upload = require('../middleware/upload');
const { isValidAadhaarFormat, hashAadhaar, lastFour } = require('../utils/aadhaar');
const { createOtp, verifyOtp } = require('../utils/otp');
const { sendOtpEmail } = require('../utils/email');
const { verifyTurnstile } = require('../utils/turnstile');

const router = express.Router();

// Sub-roles that require a document upload
const DOCUMENT_REQUIRED_SUB_ROLES = {
    restaurant_canteen: 'fssai_license',
    ngo_head: 'ngo_registration',
    social_worker_politician: 'aadhaar_card'
};

const VALID_COMBINATIONS = {
    donor: ['civilian', 'restaurant_canteen'],
    receiver: ['ngo_head', 'social_worker_politician']
};

const signupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many signup attempts, try again in a few minutes' } });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, message: { error: 'Too many attempts, try again later' } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: { error: 'Too many login attempts, try again later' } });

function signToken(user) {
    return jwt.sign(
        { sub: user.id, email: user.email, role: user.role, sub_role: user.sub_role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

// ---------------------------------------------------------------------------
// POST /api/auth/signup
// multipart/form-data: name, email, mobile, password, role, sub_role,
//                       aadhaar_number (if social_worker_politician), document (file, if required),
//                       turnstileToken
// ---------------------------------------------------------------------------
router.post('/signup', signupLimiter, upload.single('document'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { name, email, mobile, password, role, sub_role, aadhaar_number, turnstileToken } = req.body;

        if (!name || !email || !mobile || !password || !role || !sub_role) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!validator.isEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
        if (!validator.isMobilePhone(mobile, 'en-IN')) return res.status(400).json({ error: 'Invalid mobile number' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        if (!VALID_COMBINATIONS[role] || !VALID_COMBINATIONS[role].includes(sub_role)) {
            return res.status(400).json({ error: 'Invalid role / sub_role combination' });
        }

        const captchaOk = await verifyTurnstile(turnstileToken, req.ip);
        if (!captchaOk) return res.status(400).json({ error: 'Captcha verification failed' });

        const requiredDocType = DOCUMENT_REQUIRED_SUB_ROLES[sub_role];
        let aadhaarHash = null, aadhaarLast4 = null;

        if (sub_role === 'social_worker_politician') {
            if (!aadhaar_number) return res.status(400).json({ error: 'Aadhaar number is required for this account type' });
            if (!isValidAadhaarFormat(aadhaar_number)) {
                return res.status(400).json({ error: 'Aadhaar number is not a valid, well-formed Aadhaar number' });
            }
            aadhaarHash = hashAadhaar(aadhaar_number);
            aadhaarLast4 = lastFour(aadhaar_number);

            const dup = await client.query('SELECT id FROM users WHERE aadhaar_hash = $1', [aadhaarHash]);
            if (dup.rows.length > 0) {
                return res.status(409).json({ error: 'An account already exists for this Aadhaar number' });
            }
        }

        if (requiredDocType && !req.file) {
            return res.status(400).json({ error: `A ${requiredDocType.replace('_', ' ')} document upload is required for this account type` });
        }

        const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (existing.rows.length > 0) return res.status(409).json({ error: 'An account with this email already exists' });

        const passwordHash = await bcrypt.hash(password, 12);
        const initialStatus = 'pending_email_verification';

        await client.query('BEGIN');

        const insertResult = await client.query(
            `INSERT INTO users (name, email, mobile, password_hash, role, sub_role, aadhaar_hash, aadhaar_last4, account_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, name, email`,
            [name, email.toLowerCase(), mobile, passwordHash, role, sub_role, aadhaarHash, aadhaarLast4, initialStatus]
        );
        const user = insertResult.rows[0];

        if (req.file) {
            await client.query(
                `INSERT INTO documents (user_id, doc_type, file_path, original_name, mime_type)
                 VALUES ($1, $2, $3, $4, $5)`,
                [user.id, requiredDocType, req.file.path, req.file.originalname, req.file.mimetype]
            );
        }

        await client.query('COMMIT');

        const code = await createOtp(user.id, 'email_verification');
        await sendOtpEmail(user.email, user.name, code);

        res.status(201).json({
            message: 'Account created. Check your email for a verification code.',
            userId: user.id,
            requiresDocumentReview: !!requiredDocType
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Signup error:', err.message);
        res.status(500).json({ error: 'Something went wrong creating your account' });
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify-email   { userId, code }
// ---------------------------------------------------------------------------
router.post('/verify-email', otpLimiter, async (req, res) => {
    try {
        const { userId, code } = req.body;
        if (!userId || !code) return res.status(400).json({ error: 'Missing userId or code' });

        const result = await verifyOtp(userId, 'email_verification', code);
        if (!result.ok) {
            const messages = {
                no_active_code: 'No active code found - request a new one',
                expired: 'This code has expired - request a new one',
                too_many_attempts: 'Too many incorrect attempts - request a new code',
                incorrect: 'Incorrect code'
            };
            return res.status(400).json({ error: messages[result.reason] || 'Verification failed' });
        }

        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'Account not found' });

        // Every account activates immediately on email verification. Accounts that
        // uploaded a document/Aadhaar number are NOT gated behind admin approval -
        // they can log in right away. Admins audit submissions afterward and can
        // suspend or terminate an account if the uploaded info turns out to be false.
        await pool.query(
            `UPDATE users SET email_verified = TRUE, account_status = 'active', updated_at = now() WHERE id = $1`,
            [userId]
        );

        const hasDocs = ['restaurant_canteen', 'ngo_head', 'social_worker_politician'].includes(user.sub_role);

        res.json({
            message: hasDocs
                ? 'Email verified. Your account is active - you can log in now. Note: submitting false documents or an invalid Aadhaar number will get your account suspended.'
                : 'Email verified. You can now log in.',
            accountStatus: 'active'
        });
    } catch (err) {
        console.error('Verify email error:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/auth/resend-otp   { userId }
// ---------------------------------------------------------------------------
router.post('/resend-otp', otpLimiter, async (req, res) => {
    try {
        const { userId } = req.body;
        const { rows } = await pool.query('SELECT id, name, email, email_verified FROM users WHERE id = $1', [userId]);
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'Account not found' });
        if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });

        const code = await createOtp(user.id, 'email_verification');
        await sendOtpEmail(user.email, user.name, code);
        res.json({ message: 'A new code has been sent to your email' });
    } catch (err) {
        console.error('Resend OTP error:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login   { email, password, turnstileToken }
// ---------------------------------------------------------------------------
router.post('/login', loginLimiter, async (req, res) => {
    const { email, password, turnstileToken } = req.body;
    try {
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

        const captchaOk = await verifyTurnstile(turnstileToken, req.ip);
        if (!captchaOk) return res.status(400).json({ error: 'Captcha verification failed' });

        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        const user = rows[0];

        const logAttempt = (success) =>
            pool.query('INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, $3)', [email.toLowerCase(), req.ip, success]);

        const genericFail = async () => {
            await logAttempt(false);
            return res.status(401).json({ error: 'Incorrect email or password' });
        };

        if (!user) return genericFail();

        const passwordOk = await bcrypt.compare(password, user.password_hash);
        if (!passwordOk) return genericFail();

        if (!user.email_verified) {
            await logAttempt(false);
            return res.status(403).json({ error: 'Please verify your email before logging in', userId: user.id, needsEmailVerification: true });
        }
        if (user.account_status === 'suspended') {
            await logAttempt(false);
            return res.status(403).json({ error: 'Your account has been suspended.', reason: user.status_reason || undefined });
        }
        if (user.account_status === 'terminated') {
            await logAttempt(false);
            return res.status(403).json({ error: 'Your account has been terminated.', reason: user.status_reason || undefined });
        }

        await logAttempt(true);
        const token = signToken(user);
        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role, sub_role: user.sub_role }
        });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

module.exports = router;