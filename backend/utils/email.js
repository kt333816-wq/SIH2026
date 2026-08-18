const { BrevoClient } = require('@getbrevo/brevo');

// Initialize the Brevo API client
const brevo = new BrevoClient({
    apiKey: process.env.BREVO_API_KEY
});

async function sendOtpEmail(toEmail, name, code) {
    try {
        const data = await brevo.transactionalEmails.sendTransacEmail({
            subject: `Your Serviso verification code: ${code}`,
            sender: { 
                name: 'Serviso', 
                email: process.env.EMAIL_FROM || 'kt333816@gmail.com' 
            },
            to: [{ email: toEmail, name: name }],
            htmlContent: `
                <div style="font-family: sans-serif; max-width: 480px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color:#e67e22; margin-top:0;">Serviso</h2>
                    <p>Hi ${name},</p>
                    <p>Your verification code is:</p>
                    <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color:#492f23; background:#f9f9f9; padding: 10px; text-align: center; border-radius: 4px;">${code}</p>
                    <p>This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. If you didn't request this, you can safely ignore this email.</p>
                </div>
            `
        });
        return data;
    } catch (error) {
        console.error('Brevo execution error:', error);
        throw new Error('Failed to send verification email');
    }
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

    try {
        await brevo.transactionalEmails.sendTransacEmail({
            subject: copy.subject,
            sender: { 
                name: 'Serviso', 
                email: process.env.EMAIL_FROM || 'kt333816@gmail.com' 
            },
            to: [{ email: toEmail, name: name }],
            textContent: copy.text(name, reason)
        });
    } catch (error) {
        console.error('Brevo execution error:', error);
    }
}

module.exports = { sendOtpEmail, sendAccountStatusEmail };