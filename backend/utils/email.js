const { Resend } = require('resend');

// Initialize Resend client using environment variable
const resend = new Resend(process.env.RESEND_API_KEY || process.env.SMTP_PASS);

async function sendOtpEmail(toEmail, name, code) {
    const fromAddress = process.env.EMAIL_FROM || 'Serviso ';

    const { data, error } = await resend.emails.send({
        from: fromAddress,
        to: [toEmail],
        subject: `Your Serviso verification code: ${code}`,
        html: `
            
                Serviso
                Hi ${name},
                Your verification code is:
                ${code}
                This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. If you didn't request this, you can safely ignore this email.
            
        `
    });

    if (error) {
        console.error('Resend API execution error:', error);
        throw new Error(error.message || 'Failed to send verification email');
    }

    return data;
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
    
    await resend.emails.send({
        from: process.env.EMAIL_FROM || 'Serviso ',
        to: [toEmail],
        subject: copy.subject,
        text: copy.text(name, reason)
    });
}

module.exports = { sendOtpEmail, sendAccountStatusEmail };