const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const connectDB = require('./config/db');
const { errorHandler } = require('./middlewares/errorMiddleware');
const { ensureGoVerifier, stopGoVerifier } = require('./utils/spawnGo');
const { resetEngineCache } = require('./utils/verificationEngine');
const { startInboxSync, stopInboxSync } = require('./utils/imapSync');
const { resumeInterruptedJobs } = require('./utils/bulkVerifyWorker');
const { seedTemplatesForAllUsers } = require('./utils/seedTemplates');
const { startCampaignScheduler, stopCampaignScheduler } = require('./utils/campaignScheduler');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
let startPromise = null;

async function start() {
    resetEngineCache();
    console.log('Connecting to database...');
    await connectDB();

    if (!IS_SERVERLESS) {
        console.log('Starting truemail-go verifier for local development...');
        await ensureGoVerifier();
        console.log('Starting inbox sync worker...');
        startInboxSync();
        console.log('Starting campaign scheduler...');
        startCampaignScheduler();
        console.log('Resuming any interrupted verify jobs...');
        await resumeInterruptedJobs();
        console.log('Seeding email templates for all users...');
        await seedTemplatesForAllUsers();
    } else {
        console.log('Cloud runtime detected. Use Settings or env vars for hosted verifier URLs.');
    }

    return app;
}

function ensureStarted() {
    if (!startPromise) startPromise = start();
    return startPromise;
}

app.use(
    helmet({
        contentSecurityPolicy: false,
    })
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(async (req, res, next) => {
    try {
        await ensureStarted();
        next();
    } catch (err) {
        next(err);
    }
});

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/verify', require('./routes/verifyRoutes'));
app.use('/api/history', require('./routes/historyRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/senders', require('./routes/senderRoutes'));
app.use('/api/templates', require('./routes/templateRoutes'));
app.use('/api/campaigns', require('./routes/campaignRoutes'));
app.use('/api/inbox', require('./routes/inboxRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/suppression', require('./routes/suppressionRoutes'));

app.use(errorHandler);

if (require.main === module) {
    ensureStarted()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`Server running on port ${PORT}`);
                console.log(`Open http://localhost:${PORT}`);
            });
        })
        .catch(err => {
            console.error('Failed to start:', err.message);
            process.exit(1);
        });
}

process.on('SIGINT', () => {
    stopInboxSync();
    stopCampaignScheduler();
    stopGoVerifier();
    process.exit(0);
});

module.exports = app;
