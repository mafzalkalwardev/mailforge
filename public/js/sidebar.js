(function () {
    const BRAND = 'MailForge';
    const NAV_ITEMS = [
        { href: '/dashboard.html', icon: 'fa-chart-pie', label: 'Dashboard' },
        { href: '/single.html', icon: 'fa-magnifying-glass', label: 'Single Verify' },
        { href: '/bulk.html', icon: 'fa-file-csv', label: 'Bulk Verify' },
        { href: '/campaigns.html', icon: 'fa-paper-plane', label: 'Campaigns' },
        { href: '/senders.html', icon: 'fa-at', label: 'Senders' },
        { href: '/templates.html', icon: 'fa-file-lines', label: 'Templates' },
        { href: '/inbox.html', icon: 'fa-inbox', label: 'Inbox' },
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
    }

    document.addEventListener('DOMContentLoaded', renderSidebar);
})();
