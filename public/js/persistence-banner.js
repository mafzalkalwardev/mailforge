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
                Set <code>MONGO_URI</code> in <code>.env</code> or use <code>docker compose -f docker-compose.full.yml up -d</code>.
                <button type="button" class="btn btn-sm btn-outline-dark ms-2" id="dismissPersistenceBanner">Dismiss</button>`;
            document.body.prepend(el);
            document.getElementById('dismissPersistenceBanner')?.addEventListener('click', () => el.remove());
        } catch (_) {}
    }

    document.addEventListener('DOMContentLoaded', showPersistenceBanner);
})();
