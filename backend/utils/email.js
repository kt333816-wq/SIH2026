const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function sendOtpEmail(toEmail, name, code) {
    await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: toEmail,
        subject: `Your Serviso verification code: ${code}`,
        text: `Hi ${name},\n\nYour Serviso verification code is ${code}. It expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.\n\nIf you didn't request this, ignore this email.`,
        html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
                <h2 style="color:#e67e22;">Serviso</h2>
                <p>Hi ${name},</p>
                <p>Your verification code is:</p>
                <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color:#492f23;">${code}</p>
                <p>This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. If you didn't request this, you can safely ignore this email.</p>
            </div>
        `
    });
}

const STATUS_COPY = {
    suspended: {
        subject: 'Your Serviso account has been suspended',
        text: (name, reason) => `Hi ${name},\n\nYour Serviso account has been temporarily suspended pending review.${reason ? ` Reason: ${reason}` : ''}\n\nContact support@serviso.org if you believe this is a mistake.`
    },
    terminated: {
        subject: 'Your Serviso account has been terminated',
        text: (name, reason) => `Hi ${name},\n\nYour Serviso account has been permanently terminated.${reason ? ` Reason: ${reason}` : ''}\n\nContact support@serviso.org if you believe this is a mistake.`
    },
    reactivated: {
        subject: 'Your Serviso account is active again',
        text: (name) => `Hi ${name},\n\nYour Serviso account has been reactivated. You can log in again now.`
    }
};

async function sendAccountStatusEmail(toEmail, name, status, reason) {
    const copy = STATUS_COPY[status];
    if (!copy) return;
    await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: toEmail,
        subject: copy.subject,
        text: copy.text(name, reason)
    });
}

module.exports = { sendOtpEmail, sendAccountStatusEmail };