const EPS_PERIODS = [
    { label: '5m',  value: 'LAST 5 MINUTES' },
    { label: '15m', value: 'LAST 15 MINUTES' },
    { label: '30m', value: 'LAST 30 MINUTES' },
    { label: '1h',  value: 'LAST 1 HOURS' },
    { label: '3h',  value: 'LAST 3 HOURS' },
    { label: '6h',  value: 'LAST 6 HOURS' },
    { label: '12h', value: 'LAST 12 HOURS' },
    { label: '24h', value: 'LAST 24 HOURS' },
];

const EPS_MAX = 3;

const _eps = {
    jobs: {},
    pollTimer: null,
    starting: false,
    mode: 'period',
    period: 'LAST 1 HOURS',
    collector: '',
};

function mountEpsSection() {
    const section = document.getElementById('eps-test-section');
    if (!section) return;

    const hash = (window.location.hash || '').replace('#', '');
    const parts = hash.split('/').filter(Boolean);
    const isListView = (parts[0] === 'collectors' && !parts[1]);
    if (!isListView) { section.innerHTML = ''; section.dataset.built = ''; return; }

    if (section.dataset.built === '1') {
        epsRefreshDynamic();
        return;
    }

    const collectors = [...new Set(state.allSources.map(s => s._collector).filter(c => c && c !== 'Unknown'))].sort();
    if (!_eps.collector && collectors.length) _eps.collector = collectors[0];

    const collectorOptions = collectors.map(c => {
        const parts = c.split(' :: ');
        const name = parts[1] || c;
        const id = parts[0] || '';
        return `<option value="${escHtml(c)}" ${c === _eps.collector ? 'selected' : ''}>${escHtml(name)} (${escHtml(id)})</option>`;
    }).join('');

    const running = epsRunningCount();
    const full = running >= EPS_MAX;

    section.innerHTML = `
      <div style="max-width:1080px;margin:0 auto">
        <div style="display:flex;align-items:center;gap:12px;margin:28px 0 16px 0">
            <div style="height:1px;flex:1;background:var(--dark-border)"></div>
            <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--neutral-slate-400)">Event count over collector</div>
            <div style="height:1px;flex:1;background:var(--dark-border)"></div>
        </div>

        <div class="card" style="margin-bottom:16px;border-color:var(--dark-primary-30)">
            <div class="card-header">
                <span class="card-title">Count events per log source</span>
                <span id="eps-running-count" style="font-size:11px;color:${full ? 'var(--info-primary)' : 'var(--neutral-slate-500)'}">${running}/${EPS_MAX} running</span>
            </div>
            <div style="font-size:12px;color:var(--neutral-slate-400);margin-bottom:18px;line-height:1.6;max-width:680px">
                Counts how many events each log source under a collector sent during the chosen time period, then ranks them highest to lowest to find the source driving the volume. Runs in the background, you can leave or reload this page and the result stays until you close it.
            </div>

            <div style="display:grid;grid-template-columns:minmax(220px,1fr) minmax(200px,auto);gap:18px;align-items:start;margin-bottom:18px">
                <div>
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--neutral-slate-500);margin-bottom:6px">Collector</div>
                    <select class="filter-select" id="eps-collector" onchange="_eps.collector=this.value" style="width:100%">${collectorOptions}</select>
                </div>
                <div>
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--neutral-slate-500);margin-bottom:6px">Time window</div>
                    <div style="display:inline-flex;gap:0;border:1px solid var(--dark-border);border-radius:8px;overflow:hidden">
                        <button class="eps-mode-btn ${_eps.mode === 'period' ? 'active' : ''}" onclick="epsSetMode('period')">Last period</button>
                        <button class="eps-mode-btn ${_eps.mode === 'custom' ? 'active' : ''}" onclick="epsSetMode('custom')">Pick range</button>
                    </div>
                </div>
            </div>

            <div id="eps-time-controls" style="margin-bottom:18px">${renderEpsTimeControls()}</div>

            <div style="display:flex;gap:12px;align-items:center;border-top:1px solid var(--dark-border);padding-top:16px">
                <button class="btn btn-primary btn-sm" id="eps-run-btn" onclick="runEpsTest()" ${full ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}>Run event count</button>
                <span id="eps-status" style="font-size:12px;min-height:14px;color:var(--neutral-slate-400)">${full ? `All ${EPS_MAX} count slots are busy. Wait for one to finish.` : ''}</span>
            </div>
        </div>
        <div id="eps-results"></div>
      </div>`;

    section.dataset.built = '1';
    renderEpsResults();
}

function epsRefreshDynamic() {
    const running = epsRunningCount();
    const full = running >= EPS_MAX;
    const cnt = document.getElementById('eps-running-count');
    if (cnt) {
        cnt.textContent = `${running}/${EPS_MAX} running`;
        cnt.style.color = full ? 'var(--info-primary)' : 'var(--neutral-slate-500)';
    }
    const btn = document.getElementById('eps-run-btn');
    if (btn) {
        btn.disabled = full;
        btn.style.opacity = full ? '.45' : '';
        btn.style.cursor = full ? 'not-allowed' : '';
    }
    renderEpsResults();
    epsStackTray();
}

function epsBuildDateControls(prefix) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const dateVal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeVal = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return `<div class="eps-dt-row">
        <div class="eps-dt-field"><span class="eps-dt-label">Date</span><input type="date" class="filter-select eps-dt" id="${prefix}-date" value="${dateVal}" style="color-scheme:dark"></div>
        <div class="eps-dt-field"><span class="eps-dt-label">Time</span><input type="time" class="filter-select eps-dt" id="${prefix}-time" value="${timeVal}" style="color-scheme:dark"></div>
    </div>`;
}

function renderEpsTimeControls() {
    if (_eps.mode === 'period') {
        return `<div style="display:flex;gap:8px;flex-wrap:wrap" id="eps-period-row">
            ${EPS_PERIODS.map(p => `<button class="eps-period-btn ${p.value === _eps.period ? 'active' : ''}" onclick="epsSetPeriod('${p.value}',this)">${p.label}</button>`).join('')}
        </div>`;
    }
    return `<div class="eps-range-box">
        <div class="eps-range-side">
            <div class="eps-range-title">From</div>
            ${epsBuildDateControls('eps-from')}
        </div>
        <div class="eps-range-arrow">&#8594;</div>
        <div class="eps-range-side">
            <div class="eps-range-title">To</div>
            ${epsBuildDateControls('eps-to')}
        </div>
    </div>`;
}

function epsReadDateParts(prefix) {
    const dateVal = document.getElementById(`${prefix}-date`)?.value;
    const timeVal = document.getElementById(`${prefix}-time`)?.value;
    if (!dateVal || !timeVal) return null;
    const [y, mo, d] = dateVal.split('-').map(Number);
    const [h, mi] = timeVal.split(':').map(Number);
    if (!y || !mo || !d || isNaN(h) || isNaN(mi)) return null;
    const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
    if (isNaN(dt.getTime())) return null;
    return { ms: dt.getTime(), label: `${dateVal} ${timeVal}` };
}

function epsSetMode(mode) {
    _eps.mode = mode;
    const el = document.getElementById('eps-time-controls');
    if (el) el.innerHTML = renderEpsTimeControls();
    document.querySelectorAll('.eps-mode-btn').forEach(b => {
        b.classList.toggle('active', b.textContent.trim() === (mode === 'period' ? 'Last period' : 'Pick range'));
    });
}

function epsSetPeriod(value, btn) {
    _eps.period = value;
    document.querySelectorAll('#eps-period-row .eps-period-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

function epsRunningCount() {
    return Object.values(_eps.jobs).filter(j => j.status === 'running').length;
}

async function runEpsTest() {
    if (_eps.starting) return;

    const collector = document.getElementById('eps-collector')?.value || _eps.collector;
    if (!collector) return;

    const statusEl = document.getElementById('eps-status');

    if (epsRunningCount() >= EPS_MAX) {
        if (statusEl) { statusEl.style.color = 'var(--info-primary)'; statusEl.textContent = `All ${EPS_MAX} count slots are busy. Wait for one to finish.`; }
        return;
    }

    const sourceIds = state.allSources.filter(s => s._collector === collector).map(s => Number(s.id)).filter(n => n > 0);
    if (sourceIds.length === 0) {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'No log sources under this collector.'; }
        return;
    }

    const parts = collector.split(' :: ');
    const collectorName = parts[1] || collector;

    const body = { collector: collector, collector_name: collectorName, source_ids: sourceIds };
    let windowLabel = '';

    if (_eps.mode === 'custom') {
        const from = epsReadDateParts('eps-from');
        const to   = epsReadDateParts('eps-to');
        if (!from || !to) {
            if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Pick both From and To.'; }
            return;
        }
        if (!(to.ms > from.ms)) {
            if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'To must be after From.'; }
            return;
        }
        body.start_ms = from.ms;
        body.end_ms = to.ms;
        windowLabel = `${from.label} → ${to.label}`;
        body.window_label = windowLabel;
    } else {
        body.period = _eps.period;
        windowLabel = _eps.period;
        body.window_label = windowLabel;
    }

    _eps.starting = true;
    if (statusEl) {
        statusEl.style.color = 'var(--neutral-slate-400)';
        statusEl.innerHTML = `<span class="spinner" style="width:12px;height:12px;vertical-align:middle"></span> Starting event count...`;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/eps-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (resp.status === 429) {
            if (statusEl) { statusEl.style.color = 'var(--info-primary)'; statusEl.textContent = `All ${EPS_MAX} count slots are busy. Wait for one to finish.`; }
            return;
        }
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        const job = data.job || { id: data.id, collector: collector, collector_name: collectorName, period: body.period || '', window_label: windowLabel, status: 'running' };
        _eps.jobs[job.id] = job;
        if (statusEl) { statusEl.style.color = 'var(--success-primary)'; statusEl.textContent = 'Event count running in the background. You can leave this page.'; }
        renderEpsTray();
        renderEpsResults();
        startEpsPoller();
    } catch (e) {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Could not start: ' + e.message; }
    } finally {
        _eps.starting = false;
    }
}

async function refreshEpsJobs() {
    try {
        const data = await fetch(`${API_BASE}/api/eps-jobs`, { cache: 'no-store' }).then(r => r.json());
        const next = {};
        (data.jobs || []).forEach(j => {
            const prev = _eps.jobs[j.id];
            next[j.id] = Object.assign({}, prev || {}, j);
            if (prev && prev.result && !j.result) next[j.id].result = prev.result;
        });
        _eps.jobs = next;
        for (const id of Object.keys(_eps.jobs)) {
            const j = _eps.jobs[id];
            if (j.status === 'done' && !j.result) {
                try {
                    const full = await fetch(`${API_BASE}/api/eps-jobs/${id}`, { cache: 'no-store' }).then(r => r.json());
                    if (full && full.result) _eps.jobs[id].result = full.result;
                } catch {}
            }
        }
    } catch {}
    renderEpsTray();
    renderEpsResults();
    if (epsRunningCount() === 0) stopEpsPoller();
}

function startEpsPoller() {
    if (_eps.pollTimer) return;
    _eps.pollTimer = setInterval(refreshEpsJobs, 3000);
}

function stopEpsPoller() {
    if (_eps.pollTimer) { clearInterval(_eps.pollTimer); _eps.pollTimer = null; }
}

async function closeEpsJob(jobId) {
    try { await fetch(`${API_BASE}/api/eps-jobs/${jobId}`, { method: 'DELETE' }); } catch {}
    delete _eps.jobs[jobId];
    renderEpsTray();
    renderEpsResults();
}

function viewEpsJob(jobId) {
    if (!(window.location.hash || '').includes('collectors')) {
        navigate('/collectors');
        setTimeout(() => {
            renderEpsResults();
            document.getElementById('eps-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
        return;
    }
    renderEpsResults();
    document.getElementById('eps-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderEpsResults() {
    const panel = document.getElementById('eps-results');
    if (!panel) return;

    const jobs = Object.values(_eps.jobs).sort((a, b) => (b.created_ms || 0) - (a.created_ms || 0));
    if (jobs.length === 0) { panel.innerHTML = ''; return; }

    panel.innerHTML = jobs.map(renderEpsJobCard).join('');
}

function renderEpsJobCard(job) {
    const title = escHtml(job.collector_name || job.collector || 'Collector');
    const win = escHtml(job.window_label || job.period || '');

    if (job.status === 'running') {
        return `<div class="card" style="margin-bottom:12px">
            <div class="card-header">
                <span class="card-title">Event Count - ${title}</span>
                <span style="font-size:11px;color:var(--neutral-slate-500)">${win}</span>
            </div>
            <div style="font-size:12px;color:var(--neutral-slate-400);display:flex;align-items:center;gap:8px">
                <span class="spinner" style="width:14px;height:14px"></span>
                Counting in the background. This updates automatically when it finishes.
            </div>
        </div>`;
    }
    if (job.status === 'error') {
        return `<div class="card" style="margin-bottom:12px;border-color:var(--dark-primary-30)">
            <div class="card-header">
                <span class="card-title">Event Count Failed - ${title}</span>
                <button class="btn btn-ghost btn-sm" onclick="closeEpsJob('${job.id}')">Close</button>
            </div>
            <div style="font-size:12px;color:var(--dark-primary)">${escHtml(job.error || 'Unknown error')}</div>
        </div>`;
    }

    const r = job.result;
    if (!r) return '';

    const rows = (Array.isArray(r.rows) ? r.rows.slice() : []).sort((a, b) => (Number(b.events) || 0) - (Number(a.events) || 0));
    const maxEvents = rows.length ? Math.max(...rows.map(x => Number(x.events) || 0), 1) : 1;

    const statBox = (label, val, color) => `<div style="text-align:center;min-width:90px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--neutral-slate-500);margin-bottom:3px">${label}</div>
        <div style="font-size:18px;font-weight:700;color:${color}">${val}</div>
    </div>`;

    const highRow = rows.length ? rows[0] : null;
    const lowRow = rows.length ? rows[rows.length - 1] : null;
    const highName = highRow ? escHtml(highRow.src) : '-';
    const highEvents = highRow ? (highRow.events || 0) : 0;
    const lowName = lowRow ? escHtml(lowRow.src) : '-';
    const lowEvents = lowRow ? (lowRow.events || 0) : 0;

    const totalEv = rows.reduce((a, x) => a + (Number(x.events) || 0), 0);

    const tableRows = rows.map((x, i) => {
        const ev = Number(x.events) || 0;
        const pct = Math.max(2, Math.round((ev / maxEvents) * 100));
        const share = totalEv > 0 ? ((ev / totalEv) * 100).toFixed(1) + '%' : '-';
        const isHigh = i === 0;
        const isLow = i === rows.length - 1 && rows.length > 1;
        const barColor = isHigh ? 'var(--dark-primary)' : isLow ? 'var(--success-primary)' : 'var(--info-primary)';
        return `<tr>
            <td style="font-size:12px;color:var(--neutral-slate-500);text-align:right;padding-right:8px">${i + 1}</td>
            <td style="font-size:12px;color:var(--dark-text);font-weight:${isHigh ? '700' : '500'}">${escHtml(x.src)}</td>
            <td style="font-size:11px;color:var(--neutral-slate-600);font-family:monospace">${escHtml(x.logsourceid)}</td>
            <td style="font-size:12px;font-weight:700;color:${barColor};text-align:right;font-family:monospace">${ev.toLocaleString()}</td>
            <td style="font-size:11px;color:var(--neutral-slate-500);text-align:right;font-family:monospace">${share}</td>
            <td style="font-size:11px;color:var(--neutral-slate-500);text-align:right;font-family:monospace">${x.eps}</td>
            <td style="width:120px"><div style="height:6px;border-radius:3px;background:var(--dark-border);overflow:hidden"><div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px"></div></div></td>
        </tr>`;
    }).join('');

    return `<div class="card" style="margin-bottom:12px;border-color:var(--dark-primary-30)">
        <div class="card-header">
            <span class="card-title">Event Count - ${title}</span>
            <span style="font-size:11px;color:var(--neutral-slate-500)">${win}</span>
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:16px">
            ${statBox('Sources', r.source_count, 'var(--dark-text)')}
            ${statBox('Total Events', (r.total_events || 0).toLocaleString(), 'var(--dark-text)')}
            ${statBox('Avg Events', (r.avg_events != null ? r.avg_events : 0).toLocaleString(), 'var(--info-primary)')}
            ${statBox('Total EPS', r.total_eps, 'var(--neutral-slate-400)')}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
            <div style="flex:1;min-width:220px;background:var(--dark-primary-08);border:1px solid var(--dark-primary-30);border-radius:8px;padding:10px 12px">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--dark-primary);margin-bottom:4px">Most events (root cause)</div>
                <div style="font-size:13px;font-weight:700;color:var(--dark-text);line-height:1.3">${highName}</div>
                <div style="font-size:16px;font-weight:700;color:var(--dark-primary);margin-top:2px">${highEvents.toLocaleString()} <span style="font-size:11px;font-weight:500;color:var(--neutral-slate-500)">events</span></div>
            </div>
            <div style="flex:1;min-width:220px;background:var(--success-light);border:1px solid var(--success-border);border-radius:8px;padding:10px 12px">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--success-primary);margin-bottom:4px">Fewest events</div>
                <div style="font-size:13px;font-weight:700;color:var(--dark-text);line-height:1.3">${lowName}</div>
                <div style="font-size:16px;font-weight:700;color:var(--success-primary);margin-top:2px">${lowEvents.toLocaleString()} <span style="font-size:11px;font-weight:500;color:var(--neutral-slate-500)">events</span></div>
            </div>
        </div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--neutral-slate-500);margin-bottom:6px">All sources (${rows.length}) ranked by events</div>
        ${tableRows ? `<div class="table-wrapper"><table><thead><tr><th style="text-align:right">#</th><th>Source</th><th>ID</th><th style="text-align:right">Events</th><th style="text-align:right">Share</th><th style="text-align:right">EPS</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div>`
            : `<div style="text-align:center;padding:16px;color:var(--neutral-slate-500);font-size:13px">No events for these sources in this window</div>`}
        <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn btn-ghost btn-sm" onclick="closeEpsJob('${job.id}')">Close</button>
        </div>
    </div>`;
}

function renderEpsTray() {
    let tray = document.getElementById('eps-tray');
    const jobs = Object.values(_eps.jobs).sort((a, b) => (a.created_ms || 0) - (b.created_ms || 0));

    if (jobs.length === 0) {
        if (tray) tray.remove();
        return;
    }

    if (!tray) {
        tray = document.createElement('div');
        tray.id = 'eps-tray';
        epsEnsureTrayStack().appendChild(tray);
    }

    const running = jobs.filter(j => j.status === 'running').length;

    const rows = jobs.map(j => {
        let dot = 'var(--neutral-slate-400)';
        let label = '';
        if (j.status === 'running') { dot = 'var(--dark-accent)'; label = 'Running'; }
        else if (j.status === 'done') { dot = 'var(--success-primary)'; label = 'Done'; }
        else if (j.status === 'error') { dot = 'var(--dark-primary)'; label = 'Failed'; }
        return `<div class="eps-tray-row">
            <span class="eps-tray-dot" style="background:${dot}"></span>
            <div class="eps-tray-meta">
                <div class="eps-tray-name">${escHtml(j.collector_name || j.collector || 'Collector')}</div>
                <div class="eps-tray-sub">Events &middot; ${escHtml(j.window_label || j.period || '')} &middot; ${label}</div>
            </div>
            <div class="eps-tray-actions">
                ${(j.status === 'done' || j.status === 'error') ? `<button class="btn btn-ghost btn-sm" onclick="viewEpsJob('${j.id}')">View</button>` : ''}
                <button class="btn btn-ghost btn-sm" onclick="closeEpsJob('${j.id}')" title="Dismiss">&#x2715;</button>
            </div>
        </div>`;
    }).join('');

    tray.innerHTML = `
        <div class="eps-tray-head">
            <span class="eps-tray-title">Event Counts</span>
            <span class="eps-tray-count">${running}/${EPS_MAX} running</span>
        </div>
        ${rows}`;

    epsStackTray();
}

function epsEnsureTrayStack() {
    let stack = document.getElementById('tray-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'tray-stack';
        stack.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9000;display:flex;flex-direction:column;gap:12px;align-items:flex-end';
        document.body.appendChild(stack);
    }
    const analysis = document.getElementById('analysis-tray');
    if (analysis && analysis.parentElement !== stack) {
        analysis.style.position = 'static';
        analysis.style.right = 'auto';
        analysis.style.bottom = 'auto';
        analysis.style.left = 'auto';
        stack.appendChild(analysis);
    }
    return stack;
}

function epsStackTray() {
    const tray = document.getElementById('eps-tray');
    if (!tray) return;
    const stack = epsEnsureTrayStack();
    if (tray.parentElement !== stack) stack.appendChild(tray);
}

function epsInjectStyles() {
    if (document.getElementById('eps-tray-styles')) return;
    const style = document.createElement('style');
    style.id = 'eps-tray-styles';
    style.textContent = `
#eps-tray{position:static;width:320px;max-width:calc(100vw - 36px);background:var(--dark-bg-secondary);border:1px solid var(--dark-border);border-radius:12px;box-shadow:0 12px 40px var(--black-40);overflow:hidden}
.eps-tray-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--dark-border);background:var(--dark-primary-08)}
.eps-tray-title{font-size:12px;font-weight:700;color:var(--dark-text);letter-spacing:.04em;text-transform:uppercase}
.eps-tray-count{font-size:11px;color:var(--neutral-slate-400)}
.eps-tray-row{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dark-border)}
.eps-tray-row:last-child{border-bottom:none}
.eps-tray-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.eps-tray-meta{flex:1;min-width:0}
.eps-tray-name{font-size:13px;font-weight:600;color:var(--dark-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eps-tray-sub{font-size:11px;color:var(--neutral-slate-500);margin-top:2px}
.eps-tray-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}
.eps-mode-btn{background:transparent;border:none;color:var(--neutral-slate-400);font-size:12px;font-weight:600;padding:7px 14px;cursor:pointer;transition:background .15s,color .15s}
.eps-mode-btn:not(:last-child){border-right:1px solid var(--dark-border)}
.eps-mode-btn.active{background:var(--dark-primary);color:var(--on-primary)}
.eps-mode-btn:not(.active):hover{background:var(--dark-primary-08);color:var(--dark-text)}
.eps-period-btn{background:var(--dark-bg-secondary);border:1px solid var(--dark-border);color:var(--neutral-slate-300);font-size:12px;font-weight:600;padding:7px 14px;border-radius:8px;cursor:pointer;transition:all .15s}
.eps-period-btn.active{background:var(--dark-primary);color:var(--on-primary);border-color:var(--dark-primary)}
.eps-period-btn:not(.active):hover{border-color:var(--dark-primary-30);color:var(--dark-text)}
.eps-range-box{display:flex;align-items:stretch;gap:16px;background:var(--dark-bg-secondary);border:1px solid var(--dark-border);border-radius:10px;padding:14px 16px;flex-wrap:wrap}
.eps-range-side{flex:1;min-width:280px}
.eps-range-title{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--dark-accent);margin-bottom:10px}
.eps-range-arrow{display:flex;align-items:center;color:var(--neutral-slate-600);font-size:18px;font-weight:700}
.eps-dt-row{display:flex;gap:8px;flex-wrap:wrap}
.eps-dt-field{display:flex;flex-direction:column;gap:4px}
.eps-dt-label{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--neutral-slate-500)}
.eps-dt{padding:7px 10px;font-size:12px;min-width:auto}
.eps-dt[type=date]{width:150px}
.eps-dt[type=time]{width:110px}`;
    document.head.appendChild(style);
}

document.addEventListener('DOMContentLoaded', () => {
    epsInjectStyles();
    refreshEpsJobs().then(() => { if (epsRunningCount() > 0) startEpsPoller(); });
});