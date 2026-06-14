(function () {
    const BRAND = 'MailForge';
    const APP_VERSION = '1.4.1';
    const NAV_ITEMS = [
        { href: '/dashboard.html', icon: 'fa-chart-pie', label: 'Dashboard' },
        { href: '/single.html', icon: 'fa-magnifying-glass', label: 'Single Verify' },
        { href: '/bulk.html', icon: 'fa-file-csv', label: 'Bulk Verify' },
        { href: '/campaigns.html', icon: 'fa-paper-plane', label: 'Campaigns' },
        { href: '/senders.html', icon: 'fa-at', label: 'Senders' },
        { href: '/templates.html', icon: 'fa-file-lines', label: 'Templates' },
        { href: '/inbox.html', icon: 'fa-inbox', label: 'Inbox' },
        { href: '/suppression.html', icon: 'fa-ban', label: 'Suppression' },
        { href: '/history.html', icon: 'fa-clock-rotate-left', label: 'History' },
        { href: '/settings.html', icon: 'fa-gear', label: 'Settings' },
    ];

    function currentPath() {
        const p = window.location.pathname;
        if (p.endsWith('/')) return p + 'dashboard.html';
        return p;
    }

    function renderSidebar() {
        const nav = document.querySelector('.sidebar nav.nav');
        const brandTitle = document.querySelector('.brand-title');
        const pageTitle = document.querySelector('title');

        if (brandTitle) brandTitle.textContent = BRAND;
        if (pageTitle && !pageTitle.textContent.includes(BRAND)) {
            pageTitle.textContent = pageTitle.textContent
                .replace(/MailOps|Bulk Email Verifier|Email Verifier/gi, BRAND);
        }

        if (!nav) return;

        const path = currentPath();
        const links = NAV_ITEMS.map(item => {
            let isActive = path.endsWith(item.href);
            if (item.href === '/campaigns.html' && path.includes('campaign')) isActive = true;
            return `<a class="nav-link${isActive ? ' active' : ''}" href="${item.href}"><i class="fa-solid ${item.icon} me-2"></i> ${item.label}</a>`;
        }).join('');

        nav.innerHTML = links + `
            <hr class="my-3 opacity-25">
            <button type="button" id="themeToggle" class="btn btn-link nav-link text-start w-100"><i class="fa-solid fa-moon me-2"></i> Toggle Theme</button>
            <button type="button" id="logoutBtn" class="btn btn-link nav-link text-start text-danger w-100"><i class="fa-solid fa-right-from-bracket me-2"></i> Logout</button>
        `;

        document.dispatchEvent(new CustomEvent('mailforge:sidebar-ready'));
        renderFooter();
        loadNotifications();
        checkActiveVerifyJob();
    }

    function renderFooter() {
        document.querySelectorAll('.sidebar-footer small').forEach(el => {
            el.textContent = `Self-hosted · v${APP_VERSION}`;
        });
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && !sidebar.querySelector('.sidebar-footer')) {
            const footer = document.createElement('div');
            footer.className = 'sidebar-footer px-3 pb-3 mt-auto';
            footer.innerHTML = `<small class="text-muted">Self-hosted · v${APP_VERSION}</small>`;
            sidebar.appendChild(footer);
        }
    }

    function loadNotifications() {
        if (document.querySelector('script[data-mailforge-notifications]')) return;
        const s = document.createElement('script');
        s.src = '/js/notifications.js';
        s.dataset.mailforgeNotifications = '1';
        document.body.appendChild(s);
    }

    async function checkActiveCampaigns() {
        const token = localStorage.getItem('token');
        if (!token || typeof axios === 'undefined') return;
        try {
            const res = await axios.get('/api/campaigns');
            const running = (res.data || []).filter(c => c.status === 'running');
            let badge = document.getElementById('campaignJobIndicator');
            if (running.length) {
                const c = running[0];
                const s = c.stats || {};
                const done = (s.sent || 0) + (s.failed || 0) + (s.skipped || 0);
                if (!badge) {
                    badge = document.createElement('div');
                    badge.id = 'campaignJobIndicator';
                    badge.className = 'px-3 py-2 mx-2 mb-2 rounded-3 small';
                    badge.style.background = 'rgba(34,197,94,0.12)';
                    badge.style.border = '1px solid rgba(34,197,94,0.35)';
                    const nav = document.querySelector('.sidebar nav.nav');
                    const verifyBadge = document.getElementById('verifyJobIndicator');
                    if (nav) (verifyBadge || nav).insertAdjacentElement('afterend', badge);
                }
                badge.innerHTML = `<i class="fa-solid fa-paper-plane me-1"></i> Sending ${done}/${s.total || '?'} <a href="/campaign-detail.html?id=${c._id}" class="ms-1">queue</a>`;
                badge.classList.remove('d-none');
            } else if (badge) badge.classList.add('d-none');
        } catch (_) {}
    }

    async function checkActiveVerifyJob() {
        const token = localStorage.getItem('token');
        if (!token || typeof axios === 'undefined') return;
        try {
            const res = await axios.get('/api/verify/jobs/active');
            let badge = document.getElementById('verifyJobIndicator');
            if (res.data.active && res.data.job) {
                const p = res.data.job.progress || {};
                const job = res.data.job;
                const isPaused = job.status === 'paused';
                if (!badge) {
                    badge = document.createElement('div');
                    badge.id = 'verifyJobIndicator';
                    badge.className = 'px-3 py-2 mx-2 mb-2 rounded-3 small';
                    badge.style.background = 'rgba(99,102,241,0.15)';
                    badge.style.border = '1px solid rgba(99,102,241,0.3)';
                    const nav = document.querySelector('.sidebar nav.nav');
                    if (nav) nav.insertAdjacentElement('afterend', badge);
                }
                const icon = isPaused
                    ? '<i class="fa-solid fa-pause me-1"></i> Paused'
                    : '<i class="fa-solid fa-spinner fa-spin me-1"></i> Verifying';
                badge.innerHTML = `${icon} ${p.completed}/${p.total} <a href="/bulk.html" class="ms-1">view</a>`;
                badge.classList.remove('d-none');
            } else if (badge) {
                badge.classList.add('d-none');
            }
        } catch (_) {}
    }

    setInterval(checkActiveVerifyJob, 8000);
    setInterval(checkActiveCampaigns, 6000);

    document.addEventListener('DOMContentLoaded', renderSidebar);
})();
