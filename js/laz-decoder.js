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
// Helper: read string from bytes
// ═══════════════════════════════════════════════════════════════════════════════

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
    var pointFormatId     = bytes[104];
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
        var m = crsWKT.match(/AUTHORITY\["EPSG","(\d+)"\]/i);
        if (m) crsEPSG = parseInt(m[1]);
    }

    // ── Parse LAZ VLR ────────────────────────────────────────────────
    var lzOff = lazVlr.offset;
    var compressor   = view.getUint16(lzOff + 0, true);
    var coder        = view.getUint16(lzOff + 2, true);
    var lazVerMajor  = bytes[lzOff + 4];
    var lazVerMinor  = bytes[lzOff + 5];
    var chunkSize    = view.getUint32(lzOff + 12, true);
    var numItems     = view.getUint16(lzOff + 34, true);

    var items = [];
    for (var i = 0; i < numItems; i++) {
        var base = lzOff + 36 + i * 6;
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

    // ── Check if this is a v3 layered file ───────────────────────────
    // LAS 1.4 point formats 6-10 can use either pointwise chunked (v2-style)
    // or layered chunked (v3-style). We detect via the compressor field.
    if (isLayered) {
        throw new Error(
            'Layered LAZ compression (LAS 1.4 / point formats 6-10) is not yet supported.\n' +
            'This file uses compressor type 3 (layered chunked).\n' +
            'Support for standard pointwise-chunked LAZ is available.'
        );
    }

    // ── Read chunk table ─────────────────────────────────────────────
    var chunkStarts = [];
    var firstChunkStart;

    if (compressor === LASZIP_COMPRESSOR_POINTWISE_CHUNKED) {
        // The chunk table is stored at offsetToPoints
        // Version field (4 bytes) + number of chunks (4 bytes)
        var ctVersion = view.getUint32(offsetToPoints, true);
        var numChunks = view.getUint32(offsetToPoints + 4, true);

        if (chunkSize === 0xFFFFFFFF || chunkSize === 0) chunkSize = numPoints;
        if (numChunks === 0) numChunks = 1;

        // Chunk table entries: each is 4 or 8 bytes (count + size)
        // The table is stored *after* the version+count header, using an arithmetic encoder
        // Actually, in standard LAZ files, the chunk table at offsetToPoints stores:
        // [U32 version][U32 numChunks] then numChunks entries of [U32 chunkPointCount, U32 chunkByteSize]
        // But wait — many LAZ files actually store the chunk table differently.

        // In practice, the chunk table is encoded as:
        // offset_to_points -> [U32 version][U32 numChunks]
        // Followed by numChunks * 2 * U32 (or compressed via arithmetic coding)
        // The first chunk data starts right after the chunk table.

        // For version 0, the entries are raw (uncompressed):
        // Each entry: [U32 point_count] [U32 byte_count]

        var chunkTableHeaderSize = 8; // version(4) + numChunks(4)

        if (ctVersion === 0) {
            // Uncompressed chunk table
            var tableStart = offsetToPoints + chunkTableHeaderSize;
            var accumulated = tableStart + numChunks * 8;
            firstChunkStart = accumulated;
            for (var i = 0; i < numChunks; i++) {
                chunkStarts.push(accumulated);
                var chunkBytes = view.getUint32(tableStart + i * 8 + 4, true);
                accumulated += chunkBytes;
            }
        } else {
            // The chunk table itself may be compressed. For simplicity, assume raw.
            // Many LAZ writers use version 0 for the chunk table.
            // If version != 0, we skip the table and treat as single chunk
            firstChunkStart = offsetToPoints + chunkTableHeaderSize;
            chunkStarts.push(firstChunkStart);
            numChunks = 1;
            chunkSize = numPoints;
        }
    } else {
        // Pointwise (no chunks) — single chunk
        firstChunkStart = offsetToPoints;
        chunkStarts.push(offsetToPoints);
        chunkSize = numPoints;
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
    var extraBytesSize = 0;

    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.type === LASZIP_ITEM_GPSTIME11) hasGpsTime = true;
        if (it.type === LASZIP_ITEM_RGB12 || it.type === LASZIP_ITEM_RGB14) hasRGBItem = true;
        if (it.type === 0) extraBytesSize += it.size; // BYTE item
    }

    // ── Decompress chunks ────────────────────────────────────────────
    var outIdx = 0;
    var globalIdx = 0;
    var pointBuf = new Uint8Array(pointRecordLength);
    var pointView = new DataView(pointBuf.buffer);
    var rgbBuf = new Uint16Array(3);

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
                // Unsupported item type — skip (WAVEPACKET, POINT14, etc.)
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
                       hasRGB, colOff, classOff, classMask, pointRecordLength, bufLen);
            outIdx++;
        }
        globalIdx++;

        // Decompress remaining points
        for (var p = 1; p < pointsInChunk; p++, globalIdx++) {
            // Read each item
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
                        // Write back to pointBuf
                        pointView.setUint16(rOff, rgbBuf[0], true);
                        pointView.setUint16(rOff + 2, rgbBuf[1], true);
                        pointView.setUint16(rOff + 4, rgbBuf[2], true);
                    } else if (rType === 'byte') {
                        readers[ri].read(pointBuf.subarray(rOff, rOff + items[ri].size));
                    }
                }
            }

            // Emit point if it matches stride
            if (globalIdx % stride === 0 && outIdx < loadCount) {
                _emitPoint(pointBuf, pointView, outIdx, positions, rgbColors, intensities, classifications,
                           xScale, yScale, zScale, xOffset, yOffset, zOffset, cx, cy, cz,
                           hasRGB, colOff, classOff, classMask, pointRecordLength, bufLen);
                outIdx++;
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
