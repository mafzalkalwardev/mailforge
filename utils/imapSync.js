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
    const headers = parts[0] || '';
    let body = parts.length < 2 ? raw : parts.slice(1).join('\n\n');
    if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) {
        body = decodeQuotedPrintable(body);
    }
    return body.slice(0, 50000);
}

function decodeQuotedPrintable(value) {
    const binary = String(value || '')
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(binary, 'binary').toString('utf8')
        .replace(/\r\n/g, '\n');
}

function extractHeader(source, name) {
    if (!source) return '';
    const raw = Buffer.isBuffer(source) ? source.toString('utf8') : String(source);
    const re = new RegExp(`^${name}:\\s*(.+)$`, 'im');
    const m = raw.match(re);
    return m ? m[1].trim() : '';
}

function formatAddressList(list, fallback = '') {
    if (!list || !list.length) return fallback;
    return list.map(addr => {
        const email = addr.address || '';
        return `${addr.name || ''} <${email}>`.trim();
    }).filter(Boolean).join(', ');
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

async function findSentMailbox(client) {
    const commonNames = ['[Gmail]/Sent Mail', 'Sent', 'Sent Mail', 'Sent Items', 'Sent Messages'];
    try {
        const boxes = await client.list();
        const sentByFlag = boxes.find(box => {
            const flags = [
                ...(box.specialUse ? [box.specialUse] : []),
                ...(box.flags ? Array.from(box.flags) : []),
            ].map(flag => String(flag).toLowerCase());
            return flags.some(flag => flag.includes('sent'));
        });
        if (sentByFlag?.path) return sentByFlag.path;

        const byName = boxes.find(box => commonNames.some(name => String(box.path || '').toLowerCase() === name.toLowerCase()));
        if (byName?.path) return byName.path;
    } catch (err) {
        console.warn('Sent mailbox discovery failed:', err.message);
    }
    return commonNames;
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

async function syncMailboxMessages(client, account, mailboxPath, options = {}) {
    const folder = options.folder || 'inbox';
    const lock = await client.getMailboxLock(mailboxPath);
    let synced = 0;

    try {
        const since = options.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        let uids = await client.search(options.unreadOnly ? { seen: false, since } : { since });
        if (!uids || !uids.length) return 0;
        if (options.maxMessages && uids.length > options.maxMessages) {
            uids = uids.slice(-options.maxMessages);
        }

        for await (const msg of client.fetch(uids, { envelope: true, source: true, uid: true })) {
            const uid = folder === 'sent' ? `sent:${mailboxPath}:${msg.uid}` : String(msg.uid);
            const exists = await InboxMessage.findOne({
                user: account.user,
                senderAccount: account._id,
                uid,
            });
            if (exists) continue;

            const subject = msg.envelope?.subject || '(no subject)';
            const bodyText = extractTextFromSource(msg.source);
            const messageId = extractHeader(msg.source, 'Message-ID') || msg.envelope?.messageId || '';
            const inReplyTo = extractHeader(msg.source, 'In-Reply-To');
            const receivedAt = msg.envelope?.date || new Date();
            const from = folder === 'sent'
                ? account.email
                : formatAddressList(msg.envelope?.from);
            const to = folder === 'sent'
                ? formatAddressList(msg.envelope?.to, '')
                : (msg.envelope?.to?.[0]?.address || account.email);

            const campaignId = folder === 'sent' ? null : await findCampaignForReply(account.user, inReplyTo, subject);
            const isBounce = folder === 'sent' ? false : detectBounce(from, subject, bodyText);
            const threadKey = threadKeyFromMessage(inReplyTo, messageId, subject);

            await InboxMessage.create({
                user: account.user,
                senderAccount: account._id,
                campaign: campaignId,
                folder,
                uid,
                messageId,
                inReplyTo,
                from,
                to,
                subject,
                bodyPreview: bodyText.slice(0, 500),
                body: bodyText,
                isRead: folder === 'sent',
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

    return synced;
}

async function syncSentMailboxes(client, account) {
    const sentMailbox = await findSentMailbox(client);
    const candidates = Array.isArray(sentMailbox) ? sentMailbox : [sentMailbox];
    for (const mailboxPath of candidates) {
        try {
            return await syncMailboxMessages(client, account, mailboxPath, {
                folder: 'sent',
                since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                maxMessages: 200,
            });
        } catch (err) {
            if (!Array.isArray(sentMailbox)) throw err;
        }
    }
    return 0;
}

async function syncSenderAccount(account) {
    const client = createImapClient(account);
    let inboxSynced = 0;
    let sentSynced = 0;

    try {
        await client.connect();
        inboxSynced = await syncMailboxMessages(client, account, 'INBOX', {
            folder: 'inbox',
            unreadOnly: true,
            since: account.lastSyncAt || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        });
        sentSynced = await syncSentMailboxes(client, account);

        account.lastSyncAt = new Date();
        await account.save();
    } finally {
        await safeCloseClient(client);
    }

    return { inbox: inboxSynced, sent: sentSynced, total: inboxSynced + sentSynced };
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
                if (count.total > 0) {
                    console.log(`Inbox sync: ${count.inbox} inbox, ${count.sent} sent new message(s) for ${account.email}`);
                }
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
