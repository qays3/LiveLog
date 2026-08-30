const API_BASE = window.location.origin;
const DATA_BASE = '/data';
const POLL_INTERVAL = 30000;

const state = {
    domainFiles: [],
    allSources: [],
    labels: {},
    overrides: {},
    alertBufferMin: 0,
    alertMaxBucketMinCount: 4,
    minAlertMinutes: 20,
    alertStatus: {},
    stopsAll: null,
    lastUpdated: null,
    polling: false
};

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function getHash() {
    return window.location.hash.replace('#', '') || '/dashboard';
}

function navigate(path) {
    window.location.hash = path;
}

function renderPage(path) {
    $$('.page').forEach(p => p.classList.add('hidden'));
    $$('.nav-item').forEach(n => n.classList.remove('active'));

    const parts = path.split('/').filter(Boolean);
    const section = parts[0] || 'dashboard';

    const page = document.getElementById('page-' + section);
    if (page) page.classList.remove('hidden');

    const navItem = document.querySelector(`.nav-item[data-route="${section}"]`);
    if (navItem) navItem.classList.add('active');

    if (section === 'dashboard') renderDashboard();
    else if (section === 'domains') renderDomains(parts[1] ? decodeURIComponent(parts[1]) : '');
    else if (section === 'collectors') renderCollectors(parts[1] ? decodeURIComponent(parts[1]) : '');
    else if (section === 'alerts') renderAlerts();
    else if (section === 'historical-stops') renderHistoricalStopsPage();
    else if (section === 'infra') renderCanvasPage();
    else if (section === 'toolbox') renderToolbox();
    else if (section === 'logsource') renderLogSource(parts[1]);

    if ($('#topbar-title')) {
        const titles = {
            dashboard: 'Dashboard',
            domains: 'Domains',
            collectors: 'Collectors',
            alerts: 'Alerts',
            logsource: 'Log Source Detail',
            'historical-stops': 'Historical Stops',
            infra: 'Infra Map',
            toolbox: 'Toolbox',
        };
        $('#topbar-title').textContent = titles[section] || '';
    }
}

async function fetchWithConcurrency(urls, concurrency = 8) {
    const results = new Array(urls.length);
    let idx = 0;
    async function worker() {
        while (idx < urls.length) {
            const i = idx++;
            try {
                results[i] = await fetch(encodeURI(urls[i]), { cache: 'no-store' }).then(r => r.json());
            } catch { results[i] = null; }
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, urls.length) }, worker);
    await Promise.all(workers);
    return results;
}

async function loadAppConfig() {
    try {
        const cfg  = await fetch(`${API_BASE}/api/config`).then(r => r.json());
        const name = (cfg && cfg.app_name) ? cfg.app_name : '';
        state.alertBufferMin = (cfg && cfg.alert_buffer_minutes) ? cfg.alert_buffer_minutes : 0;
        state.alertMaxBucketMinCount = (cfg && cfg.max_bucket_min_count) ? cfg.max_bucket_min_count : 4;
        state.minAlertMinutes = (cfg && cfg.min_alert_minutes) ? cfg.min_alert_minutes : 20;
        if (!name) return;
        document.title = name;
        const logoText = document.getElementById('app-name-text');
        if (logoText) logoText.textContent = name;
        document.querySelectorAll('.app-name').forEach(el => el.textContent = name);
    } catch(e) { console.error('loadAppConfig failed:', e); }
}

async function loadAllData() {
    state.polling = true;
    updatePollIndicator(true);

    try {
        const [labelsResp, domainFilePaths, stateResp, overridesResp, stopsResp, alertStatusResp] = await Promise.all([
            fetch(`${API_BASE}/api/labels`).then(r => r.json()).catch(() => ({})),
            fetch(`${API_BASE}/api/domain-files`).then(r => r.json()).catch(() => []),
            fetch(`${API_BASE}/api/state`).then(r => r.json()).catch(() => ({})),
            fetch(`${API_BASE}/api/overrides`).then(r => r.json()).catch(() => ({})),
            fetch(`${API_BASE}/data/stops.json`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
            fetch(`${API_BASE}/api/alert-status`).then(r => r.json()).catch(() => ({})),
        ]);
        state.totalSources = (stateResp && stateResp.total_sources) ? stateResp.total_sources : null;

        state.labels    = labelsResp    || {};
        state.overrides    = overridesResp    || {};
        state.alertStatus        = alertStatusResp  || {};

        const fileData = await fetchWithConcurrency(domainFilePaths, 10);

        state.allSources = [];
        state.domainFiles = [];
        const seenIds = new Set();

        fileData.forEach((val, i) => {
            if (!val || !val.log_sources) return;
            if (!Array.isArray(val.log_sources)) val.log_sources = [val.log_sources].filter(Boolean);
            const dg = val.domain_group;
            const cn = val.collector_name;
            if (!dg || dg === 'N/A' || !cn || cn === 'Unknown') return;
            state.domainFiles.push(val);
            val.log_sources.forEach(src => {
                if (seenIds.has(src.id)) return;
                seenIds.add(src.id);
                state.allSources.push(normalizeSource({
                    ...src,
                    _collector: cn,
                    _domain: dg,
                    _file: domainFilePaths[i]
                }));
            });
        });

        if (stopsResp && typeof stopsResp === 'object') {
            const flat = [];
            Object.keys(stopsResp).forEach(srcId => {
                const entries = Array.isArray(stopsResp[srcId]) ? stopsResp[srcId] : [stopsResp[srcId]];
                const src = state.allSources.find(s => String(s.id) === String(srcId));
                entries.forEach((e, idx) => {
                    if (e && e.gap_ms) flat.push({ ...e, source_id: srcId, source_name: src ? src.name : srcId, domain: src ? src.domain_group : '—', collector: src ? src._collector : '—', _srcIdx: idx });
                });
            });
            flat.sort((a, b) => b.end_ms - a.end_ms);
            state.stopsAll = flat;
        } else {
            state.stopsAll = [];
        }

        state.lastUpdated = new Date();
        Object.keys(state.alertStatus).forEach(srcId => {
            const src = state.allSources.find(s => String(s.id) === srcId);
            if (!src) return;
            const sevH = liveBucketSeverity(src);
            const sevQ = (typeof qradarThresholdSeverity === 'function') ? qradarThresholdSeverity(src) : 'neutral';
            if (sevH !== 'alarm' && sevQ !== 'alarm') {
                delete state.alertStatus[srcId];
                fetch(`${API_BASE}/api/alert-status/${srcId}`, { method: 'DELETE' }).catch(() => {});
            }
        });
        updatePollIndicator(false);
        const timeStr = state.lastUpdated.toLocaleTimeString();
        const footerEl = document.getElementById('last-updated-footer');
        if (footerEl) footerEl.textContent = 'Updated ' + timeStr;
        const topEl = document.getElementById('last-updated');
        if (topEl) topEl.textContent = 'Updated ' + timeStr;
        renderPage(getHash());
        updateNavCounts();
    } catch (err) {
        console.error('Data load error:', err);
        Object.keys(state.alertStatus).forEach(srcId => {
            const src = state.allSources.find(s => String(s.id) === srcId);
            if (!src) return;
            const sevH = liveBucketSeverity(src);
            const sevQ = (typeof qradarThresholdSeverity === 'function') ? qradarThresholdSeverity(src) : 'neutral';
            if (sevH !== 'alarm' && sevQ !== 'alarm') {
                delete state.alertStatus[srcId];
                fetch(`${API_BASE}/api/alert-status/${srcId}`, { method: 'DELETE' }).catch(() => {});
            }
        });
        updatePollIndicator(false);
    }

    state.polling = false;
}

function updatePollIndicator(active) {
    const dot = document.getElementById('poll-dot');
    if (!dot) return;
    if (active) dot.classList.add('polling');
    else dot.classList.remove('polling');
}

function updateNavCounts() {
    const engine = (typeof getDefaultEngine === 'function') ? getDefaultEngine() : 'historical';
    const count = state.allSources.filter(s => {
        if (typeof engineEligible !== 'function') return false;
        if (!engineEligible(s, engine)) return false;
        if (engineSeverity(s, engine) !== 'alarm') return false;
        return getAlertStatus(s.id) === 'active';
    }).length;
    const alertNav = document.getElementById('nav-alerts-count');
    if (alertNav) {
        alertNav.textContent = count || '';
        alertNav.title = count
            ? count + ' active alert' + (count > 1 ? 's' : '') + ' (' + (typeof ENGINE_LABELS !== 'undefined' ? ENGINE_LABELS[engine] : engine) + ')'
            : '';
    }
}



function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showSkeleton(containerId, rows, cols) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.remove('hidden');
    const widths = ['40%', '20%', '12%', '18%', '10%', '16%', '8%', '6%', '10%', '8%'];
    el.innerHTML = Array.from({length: rows}, () =>
        `<div class="skeleton-row">${Array.from({length: cols}, (_, i) =>
            `<div class="skeleton skeleton-cell" style="width:${widths[i] || '12%'}"></div>`
        ).join('')}</div>`
    ).join('');
}

function hideSkeleton(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.classList.add('hidden');
}

function showCardSkeleton(containerId, count) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = Array.from({length: count}, () =>
        `<div class="skeleton-card">
            <div class="skeleton skeleton-cell" style="width:60%;height:16px"></div>
            <div class="skeleton skeleton-cell" style="width:40%;height:12px"></div>
            <div style="display:flex;gap:8px;margin-top:4px">
                <div class="skeleton skeleton-cell" style="width:30%;height:32px"></div>
                <div class="skeleton skeleton-cell" style="width:30%;height:32px"></div>
                <div class="skeleton skeleton-cell" style="width:30%;height:32px"></div>
            </div>
        </div>`
    ).join('');
}

async function triggerRefresh() {
    const btn = document.getElementById('global-refresh-btn');
    if (btn) btn.classList.add('spinning');

    const section = getHash().split('/').filter(Boolean)[0] || 'dashboard';

    if (section === 'dashboard') {
        showSkeleton('dash-table-skeleton', 8, 10);
        document.getElementById('dash-table-wrap')?.classList.add('hidden');
    } else if (section === 'alerts') {
        showSkeleton('alerts-skeleton', 6, 4);
        document.getElementById('alerts-list')?.classList.add('hidden');
    } else if (section === 'collectors') {
        showCardSkeleton('collectors-content', 6);
    } else if (section === 'domains') {
        showCardSkeleton('domains-content', 6);
    }

    state.stopsAll = null;
    await loadAllData();

    hideSkeleton('dash-table-skeleton');
    hideSkeleton('alerts-skeleton');
    document.getElementById('dash-table-wrap')?.classList.remove('hidden');
    document.getElementById('alerts-list')?.classList.remove('hidden');

    if (btn) btn.classList.remove('spinning');
}

window.addEventListener('hashchange', () => renderPage(getHash()));

document.addEventListener('DOMContentLoaded', () => {
    $$('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            navigate('/' + item.dataset.route);
        });
    });

    loadAppConfig();
    loadAllData();
    setInterval(loadAllData, POLL_INTERVAL);
    setInterval(updateNavCounts, 10000);
});