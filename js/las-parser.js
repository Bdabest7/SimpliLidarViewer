/**
 * SimpliLidarViewer — LAS/LAZ Parser
 *
 * LASParser  — native binary reader, works from file:// with no server needed.
 * LAZLoader  — uses @loaders.gl/las + @loaders.gl/core via esm.sh CDN; requires
 *              an HTTP server (run launch.bat). Shows a clear error from file://.
 *
 * Both return the same ParsedCloud shape so the rest of the app is unaffected.
 * Exposed as window.LASParser and window.LAZLoader.
 */

// ─── LAS binary parser ────────────────────────────────────────────────────────

const LASParser = (function () {

    const MAX_POINTS = 5_000_000;

    function _readString(bytes, offset, maxLen) {
        let s = '';
        for (let i = 0; i < maxLen; i++) {
            const c = bytes[offset + i];
            if (c === 0) break;
            s += String.fromCharCode(c);
        }
        return s;
    }

    function parse(buffer) {
        const view  = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        // ── Signature ───────────────────────────────────────────────
        const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
        if (sig !== 'LASF') throw new Error('Not a valid LAS file — missing LASF signature.');

        // ── Version ─────────────────────────────────────────────────
        const vMajor = bytes[24], vMinor = bytes[25];

        const systemId           = _readString(bytes, 26, 32);
        const generatingSoftware = _readString(bytes, 58, 32);

        const headerSize        = view.getUint16(94,  true);
        const offsetToPoints    = view.getUint32(96,  true);
        const numVLRs           = view.getUint32(100, true);
        const pointFormatId     = bytes[104];
        const pointRecordLength = view.getUint16(105, true);

        let numPoints = (vMajor === 1 && vMinor >= 4)
            ? Number(view.getBigUint64(247, true))
            : view.getUint32(107, true);

        if (numPoints === 0) throw new Error('LAS file contains zero points.');

        // ── Scale / offset / bounds ─────────────────────────────────
        const xScale  = view.getFloat64(131, true), yScale  = view.getFloat64(139, true), zScale  = view.getFloat64(147, true);
        const xOffset = view.getFloat64(155, true), yOffset = view.getFloat64(163, true), zOffset = view.getFloat64(171, true);
        const maxX    = view.getFloat64(179, true), minX    = view.getFloat64(187, true);
        const maxY    = view.getFloat64(195, true), minY    = view.getFloat64(203, true);
        const maxZ    = view.getFloat64(211, true), minZ    = view.getFloat64(219, true);

        // ── Parse VLRs for CRS ───────────────────────────────────────
        let crsWKT = null, crsEPSG = null, vlrPos = headerSize;
        for (let i = 0; i < numVLRs && vlrPos + 54 <= offsetToPoints; i++) {
            const userId   = _readString(bytes, vlrPos + 2, 16);
            const recordId = view.getUint16(vlrPos + 18, true);
            const recLen   = view.getUint16(vlrPos + 20, true);
            const dataStart = vlrPos + 54;
            if (userId === 'LASF_Projection') {
                if (recordId === 2112) {
                    crsWKT = _readString(bytes, dataStart, recLen).trim();
                } else if (recordId === 34737) {
                    const m = _readString(bytes, dataStart, recLen).match(/EPSG[:\s]*(\d{4,6})/i);
                    if (m) crsEPSG = parseInt(m[1]);
                }
            }
            vlrPos += 54 + recLen;
        }
        if (!crsEPSG && crsWKT) {
            const m = crsWKT.match(/AUTHORITY\["EPSG","(\d+)"\]/i);
            if (m) crsEPSG = parseInt(m[1]);
        }

        // ── Point format capabilities ────────────────────────────────
        const hasRGB   = [2, 3, 5, 7, 8, 10].includes(pointFormatId);
        const isNewFmt = pointFormatId >= 6;
        const colorByteOffset = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };
        const colOff    = colorByteOffset[pointFormatId] || 0;
        const classOff  = isNewFmt ? 16 : 15;
        const classMask = isNewFmt ? 0xFF : 0x1F;

        // ── Subsampling ──────────────────────────────────────────────
        const stride    = numPoints > MAX_POINTS ? Math.ceil(numPoints / MAX_POINTS) : 1;
        const loadCount = Math.ceil(numPoints / stride);

        // ── Center ──────────────────────────────────────────────────
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;

        // ── Allocate output ──────────────────────────────────────────
        const positions       = new Float32Array(loadCount * 3);
        const rgbColors       = new Float32Array(loadCount * 3);
        const intensities     = new Float32Array(loadCount);
        const classifications = new Uint8Array(loadCount);

        let idx = 0;
        const bufEnd = buffer.byteLength;

        for (let i = 0; i < numPoints; i += stride) {
            const p = offsetToPoints + i * pointRecordLength;
            if (p + pointRecordLength > bufEnd) break;

            const x = view.getInt32(p,     true) * xScale + xOffset - cx;
            const y = view.getInt32(p + 4, true) * yScale + yOffset - cy;
            const z = view.getInt32(p + 8, true) * zScale + zOffset - cz;

            // LAS (X=east, Y=north, Z=up) → Three.js (X=right, Y=up, Z=-north)
            positions[idx*3]     =  x;
            positions[idx*3 + 1] =  z;
            positions[idx*3 + 2] = -y;

            intensities[idx]     = view.getUint16(p + 12, true) / 65535;
            classifications[idx] = bytes[p + classOff] & classMask;

            if (hasRGB) {
                rgbColors[idx*3]     = view.getUint16(p + colOff,     true) / 65535;
                rgbColors[idx*3 + 1] = view.getUint16(p + colOff + 2, true) / 65535;
                rgbColors[idx*3 + 2] = view.getUint16(p + colOff + 4, true) / 65535;
            }
            idx++;
        }

        return {
            version:      vMajor + '.' + vMinor,
            pointFormat:  pointFormatId,
            totalPoints:  numPoints,
            loadedPoints: idx,
            subsampled:   stride > 1,
            stride,
            hasRGB,
            systemId,
            generatingSoftware,
            bounds:  { minX, maxX, minY, maxY, minZ, maxZ },
            center:  { x: cx, y: cy, z: cz },
            extents: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
            positions:       positions.slice(0, idx * 3),
            rgbColors:       rgbColors.slice(0, idx * 3),
            intensities:     intensities.slice(0, idx),
            classifications: classifications.slice(0, idx),
            crsWKT,
            crsEPSG,
        };
    }

    return { parse };
}());

// ─── Expose globally ──────────────────────────────────────────────────────────
// LAZLoader is now provided by js/laz-decoder.js (pure-JS, no CDN needed).
window.LASParser = LASParser;
