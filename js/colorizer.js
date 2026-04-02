/**
 * SimpliLidarViewer — Colorizer
 * Generates Float32Array color buffers (R,G,B per point, values 0–1).
 * Exposed as window.Colorizer — no ES module imports required.
 */

// ─── Viridis colormap ─────────────────────────────────────────────────────────
const VIRIDIS = [
    [0.267, 0.005, 0.329],
    [0.283, 0.141, 0.458],
    [0.254, 0.265, 0.530],
    [0.208, 0.374, 0.554],
    [0.164, 0.471, 0.558],
    [0.128, 0.567, 0.551],
    [0.135, 0.659, 0.517],
    [0.267, 0.749, 0.441],
    [0.478, 0.821, 0.318],
    [0.738, 0.873, 0.149],
    [0.993, 0.906, 0.144],
];

function _viridis(t) {
    t = Math.max(0, Math.min(1, t));
    const n  = VIRIDIS.length - 1;
    const lo = Math.floor(t * n);
    const hi = Math.min(lo + 1, n);
    const f  = t * n - lo;
    const a  = VIRIDIS[lo], b = VIRIDIS[hi];
    return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f];
}

// ─── LAS classification colors ────────────────────────────────────────────────
const CLASS_COLORS = {
     0: [0.50, 0.50, 0.50],   1: [0.60, 0.60, 0.60],
     2: [0.60, 0.40, 0.20],   3: [0.40, 0.75, 0.35],
     4: [0.15, 0.62, 0.15],   5: [0.00, 0.42, 0.00],
     6: [1.00, 0.55, 0.10],   7: [1.00, 0.10, 0.10],
     8: [1.00, 1.00, 0.00],   9: [0.10, 0.45, 0.95],
    10: [0.62, 0.33, 0.85],  11: [0.35, 0.35, 0.35],
    12: [1.00, 0.55, 0.80],  13: [0.55, 0.85, 1.00],
    14: [0.30, 0.65, 1.00],  15: [0.05, 0.25, 0.85],
    16: [0.55, 0.75, 1.00],  17: [0.82, 0.72, 0.52],
    18: [1.00, 0.00, 0.45],
};
const DEFAULT_CLASS_COLOR = [0.50, 0.50, 0.50];

// ─── Public functions ─────────────────────────────────────────────────────────

function colorByElevation(positions, count) {
    const colors = new Float32Array(count * 3);
    let minY =  Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i++) {
        const y = positions[i * 3 + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const range = maxY - minY || 1;
    for (let i = 0; i < count; i++) {
        const rgb = _viridis((positions[i * 3 + 1] - minY) / range);
        colors[i*3] = rgb[0]; colors[i*3+1] = rgb[1]; colors[i*3+2] = rgb[2];
    }
    return colors;
}

function colorByClassification(classifications, count) {
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const rgb = CLASS_COLORS[classifications[i]] || DEFAULT_CLASS_COLOR;
        colors[i*3] = rgb[0]; colors[i*3+1] = rgb[1]; colors[i*3+2] = rgb[2];
    }
    return colors;
}

function colorByIntensity(intensities, count) {
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const rgb = _viridis(intensities[i]);
        colors[i*3] = rgb[0]; colors[i*3+1] = rgb[1]; colors[i*3+2] = rgb[2];
    }
    return colors;
}

function colorByRGB(rgbColors, positions, count) {
    let hasData = false;
    for (let i = 0; i < Math.min(count * 3, 300); i++) {
        if (rgbColors[i] > 0) { hasData = true; break; }
    }
    if (!hasData) {
        return { colors: colorByElevation(positions, count), hadRGB: false };
    }
    // Detect 8-bit colors stored in lower byte of 16-bit field
    let maxVal = 0;
    for (let i = 0; i < Math.min(count * 3, 3000); i++) {
        if (rgbColors[i] > maxVal) maxVal = rgbColors[i];
    }
    const scale  = maxVal < 0.004 ? 256 : 1;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
        colors[i] = Math.min(1, rgbColors[i] * scale);
    }
    return { colors, hadRGB: true };
}

function colorBySingle(hexColor, count) {
    const r = parseInt(hexColor.slice(1, 3), 16) / 255;
    const g = parseInt(hexColor.slice(3, 5), 16) / 255;
    const b = parseInt(hexColor.slice(5, 7), 16) / 255;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
    }
    return colors;
}

function classificationLabel(code) {
    const labels = {
        0: 'Never Classified', 1: 'Unclassified', 2: 'Ground',
        3: 'Low Vegetation',   4: 'Medium Vegetation', 5: 'High Vegetation',
        6: 'Building',         7: 'Low Point / Noise', 8: 'Model Key-point',
        9: 'Water',           10: 'Rail',             11: 'Road Surface',
       12: 'Overlap Points',  13: 'Wire – Guard',     14: 'Wire – Conductor',
       15: 'Trans. Tower',    16: 'Wire Connector',   17: 'Bridge Deck',
       18: 'High Noise',
    };
    return labels[code] || ('Class ' + code);
}

// ─── Expose globally ──────────────────────────────────────────────────────────
window.Colorizer = {
    colorByElevation,
    colorByClassification,
    colorByIntensity,
    colorByRGB,
    colorBySingle,
    classificationLabel,
};
