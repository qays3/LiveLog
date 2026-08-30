function getCSSVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getBucketColors() {
    return BUCKET_ORDER.map((_, i) => getCSSVar('--bucket-' + i) || getCSSVar('--bucket-fallback'));
}

function getBucketColorFor(key) {
    const idx = BUCKET_ORDER.indexOf(key);
    if (idx < 0) return getCSSVar('--bucket-fallback');
    return getCSSVar('--bucket-' + idx) || getCSSVar('--bucket-fallback');
}

function drawBucketChart(canvasId, buckets, threshold) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const order = activeBuckets(buckets);

    const dpr = window.devicePixelRatio || 1;
    const w   = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 800;
    const h   = order.length > 14 ? 290 : 260;
    canvas.style.height = h + 'px';
    canvas.width  = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (order.length === 0) {
        ctx.fillStyle = getCSSVar('--canvas-axis-label');
        ctx.font = '12px Inter,system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No gap history yet', w / 2, h / 2);
        return;
    }

    const values = order.map(k => buckets[k] || 0);
    const maxVal = Math.max(...values, 1);

    const rotate = order.length > 14;
    const padL = 56, padR = 24, padT = 24;
    const padB = rotate ? 62 : 42;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;
    const n      = order.length;
    const slotW  = chartW / n;
    const barW   = Math.max(6, Math.min(64, Math.floor(slotW * 0.62)));

    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
        const y   = padT + (chartH / gridSteps) * i;
        const val = Math.round(maxVal * (1 - i / gridSteps));
        ctx.beginPath();
        ctx.strokeStyle = i === gridSteps ? getCSSVar('--canvas-grid-base') : getCSSVar('--canvas-grid-minor');
        ctx.lineWidth = 1;
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.fillStyle = getCSSVar('--canvas-axis-label');
        ctx.font = '10px Inter,system-ui,sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val, padL - 10, y);
    }

    order.forEach((key, i) => {
        const val   = values[i];
        const color = getBucketColorFor(key);
        const cx    = padL + i * slotW + slotW / 2;
        const x     = cx - barW / 2;
        const barH  = Math.max(4, Math.round((val / maxVal) * chartH));
        const y     = padT + chartH - barH;
        const baseY = padT + chartH;

        const grad = ctx.createLinearGradient(0, y, 0, baseY);
        grad.addColorStop(0, color + 'ff');
        grad.addColorStop(1, color + '44');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
        ctx.fill();

        ctx.strokeStyle = color + '88';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
        ctx.stroke();

        if (barW >= 16) {
            ctx.fillStyle = getCSSVar('--canvas-bar-label');
            ctx.font = 'bold 10px Inter,system-ui,sans-serif';
            ctx.textAlign = 'center';
            if (barH > 24) {
                ctx.textBaseline = 'middle';
                ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val, cx, y + barH / 2);
            } else {
                ctx.textBaseline = 'bottom';
                ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val, cx, y - 3);
            }
        }

        ctx.fillStyle = color;
        ctx.font = '600 10px Inter,system-ui,sans-serif';
        if (rotate) {
            ctx.save();
            ctx.translate(cx, baseY + 8);
            ctx.rotate(-Math.PI / 4);
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(key, 0, 0);
            ctx.restore();
        } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(key, cx, baseY + 8);
        }
    });
}

function drawEpsSparkline(canvasId, epsHistory) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !epsHistory || epsHistory.length < 2) return;
    const ctx  = canvas.getContext('2d');
    const w    = canvas.width;
    const h    = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const max  = Math.max(...epsHistory, 1);
    const step = w / (epsHistory.length - 1);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, getCSSVar('--canvas-eps-fill-start'));
    grad.addColorStop(1, getCSSVar('--canvas-eps-fill-end'));
    ctx.beginPath();
    epsHistory.forEach((val, i) => {
        const x = i * step;
        const y = h - (val / max) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = getCSSVar('--canvas-eps-stroke');
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineTo((epsHistory.length - 1) * step, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
}

function drawDailyChart(canvasId, dailyBuckets) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    const present = BUCKET_ORDER.filter(k =>
        days.some(d => dailyBuckets[d] && (dailyBuckets[d][k] || 0) > 0));

    const dpr = window.devicePixelRatio || 1;
    const w   = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 800;
    const h   = 220;
    canvas.style.height = h + 'px';
    canvas.width  = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (present.length === 0) {
        ctx.fillStyle = getCSSVar('--canvas-axis-label');
        ctx.font = '12px Inter,system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No daily data yet', w / 2, h / 2);
        return;
    }

    const padL = 56, padR = 24, padT = 20, padB = 40;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;

    const dayTotals = days.map(day => {
        const db = dailyBuckets[day];
        if (!db) return 0;
        return present.reduce((s, k) => s + (db[k] || 0), 0);
    });
    const maxTotal = Math.max(...dayTotals, 1);

    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
        const y   = padT + (chartH / gridSteps) * i;
        const val = Math.round(maxTotal * (1 - i / gridSteps));
        ctx.beginPath();
        ctx.strokeStyle = i === gridSteps ? getCSSVar('--canvas-grid-base') : getCSSVar('--canvas-grid-minor');
        ctx.lineWidth = 1;
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.fillStyle = getCSSVar('--canvas-axis-label');
        ctx.font = '10px Inter,system-ui,sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val, padL - 10, y);
    }

    const slotW  = chartW / days.length;
    const groupW = slotW * 0.78;

    days.forEach((day, di) => {
        const db    = dailyBuckets[day];
        const total = dayTotals[di];
        const cx    = padL + di * slotW + slotW / 2;

        if (!db || total === 0) {
            ctx.fillStyle = getCSSVar('--canvas-grid-minor');
            ctx.beginPath();
            ctx.roundRect(cx - groupW / 2, padT + chartH - 3, groupW, 3, 1);
            ctx.fill();
        } else {
            const gap     = present.length > 20 ? 0 : (present.length > 12 ? 1 : 2);
            const bucketW = Math.max(2, (groupW - gap * (present.length - 1)) / present.length);
            const totalW  = bucketW * present.length + gap * (present.length - 1);
            let bx = cx - totalW / 2;

            present.forEach(bk => {
                const val   = db[bk] || 0;
                const color = getBucketColorFor(bk);
                const barH  = val > 0 ? Math.max(3, Math.round((val / maxTotal) * chartH)) : 0;
                const by    = padT + chartH - barH;

                if (val > 0) {
                    const grad = ctx.createLinearGradient(0, by, 0, padT + chartH);
                    grad.addColorStop(0, color + 'ff');
                    grad.addColorStop(1, color + '44');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.roundRect(bx, by, bucketW, barH, [2, 2, 0, 0]);
                    ctx.fill();
                } else {
                    ctx.fillStyle = color + '18';
                    ctx.beginPath();
                    ctx.roundRect(bx, padT + chartH - 2, bucketW, 2, 0);
                    ctx.fill();
                }
                bx += bucketW + gap;
            });

            ctx.fillStyle = getCSSVar('--canvas-bar-label-soft');
            ctx.font = '9px Inter,system-ui,sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(total, cx, padT + chartH + 3);
        }

        ctx.fillStyle = total > 0 ? getCSSVar('--canvas-day-label-active') : getCSSVar('--canvas-day-label-inactive');
        ctx.font = (total > 0 ? '600 ' : '') + '10px Inter,system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(day.slice(0, 3), cx, padT + chartH + (total > 0 ? 15 : 6));
    });
}

let _selectedDay = null;
let _dailyBucketsRef = {};

function renderDailyLegend(legendId, dailyBuckets) {
    const el = document.getElementById(legendId);
    if (!el) return;
    _dailyBucketsRef = dailyBuckets;

    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const hasAny = days.some(d => {
        const db = dailyBuckets[d];
        return db && BUCKET_ORDER.some(k => (db[k] || 0) > 0);
    });

    if (!hasAny) {
        el.innerHTML = `<div style="font-size:11px;color:var(--neutral-slate-600);padding:4px 0">No daily data yet, accumulates from live polling.</div>`;
        return;
    }

    el.innerHTML =
        `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:8px" id="daily-day-cards">` +
        days.map(day => {
            const db    = dailyBuckets[day] || {};
            const total = BUCKET_ORDER.reduce((s, k) => s + (db[k] || 0), 0);
            const dom   = total > 0 ? activeBuckets(db).reduce((best, k) => (db[k] || 0) > (db[best] || 0) ? k : best, activeBuckets(db)[0]) : null;
            const domColor = dom ? getBucketColorFor(dom) : null;
            return `<div data-day="${day}" onclick="selectDailyDay('${day}')" style="
                background:${dom ? domColor + '18' : 'var(--bucket-empty-bg)'};
                border:1px solid ${dom ? domColor + '44' : 'var(--bucket-empty-border)'};
                border-radius:6px;padding:8px;text-align:center;
                cursor:${total > 0 ? 'pointer' : 'default'};
                transition:border-color 0.15s,transform 0.15s">
                <div style="font-size:11px;font-weight:600;color:${total > 0 ? 'var(--bucket-label-active)' : 'var(--bucket-label-inactive)'};margin-bottom:4px">${day.slice(0,3)}</div>
                ${dom ? `<div style="font-size:12px;font-weight:700;color:${domColor}">${dom}</div>
                <div style="font-size:10px;color:var(--neutral-slate-500);margin-top:2px">${total} gaps</div>` :
                `<div style="font-size:11px;color:var(--bucket-value-inactive)">-</div>`}
            </div>`;
        }).join('') +
        `</div>
        <div id="daily-drill" style="margin-top:12px"></div>`;

    if (_selectedDay) {
        const stillHasData = dailyBuckets[_selectedDay] &&
            BUCKET_ORDER.some(k => (dailyBuckets[_selectedDay][k] || 0) > 0);
        if (stillHasData) {
            const keep = _selectedDay;
            _selectedDay = null;
            selectDailyDay(keep);
        } else {
            _selectedDay = null;
        }
    }
}

function selectDailyDay(day) {
    const db = _dailyBucketsRef[day];
    if (!db) return;

    const present = activeBuckets(db);
    const total   = present.reduce((s, k) => s + (db[k] || 0), 0);
    if (total === 0) return;

    if (_selectedDay === day) {
        _selectedDay = null;
        const drillEl = document.getElementById('daily-drill');
        if (drillEl) drillEl.innerHTML = '';
        document.querySelectorAll('#daily-day-cards [data-day]').forEach(c => {
            c.style.outline = '';
            c.style.transform = '';
        });
        return;
    }

    _selectedDay = day;

    document.querySelectorAll('#daily-day-cards [data-day]').forEach(c => {
        c.style.outline = '';
        c.style.transform = '';
    });
    const activeCard = document.querySelector(`#daily-day-cards [data-day="${day}"]`);
    if (activeCard) {
        activeCard.style.outline = '2px solid var(--dark-accent)';
        activeCard.style.transform = 'translateY(-2px)';
    }

    const drill = document.getElementById('daily-drill');
    if (!drill) return;

    drill.innerHTML =
        `<div style="font-size:11px;font-weight:600;color:var(--neutral-slate-500);letter-spacing:.05em;margin-bottom:8px">
            ${day.toUpperCase()} - ${total} gaps
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px">` +
        present.map(k => {
            const v   = db[k] || 0;
            const pct = ((v / total) * 100).toFixed(1) + '%';
            const c   = getBucketColorFor(k);
            return `<div style="
                background:${c}18;
                border:1px solid ${c}55;
                border-radius:6px;padding:6px 8px;display:flex;flex-direction:column;gap:2px">
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