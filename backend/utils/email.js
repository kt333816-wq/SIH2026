const brevo = require('@getbrevo/brevo');

// Initialize the Brevo API client
const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
    brevo.TransactionalEmailsApiApiKeys.apiKey,
    process.env.BREVO_API_KEY
);

async function sendOtpEmail(toEmail, name, code) {
    const sendSmtpEmail = new brevo.SendSmtpEmail();

    sendSmtpEmail.subject = `Your Serviso verification code: ${code}`;
    sendSmtpEmail.sender = { 
        name: 'Serviso', 
        email: process.env.EMAIL_FROM || 'kt333816@gmail.com' 
    };
    sendSmtpEmail.to = [{ email: toEmail, name: name }];
    sendSmtpEmail.htmlContent = `
        <div style="font-family: sans-serif; max-width: 480px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color:#e67e22; margin-top:0;">Serviso</h2>
            <p>Hi ${name},</p>
            <p>Your verification code is:</p>
            <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color:#492f23; background:#f9f9f9; padding: 10px; text-align: center; border-radius: 4px;">${code}</p>
            <p>This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. If you didn't request this, you can safely ignore this email.</p>
        </div>
    `;

    try {
        const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
        return data;
    } catch (error) {
        console.error('Brevo execution error:', error.response?.body || error.message);
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

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = copy.subject;
    sendSmtpEmail.sender = { 
        name: 'Serviso', 
        email: process.env.EMAIL_FROM || 'kt333816@gmail.com' 
    };
    sendSmtpEmail.to = [{ email: toEmail, name: name }];
    sendSmtpEmail.textContent = copy.text(name, reason);

    try {
        await apiInstance.sendTransacEmail(sendSmtpEmail);
    } catch (error) {
        console.error('Brevo execution error:', error.response?.body || error.message);
    }
}

module.exports = { sendOtpEmail, sendAccountStatusEmail };