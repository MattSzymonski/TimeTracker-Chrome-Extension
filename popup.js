const STORAGE_KEY = 'statsByDay';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const parts = [];
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (!h && !m) parts.push(`${s} sec`);
  return parts.join(' ');
}

// --- helper: ensure a <pre id="stateDebug"> exists under #current ---
function ensureDebugPre() {
  let pre = document.getElementById('stateDebug');
  if (!pre) {
    pre = document.createElement('pre');
    pre.id = 'stateDebug';
    pre.style.margin = '6px 0 0 0';
    pre.style.padding = '8px';
    pre.style.background = '#f6f6f6';
    pre.style.border = '1px solid #eee';
    pre.style.borderRadius = '6px';
    pre.style.fontSize = '11px';
    const currentEl = document.getElementById('current');
    currentEl.insertAdjacentElement('afterend', pre);
  }
  return pre;
}

async function render() {
  const day = todayKey();
  const { [STORAGE_KEY]: stats = {} } = await chrome.storage.local.get(STORAGE_KEY);
  const map = stats[day] || {};

  // Add the currently running session's elapsed time (if any) so the numbers feel live
  const current = await chrome.runtime.sendMessage({ type: 'getCurrentTracking' }).catch(() => null);
  if (current?.domain && current?.elapsedSeconds && current?.elapsedSeconds > 0) {
    map[current.domain] = (map[current.domain] || 0) + current.elapsedSeconds;
  }

  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';

  let total = 0;
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  for (const [domain, seconds] of entries) {
    total += seconds;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${domain}</td><td>${fmt(seconds)}</td>`;
    tbody.appendChild(tr);
  }

  document.getElementById('total').textContent = `${fmt(total)}`;

  const currentEl = document.getElementById('current');
  if (current?.domain) {
    currentEl.textContent = `Tracking: ${current.domain}`;
  } else {
    currentEl.textContent = 'Not tracking right now.';
  }

  // // --- Show all state values as JSON ---
  // const pre = ensureDebugPre();
  // // Only stringify plain data (avoid functions/circular)
  // pre.textContent = JSON.stringify(current ?? { note: 'no state available' }, null, 2);
}

render();
// Refresh every 2s so the live timer feels responsive while popup is open
setInterval(render, 2000);
