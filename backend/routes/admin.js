const express = require('express');
const path = require('path');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendAccountStatusEmail } = require('../utils/email');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// List/search users. Query params: role, sub_role, status, hasDocuments=true, q (name/email search)
router.get('/users', async (req, res) => {
    const { role, sub_role, status, hasDocuments, q } = req.query;
    const conditions = [];
    const params = [];

    if (role) { params.push(role); conditions.push(`u.role = $${params.length}`); }
    if (sub_role) { params.push(sub_role); conditions.push(`u.sub_role = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`u.account_status = $${params.length}`); }
    if (q) { params.push(`%${q.toLowerCase()}%`); conditions.push(`(LOWER(u.name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`); }

    const docJoin = hasDocuments === 'true' ? 'INNER JOIN documents d ON d.user_id = u.id' : '';
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
        `SELECT DISTINCT u.id, u.name, u.email, u.mobile, u.role, u.sub_role, u.aadhaar_last4,
                u.account_status, u.email_verified, u.status_reason, u.created_at
         FROM users u ${docJoin} ${where}
         ORDER BY u.created_at DESC LIMIT 200`,
        params
    );
    res.json({ users: rows });
});

// Full detail for one user, including uploaded document metadata
router.get('/users/:userId', async (req, res) => {
    const { rows: userRows } = await pool.query(
        `SELECT id, name, email, mobile, role, sub_role, aadhaar_last4, account_status,
                email_verified, status_reason, status_changed_at, created_at
         FROM users WHERE id = $1`, [req.params.userId]
    );
    if (!userRows[0]) return res.status(404).json({ error: 'Not found' });

    const { rows: docRows } = await pool.query(
        `SELECT id, doc_type, original_name, mime_type, uploaded_at FROM documents WHERE user_id = $1`,
        [req.params.userId]
    );
    res.json({ user: userRows[0], documents: docRows });
});

// Stream a document file for the admin to inspect (auth-gated, not a public URL)
router.get('/documents/:docId/file', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.docId]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.resolve(doc.file_path));
});

// Suspend: temporary lock, e.g. a document/Aadhaar number looks off and needs a second look
router.post('/users/:userId/suspend', async (req, res) => {
    const { reason } = req.body;
    const result = await setStatus(req.params.userId, 'suspended', reason, req.user.sub);
    if (!result) return res.status(404).json({ error: 'User not found' });
    await sendAccountStatusEmail(result.email, result.name, 'suspended', reason).catch(err => console.error('Email failed:', err.message));
    res.json({ message: 'Account suspended' });
});

// Terminate: permanent lock, e.g. confirmed the uploaded document or Aadhaar number was false
router.post('/users/:userId/terminate', async (req, res) => {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A reason is required to terminate an account' });
    const result = await setStatus(req.params.userId, 'terminated', reason, req.user.sub);
    if (!result) return res.status(404).json({ error: 'User not found' });
    await sendAccountStatusEmail(result.email, result.name, 'terminated', reason).catch(err => console.error('Email failed:', err.message));
    res.json({ message: 'Account terminated' });
});

// Reactivate: undo a suspension once resolved
router.post('/users/:userId/reactivate', async (req, res) => {
    const result = await setStatus(req.params.userId, 'active', null, req.user.sub);
    if (!result) return res.status(404).json({ error: 'User not found' });
    await sendAccountStatusEmail(result.email, result.name, 'reactivated', null).catch(err => console.error('Email failed:', err.message));
    res.json({ message: 'Account reactivated' });
});

async function setStatus(userId, status, reason, adminId) {
    const { rows } = await pool.query(
        `UPDATE users SET account_status = $1, status_reason = $2, status_changed_by = $3, status_changed_at = now(), updated_at = now()
         WHERE id = $4 AND role != 'admin' RETURNING email, name`,
        [status, reason || null, adminId, userId]
    );
    return rows[0] || null;
}

module.exports = router;