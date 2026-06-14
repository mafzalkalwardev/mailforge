(function () {
    let modalEl = null;

    function ensureModal() {
        if (modalEl) return modalEl;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="confirmModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="confirmModalTitle">Confirm</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body" id="confirmModalBody">Are you sure?</div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-danger" id="confirmModalOk">Confirm</button>
                        </div>
                    </div>
                </div>
            </div>`);
        modalEl = document.getElementById('confirmModal');
        return modalEl;
    }

    window.showConfirm = function ({ title, message, confirmText, confirmClass, onConfirm }) {
        ensureModal();
        document.getElementById('confirmModalTitle').textContent = title || 'Confirm';
        document.getElementById('confirmModalBody').textContent = message || 'Are you sure?';
        const okBtn = document.getElementById('confirmModalOk');
        okBtn.textContent = confirmText || 'Confirm';
        okBtn.className = `btn ${confirmClass || 'btn-danger'}`;

        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        const handler = async () => {
            okBtn.disabled = true;
            try {
                await onConfirm();
                modal.hide();
            } finally {
                okBtn.disabled = false;
            }
        };
        okBtn.replaceWith(okBtn.cloneNode(true));
        document.getElementById('confirmModalOk').addEventListener('click', handler);
        modal.show();
    };
})();
