let _hsRange   = 'today';
let _hsSort    = { col: 'end_ms', dir: -1 };
const HS_DEFAULT_COLS = ['source', 'domain', 'collector', 'day', 'started_at', 'ended_at', 'gap', 'bucket', 'note_flag', 'actions'];
let _hsCols = JSON.parse(localStorage.getItem('hs_cols') || 'null') || [...HS_DEFAULT_COLS];

const HS_COL_DEFS = [
    { key: 'source',     label: 'Source' },
    { key: 'domain',     label: 'Domain' },
    { key: 'collector',  label: 'Collector' },
    { key: 'day',        label: 'Day' },
    { key: 'started_at', label: 'Stopped At' },
    { key: 'ended_at',   label: 'Came Back' },
    { key: 'gap',        label: 'Gap' },
    { key: 'bucket',     label: 'Bucket' },
    { key: 'note_flag',  label: 'Note' },
    { key: 'actions',    label: 'Actions' },
];

function saveHsCols() { localStorage.setItem('hs_cols', JSON.stringify(_hsCols)); }

async function renderHistoricalStopsPage() {
    if (!state.stopsAll || state.stopsAll.length === 0) {
        await loadAllStops();
    } else {
        enrichStopsWithSources();
    }
    syncHsRangeButton();
    populateHsDomainFilter();
    renderHistoricalStops();
}

function syncHsRangeButton() {
    const buttons = document.querySelectorAll('#hs-filter-bar .stops-tab');
    buttons.forEach(b => {
        const onclick = b.getAttribute('onclick') || '';
        const match = onclick.match(/setHsRange\(\s*['"]([^'"]+)['"]/);
        const range = match ? match[1] : null;
        b.classList.toggle('active-tab', range === _hsRange);
    });
}

function enrichStopsWithSources() {
    if (!state.stopsAll) return;
    state.stopsAll.forEach(s => {
        const src = state.allSources.find(x => String(x.id) === String(s.source_id));
        if (src) {
            s.source_name = src.name;
            s.domain      = src.domain_group || '—';
            s.collector   = src._collector   || '—';
        }
    });
}

async function loadAllStops() {
    const body = document.getElementById('hs-body');
    if (body) body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--neutral-slate-500);font-size:13px">Loading...</div>`;
    try {
        const resp = await fetch(`${API_BASE}/data/stops.json`);
        if (resp.ok) {
            const text = await resp.text();
            try {
                const raw = JSON.parse(text);
                const flat = [];
                Object.keys(raw).forEach(srcId => {
                    const entries = Array.isArray(raw[srcId]) ? raw[srcId] : [raw[srcId]];
                    const src = state.allSources.find(s => String(s.id) === String(srcId));
                    entries.forEach((e, idx) => {
                        flat.push({
                            ...e,
                            source_id:   srcId,
                            source_name: src ? src.name : srcId,
                            domain:      src ? src.domain_group : '—',
                            collector:   src ? src._collector   : '—',
                            _srcIdx:     idx,
                        });
                    });
                });
                flat.sort((a, b) => b.end_ms - a.end_ms);
                state.stopsAll = flat;
                enrichStopsWithSources();
            } catch { state.stopsAll = []; }
        } else { state.stopsAll = []; }
    } catch { state.stopsAll = []; }
}

async function refreshHistoricalStops() {
    state.stopsAll = null;
    await loadAllStops();
    populateHsDomainFilter();
    renderHistoricalStops();
}

function setHsRange(range, btn) {
    _hsRange = range;
    document.querySelectorAll('#hs-filter-bar .stops-tab').forEach(b => b.classList.remove('active-tab'));
    if (btn) btn.classList.add('active-tab');
    renderHistoricalStops();
}

function populateHsDomainFilter() {
    const sel = document.getElementById('hs-filter-domain');
    if (!sel || !state.stopsAll) return;
    const cur = sel.value;
    const domains = [...new Set(state.stopsAll.map(s => s.domain).filter(d => d && d !== '—'))].sort();
    sel.innerHTML = '<option value="">All domains</option>' +
        domains.map(d => `<option value="${escHtml(d)}"${d === cur ? ' selected' : ''}>${escHtml(d)}</option>`).join('');
}

function filterHsByRange(stops, range) {
    const startOfDay   = new Date(); startOfDay.setHours(0,0,0,0);
    const startOfYest  = new Date(startOfDay); startOfYest.setDate(startOfDay.getDate() - 1);
    const endOfYest    = startOfDay.getTime();
    const start2days   = new Date(startOfDay); start2days.setDate(startOfDay.getDate() - 2);
    const start3days   = new Date(startOfDay); start3days.setDate(startOfDay.getDate() - 3);
    const startOfWeek  = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());

    if (range === 'today')      return stops.filter(s => s.end_ms >= startOfDay.getTime());
    if (range === 'yesterday')  return stops.filter(s => s.end_ms >= startOfYest.getTime() && s.end_ms < endOfYest);
    if (range === '2days')      return stops.filter(s => s.end_ms >= start2days.getTime() && s.end_ms < startOfYest.getTime());
    if (range === '3days')      return stops.filter(s => s.end_ms >= start3days.getTime() && s.end_ms < start2days.getTime());
    if (range === 'week')       return stops.filter(s => s.end_ms >= startOfWeek.getTime());
    return stops;
}

function sortHsStops(stops) {
    const { col, dir } = _hsSort;
    return [...stops].sort((a, b) => {
        let va, vb;
        if (col === 'source')     { va = a.source_name || ''; vb = b.source_name || ''; return va.localeCompare(vb) * dir; }
        if (col === 'domain')     { va = a.domain || ''; vb = b.domain || ''; return va.localeCompare(vb) * dir; }
        if (col === 'collector')  { va = a.collector || ''; vb = b.collector || ''; return va.localeCompare(vb) * dir; }
        if (col === 'day')        { va = a.day || ''; vb = b.day || ''; return va.localeCompare(vb) * dir; }
        if (col === 'started_at') { va = a.start_ms || 0; vb = b.start_ms || 0; return (va - vb) * dir; }
        if (col === 'ended_at')   { va = a.end_ms || 0; vb = b.end_ms || 0; return (va - vb) * dir; }
        if (col === 'gap')        { va = a.gap_ms || 0; vb = b.gap_ms || 0; return (va - vb) * dir; }
        if (col === 'bucket')     { va = BUCKET_ORDER.indexOf(a.bucket); vb = BUCKET_ORDER.indexOf(b.bucket); return (va - vb) * dir; }
        return 0;
    });
}

function toggleHsColPicker() {
    const existing = document.getElementById('hs-col-picker-dropdown');
    if (existing) { existing.remove(); return; }
    const wrapper = document.getElementById('hs-col-picker-wrap');
    if (!wrapper) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'hs-col-picker-dropdown';
    dropdown.style.cssText = `position:absolute;right:0;top:calc(100% + 4px);background:var(--dark-bg-secondary);border:1px solid var(--dark-border);border-radius:8px;padding:12px;z-index:999;min-width:180px;box-shadow:0 8px 24px var(--dropdown-shadow);`;
    dropdown.innerHTML = `
        <div style="font-size:11px;font-weight:600;color:var(--neutral-slate-500);letter-spacing:.05em;margin-bottom:8px">SHOW COLUMNS</div>
        ${HS_COL_DEFS.map(c => `
            <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:12px;color:var(--dark-text)">
                <input type="checkbox" data-col="${c.key}" ${_hsCols.includes(c.key) ? 'checked' : ''}
                    style="accent-color:var(--dark-primary);width:13px;height:13px">
                ${c.label}
            </label>`).join('')}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--dark-border)">
            <button onclick="resetHsCols()" style="font-size:11px;cursor:pointer;background:transparent;border:1px solid var(--dark-border);color:var(--neutral-slate-400);padding:2px 8px;border-radius:4px">Reset</button>
        </div>`;

    dropdown.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            const col = cb.dataset.col;
            if (cb.checked) { if (!_hsCols.includes(col)) _hsCols.push(col); }
            else { _hsCols = _hsCols.filter(c => c !== col); }
            saveHsCols();
            renderHistoricalStops();
        });
    });

    wrapper.style.position = 'relative';
    wrapper.appendChild(dropdown);
    setTimeout(() => {
        document.addEventListener('click', function close(e) {
            if (!dropdown.contains(e.target) && !wrapper.querySelector('button').contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', close);
            }
        });
    }, 10);
}

function resetHsCols() {
    _hsCols = [...HS_DEFAULT_COLS];
    saveHsCols();
    document.getElementById('hs-col-picker-dropdown')?.remove();
    renderHistoricalStops();
}

function setHsSortCol(col) {
    if (_hsSort.col === col) _hsSort.dir *= -1;
    else { _hsSort.col = col; _hsSort.dir = -1; }
    renderHistoricalStops();
}

function renderHistoricalStops() {
    const body    = document.getElementById('hs-body');
    if (body && !state.stopsAll) {
        body.innerHTML = [1,2,3,4,5].map(() => '<div class="skeleton-row" style="margin-bottom:4px"></div>').join('');
    }
    const countEl = document.getElementById('hs-count');
    if (!body) return;

    if (!state.stopsAll) {
        body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--neutral-slate-500);font-size:13px">Loading...</div>`;
        return;
    }

    const search    = (document.getElementById('hs-search')?.value || '').toLowerCase();
    const domainVal = document.getElementById('hs-filter-domain')?.value || '';
    const gapVal    = document.getElementById('hs-filter-gap')?.value || '';

    let stops = getVisibleStops();
    stops = sortHsStops(stops);

    if (countEl) countEl.textContent = stops.length + ' stop' + (stops.length !== 1 ? 's' : '');

    if (!stops.length) {
        body.innerHTML = `<div class="empty-state"><div class="empty-state-icon">&#10003;</div><div class="empty-state-text">No stops recorded for this period</div></div>`;
        return;
    }

    const colors    = getBucketColors();
    const sortable  = ['source','domain','collector','day','started_at','ended_at','gap','bucket'];

    const theadCells = HS_COL_DEFS.filter(c => _hsCols.includes(c.key)).map(c => {
        const isSortable = sortable.includes(c.key);
        const isActive   = _hsSort.col === c.key;
        const arrow      = isActive ? ((_hsSort.dir === 1 ? ' ▲' : ' ▼')) : '';
        return `<th ${isSortable ? `onclick="setHsSortCol('${c.key}')" style="cursor:pointer;user-select:none"` : ''}>
            ${c.label}${isActive ? `<span style="font-size:10px;opacity:0.7;margin-left:4px">${arrow}</span>` : ''}
        </th>`;
    }).join('');

    const rows = stops.map(s => {
        const bi  = BUCKET_ORDER.indexOf(s.bucket);
        const col = bi >= 0 ? (colors[bi] || getCSSVar('--bucket-fallback')) : getCSSVar('--bucket-fallback');

        const cells = {
            source:     `<td style="font-weight:500;color:var(--dark-text);cursor:pointer" onclick="navigate('/logsource/${s.source_id}')">${escHtml(s.source_name)}</td>`,
            domain:     `<td>${s.domain && s.domain !== '—' ? `<span class="badge badge-info">${escHtml(s.domain)}</span>` : '<span class="text-muted">—</span>'}</td>`,
            collector:  `<td class="text-muted fs-12" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.collector || '—')}</td>`,
            day:        `<td style="font-size:12px;color:var(--neutral-slate-400)">${escHtml(s.day || '—')}</td>`,
            started_at: `<td style="font-size:12px;color:var(--dark-text);font-family:monospace">${escHtml(s.started_at || '—')}</td>`,
            ended_at:   `<td style="font-size:12px;color:var(--success-primary);font-family:monospace">${escHtml(s.ended_at || '—')}</td>`,
            gap:        `<td style="font-size:12px;font-weight:600;color:var(--dark-text)">${formatGapMs(s.gap_ms)}</td>`,
            bucket:     `<td><span class="bucket-pill" style="background:${col}18;color:${col};border-color:${col}44">${escHtml(s.bucket || '—')}</span></td>`,
            note_flag:  `<td>${s.note ? `<span style="font-size:11px;color:var(--dark-accent);font-weight:600" title="${escHtml(s.note)}">&#128203;</span>` : ''}</td>`,
            actions:    `<td style="white-space:nowrap">
                            <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 8px;${s.note ? 'color:var(--dark-accent)' : ''}" onclick="openStopNoteModal('${escHtml(s.source_id)}', ${s._srcIdx}, event)">${s.note ? 'Edit Note' : 'Add Note'}</button>
                            <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 8px;color:var(--dark-primary)" onclick="deleteStop('${escHtml(s.source_id)}', ${s._srcIdx}, event)">Delete</button>
                        </td>`,
        };

        return `<tr>${HS_COL_DEFS.filter(c => _hsCols.includes(c.key)).map(c => cells[c.key] || '<td>—</td>').join('')}</tr>`;
    }).join('');

    body.innerHTML = `
        <div class="table-wrapper">
            <table>
                <thead><tr>${theadCells}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}
function getVisibleStops() {
    if (!state.stopsAll) return [];

    const search    = (document.getElementById('hs-search')?.value || '').toLowerCase();
    const domainVal = document.getElementById('hs-filter-domain')?.value || '';
    const gapVal    = document.getElementById('hs-filter-gap')?.value || '';

    let stops = filterHsByRange(state.stopsAll, _hsRange);
    if (search)    stops = stops.filter(s => (s.source_name || '').toLowerCase().includes(search));
    if (domainVal) stops = stops.filter(s => s.domain === domainVal);
    if (gapVal) {
        if (gapVal === 'gt1440') stops = stops.filter(s => (s.gap_ms / 60000) > 1440);
        else stops = stops.filter(s => (s.gap_ms / 60000) < parseFloat(gapVal));
    }
    return stops;
}

function hsRangeLabel() {
    const labels = {
        today:     'today',
        yesterday: 'yesterday',
        '2days':   '2 days ago',
        '3days':   '3 days ago',
        week:      'this week',
    };
    return labels[_hsRange] || _hsRange;
}

function clearVisibleStops() {
    const stops = getVisibleStops();
    if (!stops.length) {
        setHsClearStatus('Nothing to clear.', 'var(--neutral-slate-500)');
        return;
    }

    const extra = [];
    if (document.getElementById('hs-search')?.value)        extra.push('search');
    if (document.getElementById('hs-filter-domain')?.value) extra.push('domain');
    if (document.getElementById('hs-filter-gap')?.value)    extra.push('gap');

    const existing = document.getElementById('hs-clear-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'hs-clear-overlay';
    overlay.className = 'stop-note-modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.innerHTML = `
        <div class="stop-note-modal" style="max-width:420px">
            <div class="stop-note-modal-header">
                <div>
                    <div class="stop-note-modal-title">Clear ${stops.length} stop${stops.length !== 1 ? 's' : ''}</div>
                    <div class="stop-note-modal-meta">This action cannot be undone.</div>
                </div>
                <button class="stop-note-modal-close" onclick="document.getElementById('hs-clear-overlay').remove()">&#x2715;</button>
            </div>
            <div style="font-size:13px;color:var(--neutral-slate-400);margin-bottom:8px;line-height:1.6">
                Permanently delete the <b style="color:var(--dark-text)">${stops.length}</b> stop${stops.length !== 1 ? 's' : ''}
                currently shown for <b style="color:var(--dark-text)">${escHtml(hsRangeLabel())}</b>.
            </div>
            ${extra.length ? `<div style="font-size:11px;color:var(--warning-primary);margin-bottom:12px">
                Your ${extra.join(', ')} filter${extra.length > 1 ? 's are' : ' is'} active, so only the matching stops will be removed.
            </div>` : '<div style="margin-bottom:12px"></div>'}
            <div class="stop-note-modal-footer">
                <button class="btn btn-ghost btn-sm" onclick="document.getElementById('hs-clear-overlay').remove()">Cancel</button>
                <button class="btn btn-sm" style="background:var(--dark-primary);color:var(--on-primary);border:none"
                    onclick="confirmClearVisibleStops()">Delete ${stops.length}</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
}

async function confirmClearVisibleStops() {
    document.getElementById('hs-clear-overlay')?.remove();

    const stops = getVisibleStops();
    if (!stops.length) return;

    const btn = document.getElementById('hs-clear-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Clearing...'; }
    setHsClearStatus('Clearing...', 'var(--neutral-slate-400)');

    const targets = stops.map(s => ({ source_id: String(s.source_id), index: s._srcIdx }));

    try {
        const r = await fetch(`${API_BASE}/api/stops/bulk-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));

        setHsClearStatus(`Cleared ${d.removed}.`, 'var(--success-primary)');

        state.stopsAll = null;
        await loadAllStops();
        populateHsDomainFilter();
        renderHistoricalStops();
    } catch (e) {
        setHsClearStatus('Failed: ' + e.message, 'var(--dark-primary)');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Clear all'; }
    }
}

function setHsClearStatus(msg, color) {
    const el = document.getElementById('hs-clear-status');
    if (!el) return;
    el.style.color = color || 'var(--neutral-slate-500)';
    el.textContent = msg;
    if (color === 'var(--success-primary)' || color === 'var(--neutral-slate-500)') {
        setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2500);
    }
}