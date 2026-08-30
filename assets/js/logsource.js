function renderLogSource(id) {
    if (!id) return;

    if (window._stopInterval) { clearInterval(window._stopInterval); window._stopInterval = null; }
    if (window._protocolCheckInterval) { clearInterval(window._protocolCheckInterval); window._protocolCheckInterval = null; }

    const source = state.allSources.find(s => String(s.id) === String(id));
    const container = document.getElementById('logsource-content');
    if (!container) return;

    if (!source) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-text">Log source not found</div></div>`;
        return;
    }

    renderLogSourceHTML(source, null);

    if (!source.protocol_type) {
        if (window._protocolCheckInterval) clearInterval(window._protocolCheckInterval);
        window._protocolCheckInterval = setInterval(() => {
            const fresh = state.allSources.find(s => String(s.id) === String(id));
            if (fresh && fresh.protocol_type) {
                clearInterval(window._protocolCheckInterval);
                window._protocolCheckInterval = null;
                const pt = document.querySelector('[data-protocol-type]');
                const pi = document.querySelector('[data-protocol-identifier]');
                const lt = document.querySelector('[data-log-source-type]');
                if (lt) lt.textContent = fresh.log_source_type || '—';
                if (pt) pt.textContent = fresh.protocol_type || '—';
                if (pi) pi.textContent = fresh.identifier || '—';
            }
        }, 5000);
    }
}

function formatOverrideMs(ms) {
    if (!ms || ms <= 0) return '';
    const { d, h, m, s } = msToOverrideParts(ms);
    const parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    if (m) parts.push(m + 'm');
    if (s) parts.push(s + 's');
    return parts.join(' ') || '0s';
}

function renderQRadarStatus(source) {
    const state = (source.status_state || 'NA').toUpperCase();
    const reason = source.status_reason || '';

    let color, bg, border, label;
    if (state === 'ERROR') {
        color = 'var(--dark-primary)'; bg = 'var(--dark-primary-08)'; border = 'var(--dark-primary-30)'; label = 'Error';
    } else if (state === 'WARN') {
        color = 'var(--brand-orange)'; bg = 'var(--dark-bg-secondary)'; border = 'var(--brand-orange)'; label = 'Warning';
    } else if (state === 'SUCCESS') {
        color = 'var(--success-primary)'; bg = 'var(--success-light)'; border = 'var(--success-border)'; label = 'OK';
    } else {
        color = 'var(--neutral-slate-400)'; bg = 'var(--dark-bg-secondary)'; border = 'var(--dark-border)'; label = 'Not reported';
    }

    const reasonHtml = reason
        ? `<div style="font-size:12px;color:var(--neutral-slate-300);margin-top:4px;line-height:1.5">${escHtml(reason)}</div>`
        : `<div style="font-size:12px;color:var(--neutral-slate-500);margin-top:4px">No detail message reported by QRadar for this source.</div>`;

    return `<div style="margin-top:14px;background:${bg};border:1px solid ${border};border-radius:8px;padding:10px 14px">
        <div style="display:flex;align-items:center;gap:8px">
            <span style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0"></span>
            <span style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${color}">QRadar status: ${escHtml(label)}</span>
        </div>
        ${reasonHtml}
    </div>`;
}

function renderLogSourceHTML(source, detail) {
    const container = document.getElementById('logsource-content');
    const sev    = getEffectiveSeverity(source);
    const bClass = getEffectiveBucketClass(source);
    const label  = getLabel(source.id);
    const total  = totalBucketCount(source.buckets);

    container.innerHTML = `
        <div style="margin-bottom:16px">
            <button class="btn btn-ghost btn-sm" onclick="history.back()">&larr; Back</button>
        </div>

        <div class="card" style="margin-bottom:16px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <div style="font-size:18px;font-weight:700;color:var(--dark-text);margin-bottom:4px">${escHtml(source.name)}</div>
                    ${label ? `<div style="font-size:12px;color:var(--dark-accent);margin-bottom:6px">${escHtml(label)}</div>` : ''}
                    <div style="font-size:12px;color:var(--neutral-slate-400)">${escHtml(source.log_source_type || '')}</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">
                    ${source.domain_group && source.domain_group !== 'N/A'
                        ? `<span class="badge badge-info">${escHtml(source.domain_group)}</span>` : ''}
                    <span class="bucket-pill ${bClass}" data-ls-bucket>${escHtml(source.current_bucket || '—')}</span>
                </div>
            </div>

            <div id="poll-stall-banner" style="display:none"></div>

            ${renderQRadarStatus(source)}

            <div class="divider"></div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px">
                <div>
                    <div class="stat-label">COLLECTOR</div>
                    <div style="font-size:12px;color:var(--dark-text);margin-top:3px">${escHtml(source._collector || '—')}</div>
                </div>
                <div>
                    <div class="stat-label">LAST EVENT</div>
                    <div style="font-size:12px;color:var(--dark-text);margin-top:3px" data-ls-lastevent>${escHtml(source.last_event_time || '—')}</div>
                </div>
                <div>
                    <div class="stat-label">CREATED</div>
                    <div style="font-size:12px;color:var(--dark-text);margin-top:3px">${escHtml(source.creation_date || '—')}</div>
                </div>
                <div>
                    <div class="stat-label">AVG EPS</div>
                    <div style="font-size:22px;font-weight:700;color:var(--dark-accent);margin-top:3px">${source.average_eps != null ? source.average_eps : '—'}</div>
                </div>
                <div>
                    <div class="stat-label">SOURCE ID</div>
                    <div style="font-size:12px;color:var(--neutral-slate-500);margin-top:3px">#${source.id}</div>
                </div>
                <div>
                    <div class="stat-label">TOTAL GAPS RECORDED</div>
                    <div style="font-size:22px;font-weight:700;color:var(--dark-text);margin-top:3px">${total}</div>
                </div>
                <div>
                    <div class="stat-label">QRADAR BEHAVIOR THRESHOLD</div>
                    <div style="font-size:13px;font-weight:600;color:var(--dark-text);margin-top:3px">${escHtml(source.behavior_threshold || '—')}</div>
                </div>
                <div>
                    <div class="stat-label">NORMAL STOP</div>
                    <div style="font-size:16px;font-weight:700;color:var(--success-primary);margin-top:3px">${escHtml(dominantBucket(source.buckets) || '—')}</div>
                </div>
                <div>
                    <div class="stat-label">MAX STOP</div>
                    <div style="font-size:16px;font-weight:700;color:var(--dark-primary);margin-top:3px">${escHtml(maxBucket(source.buckets) || '—')}</div>
                </div>
                <div>
                    <div class="stat-label">CURRENT STOP</div>
                    <div id="ls-current-stop" style="font-size:16px;font-weight:700;margin-top:3px;color:var(--neutral-slate-500)">—</div>
                </div>
            </div>

            <div class="divider"></div>

            <div style="margin-bottom:12px">
                <div style="font-size:11px;font-weight:600;color:var(--neutral-slate-500);letter-spacing:.05em;margin-bottom:10px">PROTOCOL &amp; CONFIGURATION</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
                    <div>
                        <div style="font-size:10px;color:var(--neutral-slate-500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Log Source Type</div>
                        <div data-log-source-type style="font-size:13px;color:var(--dark-text);font-weight:500;word-break:break-word">${escHtml(source.log_source_type || '—')}</div>
                    </div>
                    <div>
                        <div style="font-size:10px;color:var(--neutral-slate-500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Protocol Type</div>
                        <div data-protocol-type style="font-size:13px;color:var(--dark-text);font-weight:500">${escHtml(source.protocol_type || '—')}</div>
                    </div>
                    <div>
                        <div style="font-size:10px;color:var(--neutral-slate-500);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Log Source Identifier</div>
                        <div data-protocol-identifier style="font-size:13px;color:var(--dark-accent);font-weight:500;font-family:monospace;word-break:break-all">${escHtml(source.identifier || '—')}</div>
                    </div>
                </div>
            </div>

            <div class="divider"></div>

            <div style="display:flex;align-items:center;gap:8px">
                <div class="stat-label" style="margin:0">CUSTOM LABEL</div>
                <input type="text" id="label-input" value="${escHtml(label || '')}" placeholder="Add label..."
                    style="height:28px;font-size:12px;flex:1;max-width:260px">
                <button class="btn btn-secondary btn-sm" onclick="saveLabel(${source.id})">Save</button>
            </div>
            <div id="label-status" style="font-size:11px;min-height:14px;margin-top:4px"></div>

            <div class="divider"></div>

            <div class="override-block${getOverride(source.id) ? ' override-active' : ''}">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
                    <div style="display:flex;align-items:center;gap:8px">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--dark-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 12"/></svg>
                        <span style="font-size:11px;font-weight:700;color:var(--dark-text);letter-spacing:.06em;text-transform:uppercase">Manual Alert Threshold</span>
                    </div>
                    ${getOverride(source.id) ? `<span class="override-badge-active">Active &bull; ${formatOverrideMs(getOverride(source.id))}</span>` : '<span class="override-badge-off">Off</span>'}
                </div>
                <div style="font-size:11px;color:var(--neutral-slate-500);margin-bottom:14px;line-height:1.6">
                    Bypasses historical bucket analysis. Alert fires immediately when silence exceeds this fixed duration.<br>
                    Set all fields to <strong style="color:var(--neutral-slate-400)">0</strong> to remove override and restore historical behavior.
                </div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
                    <div class="override-unit-cell">
                        <input type="number" id="override-d" min="0" value="${msToOverrideParts(getOverride(source.id)).d}" class="override-input">
                        <span class="override-unit-label">Days</span>
                    </div>
                    <div class="override-unit-cell">
                        <input type="number" id="override-h" min="0" max="23" value="${msToOverrideParts(getOverride(source.id)).h}" class="override-input">
                        <span class="override-unit-label">Hours</span>
                    </div>
                    <div class="override-unit-cell">
                        <input type="number" id="override-m" min="0" max="59" value="${msToOverrideParts(getOverride(source.id)).m}" class="override-input">
                        <span class="override-unit-label">Minutes</span>
                    </div>
                    <div class="override-unit-cell">
                        <input type="number" id="override-s" min="0" max="59" value="${msToOverrideParts(getOverride(source.id)).s}" class="override-input">
                        <span class="override-unit-label">Seconds</span>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    <button class="btn btn-primary btn-sm" onclick="saveOverride(${source.id})">Save Threshold</button>
                    ${getOverride(source.id) ? `<button class="btn btn-ghost btn-sm" onclick="document.getElementById('override-d').value=0;document.getElementById('override-h').value=0;document.getElementById('override-m').value=0;document.getElementById('override-s').value=0;saveOverride(${source.id})">Clear</button>` : ''}
                    <span id="override-status" style="font-size:11px;min-height:14px"></span>
                </div>
            </div>

            <div class="divider"></div>

            <div class="reset-block">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--dark-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                    <span style="font-size:11px;font-weight:700;color:var(--dark-text);letter-spacing:.06em;text-transform:uppercase">Reset Buckets</span>
                </div>
                <div style="font-size:11px;color:var(--neutral-slate-500);margin-bottom:12px;line-height:1.6">
                    Clears bucket history, daily behavior and recorded stops for this source. The behavior baseline rebuilds from the next polled event.
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    <button class="btn btn-secondary btn-sm" onclick="resetSourceBuckets(${source.id})">Reset Buckets</button>
                    <span id="reset-buckets-status" style="font-size:11px;min-height:14px"></span>
                </div>
            </div>
        </div>

        <div class="card" style="margin-bottom:16px">
            <div class="card-header">
                <span class="card-title">Historical Bucket Distribution</span>
                ${source.analyzed_from
                    ? `<span style="font-size:11px;color:var(--neutral-slate-500)">${escHtml(source.analyzed_from)} &rarr; ${escHtml(source.analyzed_to)}</span>`
                    : ''}
            </div>
            <canvas id="bucket-chart" style="width:100%;display:block"></canvas>
            <div id="bucket-legend" style="margin-top:12px"></div>
        </div>

        <div class="card" style="margin-bottom:16px">
            <div class="card-header">
                <span class="card-title">Historical Daily Behavior</span>
                <span style="font-size:11px;color:var(--neutral-slate-500)">Gap distribution by day of week</span>
            </div>
            <canvas id="daily-chart" style="width:100%;display:block"></canvas>
            <div id="daily-legend" style="margin-top:12px"></div>
        </div>

        <div class="card" style="margin-bottom:16px">
            <div class="card-header">
                <span class="card-title">Historical Stops</span>
                <span style="font-size:11px;color:var(--neutral-slate-500)" id="stops-count"></span>
            </div>
            <div id="stops-filter-bar" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
                <button class="stops-tab" data-range="day" onclick="setStopsRange('day',this)">Today</button>
                <button class="stops-tab" data-range="yesterday" onclick="setStopsRange('yesterday',this)">Yesterday</button>
                <button class="stops-tab" data-range="2days" onclick="setStopsRange('2days',this)">2 Days Ago</button>
                <button class="stops-tab" data-range="3days" onclick="setStopsRange('3days',this)">3 Days Ago</button>
                <button class="stops-tab" data-range="week" onclick="setStopsRange('week',this)">This Week</button>
                <button class="stops-tab" data-range="last7" onclick="setStopsRange('last7',this)">Last 7 Days</button>
                <button class="stops-tab" data-range="last14" onclick="setStopsRange('last14',this)">Last 14 Days</button>
                <button class="stops-tab" data-range="last30" onclick="setStopsRange('last30',this)">Last 30 Days</button>
                <button class="stops-tab" data-range="month" onclick="setStopsRange('month',this)">This Month</button>
                <button class="stops-tab" data-range="lastmonth" onclick="setStopsRange('lastmonth',this)">Last Month</button>
                <button class="stops-tab" data-range="older" onclick="setStopsRange('older',this)">Older</button>
                <button class="stops-tab" data-range="all" onclick="setStopsRange('all',this)">All</button>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center">
                <div class="filter-input-wrap">
                    <span class="search-icon">&#128269;</span>
                    <input type="text" id="stops-search" class="filter-input" placeholder="Search stops..." oninput="renderStops()" style="min-width:180px">
                </div>
                <select id="stops-filter-gap" class="filter-select" onchange="renderStops()">
                    <option value="">All gap sizes</option>
                    <option value="5">&lt; 5m</option>
                    <option value="30">&lt; 30m</option>
                    <option value="60">&lt; 1h</option>
                    <option value="240">&lt; 4h</option>
                    <option value="1440">&lt; 1 day</option>
                    <option value="gt1440">&gt; 1 day</option>
                </select>
                <select id="stops-filter-bucket" class="filter-select" onchange="renderStops()">
                    <option value="">All buckets</option>
                </select>
                <select id="stops-filter-day" class="filter-select" onchange="renderStops()">
                    <option value="">All days</option>
                    <option value="Sunday">Sunday</option>
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                </select>
                <select id="stops-filter-month" class="filter-select" onchange="renderStops()">
                    <option value="">All months</option>
                    <option value="0">January</option>
                    <option value="1">February</option>
                    <option value="2">March</option>
                    <option value="3">April</option>
                    <option value="4">May</option>
                    <option value="5">June</option>
                    <option value="6">July</option>
                    <option value="7">August</option>
                    <option value="8">September</option>
                    <option value="9">October</option>
                    <option value="10">November</option>
                    <option value="11">December</option>
                </select>
            </div>
            <div id="stops-body">
                <div style="text-align:center;padding:24px;color:var(--neutral-slate-500);font-size:13px">Loading...</div>
            </div>
        </div>
    `;

    function updateCurrentStop() {
        const el = document.getElementById('ls-current-stop');
        if (!el) return;
        const live = state.allSources.find(s => String(s.id) === String(source.id)) || source;

        const stalledFor = checkPollStall(live);
        renderPollStallBanner(stalledFor);

        const leEl = document.querySelector('[data-ls-lastevent]');
        if (leEl) {
            const txt = live.last_event_time || '—';
            if (leEl.textContent !== txt) leEl.textContent = txt;
        }

        const bkEl = document.querySelector('[data-ls-bucket]');
        if (bkEl) {
            const liveBucket = live.last_event_ms > 0
                ? (getLiveCurrentBucket(live.last_event_ms) || live.current_bucket)
                : live.current_bucket;
            const btxt = liveBucket || '—';
            if (bkEl.textContent !== btxt) bkEl.textContent = btxt;
            const cls = getEffectiveBucketClass(live);
            bkEl.className = 'bucket-pill ' + cls;
        }

        if (!live.last_event_ms || live.last_event_ms <= 0) {
            el.textContent = '—';
            return;
        }
        const diffMs  = Date.now() - live.last_event_ms;
        const diffMin = diffMs / 60000;
        const bucket  = bucketFromMs(diffMs);

        const sev = bucketSeverity(bucket, live.behavior_threshold, live.buckets);
        const color = sev === 'alarm' ? 'var(--dark-primary)' : sev === 'ok' ? 'var(--success-primary)' : 'var(--neutral-slate-500)';

        const hrs  = Math.floor(diffMin / 60);
        const mins = Math.floor(diffMin % 60);
        const days = Math.floor(diffMin / 1440);
        let label;
        if (diffMin < 60)       label = Math.floor(diffMin) + 'm';
        else if (diffMin < 1440) label = hrs + 'h ' + mins + 'm';
        else                    label = days + 'd ' + Math.floor((diffMin % 1440) / 60) + 'h';

        el.style.color   = color;
        el.innerHTML = `${label} <span style="font-size:11px;opacity:0.6;font-weight:500">(${bucket})</span>`;
    }

    _pollWatchInit(source.id);

    updateCurrentStop();
    if (window._stopInterval) { clearInterval(window._stopInterval); window._stopInterval = null; }
    window._stopInterval = setInterval(() => {
        if (!document.getElementById('ls-current-stop')) { clearInterval(window._stopInterval); window._stopInterval = null; return; }
        updateCurrentStop();
    }, 1000);

    function tryDrawChart(attempts) {
        const canvas = document.getElementById('bucket-chart');
        if (!canvas) return;
        const w = canvas.getBoundingClientRect().width || canvas.offsetWidth || canvas.parentElement?.offsetWidth;
        if (!w && attempts > 0) {
            setTimeout(() => tryDrawChart(attempts - 1), 100);
            return;
        }
        drawBucketChart('bucket-chart', source.buckets || {}, source.behavior_threshold);
        renderBucketLegend('bucket-legend', source.buckets || {});
        drawDailyChart('daily-chart', source.daily_buckets || {});
        renderDailyLegend('daily-legend', source.daily_buckets || {});
    }
    setTimeout(() => tryDrawChart(5), 100);
    if (String(_stopsSourceId) !== String(source.id)) {
        _stopsRange = 'week';
        _stopsSearch = '';
        _stopsGap = '';
        _stopsBucket = '';
        _stopsDay = '';
        _stopsMonth = '';
    }
    _stopsData = [];
    _stopsSourceId = source.id;
    loadHistoricalStops(source.id);
    if (typeof mountAnalysisButton === 'function') mountAnalysisButton(source.id);
}

function renderBucketLegend(legendId, buckets) {
    const el = document.getElementById(legendId);
    if (!el) return;

    const present = activeBuckets(buckets);
    const total   = present.reduce((s, k) => s + (buckets[k] || 0), 0);

    if (!present.length) {
        el.innerHTML = `<div style="font-size:11px;color:var(--neutral-slate-600);padding:4px 0">No gap history yet.</div>`;
        return;
    }

    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:6px;margin-top:12px">` +
        present.map(k => {
            const v   = buckets[k] || 0;
            const pct = total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '';
            const c   = getBucketColorFor(k);
            return `<div style="
                background:${c}18;
                border:1px solid ${c}55;
                border-radius:6px;padding:6px 8px;
                display:flex;flex-direction:column;gap:2px">
                <div style="display:flex;align-items:center;gap:5px">
                    <div style="width:7px;height:7px;border-radius:2px;background:${c};flex-shrink:0"></div>
                    <span style="font-size:10px;color:var(--bucket-label-active);font-weight:500">${k}</span>
                </div>
                <div style="font-size:14px;font-weight:700;color:var(--dark-text);line-height:1">${v}</div>
                <div style="font-size:10px;color:${c};opacity:0.8">${pct}</div>
            </div>`;
        }).join('') +
    `</div>`;
}

function resetSourceBuckets(sourceId) {
    const existing = document.getElementById('reset-buckets-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'reset-buckets-overlay';
    overlay.className = 'stop-note-modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.innerHTML = `
        <div class="stop-note-modal" style="max-width:380px">
            <div class="stop-note-modal-header">
                <div>
                    <div class="stop-note-modal-title">Reset Buckets</div>
                    <div class="stop-note-modal-meta">This action cannot be undone.</div>
                </div>
                <button class="stop-note-modal-close" onclick="document.getElementById('reset-buckets-overlay').remove()">&#x2715;</button>
            </div>
            <div style="font-size:13px;color:var(--neutral-slate-400);margin-bottom:16px;line-height:1.6">
                Clears all bucket history, daily behavior and recorded stops for this log source. Live polling rebuilds the baseline from the next event.
            </div>
            <div class="stop-note-modal-footer">
                <button class="btn btn-ghost btn-sm" onclick="document.getElementById('reset-buckets-overlay').remove()">Cancel</button>
                <button class="btn btn-sm" style="background:var(--dark-primary);color:var(--on-primary);border:none" onclick="confirmResetBuckets(${sourceId})">Reset</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
}

async function confirmResetBuckets(sourceId) {
    document.getElementById('reset-buckets-overlay')?.remove();
    const statusEl = document.getElementById('reset-buckets-status');
    if (statusEl) { statusEl.style.color = 'var(--neutral-slate-400)'; statusEl.textContent = 'Resetting...'; }
    try {
        const resp = await fetch(`${API_BASE}/api/reset-buckets/${sourceId}`, { method: 'POST' });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || ('HTTP ' + resp.status));
        if (statusEl) { statusEl.style.color = 'var(--success-primary)'; statusEl.textContent = 'Buckets reset.'; }
        await loadAllData();
        const fresh = state.allSources.find(s => String(s.id) === String(sourceId));
        if (fresh) renderLogSourceHTML(fresh, null);
    } catch (e) {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Failed: ' + e.message; }
    }
}

let _stopsData = [];
let _stopsRange = 'week';
let _stopsSourceId = null;
let _stopsSearch = '';
let _stopsGap = '';
let _stopsBucket = '';
let _stopsDay = '';
let _stopsMonth = '';

async function loadHistoricalStops(sourceId) {
    try {
        const resp = await fetch(`${API_BASE}/api/stops/${sourceId}`);
        if (resp.ok) {
            const text = await resp.text();
            let data;
            try { data = JSON.parse(text); } catch { data = []; }
            if (Array.isArray(data)) {
                _stopsData = data;
            } else if (data && typeof data === 'object') {
                _stopsData = [data];
            } else {
                _stopsData = [];
            }
        } else {
            _stopsData = [];
        }
    } catch {
        _stopsData = [];
    }
    restoreStopsFilterUI();
    renderStops();
}

function restoreStopsFilterUI() {
    const searchEl = document.getElementById('stops-search');
    const gapEl    = document.getElementById('stops-filter-gap');
    const dayEl     = document.getElementById('stops-filter-day');
    const monthEl   = document.getElementById('stops-filter-month');
    if (searchEl && _stopsSearch) searchEl.value = _stopsSearch;
    if (gapEl && _stopsGap) gapEl.value = _stopsGap;
    if (dayEl) dayEl.value = _stopsDay;
    if (monthEl) monthEl.value = _stopsMonth;
}

function setStopsRange(range, btn) {
    _stopsRange = range;
    document.querySelectorAll('.stops-tab').forEach(b => b.classList.remove('active-tab'));
    if (btn) btn.classList.add('active-tab');
    renderStops();
}

function filterStopsByRange(stops, range) {
    const startOfDay   = new Date(); startOfDay.setHours(0,0,0,0);
    const startOfYest  = new Date(startOfDay); startOfYest.setDate(startOfDay.getDate() - 1);
    const endOfYest    = startOfDay.getTime();
    const start2days   = new Date(startOfDay); start2days.setDate(startOfDay.getDate() - 2);
    const start3days   = new Date(startOfDay); start3days.setDate(startOfDay.getDate() - 3);
    const startOfWeek  = new Date(startOfDay); startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startLast7   = new Date(startOfDay); startLast7.setDate(startOfDay.getDate() - 7);
    const startLast14  = new Date(startOfDay); startLast14.setDate(startOfDay.getDate() - 14);
    const startLast30  = new Date(startOfDay); startLast30.setDate(startOfDay.getDate() - 30);
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
    const startOfLM    = new Date(startOfDay.getFullYear(), startOfDay.getMonth() - 1, 1);
    const endOfLM      = startOfMonth.getTime();

    if (range === 'day')       return stops.filter(s => s.start_ms >= startOfDay.getTime());
    if (range === 'yesterday') return stops.filter(s => s.start_ms >= startOfYest.getTime() && s.start_ms < endOfYest);
    if (range === '2days')     return stops.filter(s => s.start_ms >= start2days.getTime() && s.start_ms < startOfYest.getTime());
    if (range === '3days')     return stops.filter(s => s.start_ms >= start3days.getTime() && s.start_ms < start2days.getTime());
    if (range === 'week')      return stops.filter(s => s.start_ms >= startOfWeek.getTime());
    if (range === 'last7')     return stops.filter(s => s.start_ms >= startLast7.getTime());
    if (range === 'last14')    return stops.filter(s => s.start_ms >= startLast14.getTime());
    if (range === 'last30')    return stops.filter(s => s.start_ms >= startLast30.getTime());
    if (range === 'month')     return stops.filter(s => s.start_ms >= startOfMonth.getTime());
    if (range === 'lastmonth') return stops.filter(s => s.start_ms >= startOfLM.getTime() && s.start_ms < endOfLM);
    if (range === 'older')     return stops.filter(s => s.start_ms < startOfLM.getTime());
    return stops;
}

function formatGapMs(ms) {
    if (!ms || ms <= 0) return '—';
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    if (m) parts.push(m + 'm');
    if (s) parts.push(s + 's');
    return parts.join(' ') || '0s';
}

function renderStops() {
    const body    = document.getElementById('stops-body');
    const countEl = document.getElementById('stops-count');
    if (!body) return;

    const searchEl = document.getElementById('stops-search');
    const gapEl    = document.getElementById('stops-filter-gap');
    const bucketEl = document.getElementById('stops-filter-bucket');
    const dayEl    = document.getElementById('stops-filter-day');
    const monthEl  = document.getElementById('stops-filter-month');

    if (searchEl) _stopsSearch = searchEl.value.toLowerCase();
    if (gapEl)    _stopsGap = gapEl.value;
    if (bucketEl) _stopsBucket = bucketEl.value;
    if (dayEl)    _stopsDay = dayEl.value;
    if (monthEl)  _stopsMonth = monthEl.value;

    document.querySelectorAll('.stops-tab').forEach(b => {
        b.classList.toggle('active-tab', b.dataset.range === _stopsRange);
    });

    if (bucketEl && bucketEl.options.length <= 1) {
        const present = [...new Set(_stopsData.map(s => s.bucket).filter(Boolean))]
            .sort((a, b) => BUCKET_ORDER.indexOf(a) - BUCKET_ORDER.indexOf(b));
        bucketEl.innerHTML = '<option value="">All buckets</option>' +
            present.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');
        bucketEl.value = _stopsBucket;
    }

    let filtered = filterStopsByRange([..._stopsData].reverse(), _stopsRange);

    if (_stopsSearch) {
        filtered = filtered.filter(s =>
            (s.started_at || '').toLowerCase().includes(_stopsSearch) ||
            (s.ended_at || '').toLowerCase().includes(_stopsSearch) ||
            (s.day || '').toLowerCase().includes(_stopsSearch) ||
            (s.bucket || '').toLowerCase().includes(_stopsSearch) ||
            (s.note || '').toLowerCase().includes(_stopsSearch));
    }
    if (_stopsGap) {
        if (_stopsGap === 'gt1440') filtered = filtered.filter(s => (s.gap_ms / 60000) > 1440);
        else filtered = filtered.filter(s => (s.gap_ms / 60000) < parseFloat(_stopsGap));
    }
    if (_stopsBucket) {
        filtered = filtered.filter(s => s.bucket === _stopsBucket);
    }
    if (_stopsDay) {
        filtered = filtered.filter(s => s.day === _stopsDay);
    }
    if (_stopsMonth !== '') {
        const m = parseInt(_stopsMonth, 10);
        filtered = filtered.filter(s => s.start_ms && new Date(s.start_ms).getMonth() === m);
    }

    if (countEl) countEl.textContent = filtered.length + ' stop' + (filtered.length !== 1 ? 's' : '');

    if (!filtered.length) {
        body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--neutral-slate-500);font-size:13px">No stops match the current filters</div>`;
        return;
    }

    const colors = getBucketColors();

    body.innerHTML = `
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th>Day</th>
                        <th>Stopped At</th>
                        <th>Came Back</th>
                        <th>Gap</th>
                        <th>Bucket</th>
                        <th>Note</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${filtered.map((s, i) => {
                        const bi  = BUCKET_ORDER.indexOf(s.bucket);
                        const col = bi >= 0 ? (colors[bi] || getCSSVar('--bucket-fallback')) : getCSSVar('--bucket-fallback');
                        const realIdx = _stopsData.indexOf(s);
                        return `<tr>
                            <td style="font-size:12px;color:var(--neutral-slate-400)">${escHtml(s.day || '—')}</td>
                            <td style="font-size:12px;color:var(--dark-text);font-family:monospace">${escHtml(s.started_at || '—')}</td>
                            <td style="font-size:12px;color:var(--success-primary);font-family:monospace">${escHtml(s.ended_at || '—')}</td>
                            <td style="font-size:12px;font-weight:600;color:var(--dark-text)">${formatGapMs(s.gap_ms)}</td>
                            <td><span class="bucket-pill" style="background:${col}18;color:${col};border-color:${col}44">${escHtml(s.bucket || '—')}</span></td>
                            <td>${s.note ? `<span style="font-size:11px;color:var(--dark-accent);font-weight:600" title="${escHtml(s.note)}">&#128203;</span>` : ''}</td>
                            <td style="white-space:nowrap">
                                <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 8px;${s.note ? 'color:var(--dark-accent)' : ''}" onclick="openStopNoteModal(_stopsSourceId, ${realIdx}, event)">${s.note ? 'Edit Note' : 'Add Note'}</button>
                                <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 8px;color:var(--dark-primary)" onclick="deleteStop(_stopsSourceId, ${realIdx}, event)">Delete</button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
}
const POLL_STALL_MS = 5 * 60 * 1000;

const _pollWatch = {
    sourceId:    null,
    lastSeenMs:  null,
    lastSeenAt:  null,
    reported:    false,
};

function _pollWatchInit(sourceId) {
    if (String(_pollWatch.sourceId) !== String(sourceId)) {
        _pollWatch.sourceId   = sourceId;
        _pollWatch.lastSeenMs = null;
        _pollWatch.lastSeenAt = null;
        _pollWatch.reported   = false;
    }
}

function checkPollStall(live) {
    const now = Date.now();
    const cur = live.last_event_ms || 0;

    if (_pollWatch.lastSeenMs === null) {
        _pollWatch.lastSeenMs = cur;
        _pollWatch.lastSeenAt = now;
        return null;
    }

    if (cur > _pollWatch.lastSeenMs) {
        _pollWatch.lastSeenMs = cur;
        _pollWatch.lastSeenAt = now;
        if (_pollWatch.reported) {
            _pollWatch.reported = false;
            logPollEvent('recovered', live, 0);
        }
        return null;
    }

    const stalledFor = now - _pollWatch.lastSeenAt;
    if (stalledFor < POLL_STALL_MS) return null;

    if (!_pollWatch.reported) {
        _pollWatch.reported = true;
        logPollEvent('stalled', live, stalledFor);
    }
    return stalledFor;
}

function logPollEvent(kind, live, stalledFor) {
    const name = live.name || live.id;
    if (kind === 'recovered') {
        console.info(`[POLL OK] ${name} (id ${live.id}) last_event advanced again`);
        return;
    }
    const mins = Math.floor(stalledFor / 60000);
    const msg  = `[POLL STALL] ${name} (id ${live.id}) last_event_time has not advanced for ${mins}m. ` +
                 `Stuck at ${live.last_event_time || 'never'}. The poller is not pulling new events for this source.`;
    console.error(msg);

    fetch(`${API_BASE}/api/poll-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source_id:      live.id,
            source_name:    live.name,
            collector:      live._collector || '',
            domain:         live.domain_group || '',
            last_event_ms:  live.last_event_ms || 0,
            last_event_time: live.last_event_time || '',
            stalled_ms:     stalledFor,
            stalled_min:    mins,
            message:        msg,
        }),
    }).catch(() => {});
}

function renderPollStallBanner(stalledFor) {
    const host = document.getElementById('poll-stall-banner');
    if (!host) return;

    if (!stalledFor) {
        host.innerHTML = '';
        host.style.display = 'none';
        return;
    }

    const mins = Math.floor(stalledFor / 60000);
    host.style.display = '';
    host.innerHTML = `
        <div class="poll-stall">
            <div class="poll-stall-icon">!</div>
            <div class="poll-stall-body">
                <div class="poll-stall-title">Polling stalled &mdash; no new events pulled for ${mins}m</div>
                <div class="poll-stall-msg">
                    The last event time has not advanced since this page was opened.
                    The poller is not writing fresh data for this log source.
                    Use <b>Pull last event</b> to query QRadar directly and confirm whether events are actually arriving.
                </div>
            </div>
        </div>`;
}