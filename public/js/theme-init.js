(function () {
    var theme = localStorage.getItem('theme') || 'light';
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-bs-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
    } else {
        document.documentElement.setAttribute('data-bs-theme', 'light');
    }
})();
