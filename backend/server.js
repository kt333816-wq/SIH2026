require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

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

// generic error handler (e.g. multer file-size/type errors)
app.use((err, req, res, next) => {
    console.error(err.message);
    res.status(400).json({ error: err.message || 'Request failed' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Serviso auth backend running on port ${PORT}`));