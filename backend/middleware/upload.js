const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '..', 'uploads'));
    },
    filename: (req, file, cb) => {
        const randomName = crypto.randomBytes(24).toString('hex');
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${randomName}${ext}`);
    }
});

function fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
        return cb(new Error('Only PDF, JPG, or PNG files are allowed'));
    }
    cb(null, true);
}

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_SIZE_BYTES }
});

module.exports = upload;