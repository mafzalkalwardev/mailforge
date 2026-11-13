(function () {
    async function showPersistenceBanner() {
        if (!localStorage.getItem('token')) return;
        try {
            const res = await axios.get('/api/health');
            const storage = res.data?.storage;
            if (storage && !storage.persistent && !document.getElementById('persistenceBanner')) {
                const el = document.createElement('div');
                el.id = 'persistenceBanner';
                el.className = 'alert alert-warning border-0 rounded-0 mb-0 text-center py-2 small';
                el.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-2"></i>
                    <strong>In-memory mode:</strong> verified lists, senders, and campaigns are lost when you stop the server.
                    Run the Windows installer or set <code>MAILFORGE_DB_MODE=embedded</code>, then restart.
                    <button type="button" class="btn btn-sm btn-outline-dark ms-2" id="dismissPersistenceBanner">Dismiss</button>`;
                document.body.prepend(el);
                document.getElementById('dismissPersistenceBanner')?.addEventListener('click', () => el.remove());
            }

            let port25 = res.data?.port25 || res.data?.smtp?.port25;
            try {
                const verify = await axios.get('/api/verify/health', { timeout: 15000 });
                if (verify.data?.port25) port25 = verify.data.port25;
            } catch (_) {}
            renderPort25Banner(port25);
        } catch (_) {}
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[ch]));
    }

    function renderPort25Banner(port25) {
        if (!port25 || port25.pending || document.getElementById('port25Banner')) return;

        const usingProxy = port25.direct_reachable === false && port25.proxy_configured && port25.proxy_reachable;
        const degraded = port25.reachable === false;
        if (!degraded && !usingProxy) return;

        const el = document.createElement('div');
        el.id = 'port25Banner';
        if (degraded) {
            const detail = escapeHtml(port25.detail || 'SMTP port 25 unreachable from this server');
            el.className = 'alert alert-warning border-0 rounded-0 mb-0 text-center py-2 small';
            el.innerHTML = `<i class="fa-solid fa-plug-circle-xmark me-2"></i>
                <strong>SMTP verification is degraded.</strong> ${detail}
                Addresses will be reported as unknown until outbound port 25 works or a SOCKS5 proxy is set
                (<code>SMTP_PROXY</code> or <a href="/settings.html">Settings</a>).
                <button type="button" class="btn btn-sm btn-outline-dark ms-2" id="dismissPort25Banner">Dismiss</button>`;
        } else {
            el.className = 'alert alert-info border-0 rounded-0 mb-0 text-center py-2 small';
            el.innerHTML = `<i class="fa-solid fa-shield-halved me-2"></i>
                Direct outbound port 25 is blocked on this server. Verification is using the SOCKS5 proxy.
                <button type="button" class="btn btn-sm btn-outline-dark ms-2" id="dismissPort25Banner">Dismiss</button>`;
        }
        document.body.prepend(el);
        document.getElementById('dismissPort25Banner')?.addEventListener('click', () => el.remove());
    }

    document.addEventListener('DOMContentLoaded', showPersistenceBanner);
})();
