const ANALYSIS_PERIODS = [
    { label: '24h', value: 'LAST 24 HOURS' },
    { label: '7d',  value: 'LAST 7 DAYS' },
    { label: '14d', value: 'LAST 14 DAYS' },
    { label: '30d', value: 'LAST 30 DAYS' },
    { label: '60d', value: 'LAST 60 DAYS' },
    { label: '90d', value: 'LAST 90 DAYS' },
];

const ANALYSIS_MAX = 3;

const _analysis = {
    sourceId: null,
    jobs: {},
    pollTimer: null,
    starting: false,
    viewed: {},
};

function mountAnalysisButton(sourceId, _attempt) {
    const sameSource = String(_analysis.sourceId) === String(sourceId);
    _analysis.sourceId = String(sourceId);
    const container = document.getElementById('logsource-content');
    if (!container) {
        if ((_attempt || 0) < 10) setTimeout(() => mountAnalysisButton(sourceId, (_attempt || 0) + 1), 60);
        return;
    }

    const existing = document.getElementById('analysis-mount');
    if (existing && sameSource) {
        renderActiveSourceJob();
        return;
    }
    if (existing) existing.remove();

    const wrap = document.createElement('div');
    wrap.id = 'analysis-mount';
    wrap.style.cssText = 'margin:0 0 16px 0';
    wrap.innerHTML = `
        <button class="btn btn-primary btn-sm" id="analysis-open-btn" onclick="openAnalysisPicker()">New Analysis</button>
        <div id="analysis-panel"></div>`;

    const firstCard = container.querySelector('.card');
    if (firstCard && firstCard.parentNode) {
        firstCard.parentNode.insertBefore(wrap, firstCard.nextSibling);
    } else {
        container.appendChild(wrap);
    }

    renderActiveSourceJob();
}

function openAnalysisPicker() {
    const panel = document.getElementById('analysis-panel');
    if (!panel) return;
    delete panel.dataset.renderedJob;
    const running = analysisRunningCount();
    const full = running >= ANALYSIS_MAX;

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    panel.innerHTML = `
        <div class="card" style="margin-top:12px">
            <div class="card-header">
                <span class="card-title">New Analysis</span>
                <button class="btn btn-ghost btn-sm" onclick="closeAnalysisPicker()">&#x2715;</button>
            </div>
            <div style="font-size:12px;color:var(--neutral-slate-400);margin-bottom:12px;line-height:1.6">
                Pulls all events for this source over the selected period, ignores "Device Stopped Emitting Events", and recomputes buckets, daily behavior and stops. Runs in the background: you can leave or reload this page and the result will be waiting for you. Up to ${ANALYSIS_MAX} analyses can run at the same time.
            </div>

            <div style="font-size:11px;font-weight:600;color:var(--neutral-slate-500);letter-spacing:.05em;margin-bottom:8px">CUSTOM RANGE</div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px" id="analysis-range-row">
                <span style="font-size:12px;color:var(--neutral-slate-400)">Start</span>
                <input type="date" id="analysis-start-date" value="${today}" class="filter-select" style="width:auto">
                <input type="time" id="analysis-start-time" value="${nowTime}" class="filter-select" style="width:auto">
                <span style="font-size:12px;color:var(--neutral-slate-400);margin-left:6px">End</span>
                <input type="date" id="analysis-end-date" value="${today}" class="filter-select" style="width:auto">
                <input type="time" id="analysis-end-time" value="${nowTime}" class="filter-select" style="width:auto">
                <button class="btn btn-primary btn-sm" id="analysis-range-run" onclick="runCustomAnalysis(this)" ${full ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}>Update</button>
            </div>

            <div style="font-size:11px;font-weight:600;color:var(--neutral-slate-500);letter-spacing:.05em;margin:14px 0 8px">PRESETS</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px" id="analysis-period-row">
                ${ANALYSIS_PERIODS.map(p => `<button class="stops-tab" data-period="${p.value}" onclick="runAnalysis('${p.value}',this)" ${full ? 'disabled style="opacity:.45;cursor:not-allowed"' : ''}>${p.label}</button>`).join('')}
            </div>
            <div id="analysis-status" style="font-size:12px;color:var(--neutral-slate-400);min-height:16px">${full ? `All ${ANALYSIS_MAX} analysis slots are busy. Wait for one to finish, then try again.` : ''}</div>
        </div>`;
}

function runCustomAnalysis(btn) {
    const sd = document.getElementById('analysis-start-date')?.value;
    const st = document.getElementById('analysis-start-time')?.value || '00:00';
    const ed = document.getElementById('analysis-end-date')?.value;
    const et = document.getElementById('analysis-end-time')?.value || '00:00';
    const statusEl = document.getElementById('analysis-status');

    if (!sd || !ed) {
        if (statusEl) { statusEl.style.color = 'var(--warning-primary)'; statusEl.textContent = 'Pick a start and end date.'; }
        return;
    }

    const startStr = `${sd} ${st}:00`;
    const endStr   = `${ed} ${et}:00`;

    if (new Date(startStr.replace(' ', 'T')) > new Date(endStr.replace(' ', 'T'))) {
        if (statusEl) { statusEl.style.color = 'var(--warning-primary)'; statusEl.textContent = 'Start must be before end.'; }
        return;
    }

    const period = `START '${startStr}' STOP '${endStr}'`;
    runAnalysis(period, btn);
}

function closeAnalysisPicker() {
    const panel = document.getElementById('analysis-panel');
    if (panel) { delete panel.dataset.renderedJob; panel.innerHTML = ''; }
    renderActiveSourceJob();
}

function analysisRunningCount() {
    return Object.values(_analysis.jobs).filter(j => j.status === 'running').length;
}

async function runAnalysis(period, btn) {
    if (_analysis.starting) return;
    const sourceId = _analysis.sourceId;
    const source = (typeof state !== 'undefined' && state.allSources)
        ? state.allSources.find(s => String(s.id) === String(sourceId)) : null;
    const sourceName = source ? source.name : sourceId;

    if (analysisRunningCount() >= ANALYSIS_MAX) {
        const statusEl = document.getElementById('analysis-status');
        if (statusEl) { statusEl.style.color = 'var(--warning-primary)'; statusEl.textContent = `All ${ANALYSIS_MAX} analysis slots are busy. Wait for one to finish, then try again.`; }
        return;
    }

    _analysis.starting = true;
    document.querySelectorAll('#analysis-period-row .stops-tab').forEach(b => b.classList.remove('active-tab'));
    if (btn) btn.classList.add('active-tab');

    const statusEl = document.getElementById('analysis-status');
    if (statusEl) {
        statusEl.style.color = 'var(--neutral-slate-400)';
        statusEl.innerHTML = `<span class="spinner" style="width:12px;height:12px;vertical-align:middle"></span> Starting analysis for ${escHtml(period)}...`;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/analysis-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: sourceId, period: period, source_name: sourceName })
        });
        if (resp.status === 429) {
            if (statusEl) { statusEl.style.color = 'var(--warning-primary)'; statusEl.textContent = `All ${ANALYSIS_MAX} analysis slots are busy. Wait for one to finish, then try again.`; }
            return;
        }
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        const job = data.job || { id: data.id, source_id: sourceId, source_name: sourceName, period: period, status: 'running' };
        _analysis.jobs[job.id] = job;
        _analysis.viewed[job.id] = true;
        if (statusEl) { statusEl.style.color = 'var(--success-primary)'; statusEl.textContent = 'Analysis running in the background. You can leave this page.'; }
        renderAnalysisTray();
        renderActiveSourceJob();
        startJobPoller();
    } catch (e) {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Could not start analysis: ' + e.message; }
    } finally {
        _analysis.starting = false;
    }
}

async function refreshAnalysisJobs() {
    try {
        const data = await fetch(`${API_BASE}/api/analysis-jobs`, { cache: 'no-store' }).then(r => r.json());
        const next = {};
        (data.jobs || []).forEach(j => {
            const prev = _analysis.jobs[j.id];
            next[j.id] = Object.assign({}, prev || {}, j);
            if (prev && prev.result && !j.result) next[j.id].result = prev.result;
        });
        _analysis.jobs = next;
        for (const id of Object.keys(_analysis.jobs)) {
            const j = _analysis.jobs[id];
            if (j.status === 'done' && !j.result) {
                try {
                    const full = await fetch(`${API_BASE}/api/analysis-jobs/${id}`, { cache: 'no-store' }).then(r => r.json());
                    if (full && full.result) _analysis.jobs[id].result = full.result;
                } catch {}
            }
        }
    } catch {}
    renderAnalysisTray();
    renderActiveSourceJob();
    if (analysisRunningCount() === 0) stopJobPoller();
}

function startJobPoller() {
    if (_analysis.pollTimer) return;
    _analysis.pollTimer = setInterval(refreshAnalysisJobs, 3000);
}

function stopJobPoller() {
    if (_analysis.pollTimer) { clearInterval(_analysis.pollTimer); _analysis.pollTimer = null; }
}

async function closeAnalysisJob(jobId) {
    try { await fetch(`${API_BASE}/api/analysis-jobs/${jobId}`, { method: 'DELETE' }); } catch {}
    delete _analysis.jobs[jobId];
    delete _analysis.viewed[jobId];
    renderAnalysisTray();
    renderActiveSourceJob();
}

function viewAnalysisJob(jobId) {
    const job = _analysis.jobs[jobId];
    if (!job) return;
    _analysis.viewed[jobId] = true;

    if (String(job.source_id) === String(_analysis.sourceId) && document.getElementById('analysis-panel')) {
        renderActiveSourceJob();
        const panel = document.getElementById('analysis-panel');
        if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    _analysis.sourceId = String(job.source_id);
    navigate('/logsource/' + job.source_id);
    viewAnalysisWhenReady(job.source_id, 0);
}

function viewAnalysisWhenReady(sourceId, attempt) {
    const panel = document.getElementById('analysis-panel');
    if (panel && String(_analysis.sourceId) === String(sourceId)) {
        renderActiveSourceJob();
        const p = document.getElementById('analysis-panel');
        if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    if ((attempt || 0) < 40) {
        setTimeout(() => viewAnalysisWhenReady(sourceId, (attempt || 0) + 1), 80);
    }
}

function renderActiveSourceJob() {
    const panel = document.getElementById('analysis-panel');
    if (!panel) return;

    const job = Object.values(_analysis.jobs)
        .filter(j => String(j.source_id) === String(_analysis.sourceId))
        .sort((a, b) => (b.created_ms || 0) - (a.created_ms || 0))[0];

    const pickerOpen = !!panel.querySelector('#analysis-period-row');

    if (!job) {
        if (pickerOpen) return;
        panel.innerHTML = '';
        return;
    }

    if (job.status === 'done' || job.status === 'error') {
        if (job.status === 'error') {
            panel.innerHTML = `
                <div class="card" style="margin-top:12px;border-color:var(--dark-primary-30)">
                    <div class="card-header">
                        <span class="card-title">Analysis Failed</span>
                        <button class="btn btn-ghost btn-sm" onclick="closeAnalysisJob('${job.id}')">Close</button>
                    </div>
                    <div style="font-size:12px;color:var(--dark-primary)">${escHtml(job.error || 'Unknown error')}</div>
                </div>`;
        } else if (job.result) {
            renderAnalysisResult(job);
        }
        return;
    }

    if (pickerOpen) return;

    if (job.status === 'running') {
        panel.innerHTML = `
            <div class="card" style="margin-top:12px">
                <div class="card-header">
                    <span class="card-title">Analysis Running</span>
                    <span style="font-size:11px;color:var(--neutral-slate-500)">${escHtml(job.period || '')}</span>
                </div>
                <div style="font-size:12px;color:var(--neutral-slate-400);display:flex;align-items:center;gap:8px">
                    <span class="spinner" style="width:14px;height:14px"></span>
                    Working in the background. This panel updates automatically when it finishes.
                </div>
            </div>`;
        return;
    }
}

function renderAnalysisResult(job) {
    const panel = document.getElementById('analysis-panel');
    if (!panel) return;
    const data = job.result;
    if (!data) return;

    if (panel.dataset.renderedJob === String(job.id)) return;
    panel.dataset.renderedJob = String(job.id);

    const buckets = (data.buckets && typeof data.buckets === 'object') ? data.buckets : {};
    const dailyBuckets = (data.daily_buckets && typeof data.daily_buckets === 'object') ? data.daily_buckets : {};
    let stops = data.stops;
    if (!stops) stops = [];
    else if (!Array.isArray(stops)) stops = [stops];

    const colors = getBucketColors();
    const totalGaps = BUCKET_ORDER.reduce((s, k) => s + (buckets[k] || 0), 0);
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    const bucketCells = BUCKET_ORDER.map((k, i) => {
        const v = buckets[k] || 0;
        const c = colors[i] || getCSSVar('--bucket-fallback');
        return `<div style="background:${v > 0 ? c + '18' : 'var(--bucket-empty-bg)'};border:1px solid ${v > 0 ? c + '55' : 'var(--bucket-empty-border)'};border-radius:6px;padding:6px 8px;display:flex;flex-direction:column;gap:2px">
            <div style="display:flex;align-items:center;gap:5px">
                <div style="width:7px;height:7px;border-radius:2px;background:${c};flex-shrink:0;opacity:${v > 0 ? 1 : 0.25}"></div>
                <span style="font-size:10px;color:${v > 0 ? 'var(--bucket-label-active)' : 'var(--bucket-label-inactive)'};font-weight:500">${k}</span>
            </div>
            <div style="font-size:14px;font-weight:700;color:${v > 0 ? 'var(--dark-text)' : 'var(--bucket-value-inactive)'};line-height:1">${v}</div>
        </div>`;
    }).join('');

    const dayCells = days.map(d => {
        const db = (dailyBuckets[d] && typeof dailyBuckets[d] === 'object') ? dailyBuckets[d] : {};
        const tot = BUCKET_ORDER.reduce((s, k) => s + (db[k] || 0), 0);
        return `<div style="background:var(--bucket-empty-bg);border:1px solid var(--bucket-empty-border);border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:11px;font-weight:600;color:${tot > 0 ? 'var(--bucket-label-active)' : 'var(--bucket-label-inactive)'};margin-bottom:4px">${d.slice(0,3)}</div>
            <div style="font-size:13px;font-weight:700;color:${tot > 0 ? 'var(--dark-text)' : 'var(--bucket-value-inactive)'}">${tot}</div>
        </div>`;
    }).join('');

    const stopRows = stops.slice().reverse().map(s => {
        const bi = BUCKET_ORDER.indexOf(s.bucket);
        const col = bi >= 0 ? (colors[bi] || getCSSVar('--bucket-fallback')) : getCSSVar('--bucket-fallback');
        return `<tr>
            <td style="font-size:12px;color:var(--neutral-slate-400)">${escHtml(s.day || '—')}</td>
            <td style="font-size:12px;color:var(--dark-text);font-family:monospace">${escHtml(s.started_at || '—')}</td>
            <td style="font-size:12px;color:var(--success-primary);font-family:monospace">${escHtml(s.ended_at || '—')}</td>
            <td style="font-size:12px;font-weight:600;color:var(--dark-text)">${formatGapMs(s.gap_ms)}</td>
            <td><span class="bucket-pill" style="background:${col}18;color:${col};border-color:${col}44">${escHtml(s.bucket || '—')}</span></td>
        </tr>`;
    }).join('');

    panel.innerHTML = `
        <div class="card" style="margin-top:12px;border-color:var(--dark-primary-30)">
            <div class="card-header">
                <span class="card-title">Analysis Result</span>
                <span style="font-size:11px;color:var(--neutral-slate-500)">${escHtml(data.analyzed_from || '—')} &rarr; ${escHtml(data.analyzed_to || '—')}</span>
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
                <div><div class="stat-label">EVENTS</div><div style="font-size:18px;font-weight:700;color:var(--dark-text)">${data.event_count}</div></div>
                <div><div class="stat-label">UNIQUE TIMES</div><div style="font-size:18px;font-weight:700;color:var(--dark-text)">${data.unique_count}</div></div>
                <div><div class="stat-label">TOTAL GAPS</div><div style="font-size:18px;font-weight:700;color:var(--dark-text)">${totalGaps}</div></div>
                <div><div class="stat-label">MAX STOP</div><div style="font-size:18px;font-weight:700;color:var(--dark-primary)">${escHtml(data.max_bucket || '—')}</div></div>
                <div><div class="stat-label">STOPS</div><div style="font-size:18px;font-weight:700;color:var(--dark-text)">${stops.length}</div></div>
            </div>

            <div class="stat-label" style="margin-bottom:6px">HISTORICAL BUCKETS</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;margin-bottom:16px">${bucketCells}</div>

            <div class="stat-label" style="margin-bottom:6px">HISTORICAL DAYS</div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:16px">${dayCells}</div>

            <div class="stat-label" style="margin-bottom:6px">HISTORICAL STOPS (${stops.length})</div>
            ${stopRows ? `<div class="table-wrapper" style="margin-bottom:16px"><table><thead><tr><th>Day</th><th>Stopped At</th><th>Came Back</th><th>Gap</th><th>Bucket</th></tr></thead><tbody>${stopRows}</tbody></table></div>`
                : `<div style="text-align:center;padding:16px;color:var(--neutral-slate-500);font-size:13px;margin-bottom:16px">No stops in this period</div>`}

            <div style="display:flex;gap:8px;align-items:center">
                <button class="btn btn-primary btn-sm" onclick="overwriteAnalysis('${job.id}')">Overwrite</button>
                <button class="btn btn-ghost btn-sm" onclick="closeAnalysisJob('${job.id}')">Close</button>
                <span id="analysis-overwrite-status" style="font-size:11px;min-height:14px"></span>
            </div>
        </div>`;
}

async function overwriteAnalysis(jobId) {
    const job = _analysis.jobs[jobId];
    if (!job || !job.result) return;
    const sourceId = job.source_id;
    const statusEl = document.getElementById('analysis-overwrite-status');
    if (statusEl) { statusEl.style.color = 'var(--neutral-slate-400)'; statusEl.textContent = 'Saving...'; }

    const payload = Object.assign({}, job.result, { sourceId: sourceId, period: job.period });

    try {
        const resp = await fetch(`${API_BASE}/api/source-analysis/${sourceId}/overwrite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) {
            const detail = data.trace ? (data.error + '\n' + data.trace) : (data.error || ('HTTP ' + resp.status));
            throw new Error(detail);
        }
        if (statusEl) {
            statusEl.style.color = 'var(--success-primary)';
            statusEl.textContent = `Overwritten (${data.total_gaps} gaps, ${data.stops_written} stops). Live polling continues from here.`;
        }
        await loadAllData();
        const fresh = state.allSources.find(s => String(s.id) === String(sourceId));
        if (fresh) renderLogSourceHTML(fresh, null);
    } catch (e) {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Failed: ' + e.message; }
    }
}

function ensureTrayStack() {
    let stack = document.getElementById('tray-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'tray-stack';
        stack.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9000;display:flex;flex-direction:column;gap:12px;align-items:flex-end';
        document.body.appendChild(stack);
    }
    return stack;
}

function renderAnalysisTray() {
    let tray = document.getElementById('analysis-tray');
    const jobs = Object.values(_analysis.jobs).sort((a, b) => (a.created_ms || 0) - (b.created_ms || 0));

    if (jobs.length === 0) {
        if (tray) tray.remove();
        return;
    }

    if (!tray) {
        tray = document.createElement('div');
        tray.id = 'analysis-tray';
        tray.style.position = 'static';
        ensureTrayStack().appendChild(tray);
    } else if (tray.parentElement && tray.parentElement.id !== 'tray-stack') {
        tray.style.position = 'static';
        tray.style.right = 'auto';
        tray.style.bottom = 'auto';
        tray.style.left = 'auto';
        ensureTrayStack().appendChild(tray);
    }

    const running = jobs.filter(j => j.status === 'running').length;

    const rows = jobs.map(j => {
        let dot = 'var(--neutral-slate-400)';
        let label = '';
        if (j.status === 'running') { dot = 'var(--warning-primary)'; label = 'Running'; }
        else if (j.status === 'done') { dot = 'var(--success-primary)'; label = 'Done'; }
        else if (j.status === 'error') { dot = 'var(--dark-primary)'; label = 'Failed'; }
        return `<div class="analysis-tray-row">
            <span class="analysis-tray-dot" style="background:${dot}"></span>
            <div class="analysis-tray-meta">
                <div class="analysis-tray-name">${escHtml(j.source_name || ('Source ' + j.source_id))}</div>
                <div class="analysis-tray-sub">${escHtml(j.period || '')} &middot; ${label}</div>
            </div>
            <div class="analysis-tray-actions">
                ${(j.status === 'done' || j.status === 'error') ? `<button class="btn btn-ghost btn-sm" onclick="viewAnalysisJob('${j.id}')">View</button>` : ''}
                <button class="btn btn-ghost btn-sm" onclick="closeAnalysisJob('${j.id}')" title="Dismiss">&#x2715;</button>
            </div>
        </div>`;
    }).join('');

    tray.innerHTML = `
        <div class="analysis-tray-head">
            <span class="analysis-tray-title">Analyses</span>
            <span class="analysis-tray-count">${running}/${ANALYSIS_MAX} running</span>
        </div>
        ${rows}`;
}

document.addEventListener('DOMContentLoaded', () => {
    refreshAnalysisJobs().then(() => { if (analysisRunningCount() > 0) startJobPoller(); });
});