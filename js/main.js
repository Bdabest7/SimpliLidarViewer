/**
 * SimpliLidarViewer — Main Application
 * Uses globals: window.LASParser, window.LAZLoader, window.Colorizer, window.Viewer
 * No ES module imports — works from file:// and HTTP alike.
 */

(function () {
'use strict';

// ─── Shorthand ────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

// ─── State ────────────────────────────────────────────────────────────────────
var state = {
    viewer:      null,
    cloud:       null,
    colorMode:   'elevation',
    singleColor: '#00d4ff',
    epsg:        null,
    crsName:     null,
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
var viewport         = $('viewport');
var dropZone         = $('drop-zone');
var fileInput        = $('file-input');
var loadingOverlay   = $('loading-overlay');
var loadingMsg       = $('loading-msg');
var hud              = $('hud');
var statusPoints     = $('status-points');
var statusFPS        = $('status-fps');
var statusCRS        = $('status-crs');
var statusSubsampled = $('status-subsampled');
var colorModeEl      = $('color-mode');
var rowSingleColor   = $('row-single-color');
var singleColorEl    = $('single-color');
var pointSizeEl      = $('point-size');
var lblPointSize     = $('lbl-point-size');
var autoRotateEl     = $('auto-rotate');
var rotateSpeedEl    = $('rotate-speed');
var lblRotateSpeed   = $('lbl-rotate-speed');
var rotateDirEl      = $('rotate-direction');
var showGridEl       = $('show-grid');
var showAxesEl       = $('show-axes');
var epsgInput        = $('epsg-input');
var crsDetected      = $('crs-detected');
var crsNameEl        = $('crs-name');
var lazServerNote    = $('laz-server-note');

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
    state.viewer = new Viewer(viewport);
    state.viewer.onFPS = function (fps) {
        statusFPS.textContent = 'FPS ' + fps;
    };

    setupFileHandling();
    setupControls();
}

// ─── File Handling ────────────────────────────────────────────────────────────

function setupFileHandling() {
    $('btn-open-file').addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function (e) {
        if (e.target.files[0]) loadFile(e.target.files[0]);
    });

    viewport.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    viewport.addEventListener('dragleave', function (e) {
        if (!viewport.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
    });

    viewport.addEventListener('drop', function (e) {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });

    document.body.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.body.addEventListener('drop', function (e) {
        e.preventDefault();
        var f = e.dataTransfer.files[0];
        if (f && (f.name.endsWith('.las') || f.name.endsWith('.laz'))) loadFile(f);
    });
}

function loadFile(file) {
    var ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'las' && ext !== 'laz') {
        showError('Please open a .las or .laz file.');
        return;
    }

    showLoading('Reading ' + file.name + '…');

    file.arrayBuffer().then(function (rawBuffer) {
        if (ext === 'laz') {
            showLoading('Loading LAZ library & decompressing… (large files may take a moment)');
            return LAZLoader.load(rawBuffer);
        }

        showLoading('Parsing point cloud…');
        return new Promise(function (resolve) {
            setTimeout(function () {
                resolve(LASParser.parse(rawBuffer));
            }, 30);
        });

    }).then(function (cloud) {
        state.cloud = cloud;

        // Handle detected CRS
        if (cloud.crsEPSG) {
            state.epsg = cloud.crsEPSG;
            epsgInput.value = cloud.crsEPSG;
            crsDetected.textContent = 'Detected CRS: EPSG:' + cloud.crsEPSG;
            crsDetected.style.display = 'block';
            applyCRS(cloud.crsEPSG);
        } else if (cloud.crsWKT) {
            crsDetected.textContent = 'CRS detected in file (WKT)';
            crsDetected.style.display = 'block';
        } else {
            crsDetected.style.display = 'none';
        }

        showLoading('Building 3D view…');

        return new Promise(function (resolve) {
            setTimeout(function () { resolve(cloud); }, 20);
        });

    }).then(function (cloud) {
        var colors = computeColors(cloud, state.colorMode);
        state.viewer.loadCloud(cloud, colors);

        dropZone.style.display = 'none';
        hud.style.display = 'block';

        updateFileInfo(file, cloud);
        updateStatusBar(cloud);
        hideLoading();

    }).catch(function (err) {
        hideLoading();
        showError(err.message || String(err));
        console.error(err);
    });
}

// ─── Color computation ────────────────────────────────────────────────────────

function computeColors(cloud, mode) {
    var n = cloud.loadedPoints;
    var C = Colorizer;
    switch (mode) {
        case 'elevation':
            return C.colorByElevation(cloud.positions, n);
        case 'classification':
            return C.colorByClassification(cloud.classifications, n);
        case 'intensity':
            return C.colorByIntensity(cloud.intensities, n);
        case 'rgb': {
            var result = C.colorByRGB(cloud.rgbColors, cloud.positions, n);
            if (!result.hadRGB) showToast('No RGB data in file — showing elevation color.');
            return result.colors;
        }
        case 'single':
            return C.colorBySingle(state.singleColor, n);
        default:
            return C.colorByElevation(cloud.positions, n);
    }
}

function applyColorMode(mode) {
    if (!state.cloud) return;
    state.colorMode = mode;
    state.viewer.updateColors(computeColors(state.cloud, mode));
    rowSingleColor.style.display = mode === 'single' ? 'flex' : 'none';
}

// ─── UI controls ─────────────────────────────────────────────────────────────

function setupControls() {

    colorModeEl.addEventListener('change', function () {
        applyColorMode(colorModeEl.value);
    });

    singleColorEl.addEventListener('input', function () {
        state.singleColor = singleColorEl.value;
        if (state.colorMode === 'single') applyColorMode('single');
    });

    pointSizeEl.addEventListener('input', function () {
        var v = parseFloat(pointSizeEl.value);
        lblPointSize.textContent = v.toFixed(1);
        state.viewer.setPointSize(v);
    });

    function syncRotate() {
        var enabled   = autoRotateEl.checked;
        var speed     = parseFloat(rotateSpeedEl.value);
        var direction = parseInt(rotateDirEl.value, 10);
        state.viewer.setAutoRotate(enabled, speed, direction);
    }

    autoRotateEl.addEventListener('change', syncRotate);
    rotateSpeedEl.addEventListener('input', function () {
        lblRotateSpeed.textContent = parseFloat(rotateSpeedEl.value).toFixed(1);
        syncRotate();
    });
    rotateDirEl.addEventListener('change', syncRotate);

    showGridEl.addEventListener('change', function () {
        state.viewer.setGridVisible(showGridEl.checked);
    });

    showAxesEl.addEventListener('change', function () {
        state.viewer.setAxesVisible(showAxesEl.checked);
    });

    $('btn-reset-camera').addEventListener('click', function () { state.viewer.resetCamera(); });
    $('btn-top-view').addEventListener('click',   function () { state.viewer.setTopView(); });
    $('btn-side-view').addEventListener('click',  function () { state.viewer.setSideView(); });

    $('btn-apply-epsg').addEventListener('click', function () {
        var code = parseInt(epsgInput.value.trim(), 10);
        if (!isNaN(code) && code > 0) applyCRS(code);
    });

    epsgInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            var code = parseInt(epsgInput.value.trim(), 10);
            if (!isNaN(code) && code > 0) applyCRS(code);
        }
    });
}

// ─── Coordinate System ────────────────────────────────────────────────────────

function applyCRS(epsgCode) {
    crsNameEl.textContent = 'Looking up…';
    statusCRS.textContent = 'CRS: EPSG:' + epsgCode;

    fetch('https://epsg.io/?q=' + epsgCode + '&format=json')
        .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(function (info) {
            var result = info.results && info.results[0];
            if (result) {
                if (result.proj4 && typeof proj4 !== 'undefined') {
                    proj4.defs('EPSG:' + epsgCode, result.proj4.trim());
                }
                state.crsName = result.name;
                crsNameEl.textContent = result.name;
                statusCRS.textContent = 'CRS: ' + result.name + ' (EPSG:' + epsgCode + ')';
            } else {
                crsNameEl.textContent = 'EPSG:' + epsgCode;
                statusCRS.textContent = 'CRS: EPSG:' + epsgCode;
            }
            state.epsg = epsgCode;
        })
        .catch(function () {
            crsNameEl.textContent = 'EPSG:' + epsgCode;
            statusCRS.textContent = 'CRS: EPSG:' + epsgCode;
        });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function updateFileInfo(file, cloud) {
    function fmt(n) { return (+n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
    var b = cloud.bounds;

    $('file-info').innerHTML = [
        '<div class="file-meta">',
        '<span class="file-meta-key">File</span>',
        '<span class="file-meta-val accent">'  + file.name + '</span>',
        '<span class="file-meta-key">Size</span>',
        '<span class="file-meta-val">'          + formatBytes(file.size) + '</span>',
        cloud.version !== 'LAZ' ? '<span class="file-meta-key">Version</span><span class="file-meta-val">LAS ' + cloud.version + '</span>' : '',
        cloud.pointFormat >= 0  ? '<span class="file-meta-key">Format</span><span class="file-meta-val">Point Format ' + cloud.pointFormat + '</span>' : '',
        '<span class="file-meta-key">Total pts</span>',
        '<span class="file-meta-val ' + (cloud.subsampled ? 'warn' : '') + '">' + cloud.totalPoints.toLocaleString() + '</span>',
        '<span class="file-meta-key">Loaded</span>',
        '<span class="file-meta-val">' + cloud.loadedPoints.toLocaleString() + (cloud.subsampled ? ' (1:' + cloud.stride + ')' : '') + '</span>',
        '<span class="file-meta-key">Has RGB</span>',
        '<span class="file-meta-val">'          + (cloud.hasRGB ? 'Yes' : 'No') + '</span>',
        '<span class="file-meta-key">Extent X</span>',
        '<span class="file-meta-val">'          + fmt(cloud.extents.x) + ' m</span>',
        '<span class="file-meta-key">Extent Y</span>',
        '<span class="file-meta-val">'          + fmt(cloud.extents.y) + ' m</span>',
        '<span class="file-meta-key">Extent Z</span>',
        '<span class="file-meta-val">'          + fmt(cloud.extents.z) + ' m</span>',
        '<span class="file-meta-key">Min Z</span>',
        '<span class="file-meta-val">'          + fmt(b.minZ) + '</span>',
        '<span class="file-meta-key">Max Z</span>',
        '<span class="file-meta-val">'          + fmt(b.maxZ) + '</span>',
        cloud.generatingSoftware ? '<span class="file-meta-key">Software</span><span class="file-meta-val">' + cloud.generatingSoftware + '</span>' : '',
        '</div>',
    ].join('');
}

function updateStatusBar(cloud) {
    statusPoints.textContent = cloud.loadedPoints.toLocaleString() + ' pts';
    if (cloud.subsampled) {
        statusSubsampled.style.display  = 'inline';
        statusSubsampled.textContent = 'Subsampled 1:' + cloud.stride;
    } else {
        statusSubsampled.style.display = 'none';
    }
    if (!state.crsName && !state.epsg) {
        statusCRS.textContent = cloud.crsEPSG ? 'CRS: EPSG:' + cloud.crsEPSG : 'CRS: Unknown';
    }
}

function showLoading(msg) {
    loadingMsg.textContent = msg;
    loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
}

function showError(msg) {
    var el = document.createElement('div');
    el.style.cssText = [
        'position:fixed;bottom:48px;right:20px;z-index:100;',
        'background:#1c2333;border:1px solid #f85149;border-radius:6px;',
        'padding:12px 16px;max-width:380px;font-size:12px;color:#f85149;',
        'box-shadow:0 4px 20px rgba(0,0,0,0.5);line-height:1.6;white-space:pre-wrap;',
    ].join('');
    el.innerHTML = '<strong>Error</strong><br>' + msg.replace(/\n/g, '<br>');
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 10000);
}

function showToast(msg) {
    var el = document.createElement('div');
    el.style.cssText = [
        'position:fixed;bottom:48px;right:20px;z-index:100;',
        'background:#1c2333;border:1px solid #30363d;border-radius:6px;',
        'padding:10px 14px;max-width:320px;font-size:12px;color:#8b949e;',
    ].join('');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
}

function formatBytes(bytes) {
    if (bytes < 1024)       return bytes + ' B';
    if (bytes < 1048576)    return (bytes/1024).toFixed(1)    + ' KB';
    if (bytes < 1073741824) return (bytes/1048576).toFixed(1) + ' MB';
    return (bytes/1073741824).toFixed(2) + ' GB';
}

// ─── Start ────────────────────────────────────────────────────────────────────

init();

}());
