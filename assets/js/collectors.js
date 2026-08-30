function renderCollectors(selectedCollector) {
    const container = document.getElementById('collectors-content');
    if (!container) return;

    if (typeof mountEpsSection === 'function') mountEpsSection();

    const allColls = [...new Set(state.allSources.map(s=>s._collector).filter(c=>c&&c!=='Unknown'))].sort();
    const subtitle = document.getElementById('collectors-subtitle');
    if (subtitle) subtitle.textContent = `${allColls.length} collectors`;

    if (selectedCollector) { renderCollectorDrill(selectedCollector, container); return; }

    container.innerHTML = `<div class="overview-grid">${allColls.map(c => {
        const srcs    = state.allSources.filter(s => s._collector === c);
        const alarm   = srcs.filter(s => getEffectiveSeverity(s) === 'alarm').length;
        const ok      = srcs.filter(s => getEffectiveSeverity(s) === 'ok').length;
        const domains = [...new Set(srcs.map(s => s.domain_group).filter(Boolean))];
        const parts   = c.split(' :: ');
        const collId  = parts[0] || c;
        const collName = parts[1] || c;
        const borderColor = alarm ? 'var(--dark-primary)' : 'var(--dark-border)';
        const aggBuckets = {};
        srcs.forEach(s => {
            if (!s.buckets) return;
            BUCKET_ORDER.forEach(k => { aggBuckets[k] = (aggBuckets[k] || 0) + (s.buckets[k] || 0); });
        });
        const aggTotal = BUCKET_ORDER.reduce((sum, k) => sum + (aggBuckets[k] || 0), 0);
        return `<div class="domain-card" onclick="navigate('/collectors/${encodeURIComponent(c)}')" style="border-color:${borderColor}">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
                <div>
                    <div style="font-size:13px;font-weight:700;color:var(--dark-text);line-height:1.3">${escHtml(collName)}</div>
                    <div style="font-size:10px;color:var(--neutral-slate-600);margin-top:2px">${escHtml(collId)}</div>
                </div>
                ${alarm ? `<span style="background:var(--dark-primary);color:var(--on-primary);font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0">${alarm} alarm${alarm>1?'s':''}</span>` : ''}
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">
                ${domains.map(d => `<span class="badge badge-info" style="font-size:10px">${escHtml(d)}</span>`).join('')}
            </div>
            <div style="display:flex;gap:12px;margin-bottom:10px">
                <div style="text-align:center">
                    <div style="font-size:17px;font-weight:700;color:var(--dark-text)">${srcs.length}</div>
                    <div style="font-size:10px;color:var(--neutral-slate-500);margin-top:1px">sources</div>
                </div>
                ${alarm ? `<div style="text-align:center">
                    <div style="font-size:17px;font-weight:700;color:var(--dark-primary)">${alarm}</div>
                    <div style="font-size:10px;color:var(--neutral-slate-500);margin-top:1px">alarm</div>
                </div>` : ''}
                <div style="text-align:center">
                    <div style="font-size:17px;font-weight:700;color:var(--success-primary)">${ok}</div>
                    <div style="font-size:10px;color:var(--neutral-slate-500);margin-top:1px">ok</div>
                </div>
            </div>
            ${aggTotal > 0 ? `<div style="margin-bottom:10px">
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
        </div>`;
    }).join('')}</div>`;
}

function renderCollectorDrill(collector, container) {
    const sources = state.allSources.filter(s=>s._collector===collector);
    const tbodyId = 'coll-drill-tbody';
    const ids = { searchId:'cd-search', domainId:'cd-domain', threshId:'cd-thresh', bucketId:'cd-bucket', pickerId:'cd-col-picker' };

    container.innerHTML = `
        <div style="margin-bottom:12px">
            <button class="btn btn-ghost btn-sm" onclick="navigate('/collectors')">&larr; All Collectors</button>
        </div>
        <div style="font-size:16px;font-weight:700;color:var(--dark-text);margin-bottom:12px">
            ${escHtml(collector)}
            <span style="font-size:12px;color:var(--neutral-slate-500);font-weight:400;margin-left:8px">${sources.length} sources</span>
        </div>
        ${buildDrillFilterBar(sources, ids, false)}
        <div class="table-wrapper">
            <table>${buildTheadHTML(false)}<tbody id="${tbodyId}"></tbody></table>
        </div>`;

    const apply = () => renderSortedTable(tbodyId, applyTableFilters(sources, ids.searchId, ids.domainId, null, ids.threshId, ids.bucketId), false);
    [ids.searchId, ids.domainId, ids.threshId, ids.bucketId].forEach(id => {
        document.getElementById(id)?.addEventListener('change', apply);
        document.getElementById(id)?.addEventListener('input', apply);
    });

    renderSortedTable(tbodyId, sources, false);
    makeTableSortable(tbodyId, () => applyTableFilters(sources, ids.searchId, ids.domainId, null, ids.threshId, ids.bucketId), false);
}