const TOOLBOX_ITEMS = [
    {
        id: 'manual-script',
        name: 'Manual Script for Log Source Behavior',
        kind: 'PowerShell',
        where: 'Runs on the jump server',
        managed: true,
        icon: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
        tabs: ['Description', 'Docs', 'Upload', 'Old versions'],
        description: `
            <p>If the LiveLog tool is not working, use this script instead.</p>
            <p>It gives you the same log source behavior LiveLog shows, but from the command line as a single self contained file. Nothing to install, nothing running in the background. You run it when you need an answer.</p>
            <p>Tell it how far back to look and which log source to check, and it returns the behavior for that source over that period.</p>`,
        docs: `
            <p>The script authenticates with your own QRadar credentials. Open it and set these three values at the top before running:</p>
            <div class="tool-term">
                <div class="tool-term-bar"><span class="tool-term-dot"></span>behavior-check.ps1</div>
                <pre class="tool-term-body">$QRadarHost    = 'HOST'   <span class="tool-term-note">the QRadar IP</span>
$Username      = 'User'   <span class="tool-term-note">your QRadar username</span>
$Password      = 'Pass'   <span class="tool-term-note">your QRadar password</span></pre>
            </div>
            <p>Then run it on the jump server:</p>
            <div class="tool-term">
                <div class="tool-term-bar"><span class="tool-term-dot"></span>jump server</div>
                <pre class="tool-term-body">PS&gt; .\\behavior-check.ps1</pre>
            </div>
            <p>It asks you for two things:</p>
            <ol class="tool-steps">
                <li><b>How far back to look.</b> Pick from the numbered list, anywhere from 5 minutes to 90 days.</li>
                <li><b>The log source ID</b> you want to check, as a number.</li>
            </ol>
            <p>It then queries QRadar and prints the behavior for that log source over the period you chose.</p>`
    },
    {
        id: 'tab-alarm-monitor',
        name: 'Tab Alarm Monitor',
        kind: 'Firefox extension',
        where: 'Installs from addons.mozilla.org',
        managed: false,
        external: 'https://addons.mozilla.org/en-US/firefox/addon/tab-alarm-monitor/',
        icon: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
        tabs: ['Description'],
        description: `
            <p>A Firefox extension that lets you set a timer on each tab for when it should alert you.</p>
            <p>That way you know when a tab is due to be checked, from the timer and from the color. Turn the sound on if you want an audible alert when a tab comes due.</p>`
    }
];

const toolboxState = {};

async function renderToolbox() {
    const container = document.getElementById('page-toolbox');
    if (!container) return;

    if (container.dataset.built === '1') {
        TOOLBOX_ITEMS.forEach(tool => { if (tool.managed) loadToolVersions(tool.id); });
        if (typeof loadDashboardPulseList === 'function') loadDashboardPulseList();
        return;
    }

    container.innerHTML = `
        <div class="page-header">
            <div class="page-title">Toolbox</div>
            <div class="page-subtitle">Scripts and utilities that back up the dashboard</div>
        </div>
        <div class="tool-stack">
            ${TOOLBOX_ITEMS.map(renderToolCard).join('')}
            <div id="toolbox-extra-mount"></div>
        </div>`;

    container.dataset.built = '1';

    TOOLBOX_ITEMS.forEach(tool => {
        if (!toolboxState[tool.id]) toolboxState[tool.id] = { tab: tool.tabs[0], versions: null };
        bindToolCard(tool);
        if (tool.managed) loadToolVersions(tool.id);
    });

    if (typeof renderDashboardPulseBox === 'function') renderDashboardPulseBox();
}

function renderToolCard(tool) {
    const action = tool.managed
        ? `<button class="tool-dl" id="dl-${tool.id}" onclick="downloadToolVersion('${tool.id}')">
               <svg viewBox="0 0 24 24"><path d="M12 3v12"/><polyline points="7 11 12 16 17 11"/><line x1="4" y1="20" x2="20" y2="20"/></svg>
               <span id="dltext-${tool.id}">Download latest</span>
           </button>`
        : `<a class="tool-dl" href="${tool.external}" target="_blank" rel="noopener">
               <svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><line x1="10" y1="14" x2="20" y2="4"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
               <span>Get the extension</span>
           </a>`;

    return `
        <section class="tool-card${tool.managed ? '' : ' tool-card-external'}" id="card-${tool.id}">
            <header class="tool-head">
                <div class="tool-glyph"><svg viewBox="0 0 24 24">${tool.icon}</svg></div>
                <div class="tool-ident">
                    <h2 class="tool-name">${escHtml(tool.name)}</h2>
                    <div class="tool-meta">
                        <span class="tool-kind">${escHtml(tool.kind)}</span>
                        <span class="tool-dot"></span>
                        <span>${escHtml(tool.where)}</span>
                        <span class="tool-release" id="latest-${tool.id}"></span>
                    </div>
                </div>
                ${action}
            </header>
            <nav class="tool-tabs" id="tabs-${tool.id}">
                ${tool.tabs.map((t, i) => `<button class="tool-tab${i === 0 ? ' on' : ''}" data-tab="${escHtml(t)}">${escHtml(t)}</button>`).join('')}
            </nav>
            <div class="tool-panel" id="panel-${tool.id}"></div>
        </section>`;
}

function bindToolCard(tool) {
    const tabs = document.getElementById(`tabs-${tool.id}`);
    if (!tabs) return;
    tabs.querySelectorAll('.tool-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            toolboxState[tool.id].tab = btn.dataset.tab;
            tabs.querySelectorAll('.tool-tab').forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
            paintToolPanel(tool);
        });
    });
    paintToolPanel(tool);
}

function paintToolPanel(tool) {
    const panel = document.getElementById(`panel-${tool.id}`);
    if (!panel) return;
    const tab = toolboxState[tool.id].tab;

    if (tab === 'Description')  { panel.innerHTML = `<div class="tool-prose">${tool.description}</div>`; return; }
    if (tab === 'Docs')         { panel.innerHTML = `<div class="tool-prose">${tool.docs}</div>`; return; }
    if (tab === 'Upload')       { panel.innerHTML = renderToolUpload(tool); bindToolUpload(tool); return; }
    if (tab === 'Old versions') { panel.innerHTML = renderToolVersions(tool); return; }
}

function renderToolUpload(tool) {
    return `
        <div class="tool-upload">
            <div class="tool-drop" id="drop-${tool.id}">
                <svg class="tool-drop-glyph" viewBox="0 0 24 24"><path d="M12 16V4"/><polyline points="7 9 12 4 17 9"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
                <div class="tool-drop-text">Drop the file here, or <span class="tool-drop-link">browse</span></div>
                <div class="tool-drop-hint">A newer version of this script. Up to 20 MB.</div>
                <div class="tool-drop-file" id="dropname-${tool.id}"></div>
                <input type="file" id="file-${tool.id}" class="hidden">
            </div>
            <div class="tool-fields">
                <label class="tool-field">
                    <span class="tool-field-label">Author <b class="tool-req">required</b></span>
                    <input class="tool-input" id="author-${tool.id}" type="text" placeholder="Your name">
                </label>
                <label class="tool-field">
                    <span class="tool-field-label">Version</span>
                    <input class="tool-input mono" id="version-${tool.id}" type="text" placeholder="next in sequence">
                </label>
                <label class="tool-field tool-field-wide">
                    <span class="tool-field-label">What changed</span>
                    <input class="tool-input" id="notes-${tool.id}" type="text" placeholder="Short note for whoever downloads this next">
                </label>
            </div>
            <div class="tool-upload-foot">
                <span class="tool-status" id="upstatus-${tool.id}"></span>
                <button class="tool-post" id="post-${tool.id}" onclick="postToolVersion('${tool.id}')">Post version</button>
            </div>
        </div>`;
}

function bindToolUpload(tool) {
    const drop  = document.getElementById(`drop-${tool.id}`);
    const input = document.getElementById(`file-${tool.id}`);
    if (!drop || !input) return;

    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => showPickedFile(tool.id, input.files[0]));

    ['dragenter', 'dragover'].forEach(ev =>
        drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev =>
        drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));

    drop.addEventListener('drop', e => {
        const f = e.dataTransfer.files[0];
        if (!f) return;
        input.files = e.dataTransfer.files;
        showPickedFile(tool.id, f);
    });
}

function showPickedFile(toolId, file) {
    const el = document.getElementById(`dropname-${toolId}`);
    if (!el) return;
    el.innerHTML = file
        ? `<span class="mono">${escHtml(file.name)}</span> &middot; ${(file.size / 1024).toFixed(1)} KB`
        : '';
}

async function postToolVersion(toolId) {
    const input  = document.getElementById(`file-${toolId}`);
    const author = document.getElementById(`author-${toolId}`);
    const verEl  = document.getElementById(`version-${toolId}`);
    const notes  = document.getElementById(`notes-${toolId}`);
    const status = document.getElementById(`upstatus-${toolId}`);
    const btn    = document.getElementById(`post-${toolId}`);

    const file = input?.files?.[0];
    if (!file)                 { setToolStatus(status, 'Pick a file to upload.', 'error'); return; }
    if (!author?.value.trim()) { setToolStatus(status, 'Add your name as the author.', 'error'); author?.focus(); return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Posting...'; }
    setToolStatus(status, 'Posting...', 'muted');

    try {
        const base64 = await fileToBase64(file);
        const resp = await fetch(`${API_BASE}/api/tools/${toolId}/versions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_name: file.name,
                author: author.value.trim(),
                version: verEl?.value.trim() || '',
                notes: notes?.value.trim() || '',
                content_base64: base64
            })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'The server rejected the upload.');

        setToolStatus(status, `Posted as ${data.version}.`, 'ok');
        input.value = '';
        if (verEl) verEl.value = '';
        if (notes) notes.value = '';
        showPickedFile(toolId, null);
        await loadToolVersions(toolId);
    } catch (err) {
        setToolStatus(status, err.message || 'The upload did not go through.', 'error');
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Post version'; }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(new Error('That file could not be read.'));
        r.readAsDataURL(file);
    });
}

function setToolStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg;
    el.className = 'tool-status ' + (kind || '');
}

async function loadToolVersions(toolId) {
    try {
        const resp = await fetch(`${API_BASE}/api/tools/${toolId}/versions`, { cache: 'no-store' });
        const raw  = await resp.json();
        toolboxState[toolId].versions = Array.isArray(raw) ? raw : (raw && raw.version ? [raw] : []);
    } catch {
        toolboxState[toolId].versions = [];
    }

    const list   = toolboxState[toolId].versions || [];
    const latest = list.length ? list[list.length - 1] : null;

    const badge = document.getElementById(`latest-${toolId}`);
    if (badge) badge.innerHTML = latest
        ? `<span class="tool-tag">${escHtml(latest.version)}</span><span class="tool-by">${escHtml(latest.author)} &middot; ${escHtml(latest.uploaded_at)}</span>`
        : `<span class="tool-tag empty">no versions yet</span>`;

    const dl   = document.getElementById(`dl-${toolId}`);
    const text = document.getElementById(`dltext-${toolId}`);
    if (dl) {
        dl.disabled = !latest;
        dl.title = latest ? `Download ${latest.version}` : 'Upload a version first';
    }
    if (text) text.textContent = latest ? `Download ${latest.version}` : 'No version yet';

    const tool = TOOLBOX_ITEMS.find(t => t.id === toolId);
    if (tool && toolboxState[toolId].tab === 'Old versions') paintToolPanel(tool);
}

function renderToolVersions(tool) {
    const list = toolboxState[tool.id].versions;
    if (list === null) return `<div class="tool-empty">Loading versions...</div>`;
    if (!list.length) {
        return `<div class="tool-empty">
                    <div class="tool-empty-title">Nothing here yet</div>
                    <div>Open the Upload tab to post the first version.</div>
                </div>`;
    }

    return `
        <div class="tool-versions">
            ${list.slice().reverse().map((v, i) => `
                <div class="tool-version${i === 0 ? ' current' : ''}">
                    <div class="tool-version-tag"><span class="tool-tag">${escHtml(v.version)}</span>${i === 0 ? '<span class="tool-current-flag">latest</span>' : ''}</div>
                    <div class="tool-version-body">
                        <div class="tool-version-file mono">${escHtml(v.file_name)}</div>
                        <div class="tool-version-meta">${escHtml(v.author)} &middot; ${escHtml(v.uploaded_at)} &middot; ${(v.size / 1024).toFixed(1)} KB</div>
                        ${v.notes ? `<div class="tool-version-notes">${escHtml(v.notes)}</div>` : ''}
                    </div>
                    <div class="tool-version-actions">
                        <button class="tool-mini" onclick="downloadToolVersion('${tool.id}','${escHtml(v.version)}')">Download</button>
                        <button class="tool-mini danger" onclick="deleteToolVersion('${tool.id}','${escHtml(v.version)}')">Delete</button>
                    </div>
                </div>`).join('')}
        </div>`;
}

function downloadToolVersion(toolId, version) {
    const q = version ? `?version=${encodeURIComponent(version)}` : '';
    window.location.href = `${API_BASE}/api/tools/${toolId}/download${q}`;
}

function deleteToolVersion(toolId, version) {
    document.getElementById('tool-confirm-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'tool-confirm-overlay';
    overlay.className = 'stop-note-modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.innerHTML = `
        <div class="stop-note-modal" style="max-width:380px">
            <div class="stop-note-modal-header">
                <div>
                    <div class="stop-note-modal-title">Delete ${escHtml(version)}</div>
                    <div class="stop-note-modal-meta">The file is removed from the server.</div>
                </div>
                <button class="stop-note-modal-close" onclick="document.getElementById('tool-confirm-overlay').remove()">&#x2715;</button>
            </div>
            <div style="font-size:13px;color:var(--neutral-slate-400);margin-bottom:16px;line-height:1.6">
                Anyone who downloads this version from now on will get a 404. This cannot be undone.
            </div>
            <div class="stop-note-modal-footer">
                <button class="btn btn-ghost btn-sm" onclick="document.getElementById('tool-confirm-overlay').remove()">Keep it</button>
                <button class="btn btn-sm" style="background:var(--dark-primary);color:var(--on-primary);border:none"
                        onclick="confirmDeleteToolVersion('${toolId}','${escHtml(version)}')">Delete ${escHtml(version)}</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
}

async function confirmDeleteToolVersion(toolId, version) {
    document.getElementById('tool-confirm-overlay')?.remove();
    try {
        await fetch(`${API_BASE}/api/tools/${toolId}/versions/${encodeURIComponent(version)}`, { method: 'DELETE' });
    } catch {}
    await loadToolVersions(toolId);
}
const dashboardPulseState = { tab: 'Description', list: null };
let _dpPendingUpload = null;

function renderDashboardPulseBox() {
    const mount = document.getElementById('toolbox-extra-mount');
    if (!mount) return;

    mount.innerHTML = `
        <section class="tool-card" id="card-dashboard-pulse">
            <header class="tool-head">
                <div class="tool-glyph"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg></div>
                <div class="tool-ident">
                    <h2 class="tool-name">Dashboard Pulse</h2>
                    <div class="tool-meta">
                        <span class="tool-kind">Dashboard library</span>
                        <span class="tool-dot"></span>
                        <span>Shared JSON dashboards</span>
                        <span class="tool-release" id="dp-count-badge"></span>
                    </div>
                </div>
            </header>
            <nav class="tool-tabs" id="dp-tabs">
                <button class="tool-tab on" data-tab="Description">Description</button>
                <button class="tool-tab" data-tab="Uploaded">Uploaded</button>
                <button class="tool-tab" data-tab="Upload">Upload</button>
            </nav>
            <div class="tool-panel" id="dp-panel"></div>
        </section>`;

    bindDashboardPulseTabs();
    loadDashboardPulseList();
}

function bindDashboardPulseTabs() {
    const tabs = document.getElementById('dp-tabs');
    if (!tabs) return;
    tabs.querySelectorAll('.tool-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            dashboardPulseState.tab = btn.dataset.tab;
            tabs.querySelectorAll('.tool-tab').forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
            paintDashboardPulsePanel();
        });
    });
    paintDashboardPulsePanel();
}

function paintDashboardPulsePanel() {
    const panel = document.getElementById('dp-panel');
    if (!panel) return;
    const tab = dashboardPulseState.tab;

    if (tab === 'Description') {
        panel.innerHTML = `<div class="tool-prose"><p>Dashboard Pulse, for helping analysts with their work.</p></div>`;
        return;
    }
    if (tab === 'Uploaded') { panel.innerHTML = renderDashboardPulseList(); return; }
    if (tab === 'Upload')   { panel.innerHTML = renderDashboardPulseUpload(); bindDashboardPulseUpload(); return; }
}

async function loadDashboardPulseList() {
    try {
        const resp = await fetch(`${API_BASE}/api/dashboards`);
        const raw  = resp.ok ? await resp.json() : [];
        dashboardPulseState.list = Array.isArray(raw) ? raw : [];
    } catch {
        dashboardPulseState.list = [];
    }

    const badge = document.getElementById('dp-count-badge');
    const n = (dashboardPulseState.list || []).length;
    if (badge) badge.innerHTML = n
        ? `<span class="tool-tag">${n} uploaded</span>`
        : `<span class="tool-tag empty">no dashboards yet</span>`;

    if (dashboardPulseState.tab === 'Uploaded') paintDashboardPulsePanel();
}

function renderDashboardPulseList() {
    const list = dashboardPulseState.list;
    if (list === null) return `<div class="tool-empty">Loading dashboards...</div>`;
    if (!list.length) {
        return `<div class="tool-empty">
                    <div class="tool-empty-title">Nothing here yet</div>
                    <div>Open the Upload tab to post the first dashboard.</div>
                </div>`;
    }

    return `
        <div class="tool-versions">
            ${list.map(d => `
                <div class="tool-version">
                    <div class="tool-version-tag"><span class="tool-tag mono">${escHtml(d.file)}</span></div>
                    <div class="tool-version-body">
                        <div class="tool-version-meta">${escHtml(d.author || 'unknown')} &middot; ${escHtml(d.uploaded_at || '')}</div>
                        ${d.description ? `<div class="tool-version-notes">${escHtml(d.description)}</div>` : ''}
                    </div>
                    <div class="tool-version-actions">
                        <button class="tool-mini" onclick="downloadDashboardPulseFile('${encodeURIComponent(d.file)}')">Download</button>
                        <button class="tool-mini danger" onclick="deleteDashboardPulseFile('${encodeURIComponent(d.file)}')">Remove</button>
                    </div>
                </div>`).join('')}
        </div>`;
}

function renderDashboardPulseUpload() {
    return `
        <div class="tool-upload">
            <div class="tool-drop" id="dp-drop">
                <svg class="tool-drop-glyph" viewBox="0 0 24 24"><path d="M12 16V4"/><polyline points="7 9 12 4 17 9"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
                <div class="tool-drop-text">Drop the JSON dashboard here, or <span class="tool-drop-link">browse</span></div>
                <div class="tool-drop-hint">Dashboard JSON exported for the team.</div>
                <div class="tool-drop-file" id="dp-dropname"></div>
                <input type="file" id="dp-file" class="hidden" accept=".json,application/json">
            </div>
            <div class="tool-fields">
                <label class="tool-field">
                    <span class="tool-field-label">Author <b class="tool-req">required</b></span>
                    <input class="tool-input" id="dp-author" type="text" placeholder="Your name">
                </label>
                <label class="tool-field tool-field-wide">
                    <span class="tool-field-label">Description <b class="tool-req">required</b></span>
                    <input class="tool-input" id="dp-desc" type="text" placeholder="What is this dashboard for?">
                </label>
            </div>
            <div class="tool-upload-foot">
                <span class="tool-status" id="dp-upstatus"></span>
                <button class="tool-post" id="dp-post" onclick="postDashboardPulse()">Post dashboard</button>
            </div>
        </div>`;
}

function bindDashboardPulseUpload() {
    const drop  = document.getElementById('dp-drop');
    const input = document.getElementById('dp-file');
    if (!drop || !input) return;

    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => showDashboardPulsePickedFile(input.files[0]));

    ['dragenter', 'dragover'].forEach(ev =>
        drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev =>
        drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));

    drop.addEventListener('drop', e => {
        const f = e.dataTransfer.files[0];
        if (!f) return;
        input.files = e.dataTransfer.files;
        showDashboardPulsePickedFile(f);
    });
}

function showDashboardPulsePickedFile(file) {
    const el = document.getElementById('dp-dropname');
    if (!el) return;
    el.innerHTML = file
        ? `<span class="mono">${escHtml(file.name)}</span> &middot; ${(file.size / 1024).toFixed(1)} KB`
        : '';
}

function postDashboardPulse() {
    const input  = document.getElementById('dp-file');
    const author = document.getElementById('dp-author');
    const desc   = document.getElementById('dp-desc');
    const status = document.getElementById('dp-upstatus');

    const file = input?.files?.[0];
    if (!file)                 { setToolStatus(status, 'Pick a JSON file to upload.', 'error'); return; }
    if (!author?.value.trim()) { setToolStatus(status, 'Add your name as the author.', 'error'); author?.focus(); return; }
    if (!desc?.value.trim())   { setToolStatus(status, 'Add a short description.', 'error'); desc?.focus(); return; }

    const reader = new FileReader();
    reader.onload = () => {
        const content = reader.result;
        try {
            JSON.parse(content);
        } catch {
            setToolStatus(status, 'That file is not valid JSON.', 'error');
            return;
        }

        const filename = file.name.toLowerCase().endsWith('.json') ? file.name : `${file.name}.json`;
        const exists = (dashboardPulseState.list || []).some(d => d.file.toLowerCase() === filename.toLowerCase());

        _dpPendingUpload = { filename, content, description: desc.value.trim(), author: author.value.trim() };

        if (exists) confirmReplaceDashboardPulse(filename);
        else submitDashboardPulse();
    };
    reader.onerror = () => setToolStatus(status, 'Could not read the file.', 'error');
    reader.readAsText(file);
}

async function submitDashboardPulse() {
    if (!_dpPendingUpload) return;
    const status = document.getElementById('dp-upstatus');
    const btn    = document.getElementById('dp-post');
    if (btn) { btn.disabled = true; btn.textContent = 'Posting...'; }
    setToolStatus(status, 'Posting...', 'muted');

    try {
        const resp = await fetch(`${API_BASE}/api/dashboards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_dpPendingUpload)
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.success) {
            setToolStatus(status, 'Posted.', 'ok');
            _dpPendingUpload = null;
            const input = document.getElementById('dp-file');
            const author = document.getElementById('dp-author');
            const desc = document.getElementById('dp-desc');
            if (input) input.value = '';
            if (author) author.value = '';
            if (desc) desc.value = '';
            showDashboardPulsePickedFile(null);
            await loadDashboardPulseList();
        } else {
            setToolStatus(status, data.error || 'The upload did not go through.', 'error');
        }
    } catch {
        setToolStatus(status, 'The upload did not go through.', 'error');
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Post dashboard'; }
}

function confirmReplaceDashboardPulse(filename) {
    document.getElementById('tool-confirm-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'tool-confirm-overlay';
    overlay.className = 'stop-note-modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.innerHTML = `
        <div class="stop-note-modal" style="max-width:380px">
            <div class="stop-note-modal-header">
                <div>
                    <div class="stop-note-modal-title">Replace ${escHtml(filename)}?</div>
                    <div class="stop-note-modal-meta">A dashboard with this file name already exists.</div>
                </div>
                <button class="stop-note-modal-close" onclick="document.getElementById('tool-confirm-overlay').remove()">&#x2715;</button>
            </div>
            <div style="font-size:13px;color:var(--neutral-slate-400);margin-bottom:16px;line-height:1.6">
                Uploading now will overwrite the existing file and its description/author.
            </div>
            <div class="stop-note-modal-footer">
                <button class="btn btn-ghost btn-sm" onclick="document.getElementById('tool-confirm-overlay').remove()">Cancel</button>
                <button class="btn btn-sm" style="background:var(--dark-primary);color:var(--on-primary);border:none"
                        onclick="document.getElementById('tool-confirm-overlay').remove();submitDashboardPulse()">Replace</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
}

function downloadDashboardPulseFile(encodedFilename) {
    window.location.href = `${API_BASE}/api/dashboards/file/${encodedFilename}`;
}

function deleteDashboardPulseFile(encodedFilename) {
    const filename = decodeURIComponent(encodedFilename);
    document.getElementById('tool-confirm-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'tool-confirm-overlay';
    overlay.className = 'stop-note-modal-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.innerHTML = `
        <div class="stop-note-modal" style="max-width:380px">
            <div class="stop-note-modal-header">
                <div>
                    <div class="stop-note-modal-title">Remove ${escHtml(filename)}</div>
                    <div class="stop-note-modal-meta">The file is removed from the server.</div>
                </div>
                <button class="stop-note-modal-close" onclick="document.getElementById('tool-confirm-overlay').remove()">&#x2715;</button>
            </div>
            <div style="font-size:13px;color:var(--neutral-slate-400);margin-bottom:16px;line-height:1.6">
                This cannot be undone.
            </div>
            <div class="stop-note-modal-footer">
                <button class="btn btn-ghost btn-sm" onclick="document.getElementById('tool-confirm-overlay').remove()">Keep it</button>
                <button class="btn btn-sm" style="background:var(--dark-primary);color:var(--on-primary);border:none"
                        onclick="confirmDeleteDashboardPulseFile('${encodedFilename}')">Remove</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
}

async function confirmDeleteDashboardPulseFile(encodedFilename) {
    document.getElementById('tool-confirm-overlay')?.remove();
    try {
        await fetch(`${API_BASE}/api/dashboards/${encodedFilename}`, { method: 'DELETE' });
    } catch {}
    await loadDashboardPulseList();
}