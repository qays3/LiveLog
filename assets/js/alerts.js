function sortThresholds(thresholds) {
    const order = ['5 M','10 M','20 M','35 M','1 H','2 H','4 H','8 H','12 H','1 D','2 D','3 D','More than 3 D'];
    return thresholds.sort((a, b) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
    });
}

const ALERT_MAX_SILENCE_MS = 8 * 86400000;

let _alertTab = 'active';

const ALERT_ENGINES = ['historical', 'qradar'];
const ENGINE_LABELS = { historical: 'Historical Behavior', qradar: 'QRadar Behavior Threshold' };

function getDefaultEngine() {
    const v = localStorage.getItem('alert_default_engine');
    return ALERT_ENGINES.includes(v) ? v : 'historical';
}

function setDefaultEngine(engine) {
    if (!ALERT_ENGINES.includes(engine)) return;
    localStorage.setItem('alert_default_engine', engine);
    syncEngineButtons();
    if (typeof updateNavCounts === 'function') updateNavCounts();
}

let _alertEngine = getDefaultEngine();

function getActiveEngine() {
    return ALERT_ENGINES.includes(_alertEngine) ? _alertEngine : 'historical';
}

function engineSeverity(source, engine) {
    const e = engine || _alertEngine;
    return e === 'qradar'
        ? qradarThresholdSeverity(source)
        : liveBucketSeverity(source);
}

function engineEligible(source, engine) {
    const e = engine || _alertEngine;
    if (!source._collector || source._collector === 'Unknown') return false;
    if (!source.domain_group || source.domain_group === 'N/A') return false;
    if (!source.last_event_ms || source.last_event_ms <= 0) return false;
    if ((Date.now() - source.last_event_ms) > ALERT_MAX_SILENCE_MS) return false;
    if (e === 'qradar') {
        return parseQradarThresholdMin(source.behavior_threshold) !== null;
    }
    const override = getOverride(source.id);
    const hasOverride = override !== null && override > 0;
    const hasHistory  = maxBucket(source.buckets) !== null;
    return hasOverride || hasHistory;
}

function syncEngineButtons() {
    const def = getDefaultEngine();
    document.querySelectorAll('.alert-engine-btn').forEach(b => {
        const eng = b.dataset.engine;
        b.classList.toggle('active-engine', eng === _alertEngine);
        b.classList.toggle('is-default', eng === def);
        const pin = b.querySelector('.engine-default-pin');
        if (pin) {
            pin.classList.toggle('pinned', eng === def);
            pin.title = eng === def
                ? 'Default engine, the sidebar alert count uses this'
                : 'Set as default for the sidebar alert count';
            pin.textContent = eng === def ? '\u2605' : '\u2606';
        }
    });
    document.querySelectorAll('.alert-engine-note').forEach(note => {
        note.textContent = 'Sidebar count uses: ' + ENGINE_LABELS[def];
    });
}

function setAlertEngine(engine) {
    if (!ALERT_ENGINES.includes(engine)) return;
    _alertEngine = engine;
    syncEngineButtons();
    if (typeof renderPage === 'function') renderPage(getHash());
    else renderAlerts();
    if (typeof updateNavCounts === 'function') updateNavCounts();
}

function toggleDefaultEngine(engine, event) {
    if (event) event.stopPropagation();
    setDefaultEngine(engine);
}

function setAlertTab(tab) {
    _alertTab = tab;
    document.querySelectorAll('.alert-tab-btn').forEach(b => b.classList.toggle('active-tab', b.dataset.tab === tab));
    renderAlerts();
}

async function setAlertStatus(sourceId, status, notifyAfterMs) {
    const payload = { status, updated_at: Date.now() };
    if (notifyAfterMs) payload.notify_after_ms = Date.now() + notifyAfterMs;
    state.alertStatus[String(sourceId)] = payload;
    await fetch(`${API_BASE}/api/alert-status/${sourceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(() => {});
    updateNavCounts();
    renderAlerts();
}

function getAlertStatus(sourceId) {
    const s = state.alertStatus[String(sourceId)];
    if (!s) return 'active';
    if (s.status === 'notify_after' && s.notify_after_ms && Date.now() >= s.notify_after_ms) return 'active';
    return s.status || 'active';
}

function showNotifyModal(sourceId, sourceName) {
    const existing = document.getElementById('notify-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'notify-modal-overlay';
    overlay.className = 'stop-note-modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.innerHTML = `
        <div class="stop-note-modal" style="max-width:420px">
            <div class="stop-note-modal-header">
                <div>
                    <div class="stop-note-modal-title">Notify Me After</div>
                    <div class="stop-note-modal-meta">${escHtml(sourceName)}</div>
                </div>
                <button class="stop-note-modal-close" onclick="document.getElementById('notify-modal-overlay').remove()">&#x2715;</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:16px">
                ${[['5m','5 min'],['10m','10 min'],['30m','30 min'],['1h','1 hour'],['2h','2 hours'],['4h','4 hours'],['8h','8 hours'],['1d','1 day']].map(([val, label]) =>
                    `<button class="btn btn-ghost btn-sm" style="justify-content:center;font-size:12px" onclick="applyNotify(${sourceId},'${val}')">${label}</button>`
                ).join('')}
            </div>
            <div style="font-size:11px;font-weight:600;color:var(--neutral-slate-500);letter-spacing:.05em;margin-bottom:10px">CUSTOM</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
                <div class="override-unit-cell">
                    <input type="number" id="notify-d" min="0" value="0" class="override-input">
                    <span class="override-unit-label">Days</span>
                </div>
                <div class="override-unit-cell">
                    <input type="number" id="notify-h" min="0" max="23" value="0" class="override-input">
                    <span class="override-unit-label">Hours</span>
                </div>
                <div class="override-unit-cell">
                    <input type="number" id="notify-m" min="0" max="59" value="0" class="override-input">
                    <span class="override-unit-label">Minutes</span>
                </div>
                <div class="override-unit-cell">
                    <input type="number" id="notify-s" min="0" max="59" value="0" class="override-input">
                    <span class="override-unit-label">Seconds</span>
                </div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px">
                <button class="btn btn-ghost btn-sm" onclick="document.getElementById('notify-modal-overlay').remove()">Cancel</button>
                <button class="btn btn-primary btn-sm" onclick="applyNotifyCustom(${sourceId})">Set</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
}

function applyNotify(sourceId, val) {
    const map = { '5m': 300000, '10m': 600000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '8h': 28800000, '1d': 86400000 };
    setAlertStatus(sourceId, 'notify_after', map[val]);
    document.getElementById('notify-modal-overlay')?.remove();
}

function applyNotifyCustom(sourceId) {
    const d = parseInt(document.getElementById('notify-d')?.value || '0') || 0;
    const h = parseInt(document.getElementById('notify-h')?.value || '0') || 0;
    const m = parseInt(document.getElementById('notify-m')?.value || '0') || 0;
    const s = parseInt(document.getElementById('notify-s')?.value || '0') || 0;
    const ms = ((d * 86400) + (h * 3600) + (m * 60) + s) * 1000;
    if (ms <= 0) return;
    setAlertStatus(sourceId, 'notify_after', ms);
    document.getElementById('notify-modal-overlay')?.remove();
}

function formatNotifyRemaining(srcId) {
    const s = state.alertStatus[String(srcId)];
    if (!s || s.status !== 'notify_after' || !s.notify_after_ms) return '';
    const remaining = s.notify_after_ms - Date.now();
    if (remaining <= 0) return '';
    const min = Math.floor(remaining / 60000);
    if (min < 60) return `${min}m left`;
    const h = Math.floor(min / 60); const m = min % 60;
    if (h < 24) return `${h}h ${m}m left`;
    return `${Math.floor(h/24)}d ${h%24}h left`;
}

function buildAlertsList() {
    const list = [];
    state.allSources.forEach(s => {
        if (!engineEligible(s)) return;
        const sev = engineSeverity(s);
        if (sev !== 'alarm') return;
        const override = getOverride(s.id);
        const hasOverride = override !== null && override > 0;
        const diffMs = (s.last_event_ms && s.last_event_ms > 0) ? Date.now() - s.last_event_ms : 0;
        list.push({
            id:              s.id,
            name:            s.name,
            collector:       s._collector,
            domain_group:    s.domain_group,
            condition:       sev,
            current_bucket:  s.current_bucket,
            silence_minutes: diffMs > 0 ? diffMs / 60000 : null,
            last_event_ms:   s.last_event_ms || 0,
            is_manual:       _alertEngine === 'historical' && hasOverride,
            threshold:       s.behavior_threshold,
            _src:            s
        });
    });
    const sortVal = document.getElementById('alert-sort')?.value || 'oldest';
    list.sort((a, b) => {
        if (sortVal === 'newest') return (b.last_event_ms || 0) - (a.last_event_ms || 0);
        return (b.silence_minutes || 0) - (a.silence_minutes || 0);
    });
    return list;
}

function renderAlerts() {
    syncEngineButtons();
    const container = document.getElementById('alerts-list');
    if (container && !state.allSources.length) {
        container.innerHTML = [1,2,3].map(() => '<div class="skeleton" style="height:72px;border-radius:10px;margin-bottom:8px"></div>').join('');
        return;
    }
    if (!container) return;

    populateAlertFilters();

    const searchVal  = (document.getElementById('alert-search')?.value || '').toLowerCase();
    const domainVal  = document.getElementById('alert-filter-domain')?.value || '';
    const silenceVal = document.getElementById('alert-filter-silence')?.value || '';

    const allAlerts = buildAlertsList();

    const tabCounts = { active: 0, reported: 0, notify_after: 0, ignored: 0 };
    allAlerts.forEach(a => {
        const st = getAlertStatus(a.id);
        if (st === 'active') {
            tabCounts.active++;
        } else {
            tabCounts[st] = (tabCounts[st] || 0) + 1;
        }
    });

    document.querySelectorAll('.alert-tab-btn').forEach(b => {
        const tab = b.dataset.tab;
        const countEl = b.querySelector('.alert-tab-count');
        if (countEl) countEl.textContent = tabCounts[tab] || '';
    });

    const countEl = document.getElementById('alert-total-count');
    if (countEl) countEl.textContent = tabCounts['active'] || '';

    const incidentCount = Object.keys(state.collectorIncidents || {}).length;
    const incTabBtn = document.querySelector('.alert-tab-btn[data-tab="collector_issues"]');
    if (incTabBtn) {
        const cntEl = incTabBtn.querySelector('.alert-tab-count');
        if (cntEl) cntEl.textContent = incidentCount || '';
    }

    let alerts;
    if (_alertTab === 'active') {
        alerts = allAlerts.filter(a => getAlertStatus(a.id) === 'active');
    } else {
        alerts = allAlerts.filter(a => getAlertStatus(a.id) === _alertTab);
    }
    if (searchVal)  alerts = alerts.filter(a => a.name.toLowerCase().includes(searchVal));
    if (domainVal)  alerts = alerts.filter(a => a.domain_group === domainVal);
    if (silenceVal) alerts = alerts.filter(a => silenceInRange(a.silence_minutes, silenceVal));

    if (!alerts.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">&#10003;</div><div class="empty-state-text">No alerts in this category</div></div>`;
        return;
    }

    container.innerHTML = alerts.map(a => {
        const src       = a._src;
        const silence   = formatSilence(a.silence_minutes);
        const alertSt   = getAlertStatus(a.id);
        const notifyRem = formatNotifyRemaining(a.id);

        const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

        const statusActions = alertSt === 'active' ? `
            <button class="alert-action-btn reported" onclick="event.stopPropagation();setAlertStatus(${a.id},'reported')">Reported</button>
            <button class="alert-action-btn notify" onclick="event.stopPropagation();showNotifyModal(${a.id},'${escHtml(a.name)}')">Notify Me</button>
            <button class="alert-action-btn ignore" onclick="event.stopPropagation();setAlertStatus(${a.id},'ignored')">Ignore</button>
        ` : alertSt === 'reported' ? `
            <button class="alert-action-btn active" onclick="event.stopPropagation();setAlertStatus(${a.id},'active')">Move to Active</button>
            <button class="alert-action-btn ignore" onclick="event.stopPropagation();setAlertStatus(${a.id},'ignored')">Ignore</button>
        ` : alertSt === 'notify_after' ? `
            ${notifyRem ? `<span style="font-size:11px;color:var(--dark-accent);font-weight:600">${notifyRem}</span>` : ''}
            <button class="alert-action-btn active" onclick="event.stopPropagation();setAlertStatus(${a.id},'active')">Move to Active</button>
        ` : `
            <button class="alert-action-btn active" onclick="event.stopPropagation();setAlertStatus(${a.id},'active')">Restore</button>
        `;

        const metaDetail = _alertEngine === 'qradar'
            ? `<span class="alert-meta-item" style="color:var(--neutral-slate-500)">
                    QRadar threshold: <span style="color:var(--dark-primary);font-weight:600">${escHtml(a.threshold || '—')}</span>
               </span>`
            : `<span class="alert-meta-item" style="color:var(--neutral-slate-500)">
                    Normal: <span style="color:var(--success-primary);font-weight:600">${escHtml(dominantBucket(src?.buckets) || '—')}</span>
                    &nbsp;Max: <span style="color:var(--dark-primary);font-weight:600">${escHtml(maxBucket(src?.buckets) || '—')}</span>
               </span>`;

        return `<div class="alert-card alarm" onclick="navigate('/logsource/${a.id}')">
            <div class="alert-card-left">
                <div class="alert-icon-wrap alarm">${icon}</div>
                <div class="alert-body">
                    <div class="alert-name">${escHtml(a.name)}</div>
                    <div class="alert-meta">
                        ${a.domain_group ? `<span class="badge badge-info" style="font-size:10px;padding:1px 6px">${escHtml(a.domain_group)}</span>` : ''}
                        <span class="alert-meta-item">${escHtml(a.collector || '')}</span>
                        ${metaDetail}
                        ${a.is_manual ? `<span style="font-size:10px;background:var(--info-light);color:var(--info-primary);border:1px solid var(--info-border);padding:1px 6px;border-radius:4px;font-weight:600">Manual</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="alert-card-right">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;justify-content:flex-end">
                    <span class="alert-condition alarm">Alarm</span>
                    <span class="alert-silence" style="color:var(--dark-primary)">${silence}</span>
                </div>
                <div class="alert-actions" onclick="event.stopPropagation()">
                    ${statusActions}
                </div>
            </div>
        </div>`;
    }).join('');
}

function silenceInRange(minutes, range) {
    if (!minutes || !isFinite(minutes)) return range === 'never';
    if (range === 'never') return false;
    if (range === '5m')   return minutes <= 5;
    if (range === '30m')  return minutes <= 30;
    if (range === '1h')   return minutes <= 60;
    if (range === '4h')   return minutes <= 240;
    if (range === '12h')  return minutes <= 720;
    if (range === '1d')   return minutes <= 1440;
    if (range === '3d')   return minutes <= 4320;
    if (range === '7d')   return minutes <= 10080;
    if (range === '8d')   return minutes <= 11520;
    return true;
}

function formatSilence(minutes) {
    if (!minutes || !isFinite(minutes) || minutes <= 0) return '—';
    if (minutes > 525600) return '>1y';
    if (minutes > 43200)  return Math.round(minutes / 43200) + 'mo';
    if (minutes > 10080)  return Math.round(minutes / 10080) + 'w';
    if (minutes > 1440)   return (minutes / 1440).toFixed(1) + 'd';
    if (minutes > 60)     return (minutes / 60).toFixed(1) + 'h';
    return Math.round(minutes) + 'm';
}

function populateAlertFilters() {
    const domainSel = document.getElementById('alert-filter-domain');
    if (domainSel) {
        const cur = domainSel.value;
        const domains = [...new Set(
            state.allSources
                .filter(s => engineEligible(s))
                .filter(s => engineSeverity(s) === 'alarm')
                .map(s => s.domain_group)
        )].sort();
        domainSel.innerHTML = '<option value="">All domains</option>' +
            domains.map(d => `<option value="${escHtml(d)}"${d === cur ? ' selected' : ''}>${escHtml(d)}</option>`).join('');
    }
}