import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeRgbaToPng } from "../src/png.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Parses PNG chunks back out without pulling in a PNG-decoding
 * dependency, so this test can independently verify what encodeRgbaToPng
 * actually wrote (chunk framing + pixel round-trip), not just that it ran. */
function parseChunks(png: Buffer): Array<{ type: string; data: Buffer }> {
	expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
	const chunks: Array<{ type: string; data: Buffer }> = [];
	let offset = 8;
	while (offset < png.length) {
		const length = png.readUInt32BE(offset);
		const type = png.subarray(offset + 4, offset + 8).toString("ascii");
		const data = png.subarray(offset + 8, offset + 8 + length);
		chunks.push({ type, data });
		offset += 12 + length; // length + type + data + crc
	}
	return chunks;
}

describe("encodeRgbaToPng", () => {
	it("round-trips a small RGBA image through valid PNG chunk framing", () => {
		const width = 2;
		const height = 2;
		// Distinct, recognizable per-pixel colors so a decode mistake (byte
		// order, row order, filter byte) would show up as a mismatch.
		const rgba = Buffer.from([
			0xff, 0x00, 0x00, 0xff, // red
			0x00, 0xff, 0x00, 0xff, // green
			0x00, 0x00, 0xff, 0xff, // blue
			0x11, 0x22, 0x33, 0xff, // arbitrary
		]);

		const png = encodeRgbaToPng(rgba, width, height);
		const chunks = parseChunks(png);

		expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);

		const ihdr = chunks[0]!.data;
		expect(ihdr.readUInt32BE(0)).toBe(width);
		expect(ihdr.readUInt32BE(4)).toBe(height);
		expect(ihdr[8]).toBe(8); // bit depth
		expect(ihdr[9]).toBe(6); // color type: RGBA

		const raw = inflateSync(chunks[1]!.data);
		const rowBytes = width * 4;
		// Strip the leading filter-type byte (0 = None) from each scanline.
		const pixels = Buffer.alloc(rowBytes * height);
		for (let y = 0; y < height; y++) {
			expect(raw[y * (rowBytes + 1)]).toBe(0);
			raw.copy(pixels, y * rowBytes, y * (rowBytes + 1) + 1, y * (rowBytes + 1) + 1 + rowBytes);
		}
		expect(pixels.equals(rgba)).toBe(true);
	});

	it("rejects a buffer of the wrong size", () => {
		expect(() => encodeRgbaToPng(Buffer.alloc(3), 2, 2)).toThrow();
	});
});
