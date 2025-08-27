const STORAGE_KEY = 'statsByDay';

async function loadStats() {
    const { [STORAGE_KEY]: stats = {} } = await chrome.storage.local.get(STORAGE_KEY);
    return stats; // { day: { domain: seconds } }
}

function filterRange(stats, range) {
    const days = Object.keys(stats).sort();
    if (range === 'today') {
        const today = new Date().toISOString().slice(0, 10);
        return days.filter(d => d === today);
    }
    if (range === 'all') return days;
    const n = parseInt(range, 10);
    const cutoff = daysAgo(n);
    return days.filter(d => d >= cutoff);
}

async function render() {
    const stats = await loadStats();
    const days = Object.keys(stats).sort();
    const tbody = document.getElementById('rows');
    tbody.innerHTML = '';

    // Display table rows
    for (const day of days) {
        const byDomain = stats[day] || {};
        for (const [domain, seconds] of Object.entries(byDomain)) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${day}</td><td>${domain}</td><td>${seconds}</td>`;
            tbody.appendChild(tr);
        }
    }
}

async function sync() {
    
}

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

async function resetData() {
    if (confirm('Delete all tracked time data? This cannot be undone.')) {
        await chrome.storage.local.remove(STORAGE_KEY);
        await render();
    }
}

// Wire up
document.getElementById('exportJson').addEventListener('click', exportJson);
document.getElementById('reset').addEventListener('click', resetData);

render();
