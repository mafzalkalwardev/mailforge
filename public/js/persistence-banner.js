(function () {
    async function showPersistenceBanner() {
        if (!localStorage.getItem('token')) return;
        try {
            const res = await axios.get('/api/health');
            const storage = res.data?.storage;
            if (!storage || storage.persistent) return;

            if (document.getElementById('persistenceBanner')) return;

            const el = document.createElement('div');
            el.id = 'persistenceBanner';
            el.className = 'alert alert-warning border-0 rounded-0 mb-0 text-center py-2 small';
            el.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-2"></i>
                <strong>In-memory mode:</strong> verified lists, senders, and campaigns are lost when you stop the server.
                Run the Windows installer or set <code>MAILFORGE_DB_MODE=embedded</code>, then restart.
                <button type="button" class="btn btn-sm btn-outline-dark ms-2" id="dismissPersistenceBanner">Dismiss</button>`;
            document.body.prepend(el);
            document.getElementById('dismissPersistenceBanner')?.addEventListener('click', () => el.remove());
        } catch (_) {}
    }

    function showSmtpBanner(smtp) {
        if (!smtp || !smtp.degraded || document.getElementById('smtpHealthBanner')) return;
        const reason = smtp.port25?.reason || smtp.proxy?.reason || 'SMTP verification is degraded';
        const via = smtp.proxy?.configured
            ? `Proxy ${smtp.proxy.endpoint || 'SOCKS5'}`
            : 'Direct port 25';
        const el = document.createElement('div');
        el.id = 'smtpHealthBanner';
        el.className = 'alert alert-warning border-0 rounded-0 mb-0 text-center py-2 small';
        el.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-2"></i>
            <strong>Verification degraded.</strong> ${via}: ${reason}.
            Addresses will not be marked valid until an MX accepts RCPT TO.
            <a href="/settings.html" class="alert-link ms-1">Settings</a>`;
        document.body.prepend(el);
    }

    async function showSmtpHealthBanner() {
        try {
            const res = await axios.get('/api/health');
            showSmtpBanner(res.data?.smtp);
        } catch (_) {}
    }

    document.addEventListener('DOMContentLoaded', () => {
        showPersistenceBanner();
        showSmtpHealthBanner();
    });
})();
