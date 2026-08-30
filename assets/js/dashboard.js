const dashSort = { col: null, dir: 1 };

let dashStatusFilter = '';

function sortSources(sources, col) {
    if (!col) return sources;
    return [...sources].sort((a, b) => {
        if (col === 'name')       return (a.name||'').localeCompare(b.name||'') * dashSort.dir;
        if (col === 'type')       return (a.log_source_type||'').localeCompare(b.log_source_type||'') * dashSort.dir;
        if (col === 'domain')     return (a.domain_group||'').localeCompare(b.domain_group||'') * dashSort.dir;
        if (col === 'collector')  return (a._collector||'').localeCompare(b._collector||'') * dashSort.dir;
        if (col === 'threshold')  return (a.behavior_threshold||'').localeCompare(b.behavior_threshold||'') * dashSort.dir;
        if (col === 'last_event') return (a.last_event_time||'').localeCompare(b.last_event_time||'') * dashSort.dir;
        if (col === 'bucket')     return (BUCKET_ORDER.indexOf(a.current_bucket) - BUCKET_ORDER.indexOf(b.current_bucket)) * dashSort.dir;
        if (col === 'eps')        return ((a.average_eps??-1) - (b.average_eps??-1)) * dashSort.dir;
        if (col === 'protocol')   return (a.protocol_type||'').localeCompare(b.protocol_type||'') * dashSort.dir;
        if (col === 'identifier') return (a.identifier||'').localeCompare(b.identifier||'') * dashSort.dir;
        return 0;
    });
}

function renderDashboard() {
    const sources = state.allSources;
    if (!sources.length) return;

    if (typeof syncEngineButtons === 'function') syncEngineButtons();

    // Populate filters
    const domainSel = document.getElementById('dash-filter-domain');
    if (domainSel && domainSel.options.length <= 1) {
        const domains = [...new Set(sources.map(s=>s.domain_group).filter(Boolean))].sort();
        domainSel.innerHTML = '<option value="">All domains</option>' + domains.map(d=>`<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('');
    }
    const collSel = document.getElementById('dash-filter-collector');
    if (collSel && collSel.options.length <= 1) {
        const colls = [...new Set(sources.map(s=>s._collector).filter(Boolean))].sort();
        collSel.innerHTML = '<option value="">All collectors</option>' + colls.map(c=>`<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    }
    const bucketSel = document.getElementById('dash-filter-bucket');
    if (bucketSel && bucketSel.options.length <= 1) {
        bucketSel.innerHTML = '<option value="">All buckets</option>' + BUCKET_ORDER.map(b=>`<option value="${b}">${b}</option>`).join('');
    }
    const threshSel = document.getElementById('dash-filter-threshold');
    if (threshSel && threshSel.options.length <= 1) {
        const thresholds = sortThresholds([...new Set(sources.map(s=>s.behavior_threshold).filter(t=>t&&t!=='undefined'))]);
        threshSel.innerHTML = '<option value="">All QRadar thresholds</option>' + thresholds.map(t=>`<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
    }

    // Bind filters once
    const searchEl = document.getElementById('dash-search');
    if (searchEl && !searchEl._bound) {
        searchEl._bound = true;
        searchEl.addEventListener('input', applyDashFilters);
        domainSel?.addEventListener('change', applyDashFilters);
        collSel?.addEventListener('change', applyDashFilters);
        bucketSel?.addEventListener('change', applyDashFilters);
        threshSel?.addEventListener('change', applyDashFilters);
    }

    // Bind sort headers once
    document.querySelectorAll('#page-dashboard thead th[data-col]').forEach(th => {
        if (th._bound) return;
        th._bound = true;
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (dashSort.col === col) dashSort.dir *= -1;
            else { dashSort.col = col; dashSort.dir = 1; }
            document.querySelectorAll('#page-dashboard thead th[data-col]').forEach(t => t.querySelector('.sort-arrow')?.remove());
            const arrow = document.createElement('span');
            arrow.className = 'sort-arrow';
            arrow.style.cssText = 'margin-left:4px;font-size:10px;opacity:0.7';
            arrow.textContent = dashSort.dir === 1 ? '▲' : '▼';
            th.appendChild(arrow);
            applyDashFilters();
        });
    });

    applyDashFilters();
}

function getDashBaseSources() {
    const search  = (document.getElementById('dash-search')?.value || '').toLowerCase();
    const domain  = document.getElementById('dash-filter-domain')?.value    || '';
    const coll    = document.getElementById('dash-filter-collector')?.value  || '';
    const bucket  = document.getElementById('dash-filter-bucket')?.value     || '';
    const thresh  = document.getElementById('dash-filter-threshold')?.value  || '';

    let sources = [...state.allSources];
    if (search) sources = sources.filter(s => (s.name || '').toLowerCase().includes(search));
    if (domain) sources = sources.filter(s => s.domain_group === domain);
    if (coll)   sources = sources.filter(s => s._collector === coll);
    if (bucket) sources = sources.filter(s => s.current_bucket === bucket);
    if (thresh) sources = sources.filter(s => s.behavior_threshold === thresh);
    return sources;
}

const DASH_STAT_LABELS = { ok: 'OK', alarm: 'Alarm', neutral: 'No Baseline' };

function setDashStatusFilter(status) {
    dashStatusFilter = (dashStatusFilter === status) ? '' : (status || '');
    applyDashFilters();
    document.getElementById('dash-table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDashStats() {
    const stats = document.getElementById('dash-stats');
    const base  = getDashBaseSources();

    const counts = { ok: 0, alarm: 0, neutral: 0 };
    base.forEach(s => {
        const sv = getEffectiveSeverity(s);
        counts[sv] = (counts[sv] || 0) + 1;
    });

    const serverTotal = state.totalSources || 0;
    const filtered    = base.length !== state.allSources.length;
    const totalTitle  = (!filtered && serverTotal && serverTotal !== base.length)
        ? `${serverTotal} source(s) on disk, ${base.length} loaded in this view`
        : 'Show all log sources';

    const card = (key, label, value, valueStyle, tip) => `
        <div class="stat-card stat-card-clickable${dashStatusFilter === key ? ' stat-card-active' : ''}"
             onclick="setDashStatusFilter('${key}')" title="${escHtml(tip)}">
            <div class="stat-label">${label}</div>
            <div class="stat-value ${valueStyle}">${value}</div>
        </div>`;

    if (stats) stats.innerHTML =
        card('',        'Total Sources', base.length,     '',      totalTitle) +
        card('ok',      'OK',            counts.ok,       'green', 'Show only sources reporting within their expected behavior') +
        card('alarm',   'Alarm',         counts.alarm,    'red',   'Show only sources currently past their alert threshold') +
        card('neutral', 'No Baseline',   counts.neutral,  'muted', 'Show only sources this engine cannot score yet');

    const engine      = (typeof getActiveEngine === 'function') ? getActiveEngine() : 'historical';
    const engineLabel = (typeof ENGINE_LABELS !== 'undefined' && ENGINE_LABELS[engine]) ? ENGINE_LABELS[engine] : engine;
    const domainCount = [...new Set(base.map(s => s.domain_group))].filter(Boolean).length;

    const subtitle = document.getElementById('dash-subtitle');
    if (subtitle) {
        let text = `${base.length} log sources across ${domainCount} domains · scored by ${engineLabel}`;
        if (dashStatusFilter) text += ` · showing ${DASH_STAT_LABELS[dashStatusFilter]} only, click the card again to clear`;
        subtitle.textContent = text;
    }
}

function applyDashFilters() {
    let sources = getDashBaseSources();
    if (dashStatusFilter) sources = sources.filter(s => getEffectiveSeverity(s) === dashStatusFilter);

    sources = sortSources(sources, dashSort.col);
    renderDashTable(sources);
    renderDashStats();
}

function syncDashTheadVisibility() {
    document.querySelectorAll('#page-dashboard thead th[data-col]').forEach(th => {
        th.style.display = visibleCols.includes(th.dataset.col) ? '' : 'none';
    });
    // History th has no data-col — always visible
}

function renderDashTable(sources) {
    const tbody = document.getElementById('dash-table-body');
    if (!tbody) return;

    syncDashTheadVisibility();

    if (!sources.length) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:32px;color:var(--neutral-slate-500)">${dashStatusFilter ? `No log sources are in the ${DASH_STAT_LABELS[dashStatusFilter]} state with the current filters` : 'No log sources match the current filters'}</td></tr>`;
        return;
    }

    const html = sources.map(s => {
        const sev    = getEffectiveSeverity(s);
        const bClass = getEffectiveBucketClass(s);
        const label  = getLabel(s.id);

        const cells = {
            name:       `<td data-col="name" style="font-weight:500;display:${visibleCols.includes('name')?'':'none'}">
                            ${escHtml(s.name)}${label?`<div style="font-size:10px;color:var(--dark-accent)">${escHtml(label)}</div>`:''}
                         </td>`,
            type:       `<td data-col="type" class="text-muted fs-12" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:${visibleCols.includes('type')?'':'none'}">${escHtml(s.log_source_type||'')}</td>`,
            domain:     `<td data-col="domain" style="display:${visibleCols.includes('domain')?'':'none'}">${s.domain_group&&s.domain_group!=='N/A'?`<span class="badge badge-info">${escHtml(s.domain_group)}</span>`:'<span class="text-muted">—</span>'}</td>`,
            collector:  `<td data-col="collector" class="text-muted fs-12" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;display:${visibleCols.includes('collector')?'':'none'}">${escHtml(s._collector||'')}</td>`,
            threshold:  `<td data-col="threshold" style="display:${visibleCols.includes('threshold')?'':'none'}"><span class="badge ${sev==='alarm'?'badge-error':'badge-neutral'}">${escHtml(s.behavior_threshold||'undefined')}</span></td>`,
            last_event: `<td data-col="last_event" class="fs-12 text-muted" style="display:${visibleCols.includes('last_event')?'':'none'}">${escHtml(s.last_event_time||'—')}</td>`,
            bucket:     `<td data-col="bucket" style="display:${visibleCols.includes('bucket')?'':'none'}"><span class="bucket-pill ${bClass}">${escHtml(s.current_bucket||'—')}</span></td>`,
            eps:        `<td data-col="eps" class="fs-12" style="display:${visibleCols.includes('eps')?'':'none'}">${s.average_eps!=null?s.average_eps:'—'}</td>`,
            protocol:   `<td data-col="protocol" class="text-muted fs-12" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:${visibleCols.includes('protocol')?'':'none'}">${escHtml(s.protocol_type||'—')}</td>`,
            identifier: `<td data-col="identifier" class="fs-12" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;color:var(--dark-accent);display:${visibleCols.includes('identifier')?'':'none'}">${escHtml(s.identifier||'—')}</td>`,
            history:    `<td><div class="bucket-bar-cell">${renderBucketBar(s.buckets)}</div></td>`,
            status:     `<td data-col="status" style="display:${visibleCols.includes('status')?'':'none'}">${sev==='ok'?`<button class="status-btn ok" onclick="event.stopPropagation();navigate('/logsource/${s.id}')"><span class="status-dot"></span>OK</button>`:sev==='alarm'?`<button class="status-btn breach" onclick="event.stopPropagation();navigate('/logsource/${s.id}')"><span class="status-dot"></span>Alarm</button>`:`<button class="status-btn undefined" onclick="event.stopPropagation();navigate('/logsource/${s.id}')"><span class="status-dot"></span>No baseline</button>`}</td>`,
        };

        return `<tr style="cursor:pointer" onclick="navigate('/logsource/${s.id}')">
            ${cells.name}${cells.type}${cells.domain}${cells.collector}${cells.threshold}${cells.last_event}${cells.bucket}${cells.eps}${cells.protocol}${cells.identifier}${cells.history}${cells.status}
        </tr>`;
    }).join('');
    requestAnimationFrame(() => { tbody.innerHTML = html; });
}

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

function getBucketColor(k) {
    return getBucketColorFor(k);
}

function renderBucketBar(buckets) {
    if (!buckets) return '';
    const present = activeBuckets(buckets);
    if (!present.length) return '';
    const maxVal = Math.max(...present.map(k => buckets[k] || 0), 1);
    return present.map(k => {
        const val = buckets[k] || 0;
        const h   = Math.max(3, Math.round((val / maxVal) * 22));
        return `<div class="bucket-bar-segment" style="height:${h}px;background:${getBucketColorFor(k)}" title="${k}: ${val}"></div>`;
    }).join('');
}