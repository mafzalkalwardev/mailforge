// Axios default configuration — attach JWT to every request
axios.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

axios.interceptors.response.use(
    response => response,
    error => {
        if (error.response && error.response.status === 401) {
            const path = window.location.pathname;
            if (path !== '/' && path !== '/index.html') {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = '/?expired=1';
            }
        }
        return Promise.reject(error);
    }
);

function checkAuth() {
    const token = localStorage.getItem('token');
    const path = window.location.pathname;

    if (!token && path !== '/' && path !== '/index.html') {
        window.location.href = '/';
    } else if (token && (path === '/' || path === '/index.html' || path === '')) {
        window.location.href = '/dashboard.html';
    }
}

function checkExpiredSession() {
    if (window.location.search.includes('expired=1')) {
        setTimeout(() => {
            showToast('Session expired — please log in again.', 'error');
        }, 300);
    }
}

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    document.body.classList.toggle('dark-mode', isDark);
    localStorage.setItem('theme', theme);
    updateThemeIcon();
}

function initTheme() {
    applyTheme(localStorage.getItem('theme') || 'light');
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    applyTheme(isDark ? 'light' : 'dark');
}

function updateThemeIcon() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    btn.innerHTML = `<i class="fa-solid ${dark ? 'fa-sun' : 'fa-moon'} me-2"></i> ${dark ? 'Light Mode' : 'Dark Mode'}`;
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
}

function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;

    const bgClass = type === 'success' ? 'bg-success' : type === 'error' ? 'bg-danger' : 'bg-info';

    const toastHtml = `
        <div class="toast align-items-center text-white ${bgClass} border-0 mb-2" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        </div>
    `;

    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    const toastEl = toastContainer.lastElementChild;
    const toast = new bootstrap.Toast(toastEl, { delay: 3500 });
    toast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

document.addEventListener('click', e => {
    if (e.target.closest('#themeToggle')) {
        e.preventDefault();
        toggleTheme();
    }
    if (e.target.closest('#logoutBtn')) {
        e.preventDefault();
        logout();
    }
});

document.addEventListener('mailforge:sidebar-ready', updateThemeIcon);

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    checkExpiredSession();
    initTheme();
    updateThemeIcon();

    const userNameEl = document.getElementById('userNameDisplay');
    if (userNameEl) {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        userNameEl.textContent = user.name || 'User';
    }
});
