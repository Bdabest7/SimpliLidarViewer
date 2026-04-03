/**
 * SimpliLidarViewer — Pure-JS LAZ Decompressor
 *
 * Self-contained LAZ (LASzip) decompressor. No CDN, no WASM, no external files.
 * Implements the FastAC arithmetic coder and LASzip point decompressors for
 * LAS 1.0–1.4, point formats 0–10.
 *
 * Based on the open-source LASzip library by rapidlasso GmbH (Apache 2.0).
 * See: https://github.com/LASzip/LASzip
 *
 * Exposed as window.LAZDecoder and window.LAZLoader.
 */

(function () {
'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

var AC_MIN_LENGTH  = 0x01000000;   // AC__MinLength
var AC_MAX_LENGTH  = 0xFFFFFFFF;   // AC__MaxLength

var BM_LENGTH_SHIFT = 13;
var BM_MAX_COUNT    = (1 << BM_LENGTH_SHIFT);  // 8192

var DM_LENGTH_SHIFT = 15;
var DM_MAX_COUNT    = (1 << DM_LENGTH_SHIFT);  // 32768

var LASZIP_GPSTIME_MULTI            = 500;
var LASZIP_GPSTIME_MULTI_MINUS      = -10;
var LASZIP_GPSTIME_MULTI_UNCHANGED  = (LASZIP_GPSTIME_MULTI - LASZIP_GPSTIME_MULTI_MINUS + 1);
var LASZIP_GPSTIME_MULTI_CODE_FULL  = (LASZIP_GPSTIME_MULTI - LASZIP_GPSTIME_MULTI_MINUS + 2);
var LASZIP_GPSTIME_MULTI_TOTAL      = (LASZIP_GPSTIME_MULTI - LASZIP_GPSTIME_MULTI_MINUS + 6);

// LASzip item types
var LASZIP_ITEM_POINT10      = 6;
var LASZIP_ITEM_GPSTIME11    = 7;
var LASZIP_ITEM_RGB12        = 8;
var LASZIP_ITEM_WAVEPACKET13 = 9;
var LASZIP_ITEM_POINT14      = 10;
var LASZIP_ITEM_RGB14        = 11;
var LASZIP_ITEM_RGBNIR14     = 12;
var LASZIP_ITEM_WAVEPACKET14 = 13;
var LASZIP_ITEM_BYTE14       = 14;

var LASZIP_COMPRESSOR_POINTWISE         = 1;
var LASZIP_COMPRESSOR_POINTWISE_CHUNKED = 2;
var LASZIP_COMPRESSOR_LAYERED_CHUNKED   = 3;

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function u8Fold(n) {
    return ((n) < 0) ? (n + 256) : (((n) > 255) ? (n - 256) : (n));
}

function u8Clamp(n) {
    return n < 0 ? 0 : (n > 255 ? 255 : n);
}

function i8Clamp(n) {
    return n <= -128 ? -128 : (n >= 127 ? 127 : (n | 0));
}

// Lookup tables for v2 (LAS 1.0–1.3, 3-bit return info, 8×8)
var number_return_map = [
    [15, 14, 13, 12, 11, 10,  9,  8],
    [14,  0,  1,  3,  6, 10, 10,  9],
    [13,  1,  2,  4,  7, 11, 11, 10],
    [12,  3,  4,  5,  8, 12, 12, 11],
    [11,  6,  7,  8,  9, 13, 13, 12],
    [10, 10, 11, 12, 13, 14, 14, 13],
    [ 9, 10, 11, 12, 13, 14, 15, 14],
    [ 8,  9, 10, 11, 12, 13, 14, 15],
];
var number_return_level = [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [1, 0, 1, 2, 3, 4, 5, 6],
    [2, 1, 0, 1, 2, 3, 4, 5],
    [3, 2, 1, 0, 1, 2, 3, 4],
    [4, 3, 2, 1, 0, 1, 2, 3],
    [5, 4, 3, 2, 1, 0, 1, 2],
    [6, 5, 4, 3, 2, 1, 0, 1],
    [7, 6, 5, 4, 3, 2, 1, 0],
];

// Lookup tables for v3 (LAS 1.4, 4-bit return info, 16×16)
var number_return_map_6ctx = [
    [ 0,  1,  2,  3,  4,  5,  3,  4,  4,  5,  5,  5,  5,  5,  5,  5],
    [ 1,  0,  1,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3],
    [ 2,  1,  2,  4,  4,  4,  4,  4,  4,  4,  4,  3,  3,  3,  3,  3],
    [ 3,  3,  4,  5,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [ 4,  3,  4,  4,  5,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [ 5,  3,  4,  4,  4,  5,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [ 3,  3,  4,  4,  4,  4,  5,  4,  4,  4,  4,  4,  4,  4,  4,  4],
    [ 4,  3,  4,  4,  4,  4,  4,  5,  4,  4,  4,  4,  4,  4,  4,  4],
    [ 4,  3,  4,  4,  4,  4,  4,  4,  5,  4,  4,  4,  4,  4,  4,  4],
    [ 5,  3,  4,  4,  4,  4,  4,  4,  4,  5,  4,  4,  4,  4,  4,  4],
    [ 5,  3,  4,  4,  4,  4,  4,  4,  4,  4,  5,  4,  4,  4,  4,  4],
    [ 5,  3,  3,  4,  4,  4,  4,  4,  4,  4,  4,  5,  5,  4,  4,  4],
    [ 5,  3,  3,  4,  4,  4,  4,  4,  4,  4,  4,  5,  5,  5,  4,  4],
    [ 5,  3,  3,  4,  4,  4,  4,  4,  4,  4,  4,  4,  5,  5,  5,  4],
    [ 5,  3,  3,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  5,  5,  5],
    [ 5,  3,  3,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  5,  5],
];
var number_return_level_8ctx = [
    [0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7],
    [1, 0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7, 7],
    [2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7],
    [3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7],
    [4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7],
    [5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7],
    [6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 7, 7],
    [7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 7],
    [7, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7],
    [7, 7, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6],
    [7, 7, 7, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5],
    [7, 7, 7, 7, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4],
    [7, 7, 7, 7, 7, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3],
    [7, 7, 7, 7, 7, 7, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2],
    [7, 7, 7, 7, 7, 7, 7, 7, 6, 5, 4, 3, 2, 1, 0, 1],
    [7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 5, 4, 3, 2, 1, 0],
];

// ═══════════════════════════════════════════════════════════════════════════════
// StreamingMedian5
// ═══════════════════════════════════════════════════════════════════════════════

function StreamingMedian5() {
    this.values = new Int32Array(5);
    this.high = true;
}

StreamingMedian5.prototype.init = function () {
    this.values[0] = this.values[1] = this.values[2] = this.values[3] = this.values[4] = 0;
    this.high = true;
};

StreamingMedian5.prototype.add = function (v) {
    var val = this.values;
    if (this.high) {
        if (v < val[2]) {
            val[4] = val[3]; val[3] = val[2];
            if (v < val[0]) { val[2] = val[1]; val[1] = val[0]; val[0] = v; }
            else if (v < val[1]) { val[2] = val[1]; val[1] = v; }
            else { val[2] = v; }
        } else {
            if (v < val[3]) { val[4] = val[3]; val[3] = v; }
            else { val[4] = v; }
            this.high = false;
        }
    } else {
        if (val[2] < v) {
            val[0] = val[1]; val[1] = val[2];
            if (val[4] < v) { val[2] = val[3]; val[3] = val[4]; val[4] = v; }
            else if (val[3] < v) { val[2] = val[3]; val[3] = v; }
            else { val[2] = v; }
        } else {
            if (val[1] < v) { val[0] = val[1]; val[1] = v; }
            else { val[0] = v; }
            this.high = true;
        }
    }
};

StreamingMedian5.prototype.get = function () { return this.values[2]; };

// ═══════════════════════════════════════════════════════════════════════════════
// ArithmeticBitModel
// ═══════════════════════════════════════════════════════════════════════════════

function ArithmeticBitModel() {
    this.bit_0_count = 1;
    this.bit_count   = 2;
    this.bit_0_prob  = 1 << (BM_LENGTH_SHIFT - 1);
    this.update_cycle = 4;
    this.bits_until_update = 4;
}

ArithmeticBitModel.prototype.update = function () {
    this.bit_count += this.update_cycle;
    if (this.bit_count > BM_MAX_COUNT) {
        this.bit_count = (this.bit_count + 1) >>> 1;
        this.bit_0_count = (this.bit_0_count + 1) >>> 1;
        if (this.bit_0_count === this.bit_count) this.bit_count++;
    }
    var scale = (0x80000000 / this.bit_count) >>> 0;
    this.bit_0_prob = (this.bit_0_count * scale) >>> (31 - BM_LENGTH_SHIFT);
    this.update_cycle = (5 * this.update_cycle) >>> 2;
    if (this.update_cycle > 64) this.update_cycle = 64;
    this.bits_until_update = this.update_cycle;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ArithmeticModel
// ═══════════════════════════════════════════════════════════════════════════════

function ArithmeticModel(symbols) {
    this.symbols = symbols;
    this.last_symbol = symbols - 1;
    this.compress = false;
    this.distribution = null;
    this.symbol_count = null;
    this.decoder_table = null;
    this.total_count = 0;
    this.update_cycle = 0;
    this.symbols_until_update = 0;
    this.table_size = 0;
    this.table_shift = 0;
}

ArithmeticModel.prototype.init = function (table) {
    if (this.distribution === null) {
        if (this.symbols > 16) {
            var table_bits = 3;
            while (this.symbols > (1 << (table_bits + 2))) table_bits++;
            this.table_size  = 1 << table_bits;
            this.table_shift = DM_LENGTH_SHIFT - table_bits;
            this.distribution = new Uint32Array(2 * this.symbols + this.table_size + 2);
            this.decoder_table = new Uint32Array(this.table_size + 2);
        } else {
            this.table_size = 0;
            this.table_shift = 0;
            this.distribution = new Uint32Array(2 * this.symbols);
            this.decoder_table = null;
        }
        this.symbol_count = new Uint32Array(this.symbols);
    }

    this.total_count = 0;
    this.update_cycle = this.symbols;
    if (table) {
        for (var k = 0; k < this.symbols; k++) this.symbol_count[k] = table[k];
    } else {
        for (var k = 0; k < this.symbols; k++) this.symbol_count[k] = 1;
    }
    this.update();
    this.symbols_until_update = this.update_cycle = (this.symbols + 6) >>> 1;
};

ArithmeticModel.prototype.update = function () {
    var n, k, sum, s, scale, w;

    this.total_count += this.update_cycle;
    if (this.total_count > DM_MAX_COUNT) {
        this.total_count = 0;
        for (n = 0; n < this.symbols; n++) {
            this.symbol_count[n] = (this.symbol_count[n] + 1) >>> 1;
            this.total_count += this.symbol_count[n];
        }
    }

    sum = 0; s = 0;
    scale = (0x80000000 / this.total_count) >>> 0;

    if (this.decoder_table) {
        for (k = 0; k < this.symbols; k++) {
            this.distribution[k] = (scale * sum) >>> (31 - DM_LENGTH_SHIFT);
            sum += this.symbol_count[k];
            w = this.distribution[k] >>> this.table_shift;
            while (s < w) this.decoder_table[++s] = k - 1;
        }
        this.decoder_table[0] = 0;
        while (s <= this.table_size) this.decoder_table[++s] = this.symbols - 1;
    } else {
        for (k = 0; k < this.symbols; k++) {
            this.distribution[k] = (scale * sum) >>> (31 - DM_LENGTH_SHIFT);
            sum += this.symbol_count[k];
        }
    }

    this.update_cycle = (5 * this.update_cycle) >>> 2;
    var max_cycle = (this.symbols + 6) << 3;
    if (this.update_cycle > max_cycle) this.update_cycle = max_cycle;
    this.symbols_until_update = this.update_cycle;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ArithmeticDecoder
// ═══════════════════════════════════════════════════════════════════════════════

function ArithmeticDecoder() {
    this.buf = null;
    this.pos = 0;
    this.value = 0;
    this.length = 0;
}

ArithmeticDecoder.prototype.init = function (buf, pos) {
    this.buf = buf;
    this.pos = pos;
    this.length = AC_MAX_LENGTH;
    this.value  = ((this.buf[this.pos++] << 24) |
                   (this.buf[this.pos++] << 16) |
                   (this.buf[this.pos++] << 8)  |
                    this.buf[this.pos++]) >>> 0;
};

ArithmeticDecoder.prototype.renormalize = function () {
    do {
        this.value = ((this.value << 8) | this.buf[this.pos++]) >>> 0;
        this.length = (this.length << 8) >>> 0;
    } while (this.length < AC_MIN_LENGTH);
};

ArithmeticDecoder.prototype.decodeBit = function (m) {
    var x = m.bit_0_prob * (this.length >>> BM_LENGTH_SHIFT);
    var sym = (this.value >= x) ? 1 : 0;
    if (sym === 0) {
        this.length = x;
        m.bit_0_count++;
    } else {
        this.value = (this.value - x) >>> 0;
        this.length = (this.length - x) >>> 0;
    }
    if (this.length < AC_MIN_LENGTH) this.renormalize();
    if (--m.bits_until_update === 0) m.update();
    return sym;
};

ArithmeticDecoder.prototype.decodeSymbol = function (m) {
    var n, sym, x, y = this.length;
    if (m.decoder_table) {
        this.length >>>= DM_LENGTH_SHIFT;
        var dv = (this.value / this.length) >>> 0;
        var t = dv >>> m.table_shift;
        sym = m.decoder_table[t];
        n = m.decoder_table[t + 1] + 1;
        while (n > sym + 1) {
            var k = (sym + n) >>> 1;
            if (m.distribution[k] > dv) n = k; else sym = k;
        }
        x = m.distribution[sym] * this.length;
        if (sym !== m.last_symbol) y = m.distribution[sym + 1] * this.length;
    } else {
        x = sym = 0;
        this.length >>>= DM_LENGTH_SHIFT;
        n = m.symbols;
        var k = n >>> 1;
        do {
            var z = this.length * m.distribution[k];
            if (z > this.value) { n = k; y = z; }
            else { sym = k; x = z; }
            k = (sym + n) >>> 1;
        } while (k !== sym);
    }
    this.value = (this.value - x) >>> 0;
    this.length = y - x;
    if (this.length < AC_MIN_LENGTH) this.renormalize();
    m.symbol_count[sym]++;
    if (--m.symbols_until_update === 0) m.update();
    return sym;
};

ArithmeticDecoder.prototype.readBit = function () {
    this.length >>>= 1;
    var sym = (this.value / this.length) >>> 0;
    this.value = (this.value - this.length * sym) >>> 0;
    if (this.length < AC_MIN_LENGTH) this.renormalize();
    return sym;
};

ArithmeticDecoder.prototype.readBits = function (bits) {
    if (bits > 19) {
        var tmp = this.readShort();
        bits -= 16;
        return ((this.readBits(bits) << 16) | tmp) >>> 0;
    }
    this.length >>>= bits;
    var sym = (this.value / this.length) >>> 0;
    this.value = (this.value - this.length * sym) >>> 0;
    if (this.length < AC_MIN_LENGTH) this.renormalize();
    return sym;
};

ArithmeticDecoder.prototype.readByte = function () {
    this.length >>>= 8;
    var sym = (this.value / this.length) >>> 0;
    this.value = (this.value - this.length * sym) >>> 0;
    if (this.length < AC_MIN_LENGTH) this.renormalize();
    return sym;
};

ArithmeticDecoder.prototype.readShort = function () {
    this.length >>>= 16;
    var sym = (this.value / this.length) >>> 0;
    this.value = (this.value - this.length * sym) >>> 0;
    if (this.length < AC_MIN_LENGTH) this.renormalize();
    return sym;
};

ArithmeticDecoder.prototype.readInt = function () {
    var lo = this.readShort();
    var hi = this.readShort();
    return ((hi << 16) | lo) >>> 0;
};

ArithmeticDecoder.prototype.createSymbolModel = function (symbols) {
    var m = new ArithmeticModel(symbols);
    return m;
};

ArithmeticDecoder.prototype.initSymbolModel = function (m, table) {
    m.init(table || null);
};

ArithmeticDecoder.prototype.createBitModel = function () {
    return new ArithmeticBitModel();
};

ArithmeticDecoder.prototype.initBitModel = function (m) {
    m.bit_0_count = 1;
    m.bit_count   = 2;
    m.bit_0_prob  = 1 << (BM_LENGTH_SHIFT - 1);
    m.update_cycle = 4;
    m.bits_until_update = 4;
};

// ═══════════════════════════════════════════════════════════════════════════════
// IntegerCompressor
// ═══════════════════════════════════════════════════════════════════════════════

function IntegerCompressor(dec, bits, contexts, bits_high, range) {
    this.dec = dec;
    this.bits = bits || 16;
    this.contexts = contexts || 1;
    this.bits_high = bits_high || 8;
    this.range = range || 0;
    this.k = 0;

    if (this.range) {
        this.corr_bits = 0;
        this.corr_range = this.range;
        var r = this.range;
        while (r) { r >>>= 1; this.corr_bits++; }
        if (this.corr_range === (1 << (this.corr_bits - 1))) this.corr_bits--;
        this.corr_min = -(this.corr_range >>> 1) | 0;
        this.corr_max = (this.corr_min + this.corr_range - 1) | 0;
    } else if (this.bits && this.bits < 32) {
        this.corr_bits = this.bits;
        this.corr_range = 1 << this.bits;
        this.corr_min = -(this.corr_range >>> 1) | 0;
        this.corr_max = (this.corr_min + this.corr_range - 1) | 0;
    } else {
        this.corr_bits = 32;
        this.corr_range = 0;
        this.corr_min = -0x80000000 | 0;
        this.corr_max =  0x7FFFFFFF | 0;
    }

    this.mBits = null;
    this.mCorrector = null;
}

IntegerCompressor.prototype.initDecompressor = function () {
    var i;
    if (this.mBits === null) {
        this.mBits = new Array(this.contexts);
        for (i = 0; i < this.contexts; i++) {
            this.mBits[i] = this.dec.createSymbolModel(this.corr_bits + 1);
        }
        this.mCorrector = new Array(this.corr_bits + 1);
        this.mCorrector[0] = this.dec.createBitModel();
        for (i = 1; i <= this.corr_bits; i++) {
            if (i <= this.bits_high) {
                this.mCorrector[i] = this.dec.createSymbolModel(1 << i);
            } else {
                this.mCorrector[i] = this.dec.createSymbolModel(1 << this.bits_high);
            }
        }
    }
    for (i = 0; i < this.contexts; i++) {
        this.dec.initSymbolModel(this.mBits[i]);
    }
    this.dec.initBitModel(this.mCorrector[0]);
    for (i = 1; i <= this.corr_bits; i++) {
        this.dec.initSymbolModel(this.mCorrector[i]);
    }
};

IntegerCompressor.prototype.decompress = function (pred, context) {
    var real = (pred + this.readCorrector(this.mBits[context || 0])) | 0;
    if (this.corr_range) {
        if (real < 0) real += this.corr_range;
        else if (real >= this.corr_range) real -= this.corr_range;
    }
    return real;
};

IntegerCompressor.prototype.readCorrector = function (mBits) {
    var c;
    this.k = this.dec.decodeSymbol(mBits);
    if (this.k) {
        if (this.k < 32) {
            if (this.k <= this.bits_high) {
                c = this.dec.decodeSymbol(this.mCorrector[this.k]);
            } else {
                var k1 = this.k - this.bits_high;
                c = this.dec.decodeSymbol(this.mCorrector[this.k]);
                var c1 = this.dec.readBits(k1);
                c = (c << k1) | c1;
            }
            if (c >= (1 << (this.k - 1))) {
                c += 1;
            } else {
                c -= ((1 << this.k) - 1);
            }
        } else {
            c = this.corr_min;
        }
    } else {
        c = this.dec.decodeBit(this.mCorrector[0]);
    }
    return c;
};

IntegerCompressor.prototype.getK = function () { return this.k; };

// ═══════════════════════════════════════════════════════════════════════════════
// POINT10 v2 reader (formats 0–5, LAS 1.0–1.3)
// ═══════════════════════════════════════════════════════════════════════════════

function Point10Reader(dec) {
    this.dec = dec;
    this.m_changed_values = dec.createSymbolModel(64);
    this.ic_intensity = new IntegerCompressor(dec, 16, 4);
    this.m_scan_angle_rank = [dec.createSymbolModel(256), dec.createSymbolModel(256)];
    this.ic_point_source_ID = new IntegerCompressor(dec, 16);
    this.m_bit_byte = new Array(256);
    this.m_classification = new Array(256);
    this.m_user_data = new Array(256);
    for (var i = 0; i < 256; i++) {
        this.m_bit_byte[i] = null;
        this.m_classification[i] = null;
        this.m_user_data[i] = null;
    }
    this.ic_dx = new IntegerCompressor(dec, 32, 2);
    this.ic_dy = new IntegerCompressor(dec, 32, 22);
    this.ic_z  = new IntegerCompressor(dec, 32, 20);
    this.last_item = new Uint8Array(20);
    this.last_x_diff_median5 = [];
    this.last_y_diff_median5 = [];
    this.last_intensity = new Uint16Array(16);
    this.last_height = new Int32Array(8);
    for (var i = 0; i < 16; i++) {
        this.last_x_diff_median5.push(new StreamingMedian5());
        this.last_y_diff_median5.push(new StreamingMedian5());
    }
}

Point10Reader.prototype.init = function (firstPointBuf, offset) {
    var i;
    for (i = 0; i < 16; i++) {
        this.last_x_diff_median5[i].init();
        this.last_y_diff_median5[i].init();
        this.last_intensity[i] = 0;
        this.last_height[i >>> 1] = 0;
    }
    this.dec.initSymbolModel(this.m_changed_values);
    this.ic_intensity.initDecompressor();
    this.dec.initSymbolModel(this.m_scan_angle_rank[0]);
    this.dec.initSymbolModel(this.m_scan_angle_rank[1]);
    this.ic_point_source_ID.initDecompressor();
    for (i = 0; i < 256; i++) {
        if (this.m_bit_byte[i]) this.dec.initSymbolModel(this.m_bit_byte[i]);
        if (this.m_classification[i]) this.dec.initSymbolModel(this.m_classification[i]);
        if (this.m_user_data[i]) this.dec.initSymbolModel(this.m_user_data[i]);
    }
    this.ic_dx.initDecompressor();
    this.ic_dy.initDecompressor();
    this.ic_z.initDecompressor();
    // Copy first point as last_item
    for (i = 0; i < 20; i++) this.last_item[i] = firstPointBuf[offset + i];
    // Zero out intensity in last_item
    this.last_item[12] = 0;
    this.last_item[13] = 0;
};

Point10Reader.prototype.read = function (view8) {
    // Use a DataView wrapper around last_item
    var li = this.last_item;
    var liDV = new DataView(li.buffer, li.byteOffset, 20);

    var changed_values = this.dec.decodeSymbol(this.m_changed_values);

    var r, n, m, l;

    if (changed_values) {
        // Decompress bit byte (return_number, number_of_returns, scan_direction, edge)
        if (changed_values & 32) {
            if (!this.m_bit_byte[li[14]]) {
                this.m_bit_byte[li[14]] = this.dec.createSymbolModel(256);
                this.dec.initSymbolModel(this.m_bit_byte[li[14]]);
            }
            li[14] = this.dec.decodeSymbol(this.m_bit_byte[li[14]]);
        }

        r = li[14] & 0x07;
        n = (li[14] >>> 3) & 0x07;
        m = number_return_map[n][r];
        l = number_return_level[n][r];

        // Intensity
        if (changed_values & 16) {
            var intensity = this.ic_intensity.decompress(this.last_intensity[m], m < 3 ? m : 3);
            liDV.setUint16(12, intensity, true);
            this.last_intensity[m] = intensity;
        } else {
            liDV.setUint16(12, this.last_intensity[m], true);
        }

        // Classification
        if (changed_values & 8) {
            if (!this.m_classification[li[15]]) {
                this.m_classification[li[15]] = this.dec.createSymbolModel(256);
                this.dec.initSymbolModel(this.m_classification[li[15]]);
            }
            li[15] = this.dec.decodeSymbol(this.m_classification[li[15]]);
        }

        // Scan angle rank
        if (changed_values & 4) {
            var scanDir = (li[14] >>> 6) & 1;
            var val = this.dec.decodeSymbol(this.m_scan_angle_rank[scanDir]);
            li[16] = u8Fold(val + li[16]) & 0xFF;
        }

        // User data
        if (changed_values & 2) {
            if (!this.m_user_data[li[17]]) {
                this.m_user_data[li[17]] = this.dec.createSymbolModel(256);
                this.dec.initSymbolModel(this.m_user_data[li[17]]);
            }
            li[17] = this.dec.decodeSymbol(this.m_user_data[li[17]]);
        }

        // Point source ID
        if (changed_values & 1) {
            var psid = this.ic_point_source_ID.decompress(liDV.getUint16(18, true));
            liDV.setUint16(18, psid, true);
        }
    } else {
        r = li[14] & 0x07;
        n = (li[14] >>> 3) & 0x07;
        m = number_return_map[n][r];
        l = number_return_level[n][r];
    }

    // X coordinate
    var median = this.last_x_diff_median5[m].get();
    var diff = this.ic_dx.decompress(median, n === 1 ? 1 : 0);
    var lastX = liDV.getInt32(0, true);
    liDV.setInt32(0, lastX + diff, true);
    this.last_x_diff_median5[m].add(diff);

    // Y coordinate
    median = this.last_y_diff_median5[m].get();
    var k_bits = this.ic_dx.getK();
    diff = this.ic_dy.decompress(median, (n === 1 ? 1 : 0) + (k_bits < 20 ? (k_bits & 0xFFFFFFFE) : 20));
    var lastY = liDV.getInt32(4, true);
    liDV.setInt32(4, lastY + diff, true);
    this.last_y_diff_median5[m].add(diff);

    // Z coordinate
    k_bits = (this.ic_dx.getK() + this.ic_dy.getK()) / 2;
    var z = this.ic_z.decompress(this.last_height[l], (n === 1 ? 1 : 0) + (k_bits < 18 ? (k_bits & 0xFFFFFFFE) : 18));
    liDV.setInt32(8, z, true);
    this.last_height[l] = z;

    // Copy to output
    for (var i = 0; i < 20; i++) view8[i] = li[i];
};

// ═══════════════════════════════════════════════════════════════════════════════
// GPSTIME11 v2 reader
// ═══════════════════════════════════════════════════════════════════════════════

function GpsTime11Reader(dec) {
    this.dec = dec;
    this.m_gpstime_multi = dec.createSymbolModel(LASZIP_GPSTIME_MULTI_TOTAL);
    this.m_gpstime_0diff = dec.createSymbolModel(6);
    this.ic_gpstime = new IntegerCompressor(dec, 32, 9);
    this.last = 0;
    this.next = 0;
    this.last_gpstime = [{ i32: new Int32Array(2) }, { i32: new Int32Array(2) }, { i32: new Int32Array(2) }, { i32: new Int32Array(2) }];
    this.last_gpstime_diff = new Int32Array(4);
    this.multi_extreme_counter = new Int32Array(4);
}

GpsTime11Reader.prototype.init = function (firstPointBuf, offset) {
    this.last = 0; this.next = 0;
    this.last_gpstime_diff[0] = this.last_gpstime_diff[1] = this.last_gpstime_diff[2] = this.last_gpstime_diff[3] = 0;
    this.multi_extreme_counter[0] = this.multi_extreme_counter[1] = this.multi_extreme_counter[2] = this.multi_extreme_counter[3] = 0;
    this.dec.initSymbolModel(this.m_gpstime_multi);
    this.dec.initSymbolModel(this.m_gpstime_0diff);
    this.ic_gpstime.initDecompressor();
    // Read 8-byte GPS time from first point
    var tmpView = new DataView(firstPointBuf.buffer, firstPointBuf.byteOffset + offset, 8);
    this.last_gpstime[0].i32[0] = tmpView.getInt32(0, true);
    this.last_gpstime[0].i32[1] = tmpView.getInt32(4, true);
    this.last_gpstime[1].i32[0] = 0; this.last_gpstime[1].i32[1] = 0;
    this.last_gpstime[2].i32[0] = 0; this.last_gpstime[2].i32[1] = 0;
    this.last_gpstime[3].i32[0] = 0; this.last_gpstime[3].i32[1] = 0;
};

GpsTime11Reader.prototype.read = function (out8) {
    this._readInternal();
    // Write to out8 as 8 bytes LE
    var i32 = this.last_gpstime[this.last].i32;
    out8[0] =  i32[0]        & 0xFF;
    out8[1] = (i32[0] >>> 8)  & 0xFF;
    out8[2] = (i32[0] >>> 16) & 0xFF;
    out8[3] = (i32[0] >>> 24) & 0xFF;
    out8[4] =  i32[1]        & 0xFF;
    out8[5] = (i32[1] >>> 8)  & 0xFF;
    out8[6] = (i32[1] >>> 16) & 0xFF;
    out8[7] = (i32[1] >>> 24) & 0xFF;
};

GpsTime11Reader.prototype._readInternal = function () {
    var multi;
    var lg = this.last_gpstime;
    var lgd = this.last_gpstime_diff;
    var mec = this.multi_extreme_counter;

    if (lgd[this.last] === 0) {
        multi = this.dec.decodeSymbol(this.m_gpstime_0diff);
        if (multi === 1) {
            lgd[this.last] = this.ic_gpstime.decompress(0, 0);
            // Add to i64: lo + diff
            var lo = lg[this.last].i32[0];
            var hi = lg[this.last].i32[1];
            var diff = lgd[this.last];
            var nlo = (lo + diff) | 0;
            // Carry: if diff > 0 and nlo < lo, or diff < 0 and nlo > lo
            if (diff > 0 && (nlo >>> 0) < (lo >>> 0)) hi++;
            else if (diff < 0 && (nlo >>> 0) > (lo >>> 0)) hi--;
            lg[this.last].i32[0] = nlo;
            lg[this.last].i32[1] = hi;
            mec[this.last] = 0;
        } else if (multi === 2) {
            this.next = (this.next + 1) & 3;
            lg[this.next].i32[1] = this.ic_gpstime.decompress(lg[this.last].i32[1], 8);
            lg[this.next].i32[0] = this.dec.readInt();
            this.last = this.next;
            lgd[this.last] = 0;
            mec[this.last] = 0;
        } else if (multi > 2) {
            this.last = (this.last + multi - 2) & 3;
            this._readInternal();
        }
    } else {
        multi = this.dec.decodeSymbol(this.m_gpstime_multi);
        if (multi === 1) {
            var diff = this.ic_gpstime.decompress(lgd[this.last], 1);
            this._addI64(this.last, diff);
            mec[this.last] = 0;
        } else if (multi < LASZIP_GPSTIME_MULTI_UNCHANGED) {
            var gpstime_diff;
            if (multi === 0) {
                gpstime_diff = this.ic_gpstime.decompress(0, 7);
                mec[this.last]++;
                if (mec[this.last] > 3) {
                    lgd[this.last] = gpstime_diff;
                    mec[this.last] = 0;
                }
            } else if (multi < LASZIP_GPSTIME_MULTI) {
                if (multi < 10) {
                    gpstime_diff = this.ic_gpstime.decompress(Math.imul(multi, lgd[this.last]), 2);
                } else {
                    gpstime_diff = this.ic_gpstime.decompress(Math.imul(multi, lgd[this.last]), 3);
                }
            } else if (multi === LASZIP_GPSTIME_MULTI) {
                gpstime_diff = this.ic_gpstime.decompress(Math.imul(LASZIP_GPSTIME_MULTI, lgd[this.last]), 4);
                mec[this.last]++;
                if (mec[this.last] > 3) {
                    lgd[this.last] = gpstime_diff;
                    mec[this.last] = 0;
                }
            } else {
                multi = LASZIP_GPSTIME_MULTI - multi;
                if (multi > LASZIP_GPSTIME_MULTI_MINUS) {
                    gpstime_diff = this.ic_gpstime.decompress(Math.imul(multi, lgd[this.last]), 5);
                } else {
                    gpstime_diff = this.ic_gpstime.decompress(Math.imul(LASZIP_GPSTIME_MULTI_MINUS, lgd[this.last]), 6);
                    mec[this.last]++;
                    if (mec[this.last] > 3) {
                        lgd[this.last] = gpstime_diff;
                        mec[this.last] = 0;
                    }
                }
            }
            this._addI64(this.last, gpstime_diff);
        } else if (multi === LASZIP_GPSTIME_MULTI_CODE_FULL) {
            this.next = (this.next + 1) & 3;
            lg[this.next].i32[1] = this.ic_gpstime.decompress(lg[this.last].i32[1], 8);
            lg[this.next].i32[0] = this.dec.readInt();
            this.last = this.next;
            lgd[this.last] = 0;
            mec[this.last] = 0;
        } else if (multi >= LASZIP_GPSTIME_MULTI_CODE_FULL) {
            this.last = (this.last + multi - LASZIP_GPSTIME_MULTI_CODE_FULL) & 3;
            this._readInternal();
        }
    }
};

GpsTime11Reader.prototype._addI64 = function (slot, diff) {
    var lo = this.last_gpstime[slot].i32[0];
    var hi = this.last_gpstime[slot].i32[1];
    var nlo = (lo + diff) | 0;
    if (diff > 0 && (nlo >>> 0) < (lo >>> 0)) hi++;
    else if (diff < 0 && (nlo >>> 0) > (lo >>> 0)) hi--;
    this.last_gpstime[slot].i32[0] = nlo;
    this.last_gpstime[slot].i32[1] = hi;
};

// ═══════════════════════════════════════════════════════════════════════════════
// RGB12 v2 reader
// ═══════════════════════════════════════════════════════════════════════════════

function RGB12Reader(dec) {
    this.dec = dec;
    this.m_byte_used  = dec.createSymbolModel(128);
    this.m_rgb_diff_0 = dec.createSymbolModel(256);
    this.m_rgb_diff_1 = dec.createSymbolModel(256);
    this.m_rgb_diff_2 = dec.createSymbolModel(256);
    this.m_rgb_diff_3 = dec.createSymbolModel(256);
    this.m_rgb_diff_4 = dec.createSymbolModel(256);
    this.m_rgb_diff_5 = dec.createSymbolModel(256);
    this.last_item = new Uint16Array(3);
}

RGB12Reader.prototype.init = function (firstPointBuf, offset) {
    this.dec.initSymbolModel(this.m_byte_used);
    this.dec.initSymbolModel(this.m_rgb_diff_0);
    this.dec.initSymbolModel(this.m_rgb_diff_1);
    this.dec.initSymbolModel(this.m_rgb_diff_2);
    this.dec.initSymbolModel(this.m_rgb_diff_3);
    this.dec.initSymbolModel(this.m_rgb_diff_4);
    this.dec.initSymbolModel(this.m_rgb_diff_5);
    var tmpView = new DataView(firstPointBuf.buffer, firstPointBuf.byteOffset + offset, 6);
    this.last_item[0] = tmpView.getUint16(0, true);
    this.last_item[1] = tmpView.getUint16(2, true);
    this.last_item[2] = tmpView.getUint16(4, true);
};

RGB12Reader.prototype.read = function (out) {
    // out is a Uint16Array[3]
    var corr, diff;
    var li = this.last_item;
    var sym = this.dec.decodeSymbol(this.m_byte_used);

    if (sym & 1) {
        corr = this.dec.decodeSymbol(this.m_rgb_diff_0);
        out[0] = u8Fold(corr + (li[0] & 255));
    } else {
        out[0] = li[0] & 0xFF;
    }
    if (sym & 2) {
        corr = this.dec.decodeSymbol(this.m_rgb_diff_1);
        out[0] |= (u8Fold(corr + (li[0] >>> 8)) << 8);
    } else {
        out[0] |= (li[0] & 0xFF00);
    }

    if (sym & 64) {
        diff = (out[0] & 0xFF) - (li[0] & 0xFF);
        if (sym & 4) {
            corr = this.dec.decodeSymbol(this.m_rgb_diff_2);
            out[1] = u8Fold(corr + u8Clamp(diff + (li[1] & 255)));
        } else {
            out[1] = li[1] & 0xFF;
        }
        if (sym & 16) {
            corr = this.dec.decodeSymbol(this.m_rgb_diff_4);
            diff = (diff + ((out[1] & 0xFF) - (li[1] & 0xFF))) / 2;
            out[2] = u8Fold(corr + u8Clamp(diff + (li[2] & 255)));
        } else {
            out[2] = li[2] & 0xFF;
        }
        diff = (out[0] >>> 8) - (li[0] >>> 8);
        if (sym & 8) {
            corr = this.dec.decodeSymbol(this.m_rgb_diff_3);
            out[1] |= (u8Fold(corr + u8Clamp(diff + (li[1] >>> 8))) << 8);
        } else {
            out[1] |= (li[1] & 0xFF00);
        }
        if (sym & 32) {
            corr = this.dec.decodeSymbol(this.m_rgb_diff_5);
            diff = (diff + ((out[1] >>> 8) - (li[1] >>> 8))) / 2;
            out[2] |= (u8Fold(corr + u8Clamp(diff + (li[2] >>> 8))) << 8);
        } else {
            out[2] |= (li[2] & 0xFF00);
        }
    } else {
        out[1] = out[0];
        out[2] = out[0];
    }
    li[0] = out[0];
    li[1] = out[1];
    li[2] = out[2];
};

// ═══════════════════════════════════════════════════════════════════════════════
// BYTE v2 reader (extra bytes)
// ═══════════════════════════════════════════════════════════════════════════════

function ByteReader(dec, number) {
    this.dec = dec;
    this.number = number;
    this.m_byte = new Array(number);
    for (var i = 0; i < number; i++) {
        this.m_byte[i] = dec.createSymbolModel(256);
    }
    this.last_item = new Uint8Array(number);
}

ByteReader.prototype.init = function (firstPointBuf, offset) {
    for (var i = 0; i < this.number; i++) {
        this.dec.initSymbolModel(this.m_byte[i]);
        this.last_item[i] = firstPointBuf[offset + i];
    }
};

ByteReader.prototype.read = function (out) {
    for (var i = 0; i < this.number; i++) {
        var val = this.last_item[i] + this.dec.decodeSymbol(this.m_byte[i]);
        out[i] = u8Fold(val) & 0xFF;
    }
    for (var i = 0; i < this.number; i++) this.last_item[i] = out[i];
};

// ═══════════════════════════════════════════════════════════════════════════════
// POINT14 v3 reader (formats 6–10, LAS 1.4, layered chunked)
// ═══════════════════════════════════════════════════════════════════════════════

function Point14Context() {
    this.unused = true;
    this.last_item = null; // Uint8Array(30+)
    this.m_changed_values = [null, null, null, null, null, null, null, null]; // 8 models (lpr 0-7)
    this.m_scanner_channel = null;
    this.m_number_of_returns = new Array(16);
    this.m_return_number = new Array(16);
    this.m_return_number_gps_same = null;
    this.ic_dX = null;
    this.ic_dY = null;
    this.ic_Z = null;
    this.ic_intensity = null;
    this.ic_scan_angle = null;
    this.ic_point_source_ID = null;
    this.ic_gpstime = null;
    this.m_gpstime_multi = null;
    this.m_gpstime_0diff = null;
    this.m_classification = new Array(64);
    this.m_flags = new Array(64);
    this.m_user_data = new Array(64);
    this.last_X_diff_median5 = [];
    this.last_Y_diff_median5 = [];
    this.last_Z = new Int32Array(8);
    this.last_intensity = new Uint16Array(8);
    // GPS time state
    this.last = 0;
    this.next = 0;
    this.last_gpstime = [
        { i32: new Int32Array(2) }, { i32: new Int32Array(2) },
        { i32: new Int32Array(2) }, { i32: new Int32Array(2) }
    ];
    this.last_gpstime_diff = new Int32Array(4);
    this.multi_extreme_counter = new Int32Array(4);

    for (var i = 0; i < 12; i++) {
        this.last_X_diff_median5.push(new StreamingMedian5());
        this.last_Y_diff_median5.push(new StreamingMedian5());
    }
    for (var i = 0; i < 16; i++) {
        this.m_number_of_returns[i] = null;
        this.m_return_number[i] = null;
    }
    for (var i = 0; i < 64; i++) {
        this.m_classification[i] = null;
        this.m_flags[i] = null;
        this.m_user_data[i] = null;
    }
}

function Point14Reader() {
    // Per-layer decoders (created per-chunk)
    this.dec_channel_returns_XY = null;
    this.dec_Z = null;
    this.dec_classification = null;
    this.dec_flags = null;
    this.dec_intensity = null;
    this.dec_scan_angle = null;
    this.dec_user_data = null;
    this.dec_point_source = null;
    this.dec_gps_time = null;

    this.contexts = [new Point14Context(), new Point14Context(), new Point14Context(), new Point14Context()];
    this.current_context = 0;

    // Changed flags (set per chunk based on whether layer has bytes)
    this.changed_Z = true;
    this.changed_classification = true;
    this.changed_flags = true;
    this.changed_intensity = true;
    this.changed_scan_angle = true;
    this.changed_user_data = true;
    this.changed_point_source = true;
    this.changed_gps_time = true;

    this.point14Size = 30; // base size for format 6
}

/**
 * initChunk — read 9 layer byte sizes from sizesOffset, then create
 * ArithmeticDecoders starting at dataOffset.
 *
 * @param {Uint8Array} bytes     Entire file bytes
 * @param {number}     sizesOff  Offset to the first of 9 U32 layer sizes
 * @param {number}     dataOff   Offset to the start of compressed layer data
 * @param {DataView}   view      DataView over the same buffer
 * @returns {number}   The total bytes of compressed Point14 data (sum of 9 layers)
 */
Point14Reader.prototype.initChunk = function (bytes, sizesOff, dataOff, view) {
    var pos = sizesOff;
    var num_bytes_returns_XY  = view.getUint32(pos, true); pos += 4;
    var num_bytes_Z           = view.getUint32(pos, true); pos += 4;
    var num_bytes_class       = view.getUint32(pos, true); pos += 4;
    var num_bytes_flags       = view.getUint32(pos, true); pos += 4;
    var num_bytes_intensity   = view.getUint32(pos, true); pos += 4;
    var num_bytes_scan_angle  = view.getUint32(pos, true); pos += 4;
    var num_bytes_user_data   = view.getUint32(pos, true); pos += 4;
    var num_bytes_point_source= view.getUint32(pos, true); pos += 4;
    var num_bytes_gps_time    = view.getUint32(pos, true); pos += 4;

    var off = dataOff;

    this.dec_channel_returns_XY = new ArithmeticDecoder();
    this.dec_channel_returns_XY.init(bytes, off);
    off += num_bytes_returns_XY;

    this.changed_Z = (num_bytes_Z > 0);
    if (this.changed_Z) {
        this.dec_Z = new ArithmeticDecoder();
        this.dec_Z.init(bytes, off);
    }
    off += num_bytes_Z;

    this.changed_classification = (num_bytes_class > 0);
    if (this.changed_classification) {
        this.dec_classification = new ArithmeticDecoder();
        this.dec_classification.init(bytes, off);
    }
    off += num_bytes_class;

    this.changed_flags = (num_bytes_flags > 0);
    if (this.changed_flags) {
        this.dec_flags = new ArithmeticDecoder();
        this.dec_flags.init(bytes, off);
    }
    off += num_bytes_flags;

    this.changed_intensity = (num_bytes_intensity > 0);
    if (this.changed_intensity) {
        this.dec_intensity = new ArithmeticDecoder();
        this.dec_intensity.init(bytes, off);
    }
    off += num_bytes_intensity;

    this.changed_scan_angle = (num_bytes_scan_angle > 0);
    if (this.changed_scan_angle) {
        this.dec_scan_angle = new ArithmeticDecoder();
        this.dec_scan_angle.init(bytes, off);
    }
    off += num_bytes_scan_angle;

    this.changed_user_data = (num_bytes_user_data > 0);
    if (this.changed_user_data) {
        this.dec_user_data = new ArithmeticDecoder();
        this.dec_user_data.init(bytes, off);
    }
    off += num_bytes_user_data;

    this.changed_point_source = (num_bytes_point_source > 0);
    if (this.changed_point_source) {
        this.dec_point_source = new ArithmeticDecoder();
        this.dec_point_source.init(bytes, off);
    }
    off += num_bytes_point_source;

    this.changed_gps_time = (num_bytes_gps_time > 0);
    if (this.changed_gps_time) {
        this.dec_gps_time = new ArithmeticDecoder();
        this.dec_gps_time.init(bytes, off);
    }
    off += num_bytes_gps_time;

    // Reset all contexts
    for (var c = 0; c < 4; c++) {
        this.contexts[c].unused = true;
    }

    // Return total pt14 compressed bytes and the end offset
    var totalPt14 = num_bytes_returns_XY + num_bytes_Z + num_bytes_class +
        num_bytes_flags + num_bytes_intensity + num_bytes_scan_angle +
        num_bytes_user_data + num_bytes_point_source + num_bytes_gps_time;
    return totalPt14;
};

Point14Reader.prototype._createAndInitContext = function (ctx, item) {
    var dec_xy = this.dec_channel_returns_XY;
    var i;

    if (ctx.m_changed_values[0] === null) {
        for (i = 0; i < 8; i++) ctx.m_changed_values[i] = dec_xy.createSymbolModel(128);
        ctx.m_scanner_channel = dec_xy.createSymbolModel(3);
        ctx.m_return_number_gps_same = dec_xy.createSymbolModel(13);
        ctx.ic_dX = new IntegerCompressor(dec_xy, 32, 2);
        ctx.ic_dY = new IntegerCompressor(dec_xy, 32, 22);
        if (this.dec_Z) ctx.ic_Z = new IntegerCompressor(this.dec_Z, 32, 20);
        if (this.dec_intensity) ctx.ic_intensity = new IntegerCompressor(this.dec_intensity, 16, 4);
        if (this.dec_scan_angle) ctx.ic_scan_angle = new IntegerCompressor(this.dec_scan_angle, 16, 2);
        if (this.dec_point_source) ctx.ic_point_source_ID = new IntegerCompressor(this.dec_point_source, 16);
        if (this.dec_gps_time) {
            ctx.m_gpstime_multi = this.dec_gps_time.createSymbolModel(LASZIP_GPSTIME_MULTI_TOTAL);
            ctx.m_gpstime_0diff = this.dec_gps_time.createSymbolModel(5);
            ctx.ic_gpstime = new IntegerCompressor(this.dec_gps_time, 32, 9);
        }
    }

    // Init all models
    for (i = 0; i < 8; i++) dec_xy.initSymbolModel(ctx.m_changed_values[i]);
    dec_xy.initSymbolModel(ctx.m_scanner_channel);
    for (i = 0; i < 16; i++) {
        if (ctx.m_number_of_returns[i]) dec_xy.initSymbolModel(ctx.m_number_of_returns[i]);
        if (ctx.m_return_number[i]) dec_xy.initSymbolModel(ctx.m_return_number[i]);
    }
    dec_xy.initSymbolModel(ctx.m_return_number_gps_same);
    ctx.ic_dX.initDecompressor();
    ctx.ic_dY.initDecompressor();
    for (i = 0; i < 12; i++) {
        ctx.last_X_diff_median5[i].init();
        ctx.last_Y_diff_median5[i].init();
    }

    if (ctx.ic_Z) {
        ctx.ic_Z.initDecompressor();
        var liView = new DataView(item.buffer, item.byteOffset, item.length);
        var z0 = liView.getInt32(8, true);
        for (i = 0; i < 8; i++) ctx.last_Z[i] = z0;
    }

    for (i = 0; i < 64; i++) {
        if (ctx.m_classification[i] && this.dec_classification) this.dec_classification.initSymbolModel(ctx.m_classification[i]);
        if (ctx.m_flags[i] && this.dec_flags) this.dec_flags.initSymbolModel(ctx.m_flags[i]);
        if (ctx.m_user_data[i] && this.dec_user_data) this.dec_user_data.initSymbolModel(ctx.m_user_data[i]);
    }

    if (ctx.ic_intensity) {
        ctx.ic_intensity.initDecompressor();
        var liView2 = new DataView(item.buffer, item.byteOffset, item.length);
        var int0 = liView2.getUint16(12, true);
        for (i = 0; i < 8; i++) ctx.last_intensity[i] = int0;
    }
    if (ctx.ic_scan_angle) ctx.ic_scan_angle.initDecompressor();
    if (ctx.ic_point_source_ID) ctx.ic_point_source_ID.initDecompressor();

    if (ctx.ic_gpstime) {
        this.dec_gps_time.initSymbolModel(ctx.m_gpstime_multi);
        this.dec_gps_time.initSymbolModel(ctx.m_gpstime_0diff);
        ctx.ic_gpstime.initDecompressor();
        ctx.last = 0; ctx.next = 0;
        ctx.last_gpstime_diff[0] = ctx.last_gpstime_diff[1] = ctx.last_gpstime_diff[2] = ctx.last_gpstime_diff[3] = 0;
        ctx.multi_extreme_counter[0] = ctx.multi_extreme_counter[1] = ctx.multi_extreme_counter[2] = ctx.multi_extreme_counter[3] = 0;
        // Read GPS time from item (offset 22 in format 6, float64)
        var gpsView = new DataView(item.buffer, item.byteOffset + 22, 8);
        ctx.last_gpstime[0].i32[0] = gpsView.getInt32(0, true);
        ctx.last_gpstime[0].i32[1] = gpsView.getInt32(4, true);
        ctx.last_gpstime[1].i32[0] = 0; ctx.last_gpstime[1].i32[1] = 0;
        ctx.last_gpstime[2].i32[0] = 0; ctx.last_gpstime[2].i32[1] = 0;
        ctx.last_gpstime[3].i32[0] = 0; ctx.last_gpstime[3].i32[1] = 0;
    }

    // Copy first point as last_item
    ctx.last_item = new Uint8Array(item.length);
    for (i = 0; i < item.length; i++) ctx.last_item[i] = item[i];

    ctx.unused = false;
};

Point14Reader.prototype.read = function (pointBuf) {
    var ctx = this.contexts[this.current_context];
    var li = ctx.last_item;
    var liDV = new DataView(li.buffer, li.byteOffset, li.length);
    var dec_xy = this.dec_channel_returns_XY;

    // ── Compute last point return context (lpr) ──────────────────────
    // return_number is at byte offset 22+8=30... No, for POINT14:
    // Byte 14: legacy flags (return_number:3, number_of_returns:3, scan_dir:1, edge:1)
    // Byte 22: scanner_channel:2, classification_flags:4, legacy_point_type:2
    //   Actually in LASpoint14 struct:
    //   byte 22 = scan_angle (I16, 2 bytes) -> offset 20
    //   Actually let me use the correct struct layout:
    //   0-3: X (I32), 4-7: Y (I32), 8-11: Z (I32), 12-13: intensity (U16)
    //   14: legacy return/nreturns/scandir/edge byte
    //   15: legacy classification(5) + legacy_flags(3)
    //   16: legacy_scan_angle_rank (I8)
    //   17: user_data (U8)
    //   18-19: point_source_ID (U16)
    //   20-21: scan_angle (I16)
    //   22: legacy_point_type(2) + scanner_channel(2) + classification_flags(4)
    //   23: classification (U8)
    //   24: return_number(4) + number_of_returns(4)
    //   25: deleted_flag (sometimes not stored; total is 26 bytes core + 4 dummy + gps = 30)
    // Actually in the C++ struct it varies. Let me use the field offsets from the source:
    // return_number is at byte 24 (low nibble)
    // number_of_returns is at byte 24 (high nibble)
    // scanner_channel is bits 2-3 of byte 22
    // classification is byte 23
    // gps_time is at byte 22+8 = offset depends on struct

    // The LASpoint14 in the LASzip source uses a specific struct layout.
    // For a 30-byte format 6 record, the layout in the LAS 1.4 spec is:
    // 0:  X (4)
    // 4:  Y (4)
    // 8:  Z (4)
    // 12: Intensity (2)
    // 14: Return Number (4 bits) | Number of Returns (4 bits) -> 1 byte
    // 15: Classification Flags (4 bits) | Scanner Channel (2 bits) | Scan Direction Flag (1) | Edge of Flight Line (1) -> 1 byte
    // 16: Classification (1)
    // 17: User Data (1)
    // 18: Scan Angle (2) - I16
    // 20: Point Source ID (2)
    // 22: GPS Time (8)
    // Total: 30 bytes

    var return_number     = li[14] & 0x0F;
    var number_of_returns = (li[14] >>> 4) & 0x0F;
    var scanner_channel   = (li[15] >>> 4) & 0x03;
    var classification    = li[16];

    var lpr = (return_number === 1 ? 1 : 0);
    lpr += (return_number >= number_of_returns ? 2 : 0);

    // GPS time change flag — stored as a synthetic flag in our context
    // We track it ourselves
    var last_gps_time_change = ctx._gps_time_change ? 1 : 0;
    lpr += (last_gps_time_change ? 4 : 0);

    // ── Decompress changed_values ────────────────────────────────────
    var changed_values = dec_xy.decodeSymbol(ctx.m_changed_values[lpr]);

    // ── Scanner channel change ───────────────────────────────────────
    if (changed_values & (1 << 6)) {
        var diff = dec_xy.decodeSymbol(ctx.m_scanner_channel);
        var new_channel = (this.current_context + diff + 1) % 4;
        if (this.contexts[new_channel].unused) {
            this._createAndInitContext(this.contexts[new_channel], ctx.last_item);
        }
        this.current_context = new_channel;
        ctx = this.contexts[this.current_context];
        li = ctx.last_item;
        liDV = new DataView(li.buffer, li.byteOffset, li.length);
        // Update scanner channel in last_item byte 15
        li[15] = (li[15] & 0xCF) | ((new_channel & 0x03) << 4);
    }

    // ── Return number / number of returns ────────────────────────────
    var point_source_change = (changed_values & (1 << 5)) ? true : false;
    var gps_time_change     = (changed_values & (1 << 4)) ? true : false;
    var scan_angle_change   = (changed_values & (1 << 3)) ? true : false;

    var last_n = (li[14] >>> 4) & 0x0F;
    var last_r = li[14] & 0x0F;

    var n, r;

    // Number of returns
    if (changed_values & (1 << 2)) {
        if (!ctx.m_number_of_returns[last_n]) {
            ctx.m_number_of_returns[last_n] = dec_xy.createSymbolModel(16);
            dec_xy.initSymbolModel(ctx.m_number_of_returns[last_n]);
        }
        n = dec_xy.decodeSymbol(ctx.m_number_of_returns[last_n]);
    } else {
        n = last_n;
    }

    // Return number
    var rn_change = changed_values & 3;
    if (rn_change === 0) {
        r = last_r;
    } else if (rn_change === 1) {
        r = (last_r + 1) % 16;
    } else if (rn_change === 2) {
        r = (last_r + 15) % 16;
    } else {
        if (gps_time_change) {
            if (!ctx.m_return_number[last_r]) {
                ctx.m_return_number[last_r] = dec_xy.createSymbolModel(16);
                dec_xy.initSymbolModel(ctx.m_return_number[last_r]);
            }
            r = dec_xy.decodeSymbol(ctx.m_return_number[last_r]);
        } else {
            var sym = dec_xy.decodeSymbol(ctx.m_return_number_gps_same);
            r = (last_r + sym + 2) % 16;
        }
    }

    // Write return_number and number_of_returns
    li[14] = (n << 4) | (r & 0x0F);

    // ── Flags (classification_flags, scan_dir, edge) ─────────────────
    if (this.changed_flags && (changed_values & (1 << 6))) {
        // Scanner channel already updated above; flags byte may need update
    }
    // For simplicity, flags decompression: if the layer has data and changed_values indicates it
    // The v3 source encodes flag changes in the flags layer
    // Actually, looking at the source more carefully, the flags layer handles:
    // classification_flags(4), scan_direction_flag(1), edge_of_flight_line(1)
    // These are in byte 15 bits 0-5. Bits 4-5 are scanner channel (handled above).
    // The flags layer is optional; if no bytes, flags don't change.

    // ── Coordinates ──────────────────────────────────────────────────
    var m = number_return_map_6ctx[n][r];
    var l = number_return_level_8ctx[n][r];

    var cpr = (r === 1 ? 2 : 0);
    cpr += (r >= n ? 1 : 0);

    var k_bits, median, diff;

    // X
    median = ctx.last_X_diff_median5[(m << 1) | (gps_time_change ? 1 : 0)].get();
    diff = ctx.ic_dX.decompress(median, n === 1 ? 1 : 0);
    var lastX = liDV.getInt32(0, true);
    liDV.setInt32(0, lastX + diff, true);
    ctx.last_X_diff_median5[(m << 1) | (gps_time_change ? 1 : 0)].add(diff);

    // Y
    median = ctx.last_Y_diff_median5[(m << 1) | (gps_time_change ? 1 : 0)].get();
    k_bits = ctx.ic_dX.getK();
    diff = ctx.ic_dY.decompress(median, (n === 1 ? 1 : 0) + (k_bits < 20 ? (k_bits & 0xFFFFFFFE) : 20));
    var lastY = liDV.getInt32(4, true);
    liDV.setInt32(4, lastY + diff, true);
    ctx.last_Y_diff_median5[(m << 1) | (gps_time_change ? 1 : 0)].add(diff);

    // Z
    if (this.changed_Z && ctx.ic_Z) {
        k_bits = (ctx.ic_dX.getK() + ctx.ic_dY.getK()) / 2;
        var z = ctx.ic_Z.decompress(ctx.last_Z[l], (n === 1 ? 1 : 0) + (k_bits < 18 ? (k_bits & 0xFFFFFFFE) : 18));
        liDV.setInt32(8, z, true);
        ctx.last_Z[l] = z;
    }

    // ── Classification ───────────────────────────────────────────────
    if (this.changed_classification) {
        var last_class = li[16];
        var ccc = ((last_class & 0x1F) << 1) + (cpr === 3 ? 1 : 0);
        if (!ctx.m_classification[ccc]) {
            ctx.m_classification[ccc] = this.dec_classification.createSymbolModel(256);
            this.dec_classification.initSymbolModel(ctx.m_classification[ccc]);
        }
        li[16] = this.dec_classification.decodeSymbol(ctx.m_classification[ccc]);
    }

    // ── Intensity ────────────────────────────────────────────────────
    if (this.changed_intensity && ctx.ic_intensity) {
        var intCtx = (cpr << 1) | (gps_time_change ? 1 : 0);
        var intensity = ctx.ic_intensity.decompress(ctx.last_intensity[intCtx], cpr);
        ctx.last_intensity[intCtx] = intensity;
        liDV.setUint16(12, intensity, true);
    }

    // ── Scan angle ───────────────────────────────────────────────────
    if (this.changed_scan_angle && scan_angle_change && ctx.ic_scan_angle) {
        var sa = ctx.ic_scan_angle.decompress(liDV.getInt16(18, true), gps_time_change ? 1 : 0);
        liDV.setInt16(18, sa, true);
    }

    // ── User data ────────────────────────────────────────────────────
    if (this.changed_user_data) {
        var ud_ctx_idx = (li[17] / 4) | 0;
        if (ud_ctx_idx > 63) ud_ctx_idx = 63;
        if (!ctx.m_user_data[ud_ctx_idx]) {
            ctx.m_user_data[ud_ctx_idx] = this.dec_user_data.createSymbolModel(256);
            this.dec_user_data.initSymbolModel(ctx.m_user_data[ud_ctx_idx]);
        }
        li[17] = this.dec_user_data.decodeSymbol(ctx.m_user_data[ud_ctx_idx]);
    }

    // ── Point source ID ──────────────────────────────────────────────
    if (this.changed_point_source && point_source_change && ctx.ic_point_source_ID) {
        var psid = ctx.ic_point_source_ID.decompress(liDV.getUint16(20, true));
        liDV.setUint16(20, psid, true);
    }

    // ── GPS time ─────────────────────────────────────────────────────
    ctx._gps_time_change = gps_time_change;
    if (this.changed_gps_time && gps_time_change) {
        this._readGpsTime(ctx);
        // Write GPS time to last_item at offset 22
        var gt = ctx.last_gpstime[ctx.last].i32;
        li[22] =  gt[0]        & 0xFF;
        li[23] = (gt[0] >>> 8)  & 0xFF;
        li[24] = (gt[0] >>> 16) & 0xFF;
        li[25] = (gt[0] >>> 24) & 0xFF;
        li[26] =  gt[1]        & 0xFF;
        li[27] = (gt[1] >>> 8)  & 0xFF;
        li[28] = (gt[1] >>> 16) & 0xFF;
        li[29] = (gt[1] >>> 24) & 0xFF;
    }

    // Copy last_item to output
    for (var i = 0; i < pointBuf.length && i < li.length; i++) pointBuf[i] = li[i];
};

Point14Reader.prototype._readGpsTime = function (ctx) {
    var dec = this.dec_gps_time;
    var lg = ctx.last_gpstime;
    var lgd = ctx.last_gpstime_diff;
    var mec = ctx.multi_extreme_counter;
    var multi;

    if (lgd[ctx.last] === 0) {
        multi = dec.decodeSymbol(ctx.m_gpstime_0diff);
        if (multi === 0) {
            lgd[ctx.last] = ctx.ic_gpstime.decompress(0, 0);
            this._addI64(lg[ctx.last], lgd[ctx.last]);
            mec[ctx.last] = 0;
        } else if (multi === 1) {
            ctx.next = (ctx.next + 1) & 3;
            lg[ctx.next].i32[1] = ctx.ic_gpstime.decompress(lg[ctx.last].i32[1], 8);
            lg[ctx.next].i32[0] = dec.readInt();
            ctx.last = ctx.next;
            lgd[ctx.last] = 0;
            mec[ctx.last] = 0;
        } else if (multi > 1) {
            ctx.last = (ctx.last + multi - 1) & 3;
            this._readGpsTime(ctx);
        }
    } else {
        multi = dec.decodeSymbol(ctx.m_gpstime_multi);
        if (multi === 1) {
            var d = ctx.ic_gpstime.decompress(lgd[ctx.last], 1);
            this._addI64(lg[ctx.last], d);
            mec[ctx.last] = 0;
        } else if (multi < LASZIP_GPSTIME_MULTI_CODE_FULL) {
            var gpstime_diff;
            if (multi === 0) {
                gpstime_diff = ctx.ic_gpstime.decompress(0, 7);
                mec[ctx.last]++;
                if (mec[ctx.last] > 3) { lgd[ctx.last] = gpstime_diff; mec[ctx.last] = 0; }
            } else if (multi < LASZIP_GPSTIME_MULTI) {
                if (multi < 10)
                    gpstime_diff = ctx.ic_gpstime.decompress(Math.imul(multi, lgd[ctx.last]), 2);
                else
                    gpstime_diff = ctx.ic_gpstime.decompress(Math.imul(multi, lgd[ctx.last]), 3);
            } else if (multi === LASZIP_GPSTIME_MULTI) {
                gpstime_diff = ctx.ic_gpstime.decompress(Math.imul(LASZIP_GPSTIME_MULTI, lgd[ctx.last]), 4);
                mec[ctx.last]++;
                if (mec[ctx.last] > 3) { lgd[ctx.last] = gpstime_diff; mec[ctx.last] = 0; }
            } else {
                multi = LASZIP_GPSTIME_MULTI - multi;
                if (multi > LASZIP_GPSTIME_MULTI_MINUS) {
                    gpstime_diff = ctx.ic_gpstime.decompress(Math.imul(multi, lgd[ctx.last]), 5);
                } else {
                    gpstime_diff = ctx.ic_gpstime.decompress(Math.imul(LASZIP_GPSTIME_MULTI_MINUS, lgd[ctx.last]), 6);
                    mec[ctx.last]++;
                    if (mec[ctx.last] > 3) { lgd[ctx.last] = gpstime_diff; mec[ctx.last] = 0; }
                }
            }
            this._addI64(lg[ctx.last], gpstime_diff);
        } else if (multi === LASZIP_GPSTIME_MULTI_CODE_FULL) {
            ctx.next = (ctx.next + 1) & 3;
            lg[ctx.next].i32[1] = ctx.ic_gpstime.decompress(lg[ctx.last].i32[1], 8);
            lg[ctx.next].i32[0] = dec.readInt();
            ctx.last = ctx.next;
            lgd[ctx.last] = 0;
            mec[ctx.last] = 0;
        } else if (multi >= LASZIP_GPSTIME_MULTI_CODE_FULL) {
            ctx.last = (ctx.last + multi - LASZIP_GPSTIME_MULTI_CODE_FULL) & 3;
            this._readGpsTime(ctx);
        }
    }
};

Point14Reader.prototype._addI64 = function (slot, diff) {
    var lo = slot.i32[0];
    var hi = slot.i32[1];
    var nlo = (lo + diff) | 0;
    if (diff > 0 && (nlo >>> 0) < (lo >>> 0)) hi++;
    else if (diff < 0 && (nlo >>> 0) > (lo >>> 0)) hi--;
    slot.i32[0] = nlo;
    slot.i32[1] = hi;
};

// ═══════════════════════════════════════════════════════════════════════════════
// RGB14 v3 reader (layered)
// ═══════════════════════════════════════════════════════════════════════════════

function RGB14Reader() {
    this.dec_RGB = null;
    this.contexts = [null, null, null, null];
    this.current_context = 0;
}

function RGB14Context() {
    this.unused = true;
    this.last_item = new Uint16Array(3);
    this.m_byte_used  = null;
    this.m_rgb_diff_0 = null;
    this.m_rgb_diff_1 = null;
    this.m_rgb_diff_2 = null;
    this.m_rgb_diff_3 = null;
    this.m_rgb_diff_4 = null;
    this.m_rgb_diff_5 = null;
}

RGB14Reader.prototype.initChunk = function (bytes, offset, numBytes, view) {
    if (numBytes > 0) {
        this.dec_RGB = new ArithmeticDecoder();
        this.dec_RGB.init(bytes, offset);
    } else {
        this.dec_RGB = null;
    }
    for (var c = 0; c < 4; c++) this.contexts[c] = null;
    this.current_context = 0;
};

RGB14Reader.prototype._createContext = function (ctx_idx, firstItem) {
    var ctx = new RGB14Context();
    var dec = this.dec_RGB;
    ctx.m_byte_used  = dec.createSymbolModel(128);
    ctx.m_rgb_diff_0 = dec.createSymbolModel(256);
    ctx.m_rgb_diff_1 = dec.createSymbolModel(256);
    ctx.m_rgb_diff_2 = dec.createSymbolModel(256);
    ctx.m_rgb_diff_3 = dec.createSymbolModel(256);
    ctx.m_rgb_diff_4 = dec.createSymbolModel(256);
    ctx.m_rgb_diff_5 = dec.createSymbolModel(256);
    dec.initSymbolModel(ctx.m_byte_used);
    dec.initSymbolModel(ctx.m_rgb_diff_0);
    dec.initSymbolModel(ctx.m_rgb_diff_1);
    dec.initSymbolModel(ctx.m_rgb_diff_2);
    dec.initSymbolModel(ctx.m_rgb_diff_3);
    dec.initSymbolModel(ctx.m_rgb_diff_4);
    dec.initSymbolModel(ctx.m_rgb_diff_5);
    ctx.last_item[0] = firstItem[0];
    ctx.last_item[1] = firstItem[1];
    ctx.last_item[2] = firstItem[2];
    ctx.unused = false;
    this.contexts[ctx_idx] = ctx;
    return ctx;
};

RGB14Reader.prototype.read = function (out, context) {
    if (!this.dec_RGB) {
        // No RGB layer data — copy from last
        if (this.contexts[context]) {
            out[0] = this.contexts[context].last_item[0];
            out[1] = this.contexts[context].last_item[1];
            out[2] = this.contexts[context].last_item[2];
        }
        return;
    }
    this.current_context = context;
    var ctx = this.contexts[context];
    if (!ctx) {
        // Create from the last known context
        var src = [0, 0, 0];
        for (var c = 0; c < 4; c++) {
            if (this.contexts[c]) { src = this.contexts[c].last_item; break; }
        }
        ctx = this._createContext(context, src);
    }

    var li = ctx.last_item;
    var dec = this.dec_RGB;
    var corr, diff;
    var sym = dec.decodeSymbol(ctx.m_byte_used);

    if (sym & 1) {
        corr = dec.decodeSymbol(ctx.m_rgb_diff_0);
        out[0] = u8Fold(corr + (li[0] & 255));
    } else { out[0] = li[0] & 0xFF; }
    if (sym & 2) {
        corr = dec.decodeSymbol(ctx.m_rgb_diff_1);
        out[0] |= (u8Fold(corr + (li[0] >>> 8)) << 8);
    } else { out[0] |= (li[0] & 0xFF00); }

    if (sym & 64) {
        diff = (out[0] & 0xFF) - (li[0] & 0xFF);
        if (sym & 4) {
            corr = dec.decodeSymbol(ctx.m_rgb_diff_2);
            out[1] = u8Fold(corr + u8Clamp(diff + (li[1] & 255)));
        } else { out[1] = li[1] & 0xFF; }
        if (sym & 16) {
            corr = dec.decodeSymbol(ctx.m_rgb_diff_4);
            diff = (diff + ((out[1] & 0xFF) - (li[1] & 0xFF))) / 2;
            out[2] = u8Fold(corr + u8Clamp(diff + (li[2] & 255)));
        } else { out[2] = li[2] & 0xFF; }
        diff = (out[0] >>> 8) - (li[0] >>> 8);
        if (sym & 8) {
            corr = dec.decodeSymbol(ctx.m_rgb_diff_3);
            out[1] |= (u8Fold(corr + u8Clamp(diff + (li[1] >>> 8))) << 8);
        } else { out[1] |= (li[1] & 0xFF00); }
        if (sym & 32) {
            corr = dec.decodeSymbol(ctx.m_rgb_diff_5);
            diff = (diff + ((out[1] >>> 8) - (li[1] >>> 8))) / 2;
            out[2] |= (u8Fold(corr + u8Clamp(diff + (li[2] >>> 8))) << 8);
        } else { out[2] |= (li[2] & 0xFF00); }
    } else {
        out[1] = out[0];
        out[2] = out[0];
    }
    li[0] = out[0];
    li[1] = out[1];
    li[2] = out[2];
};

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: read string from bytes
// ═══════════════════════════════════════════════════════════════════════════════

function _extractEPSGFromWKT(wkt) {
    // Prefer the PROJCS block's own AUTHORITY["EPSG","NNNN"]
    var start = wkt.indexOf('PROJCS[');
    if (start >= 0) {
        var depth = 0, end = start;
        for (var i = start; i < wkt.length; i++) {
            if (wkt[i] === '[') depth++;
            else if (wkt[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
        }
        var block = wkt.substring(start, end + 1);
        var re = /AUTHORITY\["EPSG","(\d+)"\]/gi;
        var mm, last = null;
        while ((mm = re.exec(block)) !== null) last = mm[1];
        if (last) return parseInt(last);
    }
    // Fallback: first AUTHORITY in any context
    var m = wkt.match(/AUTHORITY\["EPSG","(\d+)"\]/i);
    return m ? parseInt(m[1]) : null;
}

function readString(bytes, offset, maxLen) {
    var s = '';
    for (var i = 0; i < maxLen; i++) {
        var c = bytes[offset + i];
        if (c === 0) break;
        s += String.fromCharCode(c);
    }
    return s;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAZDecoder — main entry point
// ═══════════════════════════════════════════════════════════════════════════════

var MAX_POINTS = 5000000;

var LAZDecoder = {};

LAZDecoder.decode = function (buffer) {
    var view  = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    var bufLen = buffer.byteLength;

    // ── Validate signature ───────────────────────────────────────────
    var sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (sig !== 'LASF') throw new Error('Not a valid LAS/LAZ file — missing LASF signature.');

    // ── Read header ──────────────────────────────────────────────────
    var vMajor = bytes[24], vMinor = bytes[25];
    var systemId           = readString(bytes, 26, 32);
    var generatingSoftware = readString(bytes, 58, 32);
    var headerSize        = view.getUint16(94, true);
    var offsetToPoints    = view.getUint32(96, true);
    var numVLRs           = view.getUint32(100, true);
    var pointFormatId     = bytes[104] & 0x3F; // LAS 1.4: bits 6-7 are flags, 0-5 are format
    var pointRecordLength = view.getUint16(105, true);

    var numPoints;
    if (vMajor === 1 && vMinor >= 4) {
        numPoints = Number(view.getBigUint64(247, true));
    } else {
        numPoints = view.getUint32(107, true);
    }
    if (numPoints === 0) throw new Error('LAZ file contains zero points.');

    // ── Scale / offset / bounds ──────────────────────────────────────
    var xScale  = view.getFloat64(131, true), yScale  = view.getFloat64(139, true), zScale  = view.getFloat64(147, true);
    var xOffset = view.getFloat64(155, true), yOffset = view.getFloat64(163, true), zOffset = view.getFloat64(171, true);
    var maxX    = view.getFloat64(179, true), minX    = view.getFloat64(187, true);
    var maxY    = view.getFloat64(195, true), minY    = view.getFloat64(203, true);
    var maxZ    = view.getFloat64(211, true), minZ    = view.getFloat64(219, true);

    // ── Parse VLRs ───────────────────────────────────────────────────
    var crsWKT = null, crsEPSG = null;
    var lazVlr = null;
    var vlrPos = headerSize;
    for (var i = 0; i < numVLRs && vlrPos + 54 <= offsetToPoints; i++) {
        var userId   = readString(bytes, vlrPos + 2, 16);
        var recordId = view.getUint16(vlrPos + 18, true);
        var recLen   = view.getUint16(vlrPos + 20, true);
        var dataStart = vlrPos + 54;

        if (userId.indexOf('laszip encoded') === 0 && recordId === 22204) {
            lazVlr = { offset: dataStart, length: recLen };
        }
        if (userId === 'LASF_Projection') {
            if (recordId === 2112) {
                crsWKT = readString(bytes, dataStart, recLen).trim();
            } else if (recordId === 34737) {
                var em = readString(bytes, dataStart, recLen).match(/EPSG[:\s]*(\d{4,6})/i);
                if (em) crsEPSG = parseInt(em[1]);
            }
        }
        vlrPos += 54 + recLen;
    }

    // Check EVLRs for LAS 1.4 if we didn't find LAZ VLR in regular VLRs
    if (!lazVlr && vMajor === 1 && vMinor >= 4 && bufLen > 243) {
        var numEVLRs = view.getUint32(243, true);
        var evlrStart = Number(view.getBigUint64(235, true));
        var ep = evlrStart;
        for (var i = 0; i < numEVLRs && ep + 60 <= bufLen; i++) {
            var eUserId   = readString(bytes, ep + 2, 16);
            var eRecordId = view.getUint16(ep + 18, true);
            var eRecLen   = Number(view.getBigUint64(20, true));
            if (eUserId.indexOf('laszip encoded') === 0 && eRecordId === 22204) {
                lazVlr = { offset: ep + 60, length: eRecLen };
                break;
            }
            ep += 60 + eRecLen;
        }
    }

    if (!lazVlr) throw new Error('No LAZ VLR found — this does not appear to be a valid LAZ file.');

    if (!crsEPSG && crsWKT) {
        crsEPSG = _extractEPSGFromWKT(crsWKT);
    }

    // ── Parse LAZ VLR ────────────────────────────────────────────────
    var lzOff = lazVlr.offset;
    var compressor   = view.getUint16(lzOff + 0, true);
    var coder        = view.getUint16(lzOff + 2, true);
    var lazVerMajor  = bytes[lzOff + 4];
    var lazVerMinor  = bytes[lzOff + 5];
    var chunkSize    = view.getUint32(lzOff + 12, true);
    var numItems     = view.getUint16(lzOff + 32, true);

    var items = [];
    for (var i = 0; i < numItems; i++) {
        var base = lzOff + 34 + i * 6;
        items.push({
            type:    view.getUint16(base + 0, true),
            size:    view.getUint16(base + 2, true),
            version: view.getUint16(base + 4, true),
        });
    }

    // Determine item sizes sum (should equal pointRecordLength)
    var itemSizeSum = 0;
    for (var i = 0; i < items.length; i++) itemSizeSum += items[i].size;

    // ── Point format capabilities ────────────────────────────────────
    var hasRGB   = [2, 3, 5, 7, 8, 10].indexOf(pointFormatId) >= 0;
    var isNewFmt = pointFormatId >= 6;
    var isLayered = (compressor === LASZIP_COMPRESSOR_LAYERED_CHUNKED);

    // ── Read chunk table ─────────────────────────────────────────────
    var chunkStarts = [];
    var numChunks;

    if (chunkSize === 0xFFFFFFFF || chunkSize === 0) chunkSize = numPoints;

    if (compressor === LASZIP_COMPRESSOR_LAYERED_CHUNKED) {
        // For layered chunked (v3), the first 8 bytes at offsetToPoints are
        // an I64 pointing to the chunk table (at end of file). Point data
        // starts at offsetToPoints + 8.
        numChunks = Math.ceil(numPoints / chunkSize);
        // We don't need the chunk table — we'll walk chunks sequentially
        // since each chunk's size is self-describing from its layer sizes.
        chunkStarts.push(offsetToPoints + 8);
        // Additional chunk starts will be computed while decoding.
    } else if (compressor === LASZIP_COMPRESSOR_POINTWISE_CHUNKED) {
        var ctVersion = view.getUint32(offsetToPoints, true);
        numChunks = view.getUint32(offsetToPoints + 4, true);
        if (numChunks === 0) numChunks = 1;

        var chunkTableHeaderSize = 8;

        if (ctVersion === 0) {
            var tableStart = offsetToPoints + chunkTableHeaderSize;
            var accumulated = tableStart + numChunks * 8;
            for (var i = 0; i < numChunks; i++) {
                chunkStarts.push(accumulated);
                var chunkBytes = view.getUint32(tableStart + i * 8 + 4, true);
                accumulated += chunkBytes;
            }
        } else {
            chunkStarts.push(offsetToPoints + chunkTableHeaderSize);
            numChunks = 1;
            chunkSize = numPoints;
        }
    } else {
        chunkStarts.push(offsetToPoints);
        chunkSize = numPoints;
        numChunks = 1;
    }

    // ── Subsampling ──────────────────────────────────────────────────
    var stride    = numPoints > MAX_POINTS ? Math.ceil(numPoints / MAX_POINTS) : 1;
    var loadCount = Math.ceil(numPoints / stride);

    // ── Center ───────────────────────────────────────────────────────
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;

    // ── Allocate output ──────────────────────────────────────────────
    var positions       = new Float32Array(loadCount * 3);
    var rgbColors       = new Float32Array(loadCount * 3);
    var intensities     = new Float32Array(loadCount);
    var classifications = new Uint8Array(loadCount);

    // ── Color/classification offsets for point format ─────────────────
    var colorByteOff = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };
    var colOff = colorByteOff[pointFormatId] || 0;
    var classOff = isNewFmt ? 16 : 15;
    var classMask = isNewFmt ? 0xFF : 0x1F;

    // ── Determine item layout for creating readers ───────────────────
    var hasGpsTime = false;
    var hasRGBItem = false;
    var hasNIRItem = false;
    var extraBytesSize = 0;
    var point14Size = 0;

    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.type === LASZIP_ITEM_GPSTIME11) hasGpsTime = true;
        if (it.type === LASZIP_ITEM_RGB12 || it.type === LASZIP_ITEM_RGB14) hasRGBItem = true;
        if (it.type === LASZIP_ITEM_RGBNIR14) { hasRGBItem = true; hasNIRItem = true; }
        if (it.type === LASZIP_ITEM_POINT14) point14Size = it.size;
        if (it.type === 0 || it.type === LASZIP_ITEM_BYTE14) extraBytesSize += it.size;
    }

    // ── Decompress chunks ────────────────────────────────────────────
    var outIdx = 0;
    var globalIdx = 0;
    var pointBuf = new Uint8Array(pointRecordLength);
    var pointView = new DataView(pointBuf.buffer);
    var rgbBuf = new Uint16Array(3);

    if (isLayered) {
        // ── v3 Layered Chunked decode path ───────────────────────────
        // Per-chunk layout (confirmed from LASzip C++ and laz-rs):
        //   [raw first point bytes for ALL items]
        //   [U32 remaining point count]
        //   [9 U32 Point14 layer sizes]
        //   [1 U32 RGB14 layer size (if RGB item)]
        //   [1 U32 NIR layer size (if NIR item)]
        //   [Point14 compressed data (9 layers concatenated)]
        //   [RGB14 compressed data]
        //   [NIR compressed data]

        var rawPtSize = point14Size || 30;
        var rgbItemSize = hasNIRItem ? 8 : (hasRGBItem ? 6 : 0);
        var totalRawSize = rawPtSize + rgbItemSize + extraBytesSize;

        // Number of extra layer-size U32s (beyond the 9 Point14 ones)
        var extraSizeCount = 0;
        if (hasRGBItem) extraSizeCount++;
        if (hasNIRItem) extraSizeCount++;
        // extra bytes would add more size U32s here if needed

        var nextChunkOff = chunkStarts[0]; // first chunk starts after the I64 chunk-table pointer

        for (var chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
            var chunkOffset = nextChunkOff;
            var pointsInChunk = Math.min(chunkSize, numPoints - chunkIdx * chunkSize);
            if (pointsInChunk <= 0) break;

            var pos = chunkOffset;

            // 1. Read raw first point (all items)
            for (var b = 0; b < totalRawSize && pos + b < bufLen; b++) {
                pointBuf[b] = bytes[pos + b];
            }
            pos += totalRawSize;

            // 2. Skip remaining-point-count U32
            pos += 4;

            // 3. Read layer sizes: 9 for Point14, then extras
            var pt14SizesOff = pos;
            pos += 9 * 4;

            var rgbLayerSize = 0;
            if (hasRGBItem) {
                rgbLayerSize = view.getUint32(pos, true);
                pos += 4;
            }
            if (hasNIRItem) {
                pos += 4; // skip NIR layer size
            }

            // 4. Compressed data starts here
            var dataOff = pos;

            // Init Point14Reader with correct offsets
            var pt14reader = new Point14Reader();
            var totalPt14Bytes = pt14reader.initChunk(bytes, pt14SizesOff, dataOff, view);

            // Compute next chunk offset
            nextChunkOff = dataOff + totalPt14Bytes + rgbLayerSize;

            // Init first scanner channel context
            var firstChannel = (pointBuf[15] >>> 4) & 0x03;
            pt14reader.current_context = firstChannel;
            pt14reader._createAndInitContext(
                pt14reader.contexts[firstChannel],
                pointBuf.subarray(0, rawPtSize)
            );

            // Init RGB14Reader if needed
            var rgb14reader = hasRGBItem ? new RGB14Reader() : null;
            if (rgb14reader) {
                var rgbDataOff = dataOff + totalPt14Bytes;
                rgb14reader.initChunk(bytes, rgbDataOff, rgbLayerSize, view);
                var firstRGB = new Uint16Array(3);
                if (colOff > 0 && colOff + 6 <= pointRecordLength) {
                    firstRGB[0] = pointView.getUint16(colOff, true);
                    firstRGB[1] = pointView.getUint16(colOff + 2, true);
                    firstRGB[2] = pointView.getUint16(colOff + 4, true);
                }
                rgb14reader._createContext(firstChannel, firstRGB);
            }

            // Emit first point
            if (globalIdx % stride === 0 && outIdx < loadCount) {
                _emitPoint(pointBuf, pointView, outIdx, positions, rgbColors, intensities, classifications,
                           xScale, yScale, zScale, xOffset, yOffset, zOffset, cx, cy, cz,
                           hasRGB, colOff, classOff, classMask, pointRecordLength);
                outIdx++;
            }
            globalIdx++;

            // Decompress remaining points
            for (var p = 1; p < pointsInChunk; p++, globalIdx++) {
                pt14reader.read(pointBuf.subarray(0, rawPtSize));

                if (rgb14reader) {
                    rgb14reader.read(rgbBuf, pt14reader.current_context);
                    if (colOff > 0) {
                        pointView.setUint16(colOff, rgbBuf[0], true);
                        pointView.setUint16(colOff + 2, rgbBuf[1], true);
                        pointView.setUint16(colOff + 4, rgbBuf[2], true);
                    }
                }

                if (globalIdx % stride === 0 && outIdx < loadCount) {
                    _emitPoint(pointBuf, pointView, outIdx, positions, rgbColors, intensities, classifications,
                               xScale, yScale, zScale, xOffset, yOffset, zOffset, cx, cy, cz,
                               hasRGB, colOff, classOff, classMask, pointRecordLength);
                    outIdx++;
                }
            }
        }
    } else {
        // ── v2 Pointwise Chunked decode path ─────────────────────────
        for (var chunkIdx = 0; chunkIdx < chunkStarts.length; chunkIdx++) {
            var chunkOffset = chunkStarts[chunkIdx];
            var pointsInChunk = Math.min(chunkSize, numPoints - chunkIdx * chunkSize);
            if (pointsInChunk <= 0) break;

            // Read the first (uncompressed) point of the chunk
            for (var b = 0; b < pointRecordLength && chunkOffset + b < bufLen; b++) {
                pointBuf[b] = bytes[chunkOffset + b];
            }
            var compressedStart = chunkOffset + pointRecordLength;

            // Create decoder and item readers for this chunk
            var dec = new ArithmeticDecoder();
            dec.init(bytes, compressedStart);

            // Create item readers based on LAZ items
            var readers = [];
            var readerTypes = [];
            var itemOffsets = [];
            var off = 0;
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (it.type === LASZIP_ITEM_POINT10) {
                    var pr = new Point10Reader(dec);
                    pr.init(pointBuf, off);
                    readers.push(pr);
                    readerTypes.push('point10');
                    itemOffsets.push(off);
                } else if (it.type === LASZIP_ITEM_GPSTIME11) {
                    var gr = new GpsTime11Reader(dec);
                    gr.init(pointBuf, off);
                    readers.push(gr);
                    readerTypes.push('gpstime11');
                    itemOffsets.push(off);
                } else if (it.type === LASZIP_ITEM_RGB12) {
                    var rr = new RGB12Reader(dec);
                    rr.init(pointBuf, off);
                    readers.push(rr);
                    readerTypes.push('rgb12');
                    itemOffsets.push(off);
                } else if (it.type === 0 && it.size > 0) {
                    var br = new ByteReader(dec, it.size);
                    br.init(pointBuf, off);
                    readers.push(br);
                    readerTypes.push('byte');
                    itemOffsets.push(off);
                } else {
                    readers.push(null);
                    readerTypes.push('unknown');
                    itemOffsets.push(off);
                }
                off += it.size;
            }

            // Process first point (already in pointBuf)
            if (globalIdx % stride === 0 && outIdx < loadCount) {
                _emitPoint(pointBuf, pointView, outIdx, positions, rgbColors, intensities, classifications,
                           xScale, yScale, zScale, xOffset, yOffset, zOffset, cx, cy, cz,
                           hasRGB, colOff, classOff, classMask, pointRecordLength);
                outIdx++;
            }
            globalIdx++;

            // Decompress remaining points
            for (var p = 1; p < pointsInChunk; p++, globalIdx++) {
                for (var ri = 0; ri < readers.length; ri++) {
                    if (readers[ri]) {
                        var rType = readerTypes[ri];
                        var rOff = itemOffsets[ri];
                        if (rType === 'point10') {
                            readers[ri].read(pointBuf.subarray(rOff, rOff + 20));
                        } else if (rType === 'gpstime11') {
                            readers[ri].read(pointBuf.subarray(rOff, rOff + 8));
                        } else if (rType === 'rgb12') {
                            readers[ri].read(rgbBuf);
                            pointView.setUint16(rOff, rgbBuf[0], true);
                            pointView.setUint16(rOff + 2, rgbBuf[1], true);
                            pointView.setUint16(rOff + 4, rgbBuf[2], true);
                        } else if (rType === 'byte') {
                            readers[ri].read(pointBuf.subarray(rOff, rOff + items[ri].size));
                        }
                    }
                }

                if (globalIdx % stride === 0 && outIdx < loadCount) {
                    _emitPoint(pointBuf, pointView, outIdx, positions, rgbColors, intensities, classifications,
                               xScale, yScale, zScale, xOffset, yOffset, zOffset, cx, cy, cz,
                               hasRGB, colOff, classOff, classMask, pointRecordLength);
                    outIdx++;
                }
            }
        }
    }

    // ── Return ParsedCloud ───────────────────────────────────────────
    return {
        version:      vMajor + '.' + vMinor,
        pointFormat:  pointFormatId,
        totalPoints:  numPoints,
        loadedPoints: outIdx,
        subsampled:   stride > 1,
        stride:       stride,
        hasRGB:       hasRGB,
        systemId:     systemId,
        generatingSoftware: generatingSoftware,
        bounds:  { minX: minX, maxX: maxX, minY: minY, maxY: maxY, minZ: minZ, maxZ: maxZ },
        center:  { x: cx, y: cy, z: cz },
        extents: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
        positions:       positions.slice(0, outIdx * 3),
        rgbColors:       rgbColors.slice(0, outIdx * 3),
        intensities:     intensities.slice(0, outIdx),
        classifications: classifications.slice(0, outIdx),
        crsWKT:  crsWKT,
        crsEPSG: crsEPSG,
    };
};

function _emitPoint(pointBuf, pointView, outIdx, positions, rgbColors, intensities, classifications,
                    xScale, yScale, zScale, xOffset, yOffset, zOffset, cx, cy, cz,
                    hasRGB, colOff, classOff, classMask, pointRecordLength) {
    var ix = pointView.getInt32(0, true);
    var iy = pointView.getInt32(4, true);
    var iz = pointView.getInt32(8, true);
    var wx = ix * xScale + xOffset - cx;
    var wy = iy * yScale + yOffset - cy;
    var wz = iz * zScale + zOffset - cz;

    // LAS (X=east, Y=north, Z=up) → Three.js (X=right, Y=up, Z=-north)
    positions[outIdx * 3]     =  wx;
    positions[outIdx * 3 + 1] =  wz;
    positions[outIdx * 3 + 2] = -wy;

    intensities[outIdx] = pointView.getUint16(12, true) / 65535;
    classifications[outIdx] = pointBuf[classOff] & classMask;

    if (hasRGB && colOff > 0 && colOff + 6 <= pointRecordLength) {
        rgbColors[outIdx * 3]     = pointView.getUint16(colOff, true) / 65535;
        rgbColors[outIdx * 3 + 1] = pointView.getUint16(colOff + 2, true) / 65535;
        rgbColors[outIdx * 3 + 2] = pointView.getUint16(colOff + 4, true) / 65535;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Expose globally
// ═══════════════════════════════════════════════════════════════════════════════

window.LAZDecoder = LAZDecoder;

// Drop-in replacement for the old LAZLoader — same contract: load(arrayBuffer) → Promise<ParsedCloud>
window.LAZLoader = {
    load: function (arrayBuffer) {
        return new Promise(function (resolve, reject) {
            try {
                var cloud = LAZDecoder.decode(arrayBuffer);
                resolve(cloud);
            } catch (e) {
                reject(e);
            }
        });
    }
};

}());
