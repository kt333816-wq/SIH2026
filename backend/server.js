require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const receiverRoutes = require('./routes/receiver');
const listingsRoutes = require('./routes/listings');
const donorRoutes = require('./routes/donor');
const { runExpirySweep } = require('./utils/expirySweep');

const app = express();
// Trust reverse proxies (required for hosted environments like Render)
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/receiver', receiverRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/donor', donorRoutes);
// generic error handler (e.g. multer file-size/type errors)
app.use((err, req, res, next) => {
    console.error(err.message);
    res.status(400).json({ error: err.message || 'Request failed' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Serviso auth backend running on port ${PORT}`));

// Flips any listing past its 2-hour human-feed window over to animal feed.
// Single-process setInterval is fine on Render's free/single-instance tier;
// if this ever runs across multiple instances, move this to a proper job
// queue so the sweep doesn't run redundantly per instance.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
runExpirySweep().catch(err => console.error('Initial expiry sweep failed:', err.message));
setInterval(() => {
    runExpirySweep().catch(err => console.error('Expiry sweep failed:', err.message));
}, SWEEP_INTERVAL_MS);