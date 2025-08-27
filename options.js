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
    const range = document.getElementById('range').value;
    const stats = await loadStats();
    const days = filterRange(stats, range);
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

async function exportCsv() {
    console.log("Exporting CSV");
    const range = document.getElementById('range').value;
    const stats = await loadStats();
    const days = filterRange(stats, range);

    // Detailed daily CSV
    const detailedRows = [['date', 'domain', 'seconds']];
    const totals = {}; // aggregate across selected range

    for (const day of days) {
        const byDomain = stats[day] || {};
        for (const [domain, seconds] of Object.entries(byDomain)) {
            detailedRows.push([day, domain, seconds]);
            totals[domain] = (totals[domain] || 0) + seconds;
        }
    }

    const aggregateRows = [['domain', 'seconds']];
    for (const [domain, seconds] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
        aggregateRows.push([domain, seconds]);
    }

    download(`domain-time-detailed-${range}.csv`, makeCsv(detailedRows));
    download(`domain-time-aggregate-${range}.csv`, makeCsv(aggregateRows));
}

async function resetData() {
    if (confirm('Delete all tracked time data? This cannot be undone.')) {
        await chrome.storage.local.remove(STORAGE_KEY);
        await render();
    }
}

// Wire up

document.getElementById('range').addEventListener('change', render);
document.getElementById('exportCsv').addEventListener('click', exportCsv);
document.getElementById('reset').addEventListener('click', resetData);

render();
