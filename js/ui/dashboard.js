// Asymmetry dashboard — spec Phase 7. One screen, one question: is the gap
// closing?
//
// The verdict comes first and the chart second, deliberately. A line going
// down is not an answer; "Left was 22% behind six weeks ago, now 9% behind,
// closing" is.

import { getDb } from '../db.js';
import { unilateralTrends, weeklyVolumeBySide, couchStretchTrend } from '../asymmetry.js';
import { lineChart, barChart, legend } from '../charts.js';
import { nightlyStreak, weekStart, today } from '../sessions.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const WEAK = '#ffd75e';     // Saiyan gold: the side being pushed
const STRONG = '#57c7ff';   // ki blue
const UNIT = { hold: 's held', load: 'lb × reps', reps: 'reps' };

// "08-25" — a week label with room to breathe on a phone
function weekLabel(iso) {
  return iso.slice(5).replace('-', '/');
}

export function renderDashboard(root) {
  const db = getDb();
  root.innerHTML = '';
  root.className = 'page';

  const header = el('header', 'top');
  const back = el('a', 'back', '‹ Home');
  back.href = '#/';
  header.append(back);
  header.append(el('h1', null, 'Is the gap closing?'));
  header.append(el('p', 'muted',
    'Left vs right capacity per week. The biased side is gold. '
    + 'Capacity is the best set of the week — weight × reps, reps, or seconds held.'));
  root.append(header);

  const trends = unilateralTrends(db);

  if (!trends.length) {
    const empty = el('section', 'blockcard');
    empty.append(el('h3', 'cardlabel', 'Nothing to chart yet'));
    empty.append(el('p', 'muted',
      'This screen needs finished sessions with both sides logged. '
      + 'The spec asks for about three weeks before the charts mean anything — '
      + 'four sessions per exercise is the floor for a verdict. '
      + 'Nothing here is simulated: an empty screen is the honest answer until the work is in.'));
    root.append(empty);
    renderNightly(root, db);
    return;
  }

  for (const t of trends) {
    const card = el('section', 'blockcard trendcard');
    card.append(el('h3', 'trendname', t.name));

    const verdict = el('p', 'verdict verdict-' + t.verdict.state, t.verdict.text);
    card.append(verdict);

    const usable = t.series.filter((s) => s.left != null || s.right != null);
    if (usable.length) {
      const bias = t.biasSide || 'left';
      const series = [
        {
          name: 'Left' + (bias === 'left' ? ' (biased)' : ''),
          color: bias === 'left' ? WEAK : STRONG,
          emphasis: bias === 'left',
          values: usable.map((s) => s.left),
        },
        {
          name: 'Right' + (bias === 'right' ? ' (biased)' : ''),
          color: bias === 'right' ? WEAK : STRONG,
          emphasis: bias === 'right',
          values: usable.map((s) => s.right),
        },
      ];
      const labels = usable.map((s) => weekLabel(s.week));
      const holder = el('div', 'chartwrap');
      holder.append(lineChart({ labels, series }));
      card.append(holder);
      card.append(legend(series));
      const kind = usable[usable.length - 1].kind;
      if (kind) card.append(el('p', 'chartunit', 'capacity in ' + (UNIT[kind] || kind)));

      const gaps = usable.filter((s) => s.gapPct != null);
      if (gaps.length > 1) {
        const gapHolder = el('div', 'chartwrap');
        gapHolder.append(lineChart({
          labels: gaps.map((s) => weekLabel(s.week)),
          series: [{ name: 'gap %', color: WEAK, emphasis: true, values: gaps.map((s) => s.gapPct) }],
          height: 140,
          format: (v) => Math.round(v) + '%',
        }));
        card.append(el('p', 'chartunit', 'gap, toward zero is the goal'));
        card.append(gapHolder);
      }
    }
    card.append(el('p', 'muted', t.sessions + (t.sessions === 1 ? ' session' : ' sessions') + ' logged'));
    root.append(card);
  }

  // ---- weekly volume by side: is the bias actually happening? ----
  const volume = weeklyVolumeBySide(db);
  if (volume.length) {
    const card = el('section', 'blockcard');
    card.append(el('h3', 'cardlabel', 'Weekly sets by side'));
    card.append(el('p', 'muted', 'The bias is only real if the sets are actually there.'));
    const series = [
      { name: 'Left', color: WEAK, values: volume.map((v) => v.left) },
      { name: 'Right', color: STRONG, values: volume.map((v) => v.right) },
    ];
    const holder = el('div', 'chartwrap');
    holder.append(barChart({ labels: volume.map((v) => weekLabel(v.week)), series }));
    card.append(holder);
    card.append(legend(series));
    const thisWeek = volume.find((v) => v.week === weekStart(today()));
    if (thisWeek) {
      const diff = thisWeek.left - thisWeek.right;
      card.append(el('p', 'muted', 'This week: ' + thisWeek.left + ' left, ' + thisWeek.right + ' right'
        + (diff === 0 ? ' — even.' : diff > 0 ? ' — ' + diff + ' more on the left.'
          : ' — ' + -diff + ' more on the right.')));
    }
    root.append(card);
  }

  renderNightly(root, db);
}

// Spec Phase 7 step 5: the nightly non-negotiables get their own section and
// their own table. They never mix into lifting volume.
function renderNightly(root, db) {
  const card = el('section', 'blockcard');
  card.append(el('h3', 'cardlabel', 'Nightly non-negotiables'));
  const streak = nightlyStreak(db);
  card.append(el('p', 'streakline', streak
    ? '🌙 ' + streak + (streak === 1 ? ' night' : ' nights') + ' in a row'
    : 'No nights logged yet.'));

  const couch = couchStretchTrend(db);
  if (couch.length > 1) {
    const series = [
      { name: 'Left', color: WEAK, emphasis: true, values: couch.map((d) => d.left) },
      { name: 'Right', color: STRONG, values: couch.map((d) => d.right) },
    ];
    const holder = el('div', 'chartwrap');
    holder.append(lineChart({
      labels: couch.map((d) => d.date.slice(5).replace('-', '/')),
      series,
      height: 150,
      format: (v) => Math.round(v) + 's',
    }));
    card.append(el('p', 'muted', 'Couch stretch — time to discomfort, per side'));
    card.append(holder);
    card.append(legend(series));
  } else {
    card.append(el('p', 'muted',
      'Log the nightly couch stretch a few nights running and its per-side trend appears here.'));
  }

  const go = el('a', 'btn btn-small', 'Log tonight →');
  go.href = '#/day/0';
  card.append(go);
  root.append(card);
}
