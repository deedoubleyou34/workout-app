import { query, storageStatus, exportSqliteBlob, exportJsonBlob, importBytes } from '../db.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function renderHome(root) {
  root.innerHTML = '';
  root.className = 'page';

  const header = el('header', 'top');
  header.append(el('h1', null, 'Training Companion'));
  root.append(header);

  const days = query(
    'SELECT * FROM day_template ORDER BY CASE day_no WHEN 0 THEN 99 ELSE day_no END'
  );
  const sessionsToday = query('SELECT day_no, status FROM session WHERE date = ?', [today()]);
  const statusByDay = new Map(sessionsToday.map((s) => [s.day_no, s.status]));

  const list = el('nav', 'daylist');
  for (const d of days) {
    const a = el('a', 'daycard');
    a.href = '#/day/' + d.day_no;
    const title = d.day_no === 0 ? 'Nightly' : 'Day ' + d.day_no;
    a.append(el('div', 'daycard-title', title));
    a.append(el('div', 'daycard-sub', d.name));
    const st = statusByDay.get(d.day_no);
    if (st) a.append(el('span', 'chip chip-' + st, st.replace('_', ' ')));
    list.append(a);
  }
  root.append(list);

  const data = el('section', 'datasec');
  data.append(el('h2', null, 'Data'));
  const row = el('div', 'btnrow');

  const expSql = el('button', 'btn', 'Export .sqlite');
  expSql.onclick = () => download(exportSqliteBlob(), 'workout-' + today() + '.sqlite');
  const expJson = el('button', 'btn', 'Export .json');
  expJson.onclick = () => download(exportJsonBlob(), 'workout-' + today() + '.json');

  const imp = el('button', 'btn btn-danger', 'Import…');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.sqlite,.json,application/json,application/octet-stream';
  file.hidden = true;
  imp.onclick = () => file.click();
  file.onchange = async () => {
    if (!file.files.length) return;
    if (!confirm('Import replaces ALL current app data with the file contents. Continue?')) {
      file.value = '';
      return;
    }
    try {
      const bytes = new Uint8Array(await file.files[0].arrayBuffer());
      await importBytes(bytes);
      alert('Import complete.');
      renderHome(root);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    file.value = '';
  };

  row.append(expSql, expJson, imp, file);
  data.append(row);
  root.append(data);

  const counts = {
    ex: query('SELECT COUNT(*) c FROM exercise')[0].c,
    days: query('SELECT COUNT(*) c FROM day_template')[0].c,
    sets: query('SELECT COUNT(*) c FROM set_log')[0].c,
  };
  const vol = query(
    'SELECT COALESCE(SUM(reps_done),0) reps, COALESCE(SUM(hold_seconds_done),0) holds, ' +
    'COALESCE(SUM(weight_lb*reps_done),0) tonnage FROM set_log')[0];
  const nightly = query('SELECT COUNT(*) c FROM nightly_log')[0].c;
  const power = Math.round(counts.sets * 100 + vol.reps * 10 + vol.holds * 5 + vol.tonnage / 10 + nightly * 50);
  const foot = el('footer', 'foot');
  foot.append(el('p', 'powerline',
    '⚡ Power level: ' + power.toLocaleString() + (power > 9000 ? " — IT'S OVER 9,000!" : '')));
  foot.append(el('p', 'muted', counts.ex + ' exercises · ' + counts.days + ' templates · ' + counts.sets + ' sets logged'));
  const storageLine = el('p', 'muted', 'storage: checking…');
  foot.append(storageLine);
  storageStatus().then((p) => {
    storageLine.textContent = 'storage: ' + (p ? 'persistent' : 'best-effort') + ' · build ' + (window.BUILD || '?');
  });
  root.append(foot);
}
