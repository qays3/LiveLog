const CANVAS_COLORS = {
    '1': '#e05252', '2': '#e0a352', '3': '#d9d24f',
    '4': '#52e07a', '5': '#52c5e0', '6': '#a87de0'
};
const CANVAS_COLOR_DEFAULT = 'var(--dark-border)';

const _canvas = {
    data: { nodes: [], edges: [] },
    scale: 1,
    panX: 0,
    panY: 0,
    selected: new Set(),
    selectedEdge: null,
    dragging: null,
    resizing: null,
    panning: false,
    linking: null,
    marquee: null,
    dirty: false,
    loaded: false,
    history: [],
    future: [],
    keysBound: false,
    name: '',
    files: [],
};

function canvasColorOf(c) {
    if (!c) return CANVAS_COLOR_DEFAULT;
    return CANVAS_COLORS[c] || c;
}

function canvasSnapshot() {
    return JSON.stringify(_canvas.data);
}

function canvasPushHistory() {
    _canvas.history.push(canvasSnapshot());
    if (_canvas.history.length > 100) _canvas.history.shift();
    _canvas.future = [];
}

function canvasUndo() {
    if (_canvas.history.length === 0) return;
    _canvas.future.push(canvasSnapshot());
    const prev = _canvas.history.pop();
    _canvas.data = JSON.parse(prev);
    _canvas.selected = new Set();
    _canvas.selectedEdge = null;
    _canvas.dirty = true;
    canvasHideInspector();
    canvasDraw();
}

function canvasRedo() {
    if (_canvas.future.length === 0) return;
    _canvas.history.push(canvasSnapshot());
    const next = _canvas.future.pop();
    _canvas.data = JSON.parse(next);
    _canvas.selected = new Set();
    _canvas.selectedEdge = null;
    _canvas.dirty = true;
    canvasHideInspector();
    canvasDraw();
}

function canvasIsSelected(id) {
    return _canvas.selected.has(id);
}

function canvasSelectOnly(id) {
    _canvas.selected = new Set(id ? [id] : []);
    _canvas.selectedEdge = null;
}

function canvasSelectAll() {
    _canvas.selected = new Set(_canvas.data.nodes.map(n => n.id));
    _canvas.selectedEdge = null;
    canvasHideInspector();
    canvasDraw();
}

function canvasClearSelection() {
    _canvas.selected = new Set();
    _canvas.selectedEdge = null;
    canvasHideInspector();
    canvasDraw();
}

function canvasDeleteSelected() {
    if (_canvas.selected.size === 0 && !_canvas.selectedEdge) return;
    canvasPushHistory();
    if (_canvas.selected.size > 0) {
        const ids = _canvas.selected;
        _canvas.data.nodes = _canvas.data.nodes.filter(n => !ids.has(n.id));
        _canvas.data.edges = _canvas.data.edges.filter(e => !ids.has(e.fromNode) && !ids.has(e.toNode));
    }
    if (_canvas.selectedEdge) {
        _canvas.data.edges = _canvas.data.edges.filter(e => e.id !== _canvas.selectedEdge);
    }
    _canvas.selected = new Set();
    _canvas.selectedEdge = null;
    _canvas.dirty = true;
    canvasHideInspector();
    canvasDraw();
}

function canvasMdToHtml(text) {
    let t = escHtml(text || '');
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/^######\s?(.*)$/gm, '<span style="font-size:11px;font-weight:700">$1</span>');
    t = t.replace(/^#####\s?(.*)$/gm, '<span style="font-size:12px;font-weight:700">$1</span>');
    t = t.replace(/^####\s?(.*)$/gm, '<span style="font-size:13px;font-weight:700">$1</span>');
    t = t.replace(/^###\s?(.*)$/gm, '<span style="font-size:14px;font-weight:700">$1</span>');
    t = t.replace(/^##\s?(.*)$/gm, '<span style="font-size:16px;font-weight:800">$1</span>');
    t = t.replace(/^#\s?(.*)$/gm, '<span style="font-size:18px;font-weight:800">$1</span>');
    t = t.replace(/\n/g, '<br>');
    return t;
}

async function renderCanvasPage() {
    const page = document.getElementById('page-infra');
    if (!page) return;

    if (!_canvas.loaded) {
        page.innerHTML = `<div style="padding:40px;text-align:center;color:var(--neutral-slate-500)">Loading canvases…</div>`;
        try {
            await canvasLoadFileList();
            const first = _canvas.files.length ? _canvas.files[0].name : 'infra';
            await canvasLoadFile(first, true);
            _canvas.loaded = true;
        } catch (e) {
            page.innerHTML = `<div style="padding:40px;text-align:center;color:var(--dark-primary)">Could not load canvas: ${escHtml(e.message)}</div>`;
            return;
        }
    }

    page.innerHTML = `
        <div class="page-header flex-between">
            <div>
                <div class="page-title">Canvas</div>
                <div class="page-subtitle" id="canvas-subtitle">${_canvas.data.nodes.length} nodes · ${_canvas.data.edges.length} connections</div>
            </div>
        </div>
        <div class="canvas-filebar">
            <span class="canvas-filebar-label">Canvas</span>
            <select id="canvas-file-select" class="canvas-file-select" onchange="canvasSwitchFile(this.value)">
                ${canvasFileOptions()}
            </select>
            <button class="btn btn-ghost btn-sm" onclick="canvasNewFile()">New</button>
            <button class="btn btn-ghost btn-sm" onclick="canvasRenameFile()">Rename</button>
            <button class="btn btn-ghost btn-sm" onclick="canvasDeleteFile()">Delete</button>
            <span style="flex:1"></span>
            <input type="file" id="canvas-upload-input" accept=".canvas,application/json" style="display:none" onchange="canvasHandleUpload(this)">
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('canvas-upload-input').click()">Upload</button>
            <button class="btn btn-ghost btn-sm" onclick="canvasDownload()">Download</button>
        </div>
        <div class="canvas-toolbar">
            <button class="btn btn-primary btn-sm" onclick="canvasAddNode()">Add node</button>
            <button class="btn btn-ghost btn-sm" onclick="canvasFitToView();canvasDraw()">Fit</button>
            <button class="btn btn-ghost btn-sm" onclick="canvasZoom(1.2)">+</button>
            <button class="btn btn-ghost btn-sm" onclick="canvasZoom(0.8)">−</button>
            <span style="flex:1"></span>
            <span id="canvas-save-status" style="font-size:12px;color:var(--neutral-slate-400);min-height:14px"></span>
            <button class="btn btn-primary btn-sm" id="canvas-save-btn" onclick="canvasSave()">Save</button>
        </div>
        <div id="canvas-viewport" class="canvas-viewport">
            <div id="canvas-world" class="canvas-world">
                <svg id="canvas-edges" class="canvas-edges"></svg>
                <div id="canvas-nodes"></div>
            </div>
        </div>
        <div id="canvas-inspector" class="canvas-inspector" style="display:none"></div>`;

    canvasInjectStyles();
    canvasBindViewport();
    canvasDraw();
}

function canvasFitToView() {
    const nodes = _canvas.data.nodes;
    if (!nodes.length) { _canvas.scale = 1; _canvas.panX = 0; _canvas.panY = 0; return; }
    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxX = Math.max(...nodes.map(n => n.x + (n.width || 200)));
    const maxY = Math.max(...nodes.map(n => n.y + (n.height || 60)));
    const vp = document.getElementById('canvas-viewport');
    const vw = vp ? vp.clientWidth : 1000;
    const vh = vp ? vp.clientHeight : 600;
    const scale = Math.min(vw / (maxX - minX + 200), vh / (maxY - minY + 200), 1);
    _canvas.scale = scale > 0.02 ? scale : 0.05;
    _canvas.panX = (vw - (maxX - minX) * _canvas.scale) / 2 - minX * _canvas.scale;
    _canvas.panY = (vh - (maxY - minY) * _canvas.scale) / 2 - minY * _canvas.scale;
}

function canvasApplyTransform() {
    const world = document.getElementById('canvas-world');
    if (world) world.style.transform = `translate(${_canvas.panX}px,${_canvas.panY}px) scale(${_canvas.scale})`;
}

function canvasZoom(factor) {
    _canvas.scale = Math.max(0.05, Math.min(4, _canvas.scale * factor));
    canvasApplyTransform();
    canvasDraw();
}

function canvasDraw() {
    const nodesEl = document.getElementById('canvas-nodes');
    const edgesEl = document.getElementById('canvas-edges');
    if (!nodesEl || !edgesEl) return;

    canvasApplyTransform();

    nodesEl.innerHTML = _canvas.data.nodes.map(n => {
        const col = canvasColorOf(n.color);
        const sel = canvasIsSelected(n.id);
        return `<div class="canvas-node ${sel ? 'selected' : ''}" data-id="${n.id}"
            style="left:${n.x}px;top:${n.y}px;width:${n.width || 200}px;height:${n.height || 60}px;border-color:${col};box-shadow:0 0 0 ${sel ? '2px' : '1px'} ${col}">
            <div class="canvas-node-text">${canvasMdToHtml(n.text)}</div>
            <div class="canvas-node-port" data-id="${n.id}" title="Drag to connect"></div>
            <div class="canvas-node-resize" data-id="${n.id}"></div>
        </div>`;
    }).join('');

    const nodeById = {};
    _canvas.data.nodes.forEach(n => nodeById[n.id] = n);
    const lines = _canvas.data.edges.map(e => {
        const a = nodeById[e.fromNode], b = nodeById[e.toNode];
        if (!a || !b) return '';
        const ax = a.x + (a.width || 200) / 2, ay = a.y + (a.height || 60) / 2;
        const bx = b.x + (b.width || 200) / 2, by = b.y + (b.height || 60) / 2;
        const sel = _canvas.selectedEdge === e.id;
        return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${sel ? 'var(--dark-accent)' : 'var(--neutral-slate-600)'}" stroke-width="${sel ? 3 : 1.5}" data-edge="${e.id}" style="cursor:pointer" />`;
    }).join('');

    const nodes = _canvas.data.nodes;
    let vb = '0 0 1000 1000';
    if (nodes.length) {
        const minX = Math.min(...nodes.map(n => n.x)) - 100;
        const minY = Math.min(...nodes.map(n => n.y)) - 100;
        const maxX = Math.max(...nodes.map(n => n.x + (n.width || 200))) + 100;
        const maxY = Math.max(...nodes.map(n => n.y + (n.height || 60))) + 100;
        edgesEl.style.left = minX + 'px';
        edgesEl.style.top = minY + 'px';
        edgesEl.style.width = (maxX - minX) + 'px';
        edgesEl.style.height = (maxY - minY) + 'px';
        vb = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
    }
    edgesEl.setAttribute('viewBox', vb);
    edgesEl.innerHTML = lines;

    const sub = document.getElementById('canvas-subtitle');
    if (sub) sub.textContent = `${_canvas.data.nodes.length} nodes · ${_canvas.data.edges.length} connections${_canvas.dirty ? ' · unsaved' : ''}`;

    canvasUpdateEmptyHint();
}

function canvasUpdateEmptyHint() {
    const vp = document.getElementById('canvas-viewport');
    if (!vp) return;
    let hint = document.getElementById('canvas-empty-hint');
    if (_canvas.data.nodes.length === 0) {
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'canvas-empty-hint';
            hint.className = 'canvas-empty-hint';
            hint.innerHTML = `<div class="canvas-empty-title">Empty board</div>
                <div class="canvas-empty-sub">No infra map yet. Click <strong>Add node</strong> to start, or <strong>Upload canvas</strong> to import a .canvas file.</div>`;
            vp.appendChild(hint);
        }
    } else if (hint) {
        hint.remove();
    }
}

function canvasScreenToWorld(clientX, clientY) {
    const vp = document.getElementById('canvas-viewport');
    const rect = vp.getBoundingClientRect();
    return {
        x: (clientX - rect.left - _canvas.panX) / _canvas.scale,
        y: (clientY - rect.top - _canvas.panY) / _canvas.scale
    };
}

function canvasBindViewport() {
    const vp = document.getElementById('canvas-viewport');
    if (!vp) return;

    vp.addEventListener('wheel', e => {
        e.preventDefault();
        const before = canvasScreenToWorld(e.clientX, e.clientY);
        _canvas.scale = Math.max(0.05, Math.min(4, _canvas.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
        const after = canvasScreenToWorld(e.clientX, e.clientY);
        _canvas.panX += (after.x - before.x) * _canvas.scale;
        _canvas.panY += (after.y - before.y) * _canvas.scale;
        canvasDraw();
    }, { passive: false });

    canvasBindKeys();

    vp.addEventListener('mousedown', e => {
        const port = e.target.closest('.canvas-node-port');
        const resize = e.target.closest('.canvas-node-resize');
        const node = e.target.closest('.canvas-node');
        const edge = e.target.closest('[data-edge]');

        if (port) {
            _canvas.linking = { from: port.dataset.id, x: e.clientX, y: e.clientY };
            e.preventDefault();
            return;
        }
        if (resize) {
            const n = _canvas.data.nodes.find(x => x.id === resize.dataset.id);
            canvasPushHistory();
            _canvas.resizing = { id: n.id, startX: e.clientX, startY: e.clientY, w0: n.width || 200, h0: n.height || 60 };
            e.preventDefault();
            return;
        }
        if (node) {
            const id = node.dataset.id;
            if (e.shiftKey || e.ctrlKey) {
                if (_canvas.selected.has(id)) _canvas.selected.delete(id);
                else _canvas.selected.add(id);
                _canvas.selectedEdge = null;
                canvasDraw();
                canvasHideInspector();
                return;
            }
            if (!_canvas.selected.has(id)) canvasSelectOnly(id);
            const w = canvasScreenToWorld(e.clientX, e.clientY);
            const moving = _canvas.data.nodes.filter(x => _canvas.selected.has(x.id)).map(x => ({ id: x.id, ox: w.x - x.x, oy: w.y - x.y }));
            _canvas.dragging = { moving, moved: false, snapped: false };
            canvasDraw();
            if (_canvas.selected.size === 1) canvasShowInspector(id);
            else canvasHideInspector();
            e.preventDefault();
            return;
        }
        if (edge) {
            _canvas.selectedEdge = edge.dataset.edge;
            _canvas.selected = new Set();
            canvasDraw();
            canvasShowEdgeInspector(edge.dataset.edge);
            return;
        }
        if (e.button === 1 || _canvas.spaceDown) {
            _canvas.panning = { x: e.clientX, y: e.clientY, px: _canvas.panX, py: _canvas.panY };
            canvasHideInspector();
            e.preventDefault();
            return;
        }
        if (e.button === 0) {
            const w = canvasScreenToWorld(e.clientX, e.clientY);
            _canvas.marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, add: (e.shiftKey || e.ctrlKey), base: new Set(_canvas.selected) };
            if (!_canvas.marquee.add) { _canvas.selected = new Set(); _canvas.selectedEdge = null; }
            canvasHideInspector();
            canvasDraw();
            e.preventDefault();
            return;
        }
        _canvas.panning = { x: e.clientX, y: e.clientY, px: _canvas.panX, py: _canvas.panY };
        canvasHideInspector();
    });

    window.addEventListener('mousemove', e => {
        if (_canvas.linking) {
            canvasDrawLinkPreview(e.clientX, e.clientY);
            return;
        }
        if (_canvas.dragging) {
            if (!_canvas.dragging.moved) canvasPushHistory();
            const w = canvasScreenToWorld(e.clientX, e.clientY);
            _canvas.dragging.moving.forEach(m => {
                const n = _canvas.data.nodes.find(x => x.id === m.id);
                if (n) { n.x = Math.round(w.x - m.ox); n.y = Math.round(w.y - m.oy); }
            });
            _canvas.dragging.moved = true;
            _canvas.dirty = true;
            canvasDraw();
        } else if (_canvas.resizing) {
            const n = _canvas.data.nodes.find(x => x.id === _canvas.resizing.id);
            n.width = Math.max(80, Math.round(_canvas.resizing.w0 + (e.clientX - _canvas.resizing.startX) / _canvas.scale));
            n.height = Math.max(40, Math.round(_canvas.resizing.h0 + (e.clientY - _canvas.resizing.startY) / _canvas.scale));
            _canvas.dirty = true;
            canvasDraw();
        } else if (_canvas.marquee) {
            const w = canvasScreenToWorld(e.clientX, e.clientY);
            _canvas.marquee.x1 = w.x;
            _canvas.marquee.y1 = w.y;
            canvasApplyMarquee();
            canvasDraw();
            canvasDrawMarqueeBox();
        } else if (_canvas.panning) {
            _canvas.panX = _canvas.panning.px + (e.clientX - _canvas.panning.x);
            _canvas.panY = _canvas.panning.py + (e.clientY - _canvas.panning.y);
            canvasApplyTransform();
        }
    });

    window.addEventListener('mouseup', e => {
        if (_canvas.linking) {
            let targetId = null;
            const port = e.target.closest('.canvas-node-port');
            const node = e.target.closest('.canvas-node');
            if (port) targetId = port.dataset.id;
            else if (node) targetId = node.dataset.id;
            if (targetId && targetId !== _canvas.linking.from) {
                canvasAddEdge(_canvas.linking.from, targetId);
            }
            _canvas.linking = null;
            canvasClearLinkPreview();
        }
        if (_canvas.dragging && !_canvas.dragging.moved && _canvas.history.length) {
            _canvas.history.pop();
        }
        if (_canvas.marquee) {
            canvasClearMarqueeBox();
            _canvas.marquee = null;
        }
        _canvas.dragging = null;
        _canvas.resizing = null;
        _canvas.panning = false;
    });
}

function canvasApplyMarquee() {
    const m = _canvas.marquee;
    const minX = Math.min(m.x0, m.x1), maxX = Math.max(m.x0, m.x1);
    const minY = Math.min(m.y0, m.y1), maxY = Math.max(m.y0, m.y1);
    const hit = new Set(m.add ? Array.from(m.base) : []);
    _canvas.data.nodes.forEach(n => {
        const nx = n.x, ny = n.y, nw = n.width || 200, nh = n.height || 60;
        if (nx < maxX && nx + nw > minX && ny < maxY && ny + nh > minY) hit.add(n.id);
    });
    _canvas.selected = hit;
}

function canvasDrawMarqueeBox() {
    const vp = document.getElementById('canvas-viewport');
    if (!vp || !_canvas.marquee) return;
    const m = _canvas.marquee;
    const x = Math.min(m.x0, m.x1) * _canvas.scale + _canvas.panX;
    const y = Math.min(m.y0, m.y1) * _canvas.scale + _canvas.panY;
    const w = Math.abs(m.x1 - m.x0) * _canvas.scale;
    const h = Math.abs(m.y1 - m.y0) * _canvas.scale;
    let box = document.getElementById('canvas-marquee');
    if (!box) {
        box = document.createElement('div');
        box.id = 'canvas-marquee';
        box.className = 'canvas-marquee';
        vp.appendChild(box);
    }
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';
}

function canvasClearMarqueeBox() {
    const box = document.getElementById('canvas-marquee');
    if (box) box.remove();
}

function canvasBindKeys() {
    if (_canvas.keysBound) return;
    _canvas.keysBound = true;

    const onInfra = () => (window.location.hash || '').replace('#', '').split('/').filter(Boolean)[0] === 'infra';
    const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

    window.addEventListener('keydown', e => {
        if (!onInfra()) return;
        if (typing(e.target)) return;

        const ctrl = e.ctrlKey || e.metaKey;
        const k = e.key.toLowerCase();

        if (ctrl && k === 'a') { e.preventDefault(); canvasSelectAll(); return; }
        if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); canvasUndo(); return; }
        if ((ctrl && k === 'y') || (ctrl && e.shiftKey && k === 'z')) { e.preventDefault(); canvasRedo(); return; }
        if (k === 'delete' || k === 'backspace') { e.preventDefault(); canvasDeleteSelected(); return; }
        if (k === 'escape') { e.preventDefault(); canvasClearSelection(); return; }
        if (k === ' ') { _canvas.spaceDown = true; const vp = document.getElementById('canvas-viewport'); if (vp) vp.style.cursor = 'grab'; e.preventDefault(); }
    });

    window.addEventListener('keyup', e => {
        if (e.key === ' ') { _canvas.spaceDown = false; const vp = document.getElementById('canvas-viewport'); if (vp) vp.style.cursor = ''; }
    });
}

function canvasDrawLinkPreview(clientX, clientY) {
    const vp = document.getElementById('canvas-viewport');
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const fromNode = _canvas.data.nodes.find(n => n.id === _canvas.linking.from);
    if (!fromNode) return;

    const ax = (fromNode.x + (fromNode.width || 200)) * _canvas.scale + _canvas.panX;
    const ay = (fromNode.y + (fromNode.height || 60) / 2) * _canvas.scale + _canvas.panY;
    const bx = clientX - rect.left;
    const by = clientY - rect.top;

    let svg = document.getElementById('canvas-link-preview');
    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'canvas-link-preview';
        svg.setAttribute('class', 'canvas-link-preview');
        svg.style.left = '0';
        svg.style.top = '0';
        svg.style.width = '100%';
        svg.style.height = '100%';
        vp.appendChild(svg);
    }
    svg.innerHTML = `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="var(--dark-accent)" stroke-width="2" stroke-dasharray="5 4" />`;
}

function canvasClearLinkPreview() {
    const svg = document.getElementById('canvas-link-preview');
    if (svg) svg.remove();
}

function canvasAddEdge(from, to) {
    const exists = _canvas.data.edges.some(e => e.fromNode === from && e.toNode === to);
    if (exists) return;
    canvasPushHistory();
    _canvas.data.edges.push({
        id: 'edge_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        fromNode: from, fromSide: 'right',
        toNode: to, toSide: 'left'
    });
    _canvas.dirty = true;
    canvasDraw();
}

function canvasAddNode() {
    const vp = document.getElementById('canvas-viewport');
    const center = canvasScreenToWorld(vp.clientWidth / 2 + vp.getBoundingClientRect().left, vp.clientHeight / 2 + vp.getBoundingClientRect().top);
    const id = 'node_' + Date.now();
    canvasPushHistory();
    _canvas.data.nodes.push({
        id, type: 'text', text: 'New node',
        x: Math.round(center.x - 100), y: Math.round(center.y - 30),
        width: 200, height: 60, color: '6'
    });
    canvasSelectOnly(id);
    _canvas.dirty = true;
    canvasDraw();
    canvasShowInspector(id);
}

function canvasShowInspector(id) {
    const n = _canvas.data.nodes.find(x => x.id === id);
    if (!n) return;
    _canvasTextHistoryPending = false;
    const insp = document.getElementById('canvas-inspector');
    if (!insp) return;
    insp.style.display = 'block';
    insp.innerHTML = `
        <div class="canvas-insp-head">
            <span>Edit node</span>
            <button class="stop-note-modal-close" onclick="canvasHideInspector()">&#x2715;</button>
        </div>
        <textarea id="canvas-node-text" class="canvas-insp-text" oninput="canvasUpdateText('${id}',this.value)">${escHtml(n.text)}</textarea>
        <div class="canvas-insp-label">Color</div>
        <div class="canvas-color-row">
            ${Object.keys(CANVAS_COLORS).map(c => `<button class="canvas-color-dot ${n.color === c ? 'active' : ''}" style="background:${CANVAS_COLORS[c]}" onclick="canvasSetColor('${id}','${c}')"></button>`).join('')}
            <button class="canvas-color-dot ${!n.color ? 'active' : ''}" style="background:var(--dark-border)" onclick="canvasSetColor('${id}','')" title="No color"></button>
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-top:14px;width:100%;color:var(--dark-primary)" onclick="canvasDeleteNode('${id}')">Delete node</button>`;
}

function canvasShowEdgeInspector(edgeId) {
    const insp = document.getElementById('canvas-inspector');
    if (!insp) return;
    insp.style.display = 'block';
    insp.innerHTML = `
        <div class="canvas-insp-head">
            <span>Connection</span>
            <button class="stop-note-modal-close" onclick="canvasHideInspector()">&#x2715;</button>
        </div>
        <button class="btn btn-ghost btn-sm" style="width:100%;color:var(--dark-primary)" onclick="canvasDeleteEdge('${edgeId}')">Delete connection</button>`;
}

function canvasHideInspector() {
    const insp = document.getElementById('canvas-inspector');
    if (insp) insp.style.display = 'none';
}

let _canvasTextHistoryPending = false;
function canvasUpdateText(id, val) {
    const n = _canvas.data.nodes.find(x => x.id === id);
    if (!n) return;
    if (!_canvasTextHistoryPending) { canvasPushHistory(); _canvasTextHistoryPending = true; }
    n.text = val;
    _canvas.dirty = true;
    canvasDraw();
}

function canvasSetColor(id, c) {
    const n = _canvas.data.nodes.find(x => x.id === id);
    if (!n) return;
    canvasPushHistory();
    if (c) n.color = c; else delete n.color;
    _canvas.dirty = true;
    canvasDraw();
    canvasShowInspector(id);
}

function canvasDeleteNode(id) {
    canvasPushHistory();
    _canvas.data.nodes = _canvas.data.nodes.filter(n => n.id !== id);
    _canvas.data.edges = _canvas.data.edges.filter(e => e.fromNode !== id && e.toNode !== id);
    _canvas.selected.delete(id);
    _canvas.dirty = true;
    canvasHideInspector();
    canvasDraw();
}

function canvasDeleteEdge(edgeId) {
    canvasPushHistory();
    _canvas.data.edges = _canvas.data.edges.filter(e => e.id !== edgeId);
    _canvas.selectedEdge = null;
    _canvas.dirty = true;
    canvasHideInspector();
    canvasDraw();
}

function canvasDownload() {
    const json = JSON.stringify(_canvas.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (_canvas.name || 'infra') + '.canvas';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function canvasHandleUpload(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('canvas-save-status');
    const asName = (file.name || 'upload').replace(/\.canvas$/i, '').replace(/\.json$/i, '');
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(reader.result);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes)) {
                throw new Error('Not a valid .canvas file');
            }
            canvasPushHistory();
            _canvas.name = canvasUniqueName(asName);
            _canvas.data = { nodes: parsed.nodes || [], edges: parsed.edges || [] };
            _canvas.selected = new Set();
            _canvas.selectedEdge = null;
            _canvas.dirty = true;
            canvasHideInspector();
            canvasFitToView();
            canvasRefreshFileSelect();
            canvasDraw();
            if (statusEl) { statusEl.style.color = 'var(--info-primary)'; statusEl.textContent = `Loaded ${_canvas.data.nodes.length} nodes into ${_canvas.name} — click Save to keep it`; }
        } catch (e) {
            if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Upload failed: ' + e.message; }
        }
    };
    reader.onerror = () => {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Could not read file'; }
    };
    reader.readAsText(file);
    input.value = '';
}

async function canvasSave() {
    const statusEl = document.getElementById('canvas-save-status');
    if (statusEl) { statusEl.style.color = 'var(--neutral-slate-400)'; statusEl.textContent = 'Saving…'; }
    try {
        const resp = await fetch(`${API_BASE}/api/canvas?name=${encodeURIComponent(_canvas.name || 'infra')}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_canvas.data)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || ('HTTP ' + resp.status));
        _canvas.dirty = false;
        if (statusEl) { statusEl.style.color = 'var(--success-primary)'; statusEl.textContent = `Saved to ${_canvas.name}`; }
        await canvasLoadFileList();
        canvasRefreshFileSelect();
        canvasDraw();
    } catch (e) {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Save failed: ' + e.message; }
    }
}

function canvasInjectStyles() {
    if (document.getElementById('canvas-editor-styles')) return;
    const s = document.createElement('style');
    s.id = 'canvas-editor-styles';
    s.textContent = `
.canvas-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.canvas-filebar{display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:10px 12px;background:var(--dark-bg-secondary);border:1px solid var(--dark-border);border-radius:10px;flex-wrap:wrap}
.canvas-filebar-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--neutral-slate-500)}
.canvas-file-select{height:32px;min-width:200px;max-width:340px;padding:0 10px;background:var(--dark-bg-primary);border:1px solid var(--dark-border);border-radius:7px;color:var(--dark-text);font-size:13px;cursor:pointer}
.canvas-file-select:focus{border-color:var(--dark-primary-50)}
.canvas-file-select option{background:var(--dropdown-option-dark-bg);color:var(--dropdown-option-dark-text)}
.canvas-modal-overlay{position:fixed;inset:0;z-index:9800;background:var(--black-70);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeIn .12s ease-out}
.canvas-modal{width:100%;max-width:420px;background:var(--dark-bg-secondary);border:1px solid var(--dark-primary-30);border-radius:14px;padding:18px;box-shadow:0 24px 70px var(--black-70)}
.canvas-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.canvas-modal-title{font-size:15px;font-weight:700;color:var(--dark-text)}
.canvas-modal-sub{font-size:11px;color:var(--neutral-slate-500);margin-top:3px;word-break:break-word}
.canvas-modal-x{width:26px;height:26px;border-radius:6px;background:transparent;color:var(--neutral-slate-400);font-size:12px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;border:none}
.canvas-modal-x:hover{background:var(--dark-primary-15);color:var(--dark-text)}
.canvas-modal-body{font-size:13px;line-height:1.6;color:var(--neutral-slate-400);margin-bottom:14px;word-break:break-word}
.canvas-modal-label{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--neutral-slate-500);margin-bottom:6px}
.canvas-modal-input{width:100%;height:38px;padding:0 11px;background:var(--dark-bg-primary);border:1px solid var(--dark-border);border-radius:8px;color:var(--dark-text);font-size:14px;font-family:inherit;box-sizing:border-box}
.canvas-modal-input:focus{border-color:var(--dark-primary-50)}
.canvas-modal-input::placeholder{color:var(--neutral-slate-600)}
.canvas-modal-error{min-height:16px;font-size:11px;color:var(--error-primary);margin-top:6px}
.canvas-modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px}
.canvas-modal-go{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;background:var(--dark-primary);color:var(--on-primary);border:1px solid var(--dark-primary);transition:background .15s}
.canvas-modal-go:hover{background:var(--dark-600)}
.canvas-modal-go.danger{background:var(--error-primary);border-color:var(--error-primary)}
.canvas-modal-go.danger:hover{background:var(--error-secondary)}
.canvas-viewport{position:relative;width:100%;height:calc(100vh - 220px);min-height:400px;background-color:var(--dark-bg-secondary);background-image:radial-gradient(var(--white-08) 1px, transparent 1px);background-size:22px 22px;border:1px solid var(--dark-border);border-radius:12px;overflow:hidden;cursor:default;user-select:none;-webkit-user-select:none;-moz-user-select:none}
.canvas-marquee{position:absolute;border:1px solid var(--dark-accent);background:var(--dark-primary-08);pointer-events:none;z-index:9400}
.canvas-empty-hint{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;max-width:360px;padding:24px}
.canvas-empty-title{font-size:15px;font-weight:700;color:var(--neutral-slate-400);margin-bottom:8px}
.canvas-empty-sub{font-size:12px;color:var(--neutral-slate-500);line-height:1.6}
.canvas-viewport:active{cursor:default}
.canvas-world{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}
.canvas-edges{position:absolute;overflow:visible;pointer-events:none}
.canvas-edges line{pointer-events:stroke}
.canvas-node{position:absolute;background:var(--dark-bg-tertiary);border:1px solid var(--dark-border);border-radius:8px;padding:8px 10px;cursor:move;box-sizing:border-box}
.canvas-node.selected{z-index:10}
.canvas-node-text{font-size:12px;color:var(--dark-text);line-height:1.4;word-break:break-word;pointer-events:none;overflow:hidden;max-height:100%}
.canvas-node-text code{font-family:monospace;background:var(--black-30);padding:1px 4px;border-radius:3px;font-size:11px}
.canvas-node-port{position:absolute;right:-7px;top:50%;transform:translateY(-50%);width:16px;height:16px;border-radius:50%;background:var(--dark-accent);border:2px solid var(--dark-bg-secondary);cursor:crosshair;opacity:.55;transition:opacity .15s,transform .1s;z-index:11}
.canvas-node:hover .canvas-node-port{opacity:1}
.canvas-node-port:hover{transform:translateY(-50%) scale(1.25)}
.canvas-node-resize{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--neutral-slate-600) 50%);opacity:0;transition:opacity .15s}
.canvas-node:hover .canvas-node-resize{opacity:1}
.canvas-link-preview{position:absolute;pointer-events:none;z-index:9500;overflow:visible}
.canvas-inspector{position:fixed;right:18px;top:80px;width:300px;background:var(--dark-bg-secondary);border:1px solid var(--dark-border);border-radius:12px;padding:14px;box-shadow:0 12px 40px var(--black-40);z-index:9000}
.canvas-insp-head{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:700;color:var(--dark-text);margin-bottom:12px}
.canvas-insp-text{width:100%;min-height:90px;background:var(--dark-bg-tertiary);border:1px solid var(--dark-border);border-radius:8px;padding:8px;color:var(--dark-text);font-size:12px;font-family:inherit;resize:vertical;box-sizing:border-box}
.canvas-insp-label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--neutral-slate-500);margin:14px 0 6px}
.canvas-color-row{display:flex;gap:6px;flex-wrap:wrap}
.canvas-color-dot{width:24px;height:24px;border-radius:6px;border:2px solid transparent;cursor:pointer}
.canvas-color-dot.active{border-color:var(--dark-text)}`;
    document.head.appendChild(s);
}
async function canvasLoadFileList() {
    try {
        const raw = await fetch(`${API_BASE}/api/canvas/list`, { cache: 'no-store' }).then(r => r.json());
        _canvas.files = Array.isArray(raw) ? raw : (raw && raw.name ? [raw] : []);
    } catch {
        _canvas.files = [];
    }
    return _canvas.files;
}

function canvasFileOptions() {
    if (!_canvas.files.length && _canvas.name) {
        return `<option value="${escHtml(_canvas.name)}" selected>${escHtml(_canvas.name)}</option>`;
    }
    return _canvas.files.map(f =>
        `<option value="${escHtml(f.name)}"${f.name === _canvas.name ? ' selected' : ''}>${escHtml(f.name)} (${f.nodes})</option>`
    ).join('');
}

function canvasRefreshFileSelect() {
    const sel = document.getElementById('canvas-file-select');
    if (!sel) return;
    const known = _canvas.files.some(f => f.name === _canvas.name);
    sel.innerHTML = canvasFileOptions() +
        (known ? '' : `<option value="${escHtml(_canvas.name)}" selected>${escHtml(_canvas.name)} (unsaved)</option>`);
    sel.value = _canvas.name;
    canvasUpdateSubtitle();
}

function canvasUpdateSubtitle() {
    const sub = document.getElementById('canvas-subtitle');
    if (sub) sub.textContent = `${_canvas.name} · ${_canvas.data.nodes.length} nodes · ${_canvas.data.edges.length} connections`;
}

function canvasUniqueName(base) {
    let name = String(base || 'canvas').trim() || 'canvas';
    if (!_canvas.files.some(f => f.name === name)) return name;
    let i = 2;
    while (_canvas.files.some(f => f.name === `${name}-${i}`)) i++;
    return `${name}-${i}`;
}

async function canvasLoadFile(name, silent) {
    const data = await fetch(`${API_BASE}/api/canvas?name=${encodeURIComponent(name)}`, { cache: 'no-store' }).then(r => r.json());
    _canvas.name = name;
    _canvas.data = { nodes: data.nodes || [], edges: data.edges || [] };
    _canvas.selected = new Set();
    _canvas.selectedEdge = null;
    _canvas.history = [];
    _canvas.future = [];
    _canvas.dirty = false;
    canvasHideInspector();
    canvasFitToView();
    if (!silent) {
        canvasRefreshFileSelect();
        canvasDraw();
    }
}

function canvasModal(opts) {
    return new Promise(resolve => {
        document.getElementById('canvas-modal-overlay')?.remove();

        const hasInput = typeof opts.value === 'string';
        const overlay = document.createElement('div');
        overlay.id = 'canvas-modal-overlay';
        overlay.className = 'canvas-modal-overlay';

        overlay.innerHTML = `
            <div class="canvas-modal">
                <div class="canvas-modal-head">
                    <div>
                        <div class="canvas-modal-title">${escHtml(opts.title)}</div>
                        ${opts.subtitle ? `<div class="canvas-modal-sub">${escHtml(opts.subtitle)}</div>` : ''}
                    </div>
                    <button class="canvas-modal-x" data-act="cancel">&#x2715;</button>
                </div>
                ${opts.body ? `<div class="canvas-modal-body">${escHtml(opts.body)}</div>` : ''}
                ${hasInput ? `
                    <label class="canvas-modal-label">${escHtml(opts.label || 'Name')}</label>
                    <input class="canvas-modal-input" id="canvas-modal-input" type="text"
                           value="${escHtml(opts.value)}" placeholder="${escHtml(opts.placeholder || '')}" maxlength="80">
                    <div class="canvas-modal-error" id="canvas-modal-error"></div>` : ''}
                <div class="canvas-modal-foot">
                    <button class="btn btn-ghost btn-sm" data-act="cancel">${escHtml(opts.cancelLabel || 'Cancel')}</button>
                    <button class="canvas-modal-go${opts.danger ? ' danger' : ''}" data-act="ok">${escHtml(opts.confirmLabel || 'Save')}</button>
                </div>
            </div>`;

        const close = val => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(val); };

        const submit = () => {
            if (!hasInput) return close(true);
            const input = document.getElementById('canvas-modal-input');
            const val = (input.value || '').replace(/\s+/g, ' ').trim();
            const err = document.getElementById('canvas-modal-error');
            const problem = opts.validate ? opts.validate(val) : (val ? '' : 'Give it a name.');
            if (problem) { err.textContent = problem; input.focus(); return; }
            close(val);
        };

        const onKey = e => {
            if (e.key === 'Escape') close(null);
            if (e.key === 'Enter' && hasInput) { e.preventDefault(); submit(); }
        };

        overlay.addEventListener('click', e => {
            if (e.target === overlay) return close(null);
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'cancel') close(null);
            if (act === 'ok') submit();
        });

        document.addEventListener('keydown', onKey);
        document.body.appendChild(overlay);

        if (hasInput) {
            const input = document.getElementById('canvas-modal-input');
            input.focus();
            input.select();
        }
    });
}

function canvasNameTaken(name, except) {
    return _canvas.files.some(f => f.name === name && f.name !== except);
}

function canvasValidateName(name, except) {
    if (!name) return 'Give it a name.';
    if (/[\\/:*?"<>|]/.test(name)) return 'These characters are not allowed: \\ / : * ? " < > |';
    if (name.includes('..')) return 'The name cannot contain "..".';
    if (canvasNameTaken(name, except)) return `A canvas called "${name}" already exists.`;
    return '';
}

async function canvasConfirmDiscard(action) {
    if (!_canvas.dirty) return true;
    const ok = await canvasModal({
        title: 'Unsaved changes',
        subtitle: _canvas.name,
        body: `"${_canvas.name}" has changes you have not saved. ${action} anyway and lose them?`,
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true
    });
    return ok === true;
}

async function canvasSwitchFile(name) {
    if (!name || name === _canvas.name) return;

    if (!await canvasConfirmDiscard('Switch')) {
        const sel = document.getElementById('canvas-file-select');
        if (sel) sel.value = _canvas.name;
        return;
    }

    const statusEl = document.getElementById('canvas-save-status');
    try {
        await canvasLoadFile(name);
        if (statusEl) { statusEl.style.color = 'var(--neutral-slate-400)'; statusEl.textContent = ''; }
    } catch {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = 'Could not open ' + name; }
    }
}

async function canvasNewFile() {
    if (!await canvasConfirmDiscard('Start a new canvas')) return;

    const name = await canvasModal({
        title: 'New canvas',
        subtitle: 'It is created on the server when you save',
        label: 'Canvas name',
        value: canvasUniqueName('canvas'),
        placeholder: 'DMZ layout',
        confirmLabel: 'Create',
        validate: v => canvasValidateName(v)
    });
    if (name === null) return;

    _canvas.name = name;
    _canvas.data = { nodes: [], edges: [] };
    _canvas.selected = new Set();
    _canvas.selectedEdge = null;
    _canvas.history = [];
    _canvas.future = [];
    _canvas.dirty = true;
    canvasHideInspector();
    canvasFitToView();
    canvasRefreshFileSelect();
    canvasDraw();

    const statusEl = document.getElementById('canvas-save-status');
    if (statusEl) { statusEl.style.color = 'var(--info-primary)'; statusEl.textContent = 'New canvas — click Save to create it'; }
}

async function canvasRenameFile() {
    const current = _canvas.name;

    const name = await canvasModal({
        title: 'Rename canvas',
        subtitle: current,
        label: 'Canvas name',
        value: current,
        confirmLabel: 'Rename',
        validate: v => canvasValidateName(v, current)
    });
    if (name === null || name === current) return;

    const statusEl = document.getElementById('canvas-save-status');

    if (!_canvas.files.some(f => f.name === current)) {
        _canvas.name = name;
        canvasRefreshFileSelect();
        if (statusEl) { statusEl.style.color = 'var(--info-primary)'; statusEl.textContent = 'Renamed — click Save to create it'; }
        return;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/canvas/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: current, to: name })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || 'Rename failed');

        _canvas.name = data.name || name;
        await canvasLoadFileList();
        canvasRefreshFileSelect();
        if (statusEl) { statusEl.style.color = 'var(--success-primary)'; statusEl.textContent = `Renamed to ${_canvas.name}`; }
    } catch (e) {
        if (statusEl) { statusEl.style.color = 'var(--dark-primary)'; statusEl.textContent = e.message; }
    }
}

async function canvasDeleteFile() {
    const name = _canvas.name;
    const saved = _canvas.files.some(f => f.name === name);

    const ok = await canvasModal({
        title: `Delete ${name}`,
        subtitle: saved ? 'The file is removed from the server' : 'This canvas was never saved',
        body: saved
            ? `"${name}" and everything drawn on it will be gone. This cannot be undone.`
            : `"${name}" only exists in this browser. Discard it?`,
        confirmLabel: `Delete ${name}`,
        cancelLabel: 'Keep it',
        danger: true
    });
    if (ok !== true) return;

    const statusEl = document.getElementById('canvas-save-status');
    if (saved) {
        try {
            await fetch(`${API_BASE}/api/canvas?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
        } catch {}
    }

    await canvasLoadFileList();
    const next = _canvas.files.length ? _canvas.files[0].name : 'infra';
    _canvas.dirty = false;
    await canvasLoadFile(next);
    if (statusEl) { statusEl.style.color = 'var(--neutral-slate-400)'; statusEl.textContent = `Deleted ${name}`; }
}