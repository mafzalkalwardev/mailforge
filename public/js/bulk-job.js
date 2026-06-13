/**
 * Tracks active backend verify job id for UI resume.
 */
const ACTIVE_JOB_KEY = 'mailforgeActiveVerifyJobId';

function saveActiveJobId(id) {
    try {
        if (id) sessionStorage.setItem(ACTIVE_JOB_KEY, id);
        else sessionStorage.removeItem(ACTIVE_JOB_KEY);
    } catch (_) {}
}

function loadActiveJobId() {
    try {
        return sessionStorage.getItem(ACTIVE_JOB_KEY);
    } catch (_) {
        return null;
    }
}

function clearActiveJobId() {
    sessionStorage.removeItem(ACTIVE_JOB_KEY);
}

window.BulkJob = { saveActiveJobId, loadActiveJobId, clearActiveJobId };
