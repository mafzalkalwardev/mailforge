const nodemailer = require('nodemailer');
const { decrypt } = require('./crypto');

function createTransport(sender) {
    const password = decrypt(sender.encryptedPassword);
    return nodemailer.createTransport({
        host: sender.smtpHost || 'smtp.gmail.com',
        port: sender.smtpPort || 465,
        secure: (sender.smtpPort || 465) === 465,
        auth: {
            user: sender.email,
            pass: password,
        },
        connectionTimeout: 15000,
    });
}

async function verifySmtp(sender) {
    const transport = createTransport(sender);
    await transport.verify();
    await transport.close();
}

async function sendWarmUp(sender) {
    const transport = createTransport(sender);
    const name = sender.displayName || sender.email;
    const info = await transport.sendMail({
        from: `"${name}" <${sender.email}>`,
        to: sender.email,
        subject: 'MailForge — account warm-up',
        text: 'This is a warm-up message sent before your campaign begins.',
    });
    await transport.close();
    return info.messageId;
}

async function sendCampaignMessage(sender, to, subject, body, options = {}) {
    const transport = createTransport(sender);
    const name = sender.displayName || sender.email;
    const mailOptions = {
        from: `"${name}" <${sender.email}>`,
        to,
        subject,
        text: body,
    };
    if (options.inReplyTo) {
        const id = String(options.inReplyTo).replace(/^<|>$/g, '');
        mailOptions.inReplyTo = `<${id}>`;
        mailOptions.references = options.references || `<${id}>`;
    }
    const info = await transport.sendMail(mailOptions);
    await transport.close();
    return info.messageId || '';
}

async function sendReplyMessage(sender, { to, subject, body, inReplyTo, references }) {
    const replySubject = subject && /^re:/i.test(subject.trim()) ? subject : `Re: ${subject || ''}`;
    return sendCampaignMessage(sender, to, replySubject.trim(), body, { inReplyTo, references });
}

module.exports = { createTransport, verifySmtp, sendWarmUp, sendCampaignMessage, sendReplyMessage };
