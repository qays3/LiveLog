function startPolling(intervalMs, callback) {
    callback();
    return setInterval(callback, intervalMs);
}

function stopPolling(id) {
    clearInterval(id);
}

async function fetchJson(url) {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    return resp.json();
}

async function fetchAllCollectorFiles(domainsDir, domainFiles) {
    const seen = new Set();
    const urls = [];

    domainFiles.forEach(f => {
        const d = f.domain_group.replace(/[\\/:*?"<>|]/g, '_');
        const c = f.collector_name.replace(/[\\/:*?"<>|]/g, '_');
        const url = `${domainsDir}/${d}/${c}.json`;
        if (!seen.has(url)) {
            seen.add(url);
            urls.push(url);
        }
    });

    const results = await Promise.allSettled(urls.map(u => fetchJson(u)));
    return results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);
}