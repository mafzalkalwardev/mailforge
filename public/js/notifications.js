(function () {
    const KEY = 'mailforgeNotifyState';

    function loadState() {
        try {
            return JSON.parse(sessionStorage.getItem(KEY) || '{}');
        } catch {
            return {};
        }
    }

    function saveState(state) {
        sessionStorage.setItem(KEY, JSON.stringify(state));
    }

    function toast(msg, type) {
        if (typeof showToast === 'function') showToast(msg, type || 'success');
    }

    async function pollNotifications() {
        if (!localStorage.getItem('token') || typeof axios === 'undefined') return;

        const state = loadState();

        try {
            const verifyRes = await axios.get('/api/verify/jobs/active');
            const active = verifyRes.data?.active;
            const job = verifyRes.data?.job;
            const jobId = job?._id;

            if (state.verifyJobId && state.verifyJobId === jobId && !active) {
                const stats = job?.stats || job?.progress || {};
                toast(`Verification finished — ${stats.valid ?? 0} valid, ${stats.invalid ?? 0} invalid`, 'success');
                state.verifyJobId = null;
            }
            if (active && jobId) state.verifyJobId = jobId;

            const campRes = await axios.get('/api/campaigns');
            const campaigns = campRes.data || [];
            const running = campaigns.filter(c => c.status === 'running').map(c => c._id);
            const prevRunning = state.runningCampaigns || [];

            for (const id of prevRunning) {
                if (!running.includes(id)) {
                    const c = campaigns.find(x => String(x._id) === String(id));
                    if (c) {
                        const s = c.stats || {};
                        toast(`Campaign "${c.name}" ${c.status} — ${s.sent || 0} sent, ${s.failed || 0} failed`, c.status === 'completed' ? 'success' : 'info');
                    }
                }
            }
            state.runningCampaigns = running;

            saveState(state);
        } catch (_) {}
    }

    document.addEventListener('DOMContentLoaded', () => {
        pollNotifications();
        setInterval(pollNotifications, 12000);
    });
})();
