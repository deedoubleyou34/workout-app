// Hand-rolled SVG charts — spec Phase 7 step 1. No library, no CDN, offline.
//
// Everything is drawn into a viewBox and sized with width:100%, so a phone in
// portrait scales the whole chart down instead of scrolling sideways. Nothing
// here measures the DOM, so a chart renders correctly before it is attached.

const NS = 'http://www.w3.org/2000/svg';

function node(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) n.setAttribute(k, String(v));
  }
  if (text !== undefined) n.textContent = text;
  return n;
}

function frame(width, height) {
  const svg = node('svg', {
    viewBox: '0 0 ' + width + ' ' + height,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    class: 'chart',
  });
  return svg;
}

// Round numbers for an axis that a human reads at a glance.
export function niceBounds(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return { min: 0, max: 1 };
  let min = Math.min(...nums, 0);
  let max = Math.max(...nums);
  if (max === min) max = min + 1;
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span))) / 2;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  return { min, max };
}

const PAD = { top: 14, right: 12, bottom: 26, left: 38 };

// series: [{ name, color, values: [n|null], emphasis }]
// labels: one per x position
export function lineChart({ labels, series, width = 340, height = 190, format = (v) => String(Math.round(v)) }) {
  const svg = frame(width, height);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const all = series.flatMap((s) => s.values);
  const { min, max } = niceBounds(all);
  const n = Math.max(labels.length, 1);
  const x = (i) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  // horizontal guides, and the y axis labelled at both ends only — a phone
  // has no room for five tick labels
  for (const v of [min, (min + max) / 2, max]) {
    svg.append(node('line', {
      x1: PAD.left, x2: width - PAD.right, y1: y(v), y2: y(v), class: 'chart-grid',
    }));
    svg.append(node('text', { x: PAD.left - 6, y: y(v) + 4, class: 'chart-tick', 'text-anchor': 'end' },
      format(v)));
  }

  for (const s of series) {
    const points = s.values
      .map((v, i) => (Number.isFinite(v) ? [x(i), y(v)] : null))
      .filter(Boolean);
    if (points.length > 1) {
      svg.append(node('polyline', {
        points: points.map((p) => p.join(',')).join(' '),
        class: 'chart-line' + (s.emphasis ? ' emphasis' : ''),
        stroke: s.color,
      }));
    }
    for (const [px, py] of points) {
      svg.append(node('circle', { cx: px, cy: py, r: s.emphasis ? 3.5 : 2.5, fill: s.color }));
    }
  }

  // x labels: first and last, plus the middle when there is room
  const showAt = new Set([0, labels.length - 1]);
  if (labels.length >= 5) showAt.add(Math.floor((labels.length - 1) / 2));
  for (const i of showAt) {
    if (labels[i] === undefined) continue;
    svg.append(node('text', {
      x: x(i), y: height - 8, class: 'chart-tick',
      'text-anchor': i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle',
    }, labels[i]));
  }
  return svg;
}

// Grouped bars, two series side by side per label.
export function barChart({ labels, series, width = 340, height = 170, format = (v) => String(Math.round(v)) }) {
  const svg = frame(width, height);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const max = Math.max(1, ...series.flatMap((s) => s.values.filter(Number.isFinite)));
  const groups = Math.max(labels.length, 1);
  const groupW = plotW / groups;
  const barW = Math.max(4, Math.min(18, (groupW - 6) / series.length));

  svg.append(node('line', {
    x1: PAD.left, x2: width - PAD.right, y1: PAD.top + plotH, y2: PAD.top + plotH, class: 'chart-grid',
  }));
  svg.append(node('text', { x: PAD.left - 6, y: PAD.top + 10, class: 'chart-tick', 'text-anchor': 'end' },
    format(max)));

  labels.forEach((label, i) => {
    const left = PAD.left + i * groupW + (groupW - barW * series.length) / 2;
    series.forEach((s, k) => {
      const v = Number.isFinite(s.values[i]) ? s.values[i] : 0;
      const h = (v / max) * plotH;
      svg.append(node('rect', {
        x: left + k * barW, y: PAD.top + plotH - h, width: barW - 2, height: Math.max(h, v > 0 ? 1 : 0),
        fill: s.color, rx: 2,
      }));
    });
    if (i === 0 || i === labels.length - 1 || labels.length <= 4) {
      svg.append(node('text', {
        x: PAD.left + i * groupW + groupW / 2, y: height - 8, class: 'chart-tick', 'text-anchor': 'middle',
      }, label));
    }
  });
  return svg;
}

// A countdown ring, per the spec's session walkthrough. Returns the <svg> with
// an `update(fraction)` on it: the ticker repaints four times a second, so it
// moves one attribute rather than rebuilding the node.
export function progressRing({ size = 200, stroke = 10, color = '#57c7ff' } = {}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const svg = frame(size, size);
  svg.setAttribute('class', 'chart ring');
  const common = { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke };
  svg.append(node('circle', { ...common, class: 'ring-track' }));
  const arc = node('circle', {
    ...common,
    class: 'ring-arc',
    stroke: color,
    'stroke-linecap': 'round',
    'stroke-dasharray': circumference,
    'stroke-dashoffset': 0,
    transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')',
  });
  svg.append(arc);
  svg.update = (fraction) => {
    const clamped = Math.max(0, Math.min(Number(fraction) || 0, 1));
    arc.setAttribute('stroke-dashoffset', String(circumference * (1 - clamped)));
  };
  svg.update(1);
  return svg;
}

export function legend(series) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-legend';
  for (const s of series) {
    const item = document.createElement('span');
    item.className = 'chart-key' + (s.emphasis ? ' emphasis' : '');
    const dot = document.createElement('i');
    dot.style.background = s.color;
    item.append(dot, document.createTextNode(s.name));
    wrap.append(item);
  }
  return wrap;
}
