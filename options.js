const STORAGE_KEYS = {
    STATS: 'statsByDay',
    LAST_UPLOAD: 'lastUploadIso',
    UPLOAD_URL: 'uploadUrl',
    DEVICE_NAME: 'deviceName',
};

// TODO: add card for displaying data in home, expose endpoint and make sure it works, check what data is sent, make endpoint understand this data

// ---------- Data ----------
async function loadStats() {
    const { [STORAGE_KEYS.STATS]: stats = {} } = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    return stats; // { day: { domain: seconds } }
}

// ---------- UI: Unsent table ----------
async function render() {
    const stats = await loadStats();
    const days = Object.keys(stats).sort();
    const tbody = document.getElementById('rows');
    tbody.innerHTML = '';

    for (const day of days) {
        const byDomain = stats[day] || {};
        for (const [domain, seconds] of Object.entries(byDomain)) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${day}</td><td>${domain}</td><td>${seconds}</td>`;
            tbody.appendChild(tr);
        }
    }
}

// ---------- UI: Last upload ----------
async function renderLastUpload() {
    const { [STORAGE_KEYS.LAST_UPLOAD]: iso } = await chrome.storage.local.get(STORAGE_KEYS.LAST_UPLOAD);
    const target =
        document.getElementById('lastUpload') ||
        // fallback: the second .info-text inside the "Data Upload Info" line
        document.querySelector('.section h3 + div .info-text:nth-of-type(2)');

    if (!target) return;

    if (!iso) {
        target.textContent = '—';
        target.title = 'No uploads yet';
        return;
    }

    // Display local time nicely, keep ISO in title
    const d = new Date(iso);
    target.textContent = d.toLocaleString();
    target.title = iso;
}

// ---------- Export JSON ----------
async function exportJson() {
    console.log("Exporting all JSON");
    const stats = await loadStats();
    const days = Object.keys(stats).sort();

    const rows = [];
    for (const day of days) {
        const byDomain = stats[day] || {};
        for (const [domain, seconds] of Object.entries(byDomain)) {
            rows.push({ date: day, domain, seconds });
        }
    }

    rows.sort((a, b) =>
        a.date === b.date ? a.domain.localeCompare(b.domain) : a.date.localeCompare(b.date)
    );

    download(`domain-time.json`, JSON.stringify(rows, null, 2));
}

function download(filename, content) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// ---------- Reset ----------
async function resetData() {
    if (confirm('Delete all tracked time data? This cannot be undone.')) {
        await chrome.storage.local.remove(STORAGE_KEYS.STATS);
        await render();
    }
}

// ---------- Settings: load & save ----------
async function loadSettings() {
    const { [STORAGE_KEYS.UPLOAD_URL]: uploadUrl = '', [STORAGE_KEYS.DEVICE_NAME]: deviceName = '' } =
        await chrome.storage.local.get([STORAGE_KEYS.UPLOAD_URL, STORAGE_KEYS.DEVICE_NAME]);

    const urlInput = document.getElementById('uploadUrl');
    const deviceInput = document.getElementById('deviceName');
    if (urlInput) urlInput.value = uploadUrl;
    if (deviceInput) deviceInput.value = deviceName;
}

async function saveUploadUrl() {
    const urlInput = document.getElementById('uploadUrl');
    if (!urlInput) return;
    const value = urlInput.value.trim();
    await chrome.storage.local.set({ [STORAGE_KEYS.UPLOAD_URL]: value });
    console.log('[Options] Saved uploadUrl:', value);
}

async function saveDeviceName() {
    const deviceInput = document.getElementById('deviceName');
    if (!deviceInput) return;
    const value = deviceInput.value.trim();
    await chrome.storage.local.set({ [STORAGE_KEYS.DEVICE_NAME]: value });
    console.log('[Options] Saved deviceName:', value);
}

// ---------- Wire up ----------
document.addEventListener('DOMContentLoaded', () => {
    // buttons
    const exportBtn = document.getElementById('exportJson');
    if (exportBtn) exportBtn.addEventListener('click', exportJson);

    const resetBtn = document.getElementById('reset');
    if (resetBtn) resetBtn.addEventListener('click', resetData);

    const saveUrlBtn = document.getElementById('saveUrl');
    if (saveUrlBtn) saveUrlBtn.addEventListener('click', saveUploadUrl);

    const saveDeviceBtn = document.getElementById('saveDevice');
    if (saveDeviceBtn) saveDeviceBtn.addEventListener('click', saveDeviceName);

    // initial renders
    render();
    renderLastUpload();
    loadSettings();
});