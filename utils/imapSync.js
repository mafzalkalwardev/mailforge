const { ImapFlow } = require('imapflow');
const SenderAccount = require('../models/SenderAccount');
const InboxMessage = require('../models/InboxMessage');
const Campaign = require('../models/Campaign');
const { decrypt } = require('./crypto');
const { addSuppression } = require('./suppressionService');

const BOUNCE_FROM_PATTERNS = ['mailer-daemon', 'postmaster', 'mail delivery', 'noreply'];
const BOUNCE_SUBJECT_PATTERNS = ['delivery status', 'undeliverable', 'failure notice', 'returned mail', 'delivery failure'];
const BOUNCE_BODY_PATTERNS = ['550', 'user unknown', 'mailbox not found', 'address rejected', 'does not exist'];

function detectBounce(from, subject, body) {
    const f = String(from || '').toLowerCase();
    const s = String(subject || '').toLowerCase();
    const b = String(body || '').toLowerCase();
    if (BOUNCE_FROM_PATTERNS.some(p => f.includes(p))) return true;
    if (BOUNCE_SUBJECT_PATTERNS.some(p => s.includes(p))) return true;
    if (BOUNCE_SUBJECT_PATTERNS.some(p => s.includes(p)) && BOUNCE_BODY_PATTERNS.some(p => b.includes(p))) return true;
    return BOUNCE_SUBJECT_PATTERNS.some(p => s.includes(p)) || (BOUNCE_BODY_PATTERNS.filter(p => b.includes(p)).length >= 2);
}

function extractBouncedEmail(body, subject) {
    const text = `${subject || ''}\n${body || ''}`;
    const m = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/gi);
    if (!m) return null;
    const filtered = m.map(e => e.toLowerCase()).filter(e => !e.includes('mailer-daemon') && !e.includes('postmaster'));
    return filtered[0] || null;
}

function threadKeyFromMessage(inReplyTo, messageId, subject) {
    const base = inReplyTo || messageId || normalizeSubject(subject);
    return String(base || subject || 'unknown').replace(/^<|>$/g, '').slice(0, 200);
}

let syncTimer = null;
let syncing = false;

function normalizeSubject(subject) {
    return String(subject || '')
        .replace(/^re:\s*/i, '')
        .replace(/^fwd:\s*/i, '')
        .trim()
        .toLowerCase();
}

function extractTextFromSource(source) {
    if (!source) return '';
    const raw = Buffer.isBuffer(source) ? source.toString('utf8') : String(source);
    const parts = raw.split(/\r?\n\r?\n/);
    if (parts.length < 2) return raw.slice(0, 5000);
    return parts.slice(1).join('\n\n').slice(0, 50000);
}

function extractHeader(source, name) {
    if (!source) return '';
    const raw = Buffer.isBuffer(source) ? source.toString('utf8') : String(source);
    const re = new RegExp(`^${name}:\\s*(.+)$`, 'im');
    const m = raw.match(re);
    return m ? m[1].trim() : '';
}

function createImapClient(account) {
    const password = decrypt(account.encryptedPassword);
    const client = new ImapFlow({
        host: account.imapHost || 'imap.gmail.com',
        port: account.imapPort || 993,
        secure: true,
        auth: {
            user: account.email,
            pass: password,
        },
        logger: false,
        socketTimeout: 120000,
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        maxIdleTime: 60000,
    });

    client.on('error', (err) => {
        console.warn(`IMAP client error for ${account.email}:`, err.message);
    });

    return client;
}

async function safeCloseClient(client) {
    if (!client) return;
    try {
        await Promise.race([
            (async () => {
                try {
                    if (client.authenticated) {
                        await client.logout();
                    } else {
                        await client.close();
                    }
                } catch {
                    await client.close();
                }
            })(),
            new Promise(resolve => setTimeout(resolve, 4000)),
        ]);
    } catch (_) {
        // ignore
    }
    try {
        client.removeAllListeners('error');
        await client.close();
    } catch (_) {
        // ignore
    }
}

async function findCampaignForReply(userId, inReplyTo, subject) {
    const cleanId = String(inReplyTo || '').replace(/^<|>$/g, '').trim();
    if (cleanId) {
        const byMsgId = await Campaign.findOne({
            user: userId,
            'recipients.messageId': { $regex: cleanId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') },
        });
        if (byMsgId) return byMsgId._id;
    }

    const norm = normalizeSubject(subject);
    if (!norm) return null;

    const campaigns = await Campaign.find({ user: userId }).sort({ updatedAt: -1 }).limit(50);
    for (const c of campaigns) {
        for (const r of c.recipients || []) {
            if (r.subject && normalizeSubject(r.subject) === norm) {
                return c._id;
            }
        }
    }
    return null;
}

async function syncSenderAccount(account) {
    const client = createImapClient(account);
    let synced = 0;

    try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
            const since = account.lastSyncAt || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const uids = await client.search({ seen: false, since });
            if (!uids || !uids.length) return 0;

            for await (const msg of client.fetch(uids, { envelope: true, source: true, uid: true })) {
                const uid = String(msg.uid);
                const exists = await InboxMessage.findOne({
                    user: account.user,
                    senderAccount: account._id,
                    uid,
                });
                if (exists) continue;

                const from = msg.envelope?.from?.[0]
                    ? `${msg.envelope.from[0].name || ''} <${msg.envelope.from[0].address}>`.trim()
                    : '';
                const to = msg.envelope?.to?.[0]?.address || account.email;
                const subject = msg.envelope?.subject || '(no subject)';
                const bodyText = extractTextFromSource(msg.source);
                const messageId = extractHeader(msg.source, 'Message-ID') || msg.envelope?.messageId || '';
                const inReplyTo = extractHeader(msg.source, 'In-Reply-To');
                const receivedAt = msg.envelope?.date || new Date();

                const campaignId = await findCampaignForReply(account.user, inReplyTo, subject);
                const isBounce = detectBounce(from, subject, bodyText);
                const threadKey = threadKeyFromMessage(inReplyTo, messageId, subject);

                await InboxMessage.create({
                    user: account.user,
                    senderAccount: account._id,
                    campaign: campaignId,
                    uid,
                    messageId,
                    inReplyTo,
                    from,
                    to,
                    subject,
                    bodyPreview: bodyText.slice(0, 500),
                    body: bodyText,
                    isRead: false,
                    isBounce,
                    threadKey,
                    receivedAt,
                });

                if (isBounce) {
                    const bounced = extractBouncedEmail(bodyText, subject);
                    if (bounced) {
                        try {
                            await addSuppression(account.user, bounced, 'bounce', `Inbox bounce: ${subject}`.slice(0, 200));
                        } catch (_) {}
                    }
                }
                synced++;
            }
        } finally {
            lock.release();
        }

        account.lastSyncAt = new Date();
        await account.save();
    } finally {
        await safeCloseClient(client);
    }

    return synced;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncAllAccounts() {
    if (syncing) return;
    syncing = true;
    try {
        const accounts = await SenderAccount.find({ enabled: true });
        for (const account of accounts) {
            try {
                const count = await syncSenderAccount(account);
                if (count > 0) console.log(`Inbox sync: ${count} new message(s) for ${account.email}`);
            } catch (err) {
                console.warn(`Inbox sync failed for ${account.email}:`, err.message);
            }
            await sleep(1500);
        }
    } finally {
        syncing = false;
    }
}

function startInboxSync(intervalMs = 5 * 60 * 1000) {
    if (syncTimer) return;
    setTimeout(() => syncAllAccounts().catch(err => {
        console.warn('Inbox sync cycle error:', err.message);
    }), 10000);
    syncTimer = setInterval(() => syncAllAccounts().catch(err => {
        console.warn('Inbox sync cycle error:', err.message);
    }), intervalMs);
}

function stopInboxSync() {
    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
    }
}

module.exports = { syncAllAccounts, syncSenderAccount, startInboxSync, stopInboxSync, findCampaignForReply };
