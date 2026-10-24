import { escapeHtml, formatInteger } from "./core.mjs";

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const lower = Math.floor(position);
  return (
    sorted[lower] +
    (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
  );
}

export function nanoseconds(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const ns = Number(value);
  if (ns < 1000) return `${Math.round(ns)} нс`;
  if (ns < 1000000) return `${(ns / 1000).toFixed(ns < 10000 ? 2 : 1)} мкс`;
  return `${(ns / 1000000).toFixed(ns < 10000000 ? 2 : 1)} мс`;
}

export function speedup(value) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)}×`;
}

export function severityCounts(findings) {
  return findings.reduce(
    (counts, finding) => {
      counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
      return counts;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

export function methodRisk(method) {
  return (
    Math.round(
      (Number(method.cyclomatic ?? 1) * 2 +
        Number(method.cognitive ?? 0) * 1.5 +
        Number(method.lines ?? 0) * 0.15) *
        10,
    ) / 10
  );
}

export function distribution(values, boundaries = [5, 10, 20, 40]) {
  const buckets = boundaries.map((upper, index) => ({
    label: index === 0 ? `≤ ${upper}` : `${boundaries[index - 1] + 1}–${upper}`,
    minimum: index === 0 ? -Infinity : boundaries[index - 1],
    maximum: upper,
    count: 0,
  }));
  buckets.push({
    label: `> ${boundaries.at(-1)}`,
    minimum: boundaries.at(-1),
    maximum: Infinity,
    count: 0,
  });
  for (const value of values) {
    const bucket = buckets.find(
      (candidate) => value > candidate.minimum && value <= candidate.maximum,
    );
    if (bucket) bucket.count++;
  }
  return buckets;
}

export function complexityClass(label) {
  if (/неизвест|unknown/i.test(label)) return "unknown";
  if (/n\^3|n³|n\^4/.test(label)) return "critical";
  if (/n\^2|n²/.test(label)) return "quadratic";
  if (/log/.test(label) && /n.*log/.test(label)) return "nlogn";
  if (/log/.test(label)) return "logarithmic";
  if (/n/.test(label)) return "linear";
  return "constant";
}

export function reportSummary(report) {
  const tests = report?.tests ?? [];
  const passed = tests.filter((test) => test.passed).length;
  const baselineMs = tests.reduce(
    (total, test) => total + Number(test.baseline?.timeMs ?? 0),
    0,
  );
  const candidateMs = tests.reduce(
    (total, test) => total + Number(test.candidate?.timeMs ?? 0),
    0,
  );
  return {
    total: tests.length,
    passed,
    failed: tests.length - passed,
    baselineMs,
    candidateMs,
  };
}

export function lineChart(
  series,
  { width = 640, height = 240, yLabel = "мкс", logScale = false } = {},
) {
  const padding = { left: 62, right: 24, top: 25, bottom: 40 };
  const all = series.flatMap((item) => item.values);
  if (!all.length) return '<div class="chart-empty">Нет измерений</div>';
  const xs = [...new Set(all.map((point) => point.x))].sort((a, b) => a - b);
  const ys = all.map((point) => Math.max(Number.MIN_VALUE, point.y));
  const maximumY = Math.max(...ys, 1);
  const minimumY = logScale ? Math.min(...ys) / 1.5 : 0;
  const transform = (value) =>
    logScale ? Math.log10(Math.max(Number.MIN_VALUE, value)) : value;
  const lower = transform(minimumY || 1);
  const upper = transform(maximumY * 1.1);
  const x = (value) =>
    padding.left +
    (xs.length === 1 ? 0.5 : (value - xs[0]) / (xs.at(-1) - xs[0])) *
      (width - padding.left - padding.right);
  const y = (value) =>
    height -
    padding.bottom -
    (logScale
      ? (transform(value) - lower) / Math.max(0.001, upper - lower)
      : value / (maximumY * 1.1)) *
      (height - padding.top - padding.bottom);
  let svg = `<svg viewBox="0 0 ${width} ${height}" class="data-chart" role="img" aria-label="График измерений ${escapeHtml(yLabel)}">`;
  for (let i = 0; i <= 4; i++) {
    const value = logScale
      ? 10 ** (lower + ((upper - lower) * i) / 4)
      : (maximumY * 1.1 * i) / 4;
    const position = y(value);
    svg += `<line x1="${padding.left}" y1="${position}" x2="${width - padding.right}" y2="${position}" class="chart-grid"/>`;
    svg += `<text x="${padding.left - 12}" y="${position + 4}" text-anchor="end" class="chart-label">${value >= 1000 ? (value / 1000).toFixed(1) + "k" : value.toFixed(value < 10 ? 1 : 0)}</text>`;
  }
  for (const value of xs)
    svg += `<text x="${x(value)}" y="${height - 12}" text-anchor="middle" class="chart-label">${formatInteger(value)}</text>`;
  series.forEach((item, index) => {
    const points = item.values
      .map((point) => `${x(point.x)},${y(point.y)}`)
      .join(" ");
    const color = item.color ?? ["#a2a5ff", "#b6f36d"][index % 2];
    svg += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    for (const point of item.values)
      svg += `<circle cx="${x(point.x)}" cy="${y(point.y)}" r="4" fill="${color}"><title>${escapeHtml(item.name)}: n=${point.x}, ${point.y.toFixed(2)} ${escapeHtml(yLabel)}</title></circle>`;
  });
  svg += `<text x="${padding.left}" y="12" class="chart-label">${escapeHtml(yLabel)}</text></svg>`;
  return svg;
}

export function histogramChart(buckets, width = 520, height = 180) {
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const barWidth = (width - 44) / buckets.length;
  return `<svg viewBox="0 0 ${width} ${height}" class="data-chart" role="img" aria-label="Распределение методов">${buckets
    .map((bucket, index) => {
      const barHeight = ((height - 52) * bucket.count) / maximum;
      const x = 24 + index * barWidth;
      const y = height - 29 - barHeight;
      return `<rect x="${x}" y="${y}" width="${barWidth - 12}" height="${barHeight}" rx="5" fill="${index < 2 ? "#b6f36d" : "#a2a5ff"}" opacity="${1 - index * 0.1}"/><text x="${x + (barWidth - 12) / 2}" y="${y - 9}" class="chart-label" text-anchor="middle">${bucket.count}</text><text x="${x + (barWidth - 12) / 2}" y="${height - 8}" class="chart-label" text-anchor="middle">${escapeHtml(bucket.label)}</text>`;
    })
    .join("")}</svg>`;
}

export function donutChart(segments, { size = 130, label = "" } = {}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = size * 0.36;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;
  const circles = segments
    .map((segment) => {
      const fraction = total ? segment.value / total : 0;
      const length = circumference * fraction;
      const svg = `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${segment.color}" stroke-width="9" stroke-dasharray="${Math.max(0, length - 3)} ${circumference}" stroke-dashoffset="${-consumed}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${escapeHtml(segment.label)}: ${segment.value}</title></circle>`;
      consumed += length;
      return svg;
    })
    .join("");
  return `<svg viewBox="0 0 ${size} ${size}" class="donut-chart" role="img" aria-label="${escapeHtml(label)}"><circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="var(--border)" stroke-width="9"/>${circles}<text x="50%" y="49%" text-anchor="middle" class="donut-number">${total}</text><text x="50%" y="64%" text-anchor="middle" class="donut-label">${escapeHtml(label)}</text></svg>`;
}
