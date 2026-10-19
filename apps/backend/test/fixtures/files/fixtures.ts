import { crc32, deflateSync } from 'node:zlib';

// Test files built in memory (no binary fixtures in the repository, no
// network). The metadata payloads carry recognizable markers so tests can
// assert they are gone from the stored object.

export const GPS_MARKER = 'GPS-MARKER-41.2995N-69.2401E';
export const TEXT_MARKER = 'SECRET-TEXT-MARKER-farm-location';
export const XMP_MARKER = 'XMP-MARKER-creator-tool';
export const COMMENT_MARKER = 'COMMENT-MARKER-jpeg';

const ascii = (text: string) => Buffer.from(text, 'latin1');

// --- JPEG -------------------------------------------------------------------

export function jpegSegment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/** Structurally valid baseline JPEG segments (1×1 grayscale). */
export const JPEG_IMAGE_SEGMENTS = {
  app0: jpegSegment(
    0xe0,
    Buffer.from([
      0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
      0x00, 0x00,
    ]),
  ),
  icc: jpegSegment(
    0xe2,
    Buffer.concat([ascii('ICC_PROFILE\0'), Buffer.from([1, 1]), ascii('icc')]),
  ),
  adobe: jpegSegment(0xee, ascii('Adobe\0d\0\0\0\0\x01')),
  dqt: jpegSegment(
    0xdb,
    Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)]),
  ),
  sof0: jpegSegment(
    0xc0,
    Buffer.from([0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]),
  ),
  dht: jpegSegment(
    0xc4,
    Buffer.concat([Buffer.from([0x00, 1]), Buffer.alloc(15), Buffer.from([0])]),
  ),
  // SOS header + entropy-coded data (with a stuffed 0xFF00) + EOI.
  scan: Buffer.concat([
    jpegSegment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    Buffer.from([0x7f, 0xff, 0x00, 0x12, 0xff, 0xd9]),
  ]),
};

export function jpegWithMetadata(): Buffer {
  const s = JPEG_IMAGE_SEGMENTS;
  const exif = Buffer.concat([
    ascii('Exif\0\0'),
    ascii('MM\0*\0\0\0\x08'), // big-endian TIFF header
    ascii(GPS_MARKER),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    s.app0,
    jpegSegment(0xe1, exif),
    jpegSegment(
      0xe1,
      ascii(
        `http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${XMP_MARKER}</x:xmpmeta>`,
      ),
    ),
    s.icc,
    jpegSegment(0xe2, ascii(`MPF\0${GPS_MARKER}`)), // APP2 that is not ICC
    jpegSegment(0xed, ascii(`Photoshop 3.0\0${TEXT_MARKER}`)), // APP13 IPTC
    jpegSegment(0xfe, ascii(COMMENT_MARKER)), // COM
    s.adobe,
    s.dqt,
    s.sof0,
    s.dht,
    s.scan,
    ascii(`trailing-${GPS_MARKER}`), // bytes after EOI
  ]);
}

/** The same image without any metadata (what stripping must produce). */
export function jpegWithoutMetadata(): Buffer {
  const s = JPEG_IMAGE_SEGMENTS;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    s.app0,
    s.icc,
    s.adobe,
    s.dqt,
    s.sof0,
    s.dht,
    s.scan,
  ]);
}

// --- PNG --------------------------------------------------------------------

export const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([ascii(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function pngIhdr(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return pngChunk('IHDR', ihdr);
}

function pngIdat(): Buffer {
  // One scanline: filter byte 0 + one RGBA pixel.
  return pngChunk(
    'IDAT',
    deflateSync(Buffer.from([0, 0x2e, 0x7d, 0x32, 0xff])),
  );
}

/** A decodable 1×1 PNG. */
export function plainPng(): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    pngIhdr(),
    pngIdat(),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function pngWithMetadata(): Buffer {
  const time = Buffer.from([0x07, 0xea, 10, 16, 12, 0, 0]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngIhdr(),
    pngChunk('tEXt', ascii(`Comment\0${TEXT_MARKER}`)),
    pngChunk(
      'zTXt',
      Buffer.concat([ascii('Author\0\0'), deflateSync(TEXT_MARKER)]),
    ),
    pngChunk('iTXt', ascii(`XML:com.adobe.xmp\0\0\0\0\0${XMP_MARKER}`)),
    pngChunk('eXIf', ascii(`MM\0*\0\0\0\x08${GPS_MARKER}`)),
    pngChunk('tIME', time),
    pngIdat(),
    pngChunk('IEND', Buffer.alloc(0)),
    ascii(`appended-${GPS_MARKER}`), // bytes after IEND
  ]);
}

export interface PngChunkInfo {
  type: string;
  crcValid: boolean;
}

/** Walks a PNG and verifies each chunk CRC (throws on a broken structure). */
export function readPngChunks(png: Buffer): PngChunkInfo[] {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  const chunks: PngChunkInfo[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const typeAndData = png.subarray(offset + 4, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    chunks.push({
      type: typeAndData.toString('latin1', 0, 4),
      crcValid: crc32(typeAndData) === crc,
    });
    offset += 12 + length;
  }
  if (offset !== png.length) throw new Error('truncated PNG');
  return chunks;
}

// --- WebP -------------------------------------------------------------------

export function riffChunk(fourcc: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, 'latin1');
  header.writeUInt32LE(data.length, 4);
  const pad = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, data, pad]);
}

function riff(chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

export const VP8X_FLAGS = { icc: 0x20, alpha: 0x10, exif: 0x08, xmp: 0x04 };

function vp8x(flags: number): Buffer {
  // flags, 3 reserved bytes, canvas width-1 and height-1 (24-bit LE each).
  return riffChunk('VP8X', Buffer.from([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
}

// 1×1 lossless bitstream header (signature 0x2f) followed by opaque data.
const VP8L = riffChunk(
  'VP8L',
  Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88, 0x08, 0x08]),
);

export function webpWithMetadata(): Buffer {
  return riff([
    vp8x(VP8X_FLAGS.alpha | VP8X_FLAGS.exif | VP8X_FLAGS.xmp),
    VP8L,
    riffChunk('EXIF', ascii(`MM\0*\0\0\0\x08${GPS_MARKER}`)), // odd size
    riffChunk('XMP ', ascii(`<x:xmpmeta>${XMP_MARKER}</x:xmpmeta>`)),
  ]);
}

export function webpWithoutMetadata(): Buffer {
  return riff([vp8x(VP8X_FLAGS.alpha), VP8L]);
}

// --- PDF / rejected types -----------------------------------------------------

export function minimalPdf(): Buffer {
  return ascii(
    [
      '%PDF-1.4',
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj',
      'trailer << /Root 1 0 R >>',
      '%%EOF',
      '',
    ].join('\n'),
  );
}

export function svgImage(): Buffer {
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">' +
      '<script>alert(document.domain)</script></svg>\n',
  );
}

export function htmlPage(): Buffer {
  return Buffer.from(
    '<!DOCTYPE html><html><body><script>alert(1)</script></body></html>\n',
  );
}

/** Windows PE: 'MZ' DOS header pointing at a 'PE\0\0' signature. */
export function windowsExecutable(): Buffer {
  const exe = Buffer.alloc(512);
  exe.write('MZ', 0, 'latin1');
  exe.writeUInt32LE(0x80, 0x3c);
  exe.write('PE\0\0', 0x80, 'latin1');
  return exe;
}

export function elfExecutable(): Buffer {
  const elf = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]).copy(elf);
  return elf;
}

export function shellScript(): Buffer {
  return Buffer.from('#!/bin/sh\nrm -rf /\n');
}

/** Valid PNG magic bytes followed by HTML (a classic content-sniffing polyglot). */
export function pngHtmlPolyglot(): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    pngIhdr(),
    Buffer.from('<html><body><script>alert(1)</script></body></html>'),
    pngIdat(),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** HTML encoded as UTF-16LE with a BOM. */
export function utf16Html(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('<html><script>alert(1)</script></html>', 'utf16le'),
  ]);
}

const MARKUP = '<html><script>alert(document.domain)</script></html>';
// Larger than the sniffed head (1 KiB), so the markup behind it is only
// visible to the sniffer once stripping has removed the padding.
const METADATA_PADDING = 'A'.repeat(1100);

/** Markup in an ICC segment (kept) behind a large Exif segment (dropped). */
export function jpegWithMarkupBehindMetadata(): Buffer {
  const s = JPEG_IMAGE_SEGMENTS;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    s.app0,
    jpegSegment(0xe1, ascii(`Exif\0\0${METADATA_PADDING}`)),
    jpegSegment(0xe2, ascii(`ICC_PROFILE\0\x01\x01${MARKUP}`)),
    s.dqt,
    s.sof0,
    s.dht,
    s.scan,
  ]);
}

/** Markup in a private ancillary chunk behind a large tEXt chunk. */
export function pngWithMarkupBehindMetadata(): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    pngIhdr(),
    pngChunk('tEXt', ascii(`Comment\0${METADATA_PADDING}`)),
    pngChunk('prVt', ascii(MARKUP)),
    pngIdat(),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Markup in an unknown RIFF chunk behind a large EXIF chunk. */
export function webpWithMarkupBehindMetadata(): Buffer {
  return riff([
    vp8x(VP8X_FLAGS.exif),
    VP8L,
    riffChunk('EXIF', ascii(METADATA_PADDING)),
    riffChunk('prVt', ascii(MARKUP)),
  ]);
}
