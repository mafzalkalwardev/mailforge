const crypto = require('crypto');

function getSecret() {
    return process.env.JWT_SECRET || process.env.UNSUBSCRIBE_SECRET || 'mailforge-unsubscribe-dev';
}

function signUnsubscribeToken(userId, email) {
    const payload = `${userId}:${String(email).toLowerCase().trim()}`;
    const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
    return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyUnsubscribeToken(token) {
    try {
        const decoded = Buffer.from(token, 'base64url').toString('utf8');
        const lastColon = decoded.lastIndexOf(':');
        if (lastColon <= 0) return null;
        const sig = decoded.slice(lastColon + 1);
        const payload = decoded.slice(0, lastColon);
        const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
        if (sig !== expected) return null;
        const [userId, email] = payload.split(':');
        if (!userId || !email) return null;
        return { userId, email };
    } catch {
        return null;
    }
}

module.exports = { signUnsubscribeToken, verifyUnsubscribeToken };
