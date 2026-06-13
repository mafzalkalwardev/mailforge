const { ImapFlow } = require('imapflow');
const SenderAccount = require('../models/SenderAccount');
const InboxMessage = require('../models/InboxMessage');
const Campaign = require('../models/Campaign');
const { decrypt } = require('./crypto');

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
    });

    let synced = 0;
    await client.connect();
    try {
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
                    receivedAt,
                });
                synced++;
            }
        } finally {
            lock.release();
        }
    } finally {
        await client.logout();
    }

    account.lastSyncAt = new Date();
    await account.save();
    return synced;
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
        }
    } finally {
        syncing = false;
    }
}

function startInboxSync(intervalMs = 5 * 60 * 1000) {
    if (syncTimer) return;
    setTimeout(() => syncAllAccounts().catch(() => {}), 10000);
    syncTimer = setInterval(() => syncAllAccounts().catch(() => {}), intervalMs);
}

function stopInboxSync() {
    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
    }
}

module.exports = { syncAllAccounts, syncSenderAccount, startInboxSync, stopInboxSync, findCampaignForReply };
