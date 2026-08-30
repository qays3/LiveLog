const BUCKET_ORDER = (() => {
    const arr = ['5m', '10m', '20m', '30m', '40m', '50m'];
    for (let h = 1; h <= 23; h++) arr.push(h + 'h');
    for (let d = 1; d <= 30; d++) arr.push(d + 'd');
    arr.push('>30d');
    return arr;
})();

const BUCKET_THRESHOLD_MIN = (() => {
    const map = { '5m': 5, '10m': 10, '20m': 20, '30m': 30, '40m': 40, '50m': 50 };
    for (let h = 1; h <= 23; h++) map[h + 'h'] = h * 60;
    for (let d = 1; d <= 30; d++) map[d + 'd'] = d * 1440;
    map['>30d'] = Infinity;
    return map;
})();

function bucketFromMs(ms) {
    if (!ms || ms <= 0) return null;
    const min = ms / 60000;
    if (min > 30 * 1440) return '>30d';

    let best = null;
    let bestDiff = Infinity;
    for (const k of BUCKET_ORDER) {
        const t = BUCKET_THRESHOLD_MIN[k];
        if (!isFinite(t)) continue;
        const diff = Math.abs(min - t);
        if (diff <= bestDiff) { bestDiff = diff; best = k; }
    }
    return best;
}

function getLiveCurrentBucket(lastEventMs) {
    if (!lastEventMs || lastEventMs <= 0) return null;
    return bucketFromMs(Date.now() - lastEventMs);
}

const LEGACY_BUCKET_MIN = {
    '5min': 5, '10min': 10, '15min': 15, '20min': 20, '30min': 30,
    '1hr': 60, '2hr': 120, '4hr': 240, '8hr': 480, '12hr': 720
};

function normalizeBuckets(buckets) {
    if (!buckets) return null;
    const out = emptyBuckets();
    let legacy = false;
    Object.keys(buckets).forEach(k => {
        const v = buckets[k] || 0;
        if (v <= 0) return;
        if (BUCKET_THRESHOLD_MIN[k] !== undefined) {
            out[k] += v;
        } else if (LEGACY_BUCKET_MIN[k] !== undefined) {
            legacy = true;
            const nk = bucketFromMs(LEGACY_BUCKET_MIN[k] * 60000);
            if (nk) out[nk] += v;
        }
    });
    return legacy ? out : buckets;
}

function normalizeDailyBuckets(daily) {
    if (!daily) return daily;
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const out = {};
    days.forEach(d => { out[d] = normalizeBuckets(daily[d]) || emptyBuckets(); });
    return out;
}

function normalizeSource(src) {
    if (!src) return src;
    src.buckets = normalizeBuckets(src.buckets) || emptyBuckets();
    src.daily_buckets = normalizeDailyBuckets(src.daily_buckets);
    if (src.last_event_ms > 0) src.current_bucket = getLiveCurrentBucket(src.last_event_ms);
    return src;
}

function totalBucketCount(buckets) {
    if (!buckets) return 0;
    return BUCKET_ORDER.reduce((sum, k) => sum + (buckets[k] || 0), 0);
}

function activeBuckets(buckets) {
    if (!buckets) return [];
    return BUCKET_ORDER.filter(k => (buckets[k] || 0) > 0);
}

function maxBucket(buckets) {
    if (!buckets) return null;
    const minCount = (typeof state !== 'undefined' && state.alertMaxBucketMinCount) ? state.alertMaxBucketMinCount : 4;
    for (let i = BUCKET_ORDER.length - 1; i >= 0; i--) {
        if ((buckets[BUCKET_ORDER[i]] || 0) >= minCount) return BUCKET_ORDER[i];
    }
    for (let i = BUCKET_ORDER.length - 1; i >= 0; i--) {
        if ((buckets[BUCKET_ORDER[i]] || 0) > 0) return BUCKET_ORDER[i];
    }
    return null;
}

function dominantBucket(buckets) {
    if (!buckets) return null;
    const nonZero = activeBuckets(buckets);
    if (nonZero.length === 0) return null;
    if (nonZero.length === 1) return nonZero[0];

    let modeBucket = nonZero[0];
    let modeCount  = buckets[nonZero[0]] || 0;
    for (const k of nonZero) {
        const c = buckets[k] || 0;
        if (c > modeCount) { modeCount = c; modeBucket = k; }
    }

    const max = maxBucket(buckets);
    if (max) {
        const modeIdx = BUCKET_ORDER.indexOf(modeBucket);
        const maxIdx  = BUCKET_ORDER.indexOf(max);
        if (modeIdx > maxIdx) return max;
    }
    return modeBucket;
}

function bucketSeverity(currentBucket, threshold, buckets) {
    if (!currentBucket) return 'neutral';
    const alarm = maxBucket(buckets);
    if (!alarm) return 'neutral';
    const curIdx   = BUCKET_ORDER.indexOf(currentBucket);
    const alarmIdx = BUCKET_ORDER.indexOf(alarm);
    if (curIdx > alarmIdx) return 'alarm';
    return 'ok';
}

function getBucketClass(currentBucket, threshold, buckets) {
    const sev = bucketSeverity(currentBucket, threshold, buckets);
    if (sev === 'alarm')   return 'breach';
    if (sev === 'neutral') return 'neutral';
    return 'ok';
}

function emptyBuckets() {
    return BUCKET_ORDER.reduce((acc, k) => { acc[k] = 0; return acc; }, {});
}

function liveBucketSeverity(source) {
    const bufferMin = (typeof state !== 'undefined' && state.alertBufferMin) ? state.alertBufferMin : 0;

    const override = getOverride(source.id);
    if (override !== null && override > 0) {
        if (!source.last_event_ms || source.last_event_ms <= 0) return 'neutral';
        const diffMs   = Date.now() - source.last_event_ms;
        const bufferMs = bufferMin * 60000;
        if (diffMs > override + bufferMs) return 'alarm';
        return 'ok';
    }

    const alarm = maxBucket(source.buckets);
    if (!alarm) return 'neutral';
    if (!source.last_event_ms || source.last_event_ms <= 0) return 'neutral';

    const maxThreshMin = BUCKET_THRESHOLD_MIN[alarm];
    if (maxThreshMin === undefined) return 'neutral';
    if (!isFinite(maxThreshMin)) return 'ok';

    const minAlertMin = (typeof state !== 'undefined' && state.minAlertMinutes) ? state.minAlertMinutes : 0;
    const effectiveThreshMin = Math.max(maxThreshMin, minAlertMin);

    const diffMin = (Date.now() - source.last_event_ms) / 60000;
    if (diffMin > effectiveThreshMin + bufferMin) return 'alarm';
    return 'ok';
}

function parseQradarThresholdMin(threshold) {
    if (!threshold || threshold === 'undefined') return null;
    const t = String(threshold).trim();
    const more = t.match(/^More than\s+(\d+)\s*([MHD])$/i);
    const plain = t.match(/^(\d+)\s*([MHD])$/i);
    const m = more || plain;
    if (!m) return null;
    const n    = parseInt(m[1], 10);
    const unit = m[2].toUpperCase();
    if (unit === 'M') return n;
    if (unit === 'H') return n * 60;
    if (unit === 'D') return n * 1440;
    return null;
}

function qradarThresholdSeverity(source) {
    const threshMin = parseQradarThresholdMin(source.behavior_threshold);
    if (threshMin === null) return 'neutral';
    if (!source.last_event_ms || source.last_event_ms <= 0) return 'neutral';

    const bufferMin = (typeof state !== 'undefined' && state.alertBufferMin) ? state.alertBufferMin : 0;
    const minAlertMin = (typeof state !== 'undefined' && state.minAlertMinutes) ? state.minAlertMinutes : 0;
    const effectiveThreshMin = Math.max(threshMin, minAlertMin);
    const diffMin   = (Date.now() - source.last_event_ms) / 60000;

    if (diffMin > effectiveThreshMin + bufferMin) return 'alarm';
    return 'ok';
}