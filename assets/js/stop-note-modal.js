let _noteModal = null;
let _noteSourceId = null;
let _noteStopIdx = null;
let _noteOriginal = '';

function openStopNoteModal(sourceId, stopIdx, event) {
    if (event) event.stopPropagation();

    _noteSourceId = String(sourceId);
    _noteStopIdx  = stopIdx;

    const stop = getStopEntry(sourceId, stopIdx);
    _noteOriginal = stop ? (stop.note || '') : '';

    const overlay = document.createElement('div');
    overlay.className = 'stop-note-modal-overlay';
    overlay.id = 'stop-note-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeStopNoteModal(); });

    overlay.innerHTML = `
        <div class="stop-note-modal">
            <div class="stop-note-modal-header">
                <div>
                    <div class="stop-note-modal-title">Stop Note</div>
                    <div class="stop-note-modal-meta">${stop ? escHtml(stop.started_at || '') + ' → ' + escHtml(stop.ended_at || '') : ''}</div>
                </div>
                <button class="stop-note-modal-close" onclick="closeStopNoteModal()">&#x2715;</button>
            </div>
            <textarea class="stop-note-textarea" id="stop-note-input" placeholder="Write a note about why this log source stopped...">${escHtml(_noteOriginal)}</textarea>
            <div class="stop-note-modal-footer">
                <span class="stop-note-status" id="stop-note-status"></span>
                <button class="btn btn-ghost btn-sm" onclick="closeStopNoteModal()">Cancel</button>
                <button class="btn btn-primary btn-sm" onclick="saveStopNote()">Save</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    _noteModal = overlay;
    setTimeout(() => document.getElementById('stop-note-input')?.focus(), 50);
}

function getStopEntry(sourceId, stopIdx) {
    if (state.stopsAll) {
        const entry = state.stopsAll.find(s => String(s.source_id) === String(sourceId) && s._srcIdx === stopIdx);
        if (entry) return entry;
    }
    if (Array.isArray(_stopsData)) {
        return _stopsData[stopIdx] || null;
    }
    return null;
}

async function saveStopNote() {
    const input    = document.getElementById('stop-note-input');
    const statusEl = document.getElementById('stop-note-status');
    if (!input) return;

    const note = input.value.trim();
    if (statusEl) { statusEl.style.color = 'var(--neutral-slate-500)'; statusEl.textContent = 'Saving...'; }

    try {
        const resp = await fetch(`${API_BASE}/api/stops/${_noteSourceId}/${_noteStopIdx}/note`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note })
        });
        const ok = resp.ok;

        if (ok) {
            if (statusEl) { statusEl.style.color = 'var(--success-primary)'; statusEl.textContent = 'Saved.'; }
            updateNoteInState(_noteSourceId, _noteStopIdx, note);
            setTimeout(() => closeStopNoteModal(), 800);
        } else {
            if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Failed to save.'; }
        }
    } catch {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Failed to save.'; }
    }
}

function updateNoteInState(sourceId, stopIdx, note) {
    if (state.stopsAll) {
        const entry = state.stopsAll.find(s => String(s.source_id) === String(sourceId) && s._srcIdx === stopIdx);
        if (entry) entry.note = note;
    }
    if (Array.isArray(_stopsData) && _stopsData[stopIdx]) {
        _stopsData[stopIdx].note = note;
    }
}

function closeStopNoteModal() {
    const input = document.getElementById('stop-note-input');
    const newNote = input ? input.value.trim() : _noteOriginal;

    if (_noteModal) { _noteModal.remove(); _noteModal = null; }

    if (newNote !== _noteOriginal) {
        const section = getHash().split('/').filter(Boolean)[0];
        if (section === 'historical-stops') renderHistoricalStops();
        else if (section === 'logsource') renderStops();
    }
}

function deleteStop(sourceId, stopIdx, event) {
    if (event) event.stopPropagation();

    const existing = document.getElementById('delete-confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'delete-confirm-overlay';
    overlay.className = 'stop-note-modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.innerHTML = `
        <div class="stop-note-modal" style="max-width:360px">
            <div class="stop-note-modal-header">
                <div>
                    <div class="stop-note-modal-title">Delete Stop Entry</div>
                    <div class="stop-note-modal-meta">This action cannot be undone.</div>
                </div>
                <button class="stop-note-modal-close" onclick="document.getElementById('delete-confirm-overlay').remove()">&#x2715;</button>
            </div>
            <div style="font-size:13px;color:var(--neutral-slate-400);margin-bottom:16px;line-height:1.6">
                Are you sure you want to delete this stop entry?
            </div>
            <div class="stop-note-modal-footer">
                <button class="btn btn-ghost btn-sm" onclick="document.getElementById('delete-confirm-overlay').remove()">Cancel</button>
                <button class="btn btn-sm" style="background:var(--dark-primary);color:var(--on-primary);border:none" onclick="confirmDeleteStop('${sourceId}',${stopIdx})">Delete</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
}

async function confirmDeleteStop(sourceId, stopIdx) {
    document.getElementById('delete-confirm-overlay')?.remove();
    try {
        const resp = await fetch(`${API_BASE}/api/stops/${sourceId}/${stopIdx}`, { method: 'DELETE' });
        if (resp.ok) {
            if (state.stopsAll) {
                const idx = state.stopsAll.findIndex(s => String(s.source_id) === String(sourceId) && s._srcIdx === stopIdx);
                if (idx !== -1) state.stopsAll.splice(idx, 1);
                state.stopsAll.filter(s => String(s.source_id) === String(sourceId) && s._srcIdx > stopIdx)
                    .forEach(s => s._srcIdx--);
            }
            if (Array.isArray(_stopsData) && _stopsData[stopIdx]) {
                _stopsData.splice(stopIdx, 1);
            }
            const section = getHash().split('/').filter(Boolean)[0];
            if (section === 'historical-stops') renderHistoricalStops();
            else renderStops();
        }
    } catch {}
}