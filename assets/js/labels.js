async function getLabels() {
    try {
        const resp = await fetch(`${API_BASE}/api/labels`);
        return resp.ok ? await resp.json() : {};
    } catch {
        return {};
    }
}

async function setLabel(sourceId, label) {
    try {
        const resp = await fetch(`${API_BASE}/api/labels/${sourceId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label })
        });
        return resp.ok;
    } catch {
        return false;
    }
}

function getLabel(sourceId) {
    return state.labels[String(sourceId)] || null;
}

async function saveLabel(sourceId) {
    const input  = document.getElementById('label-input');
    const status = document.getElementById('label-status');
    if (!input) return;

    const label = input.value.trim();
    const ok    = await setLabel(sourceId, label);

    if (ok) {
        state.labels[String(sourceId)] = label || null;
        if (status) {
            status.style.color = 'var(--success-primary)';
            status.textContent = 'Saved.';
            setTimeout(() => { if (status) status.textContent = ''; }, 2000);
        }
    } else {
        if (status) {
            status.style.color = 'var(--dark-primary)';
            status.textContent = 'Failed to save.';
        }
    }
}

async function getOverrides() {
    try {
        const resp = await fetch(`${API_BASE}/api/overrides`);
        return resp.ok ? await resp.json() : {};
    } catch {
        return {};
    }
}

async function setOverride(sourceId, manualMaxMs) {
    try {
        const resp = await fetch(`${API_BASE}/api/overrides/${sourceId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manual_max_ms: manualMaxMs })
        });
        return resp.ok;
    } catch {
        return false;
    }
}

async function deleteOverride(sourceId) {
    try {
        const resp = await fetch(`${API_BASE}/api/overrides/${sourceId}`, {
            method: 'DELETE'
        });
        return resp.ok;
    } catch {
        return false;
    }
}

function getOverride(sourceId) {
    return state.overrides ? (state.overrides[String(sourceId)] ?? null) : null;
}

function isStaleSource(source) {
    const maxMs = (typeof ALERT_MAX_SILENCE_MS !== 'undefined') ? ALERT_MAX_SILENCE_MS : 8 * 86400000;
    if (!source.last_event_ms || source.last_event_ms <= 0) return true;
    return (Date.now() - source.last_event_ms) > maxMs;
}

function getEffectiveSeverity(source) {
    if (isStaleSource(source)) return 'neutral';

    const engine = (typeof getActiveEngine === 'function') ? getActiveEngine() : 'historical';
    if (typeof engineEligible === 'function' && !engineEligible(source, engine)) return 'neutral';
    if (typeof engineSeverity === 'function') return engineSeverity(source, engine);
    return liveBucketSeverity(source);
}

function getEffectiveBucketClass(source) {
    const sev = getEffectiveSeverity(source);
    if (sev === 'alarm')   return 'breach';
    if (sev === 'neutral') return 'neutral';
    return 'ok';
}

async function saveOverride(sourceId) {
    const d   = parseInt(document.getElementById('override-d')?.value  || '0', 10) || 0;
    const h   = parseInt(document.getElementById('override-h')?.value  || '0', 10) || 0;
    const m   = parseInt(document.getElementById('override-m')?.value  || '0', 10) || 0;
    const s   = parseInt(document.getElementById('override-s')?.value  || '0', 10) || 0;
    const statusEl = document.getElementById('override-status');

    const totalMs = ((d * 86400) + (h * 3600) + (m * 60) + s) * 1000;

    if (totalMs <= 0) {
        const ok = await deleteOverride(sourceId);
        if (ok) {
            if (!state.overrides) state.overrides = {};
            delete state.overrides[String(sourceId)];
            if (statusEl) {
                statusEl.style.color = 'var(--success-primary)';
                statusEl.textContent = 'Override cleared.';
                setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
            }
        } else {
            if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Failed.'; }
        }
        return;
    }

    const ok = await setOverride(sourceId, totalMs);
    if (ok) {
        if (!state.overrides) state.overrides = {};
        state.overrides[String(sourceId)] = totalMs;
        if (statusEl) {
            statusEl.style.color = 'var(--success-primary)';
            statusEl.textContent = 'Saved.';
            setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
        }
    } else {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Failed.'; }
    }
}

function msToOverrideParts(ms) {
    if (!ms || ms <= 0) return { d: 0, h: 0, m: 0, s: 0 };
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return { d, h, m, s };
}