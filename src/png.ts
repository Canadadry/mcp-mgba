/**
 * A small, dependency-free PNG encoder for the one case this project needs:
 * a tightly-packed RGBA8888 buffer (as produced by the native shim's
 * mcbamgba_get_framebuffer()) to a valid PNG file.
 *
 * Why this exists instead of using libmgba's own screenshot support: the
 * native build uses DISABLE_DEPS (see native/vendor/mgba/CMakeLists.txt),
 * which forces USE_PNG off - there is no libpng linked into the shim, and
 * reintroducing it as a native dependency just for this milestone was
 * explicitly out of scope (see docs/prd/triage/02-core-mcp-tools.md). This
 * only uses Node's built-in `zlib` module (already part of every Node
 * runtime, not a new dependency) for the DEFLATE/zlib compression PNG's
 * IDAT chunk requires - the PNG framing (signature, chunks, CRC32) below is
 * hand-written.
 */
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buf: Buffer): number {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const typeBuf = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);

	const crcInput = Buffer.concat([typeBuf, data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(crcInput), 0);

	return Buffer.concat([length, typeBuf, data, crc]);
}

/** Encodes `rgba` (width*height*4 bytes, 8-bit RGBA, row-major, no padding)
 * as a PNG file. */
export function encodeRgbaToPng(rgba: Buffer, width: number, height: number): Buffer {
	const expected = width * height * 4;
	if (rgba.length !== expected) {
		throw new Error(
			`encodeRgbaToPng: expected ${expected} bytes for a ${width}x${height} RGBA8888 image, got ${rgba.length}`,
		);
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type: RGBA
	ihdr[10] = 0; // compression method
	ihdr[11] = 0; // filter method
	ihdr[12] = 0; // interlace method

	// Each scanline is prefixed with a filter-type byte; filter 0 (None) is
	// the simplest correct choice, at the cost of not exploiting the
	// row-to-row redundancy the other PNG filters are designed for.
	const rowBytes = width * 4;
	const raw = Buffer.alloc((rowBytes + 1) * height);
	for (let y = 0; y < height; y++) {
		const rawOffset = y * (rowBytes + 1);
		raw[rawOffset] = 0; // filter type: None
		rgba.copy(raw, rawOffset + 1, y * rowBytes, y * rowBytes + rowBytes);
	}

	const idatData = deflateSync(raw);

	return Buffer.concat([
		PNG_SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", idatData),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
