// ── Shared column config ──────────────────────────────────────────────
const DEFAULT_COLS = ['name','type','collector','threshold','last_event','bucket','eps','history','status'];
let visibleCols = JSON.parse(localStorage.getItem('qklog_cols') || 'null') || [...DEFAULT_COLS];

const COL_DEFS = [
    { key:'name',       label:'Name' },
    { key:'type',       label:'Type' },
    { key:'domain',     label:'Domain' },
    { key:'collector',  label:'Collector' },
    { key:'threshold',  label:'QRadar Behavior Threshold' },
    { key:'last_event', label:'Last Event' },
    { key:'bucket',     label:'Bucket' },
    { key:'eps',        label:'EPS' },
    { key:'protocol',   label:'Protocol Type' },
    { key:'identifier', label:'Identifier' },
    { key:'history',    label:'History' },
    { key:'status',     label:'Status' },
];

function saveColPrefs() { localStorage.setItem('qklog_cols', JSON.stringify(visibleCols)); }

function toggleColPicker(wrapperId) {
    const existing = document.getElementById('col-picker-dropdown');
    if (existing) { existing.remove(); return; }
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;

    const hash = getHash();
    const isDomainDrill    = hash.startsWith('/domains/');
    const isCollectorDrill = hash.startsWith('/collectors/');

    const filteredDefs = COL_DEFS.filter(c => {
        if (c.key === 'collector' && isDomainDrill)    return false;
        if (c.key === 'domain'    && isCollectorDrill) return false;
        return true;
    });

    const dropdown = document.createElement('div');
    dropdown.id = 'col-picker-dropdown';
    dropdown.style.cssText = `position:absolute;right:0;top:calc(100% + 4px);background:var(--dark-bg-secondary);border:1px solid var(--dark-border);border-radius:8px;padding:12px;z-index:999;min-width:180px;box-shadow:0 8px 24px var(--dropdown-shadow);`;
    dropdown.innerHTML = `
        <div style="font-size:11px;font-weight:600;color:var(--neutral-slate-500);letter-spacing:.05em;margin-bottom:8px">SHOW COLUMNS</div>
        ${filteredDefs.map(c => `
            <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:12px;color:var(--dark-text)">
                <input type="checkbox" data-col="${c.key}" ${visibleCols.includes(c.key)?'checked':''}
                    style="accent-color:var(--dark-primary);width:13px;height:13px">
                ${c.label}
            </label>`).join('')}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--dark-border)">
            <button onclick="resetCols()" style="font-size:11px;cursor:pointer;background:transparent;border:1px solid var(--dark-border);color:var(--neutral-slate-400);padding:2px 8px;border-radius:4px">Reset</button>
        </div>`;
    dropdown.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            const col = cb.dataset.col;
            if (cb.checked) { if (!visibleCols.includes(col)) visibleCols.push(col); }
            else { visibleCols = visibleCols.filter(c => c !== col); }
            saveColPrefs();
            rerenderCurrentTable();
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

function resetCols() {
    visibleCols = [...DEFAULT_COLS];
    saveColPrefs();
    document.getElementById('col-picker-dropdown')?.remove();
    rerenderCurrentTable();
}

function rerenderCurrentTable() {
    const hash = getHash();
    if (hash.startsWith('/domains'))    renderDomains(hash.split('/')[2] ? decodeURIComponent(hash.split('/')[2]) : '');
    else if (hash.startsWith('/collectors')) renderCollectors(hash.split('/')[2] ? decodeURIComponent(hash.split('/')[2]) : '');
    else if (typeof applyDashFilters === 'function') applyDashFilters();
}

// ── Shared table ──────────────────────────────────────────────────────
function buildRow(s, showDomain) {
    const sev    = getEffectiveSeverity(s);
    const bClass = getEffectiveBucketClass(s);
    const cols   = COL_DEFS.filter(c => {
        if (c.key === 'domain'    && !showDomain) return false;
        if (c.key === 'collector' &&  showDomain) return false;
        return visibleCols.includes(c.key);
    });
    return `<tr style="cursor:pointer" onclick="navigate('/logsource/${s.id}')">` +
        cols.map(c => {
            switch(c.key) {
                case 'name':       return `<td style="font-weight:500">${escHtml(s.name)}</td>`;
                case 'type':       return `<td class="text-muted fs-12" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.log_source_type||'')}</td>`;
                case 'domain':     return `<td>${s.domain_group&&s.domain_group!=='N/A'?`<span class="badge badge-info">${escHtml(s.domain_group)}</span>`:'<span class="text-muted">—</span>'}</td>`;
                case 'collector':  return `<td class="text-muted fs-12" style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${escHtml(s._collector||'')}</td>`;
                case 'threshold':  return `<td><span class="badge ${sev==='alarm'?'badge-error':'badge-neutral'}">${escHtml(s.behavior_threshold||'undefined')}</span></td>`;
                case 'last_event': return `<td class="fs-12 text-muted">${escHtml(s.last_event_time||'—')}</td>`;
                case 'bucket':     return `<td><span class="bucket-pill ${bClass}">${escHtml(s.current_bucket||'—')}</span></td>`;
                case 'eps':        return `<td class="fs-12">${s.average_eps!=null?s.average_eps:'—'}</td>`;
                case 'protocol':   return `<td class="text-muted fs-12" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.protocol_type||'—')}</td>`;
                case 'identifier': return `<td class="fs-12" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;color:var(--dark-accent)">${escHtml(s.identifier||'—')}</td>`;
                case 'history':    return `<td><div class="bucket-bar-cell">${typeof renderBucketBar==='function'?renderBucketBar(s.buckets):''}</div></td>`;
                case 'status':     return `<td>${sev==='alarm'?`<button class="status-btn breach"><span class="status-dot"></span>Alarm</button>`:sev==='ok'?`<button class="status-btn ok"><span class="status-dot"></span>OK</button>`:`<button class="status-btn undefined"><span class="status-dot"></span>No baseline</button>`}</td>`;
                default:           return '<td>—</td>';
            }
        }).join('') + '</tr>';
}

function buildTheadHTML(showDomain) {
    const cols = COL_DEFS.filter(c => {
        if (c.key === 'domain'    && !showDomain) return false;
        if (c.key === 'collector' &&  showDomain) return false;
        return visibleCols.includes(c.key);
    });
    return `<thead><tr>${cols.map(c=>`<th data-col="${c.key}">${c.label}</th>`).join('')}</tr></thead>`;
}

function renderSortedTable(tbodyId, sources, showDomain) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = sources.length
        ? sources.map(s => buildRow(s, showDomain)).join('')
        : `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--neutral-slate-500)">No sources match filters</td></tr>`;
}

function applyTableFilters(sources, searchId, domainId, collId, threshId, bucketId) {
    const s = (document.getElementById(searchId)?.value||'').toLowerCase();
    const d = domainId ? document.getElementById(domainId)?.value||'' : '';
    const c = collId   ? document.getElementById(collId)?.value||''   : '';
    const t = document.getElementById(threshId)?.value||'';
    const b = document.getElementById(bucketId)?.value||'';
    let f = [...sources];
    if (s) f = f.filter(x => x.name.toLowerCase().includes(s));
    if (d) f = f.filter(x => x.domain_group===d);
    if (c) f = f.filter(x => x._collector===c);
    if (t) f = f.filter(x => x.behavior_threshold===t);
    if (b) f = f.filter(x => x.current_bucket===b);
    return f;
}

function makeTableSortable(tbodyId, getRows, showDomain) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const thead = tbody.closest('table')?.querySelector('thead tr');
    if (!thead) return;
    const st = { col:null, dir:1 };
    thead.querySelectorAll('th[data-col]').forEach(th => {
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (st.col===col) st.dir*=-1; else { st.col=col; st.dir=1; }
            thead.querySelectorAll('th[data-col]').forEach(t => t.querySelector('.sort-arrow')?.remove());
            const arrow = document.createElement('span');
            arrow.className='sort-arrow'; arrow.style.cssText='margin-left:4px;font-size:10px;opacity:0.7';
            arrow.textContent = st.dir===1?'▲':'▼'; th.appendChild(arrow);
            const rows = getRows();
            const sorted = [...rows].sort((a,b) => {
                if (col==='name')       return (a.name||'').localeCompare(b.name||'')*st.dir;
                if (col==='type')       return (a.log_source_type||'').localeCompare(b.log_source_type||'')*st.dir;
                if (col==='domain')     return (a.domain_group||'').localeCompare(b.domain_group||'')*st.dir;
                if (col==='collector')  return (a._collector||'').localeCompare(b._collector||'')*st.dir;
                if (col==='threshold')  return (a.behavior_threshold||'').localeCompare(b.behavior_threshold||'')*st.dir;
                if (col==='last_event') return (a.last_event_time||'').localeCompare(b.last_event_time||'')*st.dir;
                if (col==='bucket')     return (BUCKET_ORDER.indexOf(a.current_bucket)-BUCKET_ORDER.indexOf(b.current_bucket))*st.dir;
                if (col==='eps')        return ((a.average_eps??-1)-(b.average_eps??-1))*st.dir;
                if (col==='protocol')   return (a.protocol_type||'').localeCompare(b.protocol_type||'')*st.dir;
                if (col==='identifier') return (a.identifier||'').localeCompare(b.identifier||'')*st.dir;
                if (col==='history')    return ((typeof totalBucketCount==='function'?totalBucketCount(a.buckets):0)-(typeof totalBucketCount==='function'?totalBucketCount(b.buckets):0))*st.dir;
                return 0;
            });
            renderSortedTable(tbodyId, sorted, showDomain);
        });
    });
}

function buildDrillFilterBar(sources, ids, showDomain) {
    const { searchId, domainId, collId, threshId, bucketId, pickerId } = ids;
    const collectors = [...new Set(sources.map(s=>s._collector).filter(Boolean))].sort();
    const domains    = [...new Set(sources.map(s=>s.domain_group).filter(Boolean))].sort();
    const thresholds = sortThresholds([...new Set(sources.map(s=>s.behavior_threshold).filter(t=>t&&t!=='undefined'))]);

    return `<div class="filter-bar" style="flex-wrap:wrap;margin-bottom:12px">
        <div class="filter-input-wrap">
            <span class="search-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
            <input type="text" class="filter-input" id="${searchId}" placeholder="Search log sources...">
        </div>
        ${domainId ? `<select class="filter-select" id="${domainId}"><option value="">All domains</option>${domains.map(d=>`<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('')}</select>` : ''}
        ${collId   ? `<select class="filter-select" id="${collId}"><option value="">All collectors</option>${collectors.map(c=>`<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}</select>` : ''}
        <select class="filter-select" id="${threshId}">
            <option value="">All QRadar thresholds</option>
            ${thresholds.map(t=>`<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('')}
        </select>
        <select class="filter-select" id="${bucketId}">
            <option value="">All buckets</option>
            ${BUCKET_ORDER.map(b=>`<option value="${b}">${b}</option>`).join('')}
        </select>
        <div id="${pickerId}" style="position:relative">
            <button class="btn btn-ghost btn-sm" onclick="toggleColPicker('${pickerId}')" style="display:flex;align-items:center;gap:5px">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                Columns
            </button>
        </div>
    </div>`;
}

// ── Domains overview ──────────────────────────────────────────────────
function renderDomains(selectedDomain) {
    const container = document.getElementById('domains-content');
    if (!container) return;

    const allDomains = [...new Set(state.allSources.map(s=>s.domain_group).filter(d=>d&&d!=='N/A'))].sort();
    const subtitle   = document.getElementById('domains-subtitle');
    if (subtitle) subtitle.textContent = `${allDomains.length} domains`;

    if (selectedDomain) { renderDomainDrill(selectedDomain, container); return; }

    container.innerHTML = `<div class="overview-grid">${allDomains.map(d => {
        const srcs  = state.allSources.filter(s => s.domain_group === d);
        const alarm = srcs.filter(s => getEffectiveSeverity(s) === 'alarm').length;
        const ok    = srcs.filter(s => getEffectiveSeverity(s) === 'ok').length;
        const borderColor = alarm ? 'var(--dark-primary)' : 'var(--dark-border)';
        const aggBuckets = {};
        srcs.forEach(s => {
            if (!s.buckets) return;
            BUCKET_ORDER.forEach(k => { aggBuckets[k] = (aggBuckets[k] || 0) + (s.buckets[k] || 0); });
        });
        const aggTotal = BUCKET_ORDER.reduce((sum, k) => sum + (aggBuckets[k] || 0), 0);
        return `<div class="domain-card" onclick="navigate('/domains/${encodeURIComponent(d)}')" style="border-color:${borderColor}">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px">
                <div style="font-size:15px;font-weight:700;color:var(--dark-text);line-height:1.3">${escHtml(d)}</div>
                ${alarm ? `<span style="background:var(--dark-primary);color:var(--on-primary);font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0">${alarm} alarm${alarm>1?'s':''}</span>` : ''}
            </div>
            <div style="display:flex;gap:12px;margin-bottom:12px">
                <div style="text-align:center">
                    <div style="font-size:18px;font-weight:700;color:var(--dark-text)">${srcs.length}</div>
                    <div style="font-size:10px;color:var(--neutral-slate-500);margin-top:1px">sources</div>
                </div>
                ${alarm ? `<div style="text-align:center">
                    <div style="font-size:18px;font-weight:700;color:var(--dark-primary)">${alarm}</div>
                    <div style="font-size:10px;color:var(--neutral-slate-500);margin-top:1px">alarm</div>
                </div>` : ''}
                <div style="text-align:center">
                    <div style="font-size:18px;font-weight:700;color:var(--success-primary)">${ok}</div>
                    <div style="font-size:10px;color:var(--neutral-slate-500);margin-top:1px">ok</div>
                </div>
            </div>
            ${aggTotal > 0 ? `<div style="margin-bottom:12px">
                <div style="font-size:10px;color:var(--neutral-slate-500);margin-bottom:4px">History (${aggTotal} gaps)</div>
                <div class="bucket-bar-cell">${typeof renderBucketBar==='function'?renderBucketBar(aggBuckets):''}</div>
            </div>` : ''}
            <div style="height:4px;border-radius:2px;background:var(--dark-border);overflow:hidden">
                ${srcs.length > 0 ? `
                <div style="display:flex;height:100%;border-radius:2px;overflow:hidden">
                    ${alarm ? `<div style="flex:${alarm};background:var(--dark-primary)"></div>` : ''}
                    ${ok > 0 ? `<div style="flex:${ok};background:var(--success-primary);opacity:0.4"></div>` : ''}
                </div>` : ''}
            </div>
            <div class="domain-card-actions" onclick="event.stopPropagation()">
                <button class="btn btn-secondary btn-sm domain-map-view"
                    onclick="openMapModal('${escHtml(d).replace(/'/g, "\\'")}')">View map</button>
            </div>
        </div>`;
    }).join('')}</div>`;
}

function renderDomainDrill(domain, container) {
    const sources = state.allSources.filter(s=>s.domain_group===domain);
    const tbodyId = 'domain-drill-tbody';
    const ids = { searchId:'dd-search', collId:'dd-coll', threshId:'dd-thresh', bucketId:'dd-bucket', pickerId:'dd-col-picker' };

    container.innerHTML = `
        <div style="margin-bottom:12px">
            <button class="btn btn-ghost btn-sm" onclick="navigate('/domains')">&larr; All Domains</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap">
            <div style="font-size:16px;font-weight:700;color:var(--dark-text)">
                ${escHtml(domain)}
                <span style="font-size:12px;color:var(--neutral-slate-500);font-weight:400;margin-left:8px">${sources.length} sources</span>
            </div>
            <div style="display:flex;gap:6px">
                <button class="btn btn-secondary btn-sm"
                    onclick="openMapModal('${escHtml(domain).replace(/'/g, "\\'")}')">View map</button>
            </div>
        </div>
        ${buildDrillFilterBar(sources, ids, true)}
        <div class="table-wrapper">
            <table>${buildTheadHTML(true)}<tbody id="${tbodyId}"></tbody></table>
        </div>`;

    const apply = () => renderSortedTable(tbodyId, applyTableFilters(sources, ids.searchId, null, ids.collId, ids.threshId, ids.bucketId), true);
    [ids.searchId, ids.collId, ids.threshId, ids.bucketId].forEach(id => {
        document.getElementById(id)?.addEventListener('change', apply);
        document.getElementById(id)?.addEventListener('input', apply);
    });

    renderSortedTable(tbodyId, sources, true);
    makeTableSortable(tbodyId, () => applyTableFilters(sources, ids.searchId, null, ids.collId, ids.threshId, ids.bucketId), true);
}