const MAP_LAYOUT = {
    colGap:      110,
    rowGap:      14,
    leafGap:     6,
    domainW:     190,
    domainH:     64,
    procW:       230,
    procH:       58,
    typeW:       268,
    typeHeadH:   34,
    leafH:       26,
    typePadY:    8,
    typeGap:     20,
    padX:        36,
    padY:        36,
};

const _mapState = {
    domain:    null,
    tree:      null,
    collapsed: {},
};

function mapSourceStatus(s) {
    const sev = getEffectiveSeverity(s);
    if (sev === 'alarm')   return { key: 'alarm',   color: 'var(--dark-primary)' };
    if (sev === 'ok')      return { key: 'ok',      color: 'var(--success-primary)' };
    return { key: 'neutral', color: 'var(--neutral-slate-600)' };
}

function buildDomainTree(domain) {
    const sources = state.allSources.filter(s => s.domain_group === domain);

    const procMap = new Map();
    sources.forEach(s => {
        const coll = s._collector || 'Unknown';
        if (!procMap.has(coll)) procMap.set(coll, new Map());
        const typeMap = procMap.get(coll);
        const type = (s.log_source_type && String(s.log_source_type).trim()) || 'Unknown Type';
        if (!typeMap.has(type)) typeMap.set(type, []);
        typeMap.get(type).push(s);
    });

    const processors = [...procMap.keys()].sort().map(coll => {
        const parts = coll.split(' :: ');
        const typeMap = procMap.get(coll);
        const types = [...typeMap.keys()].sort().map(type => {
            const list = typeMap.get(type).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            return {
                type,
                sources: list.map(s => ({
                    id:         s.id,
                    name:       s.name,
                    status:     mapSourceStatus(s).key,
                    bucket:     s.current_bucket || null,
                    last_event: s.last_event_time || null,
                    eps:        s.average_eps != null ? s.average_eps : null,
                    protocol:   s.protocol_type || null,
                    identifier: s.identifier || null,
                    threshold:  s.behavior_threshold || null,
                })),
            };
        });
        const all = types.flatMap(t => t.sources);
        return {
            key:      coll,
            id:       parts[0] || coll,
            name:     parts[1] || coll,
            types,
            total:    all.length,
            alarm:    all.filter(x => x.status === 'alarm').length,
        };
    });

    const all = processors.flatMap(p => p.types.flatMap(t => t.sources));
    return {
        domain,
        generated_at:  new Date().toISOString(),
        total_sources: all.length,
        total_alarm:   all.filter(x => x.status === 'alarm').length,
        type_count:    new Set(processors.flatMap(p => p.types.map(t => t.type))).size,
        processors,
    };
}

function layoutDomainTree(tree) {
    const L = MAP_LAYOUT;
    const collapsed = _mapState.collapsed;

    const typeBlockH = t => {
        const isC = collapsed[t.type] === true;
        if (isC) return L.typeHeadH;
        return L.typeHeadH + L.typePadY + t.sources.length * (L.leafH + L.leafGap) - L.leafGap + L.typePadY;
    };

    const procs = tree.processors.map(p => {
        const types = p.types.map(t => ({ ...t, _h: typeBlockH(t) }));
        const stackH = types.reduce((s, t) => s + t._h, 0) + Math.max(0, types.length - 1) * L.typeGap;
        return { ...p, types, _h: Math.max(L.procH, stackH) };
    });

    const totalH = procs.reduce((s, p) => s + p._h, 0) + Math.max(0, procs.length - 1) * L.rowGap * 2;

    const x0 = L.padX;
    const x1 = x0 + L.domainW + L.colGap;
    const x2 = x1 + L.procW + L.colGap;

    const nodes = { domain: null, procs: [], types: [], leaves: [] };
    const edges = [];

    let y = L.padY;
    procs.forEach(p => {
        const procY = y + p._h / 2 - L.procH / 2;
        nodes.procs.push({ ...p, x: x1, y: procY, w: L.procW, h: L.procH });

        let ty = y;
        p.types.forEach(t => {
            const node = { ...t, x: x2, y: ty, w: L.typeW, h: t._h, proc: p.key };
            nodes.types.push(node);

            edges.push({
                x1: x1 + L.procW, y1: procY + L.procH / 2,
                x2: x2,           y2: ty + L.typeHeadH / 2,
                kind: 'proc-type',
            });

            if (collapsed[t.type] !== true) {
                let ly = ty + L.typeHeadH + L.typePadY;
                t.sources.forEach(s => {
                    nodes.leaves.push({ ...s, x: x2 + 10, y: ly, w: L.typeW - 20, h: L.leafH, type: t.type });
                    ly += L.leafH + L.leafGap;
                });
            }
            ty += t._h + L.typeGap;
        });
        y += p._h + L.rowGap * 2;
    });

    const contentH = Math.max(totalH, L.domainH);
    const domainY  = L.padY + contentH / 2 - L.domainH / 2;
    nodes.domain = { x: x0, y: domainY, w: L.domainW, h: L.domainH, ...tree };

    nodes.procs.forEach(p => {
        edges.push({
            x1: x0 + L.domainW, y1: domainY + L.domainH / 2,
            x2: x1,             y2: p.y + L.procH / 2,
            kind: 'domain-proc',
        });
    });

    const width  = x2 + L.typeW + L.padX;
    const height = L.padY * 2 + contentH;
    return { nodes, edges, width, height };
}

function elbowPath(e) {
    const mx = e.x1 + (e.x2 - e.x1) / 2;
    const r  = Math.min(12, Math.abs(e.y2 - e.y1) / 2, Math.abs(mx - e.x1));
    if (Math.abs(e.y2 - e.y1) < 1) return `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`;
    const dir = e.y2 > e.y1 ? 1 : -1;
    return [
        `M ${e.x1} ${e.y1}`,
        `L ${mx - r} ${e.y1}`,
        `Q ${mx} ${e.y1} ${mx} ${e.y1 + r * dir}`,
        `L ${mx} ${e.y2 - r * dir}`,
        `Q ${mx} ${e.y2} ${mx + r} ${e.y2}`,
        `L ${e.x2} ${e.y2}`,
    ].join(' ');
}

function typeHue(type) {
    let h = 0;
    for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) % 360;
    return h;
}

function renderMapSvg(tree) {
    const { nodes, edges, width, height } = layoutDomainTree(tree);
    const L = MAP_LAYOUT;

    const edgeSvg = edges.map(e =>
        `<path d="${elbowPath(e)}" class="map-edge ${e.kind}" />`
    ).join('');

    const d = nodes.domain;
    const domainSvg = `
        <g class="map-node map-domain">
            <rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="12" />
            <text x="${d.x + d.w / 2}" y="${d.y + 25}" class="map-domain-label">${escHtml(d.domain)}</text>
            <text x="${d.x + d.w / 2}" y="${d.y + 45}" class="map-domain-sub">${d.total_sources} sources \u00b7 ${d.processors.length} proc</text>
        </g>`;

    const procSvg = nodes.procs.map(p => `
        <g class="map-node map-proc" data-tip="${escHtml(JSON.stringify({ k: 'proc', name: p.name, id: p.id, total: p.total, alarm: p.alarm, types: p.types.length }))}">
            <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="10" />
            <rect x="${p.x}" y="${p.y}" width="4" height="${p.h}" rx="2" class="map-proc-accent ${p.alarm ? 'has-alarm' : ''}" />
            <text x="${p.x + 16}" y="${p.y + 24}" class="map-proc-label">${escHtml(p.name)}</text>
            <text x="${p.x + 16}" y="${p.y + 42}" class="map-proc-sub">${escHtml(p.id)} \u00b7 ${p.total} src</text>
            ${p.alarm ? `<g class="map-proc-badge">
                <rect x="${p.x + p.w - 42}" y="${p.y + 10}" width="30" height="18" rx="9" />
                <text x="${p.x + p.w - 27}" y="${p.y + 23}" class="map-badge-text">${p.alarm}</text>
            </g>` : ''}
        </g>`).join('');

    const typeSvg = nodes.types.map(t => {
        const hue = typeHue(t.type);
        const isC = _mapState.collapsed[t.type] === true;
        const alarm = t.sources.filter(s => s.status === 'alarm').length;
        return `
        <g class="map-node map-type" data-type="${escHtml(t.type)}" style="--type-hue:${hue}">
            <rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="10" class="map-type-body" />
            <rect x="${t.x}" y="${t.y}" width="${t.w}" height="${L.typeHeadH}" rx="10" class="map-type-head" />
            <rect x="${t.x}" y="${t.y + L.typeHeadH - 10}" width="${t.w}" height="10" class="map-type-head-fill" />
            <g class="map-type-toggle" onclick="toggleMapType('${escHtml(t.type).replace(/'/g, "\\'")}')">
                <rect x="${t.x}" y="${t.y}" width="${t.w}" height="${L.typeHeadH}" rx="10" fill="transparent" />
                <text x="${t.x + 12}" y="${t.y + 22}" class="map-type-caret">${isC ? '\u25B8' : '\u25BE'}</text>
                <text x="${t.x + 28}" y="${t.y + 22}" class="map-type-label">${escHtml(t.type.length > 24 ? t.type.slice(0, 23) + '\u2026' : t.type)}</text>
                <title>${escHtml(t.type)}</title>
                <text x="${t.x + t.w - 12}" y="${t.y + 22}" class="map-type-count">${t.sources.length}${alarm ? ' \u00b7 ' + alarm : ''}</text>
            </g>
        </g>`;
    }).join('');

    const leafSvg = nodes.leaves.map(s => `
        <g class="map-node map-leaf ${s.status}" data-id="${s.id}"
           data-tip="${escHtml(JSON.stringify({ k: 'src', name: s.name, id: s.id, status: s.status, bucket: s.bucket, last_event: s.last_event, eps: s.eps, protocol: s.protocol, identifier: s.identifier, threshold: s.threshold, type: s.type }))}"
           onclick="closeMapModal();navigate('/logsource/${s.id}')">
            <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" />
            <circle cx="${s.x + 12}" cy="${s.y + s.h / 2}" r="3.5" class="map-leaf-dot" />
            <text x="${s.x + 24}" y="${s.y + s.h / 2 + 4}" class="map-leaf-label">${escHtml(s.name.length > 30 ? s.name.slice(0, 29) + '\u2026' : s.name)}</text>
        </g>`).join('');

    return `<svg id="domain-map-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
        xmlns="http://www.w3.org/2000/svg" role="img">
        <g class="map-edges">${edgeSvg}</g>
        ${domainSvg}${procSvg}${typeSvg}${leafSvg}
    </svg>`;
}

function toggleMapType(type) {
    _mapState.collapsed[type] = !_mapState.collapsed[type];
    paintMap();
}

function expandAllMapTypes(collapse) {
    if (!_mapState.tree) return;
    _mapState.collapsed = {};
    if (collapse) {
        _mapState.tree.processors.forEach(p => p.types.forEach(t => { _mapState.collapsed[t.type] = true; }));
    }
    paintMap();
}

function paintMap() {
    const host = document.getElementById('map-canvas');
    if (!host || !_mapState.tree) return;
    host.innerHTML = renderMapSvg(_mapState.tree);
    bindMapHover();
    const meta = document.getElementById('map-meta');
    if (meta) {
        const t = _mapState.tree;
        meta.innerHTML = `<span>${t.total_sources} sources</span>
            <span>${t.processors.length} processors</span>
            <span>${t.type_count} types</span>
            ${t.total_alarm ? `<span class="map-meta-alarm">${t.total_alarm} alarm</span>` : ''}`;
    }
}

function bindMapHover() {
    const tip = document.getElementById('map-tooltip');
    const wrap = document.getElementById('map-scroll');
    if (!tip || !wrap) return;

    wrap.querySelectorAll('[data-tip]').forEach(el => {
        el.addEventListener('mousemove', ev => {
            let d;
            try { d = JSON.parse(el.getAttribute('data-tip')); } catch { return; }
            tip.innerHTML = d.k === 'proc' ? tipProc(d) : tipSource(d);
            tip.classList.add('visible');
            const r = wrap.getBoundingClientRect();
            let x = ev.clientX - r.left + wrap.scrollLeft + 16;
            let y = ev.clientY - r.top + wrap.scrollTop + 16;
            const tw = tip.offsetWidth, th = tip.offsetHeight;
            if (x + tw > wrap.scrollLeft + r.width)  x = ev.clientX - r.left + wrap.scrollLeft - tw - 12;
            if (y + th > wrap.scrollTop + r.height)  y = ev.clientY - r.top + wrap.scrollTop - th - 12;
            tip.style.left = Math.max(4, x) + 'px';
            tip.style.top  = Math.max(4, y) + 'px';
        });
        el.addEventListener('mouseleave', () => tip.classList.remove('visible'));
    });
}

function tipRow(k, v) {
    if (v === null || v === undefined || v === '') return '';
    return `<div class="map-tip-row"><span>${escHtml(k)}</span><b>${escHtml(String(v))}</b></div>`;
}

function tipProc(d) {
    return `<div class="map-tip-head">${escHtml(d.name)}</div>
        <div class="map-tip-sub">${escHtml(d.id)}</div>
        ${tipRow('Sources', d.total)}
        ${tipRow('Types', d.types)}
        ${d.alarm ? `<div class="map-tip-row alarm"><span>Alarm</span><b>${d.alarm}</b></div>` : ''}`;
}

function tipSource(d) {
    const label = d.status === 'alarm' ? 'Alarm' : d.status === 'ok' ? 'OK' : 'No baseline';
    return `<div class="map-tip-head">${escHtml(d.name)}</div>
        <div class="map-tip-sub">${escHtml(d.type)}</div>
        <div class="map-tip-row ${d.status}"><span>Status</span><b>${label}</b></div>
        ${tipRow('Current bucket', d.bucket)}
        ${tipRow('Last event', d.last_event)}
        ${tipRow('QRadar threshold', d.threshold && d.threshold !== 'undefined' ? d.threshold : null)}
        ${tipRow('Avg EPS', d.eps)}
        ${tipRow('Protocol', d.protocol)}
        ${tipRow('Identifier', d.identifier)}
        <div class="map-tip-go">Click to open log source</div>`;
}

function renderDomainMap(domain) {
    _mapState.domain    = domain;
    _mapState.collapsed = {};
    _mapState.tree      = buildDomainTree(domain);
    paintMap();
}

const SVG_PAINT_PROPS = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
    'font-family', 'font-size', 'font-weight',
    'text-anchor', 'opacity',
];

const SVG_SKIP_VALUES = new Set(['', 'normal', 'auto', 'none 0px', 'medium', 'depends on user agent']);

function resolveCssValue(v, rootStyle, depth) {
    if (!v || depth > 8) return v;
    if (v.indexOf('var(') === -1) return v.trim();
    const out = v.replace(/var\(\s*(--[\w-]+)\s*(?:,([^)]*))?\)/g, (_, name, fallback) => {
        const got = rootStyle.getPropertyValue(name).trim();
        if (got) return got;
        return (fallback || '').trim();
    });
    return resolveCssValue(out, rootStyle, depth + 1).trim();
}

function inlineSvgStyles(liveEl, cloneEl, rootStyle) {
    const cs = getComputedStyle(liveEl);
    let decl = '';
    SVG_PAINT_PROPS.forEach(p => {
        let v = cs.getPropertyValue(p);
        if (!v) return;
        v = resolveCssValue(v.trim(), rootStyle, 0);
        if (!v || SVG_SKIP_VALUES.has(v)) return;
        if (v.indexOf('var(') !== -1) return;
        decl += `${p}:${v};`;
    });
    if (decl) cloneEl.setAttribute('style', decl);
    cloneEl.removeAttribute('class');

    const liveKids  = liveEl.children;
    const cloneKids = cloneEl.children;
    for (let i = 0; i < liveKids.length && i < cloneKids.length; i++) {
        inlineSvgStyles(liveKids[i], cloneKids[i], rootStyle);
    }
}

function downloadMapSvg() {
    const svg = document.getElementById('domain-map-svg');
    if (!svg || !_mapState.domain) return;

    const rootStyle = getComputedStyle(document.documentElement);
    const clone = svg.cloneNode(true);
    inlineSvgStyles(svg, clone, rootStyle);

    const bg = rootStyle.getPropertyValue('--dark-bg-primary').trim() || '#0a0118';
    const w  = svg.getAttribute('width');
    const h  = svg.getAttribute('height');

    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    clone.removeAttribute('style');
    clone.removeAttribute('data-zoom');

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);

    clone.querySelectorAll('[onclick]').forEach(el => el.removeAttribute('onclick'));
    clone.querySelectorAll('[data-tip]').forEach(el => el.removeAttribute('data-tip'));
    clone.querySelectorAll('[data-type]').forEach(el => el.removeAttribute('data-type'));

    const xml  = new XMLSerializer().serializeToString(clone);
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + xml], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = _mapState.domain.replace(/[\\/:*?"<>|]/g, '_') + '-map.svg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function csvCell(value) {
    const s = value == null ? '' : String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadMapCsv() {
    const domain = _mapState.domain;
    if (!domain) return;

    const rows = state.allSources
        .filter(s => s.domain_group === domain)
        .slice()
        .sort((a, b) =>
            (a._collector || '').localeCompare(b._collector || '') ||
            (a.name || '').localeCompare(b.name || ''));

    const header = ['Log source ID', 'Log source', 'Name', 'Log Source Type', 'Domain Name', 'Processor'];

    const lines = [header.map(csvCell).join(',')];
    rows.forEach(s => {
        lines.push([
            s.id,
            s.identifier || '',
            s.name || '',
            s.log_source_type || '',
            s.domain_group || '',
            s._collector || ''
        ].map(csvCell).join(','));
    });

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = domain.replace(/[\\/:*?"<>|]/g, '_').trim() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function mapZoom(dir) {
    const svg = document.getElementById('domain-map-svg');
    if (!svg) return;
    const cur = parseFloat(svg.dataset.zoom || '1');
    const next = dir === 0 ? 1 : Math.min(2, Math.max(0.4, cur + dir * 0.15));
    svg.dataset.zoom = next;
    svg.style.width  = (parseFloat(svg.getAttribute('width')) * next) + 'px';
    svg.style.height = (parseFloat(svg.getAttribute('height')) * next) + 'px';
}

function openMapModal(domain) {
    closeMapModal();

    const overlay = document.createElement('div');
    overlay.id = 'map-modal-overlay';
    overlay.className = 'map-modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeMapModal(); });

    overlay.innerHTML = `
        <div class="map-modal">
            <div class="map-modal-header">
                <div>
                    <div class="map-modal-title">${escHtml(domain)}</div>
                    <div class="map-modal-meta" id="map-meta"></div>
                </div>
                <div class="map-modal-actions">
                    <button class="btn btn-ghost btn-sm" onclick="expandAllMapTypes(true)">Collapse all</button>
                    <button class="btn btn-ghost btn-sm" onclick="expandAllMapTypes(false)">Expand all</button>
                    <div class="map-zoom">
                        <button onclick="mapZoom(-1)" title="Zoom out">&minus;</button>
                        <button onclick="mapZoom(0)" title="Reset zoom">1:1</button>
                        <button onclick="mapZoom(1)" title="Zoom in">+</button>
                    </div>
                    <button class="btn btn-ghost btn-sm" onclick="downloadMapSvg()">Export SVG</button>
                    <button class="btn btn-ghost btn-sm" onclick="downloadMapCsv()">Export CSV</button>
                    <button class="map-modal-close" onclick="closeMapModal()">&#x2715;</button>
                </div>
            </div>
            <div class="map-scroll map-modal-scroll" id="map-scroll">
                <div id="map-canvas"></div>
                <div class="map-tooltip" id="map-tooltip"></div>
            </div>
            <div class="map-legend">
                <span><i class="map-dot ok"></i>OK</span>
                <span><i class="map-dot alarm"></i>Alarm</span>
                <span><i class="map-dot neutral"></i>No baseline</span>
                <span class="map-legend-hint">Click a log source to open it</span>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    document.addEventListener('keydown', _mapEscHandler);
    renderDomainMap(domain);
}

function _mapEscHandler(e) {
    if (e.key === 'Escape') closeMapModal();
}

function closeMapModal() {
    const el = document.getElementById('map-modal-overlay');
    if (el) el.remove();
    document.removeEventListener('keydown', _mapEscHandler);
}