import { fileTypeFromBuffer } from 'file-type';
import type { StoredFileExtension } from '../storage/storage.types.js';
import {
  COMMENT_MARKER,
  GPS_MARKER,
  JPEG_IMAGE_SEGMENTS,
  jpegSegment,
  jpegWithMarkupBehindMetadata,
  jpegWithMetadata,
  jpegWithoutMetadata,
  minimalPdf,
  plainPng,
  PNG_SIGNATURE,
  pngChunk,
  pngWithMarkupBehindMetadata,
  pngWithMetadata,
  readPngChunks,
  riffChunk,
  TEXT_MARKER,
  VP8X_FLAGS,
  webpWithMarkupBehindMetadata,
  webpWithMetadata,
  webpWithoutMetadata,
  XMP_MARKER,
} from '../../test/fixtures/files/fixtures.js';
import {
  MalformedImageError,
  stripJpeg,
  stripMetadata,
  stripPng,
  stripWebp,
} from './metadata-strip.js';
import { hasActiveContent } from './file-inspection.js';

const MARKERS = [GPS_MARKER, TEXT_MARKER, XMP_MARKER, COMMENT_MARKER];

function expectNoMarkers(buffer: Buffer) {
  const text = buffer.toString('latin1');
  for (const marker of MARKERS) expect(text).not.toContain(marker);
  expect(text).not.toContain('Exif');
}

/** Marker bytes of every JPEG segment before the scan data. */
function jpegMarkers(jpeg: Buffer): number[] {
  const markers: number[] = [];
  let offset = 2;
  while (offset < jpeg.length) {
    const marker = jpeg[offset + 1];
    markers.push(marker);
    if (marker === 0xda) break;
    offset += 2 + jpeg.readUInt16BE(offset + 2);
  }
  return markers;
}

describe('stripJpeg', () => {
  it('removes Exif/XMP (APP1), IPTC (APP13), non-ICC APP2, COM and trailing bytes', async () => {
    const input = jpegWithMetadata();
    expect(input.toString('latin1')).toContain(GPS_MARKER);

    const output = stripJpeg(input);

    expectNoMarkers(output);
    // Exactly the image without metadata: APP0, ICC APP2, APP14 and all
    // image data are preserved byte for byte.
    expect(output.equals(jpegWithoutMetadata())).toBe(true);
    expect(jpegMarkers(output)).toEqual([
      0xe0, 0xe2, 0xee, 0xdb, 0xc0, 0xc4, 0xda,
    ]);
    expect(output.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(await fileTypeFromBuffer(output)).toMatchObject({
      ext: 'jpg',
      mime: 'image/jpeg',
    });
  });

  it('filters segments between scans (multi-scan / progressive JPEG)', async () => {
    const s = JPEG_IMAGE_SEGMENTS;
    const secondScan = Buffer.concat([
      jpegSegment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
      // Restart marker inside the entropy-coded data stays in place.
      Buffer.from([0x55, 0xff, 0xd0, 0x66]),
    ]);
    const firstScan = s.scan.subarray(0, -2); // without EOI
    const head = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      s.app0,
      s.dqt,
      s.sof0,
      s.dht,
      firstScan,
    ]);
    const input = Buffer.concat([
      head,
      jpegSegment(0xe1, Buffer.from(`Exif\0\0${GPS_MARKER}`, 'latin1')),
      jpegSegment(0xfe, Buffer.from(COMMENT_MARKER, 'latin1')),
      s.dht, // tables between scans are structural and kept
      secondScan,
      Buffer.from([0xff, 0xd9]),
    ]);

    const output = stripJpeg(input);

    expectNoMarkers(output);
    expect(
      output.equals(
        Buffer.concat([head, s.dht, secondScan, Buffer.from([0xff, 0xd9])]),
      ),
    ).toBe(true);
    expect(await fileTypeFromBuffer(output)).toMatchObject({ ext: 'jpg' });
  });

  it.each([
    ['JPG0', 0xf0],
    ['JPG13', 0xfd],
    ['reserved JPG (0xC8)', 0xc8],
    ['APP15', 0xef],
    ['APP0 that is not JFIF', 0xe0],
    ['APP14 that is not Adobe', 0xee],
  ])('drops a %s segment carrying arbitrary data', (_name, marker) => {
    const clean = jpegWithoutMetadata();
    const input = Buffer.concat([
      clean.subarray(0, 2),
      jpegSegment(marker, Buffer.from(`XX${TEXT_MARKER}`, 'latin1')),
      clean.subarray(2),
    ]);
    expect(stripJpeg(input).equals(clean)).toBe(true);
  });

  it('is idempotent on an image without metadata', () => {
    const clean = jpegWithoutMetadata();
    expect(stripJpeg(clean).equals(clean)).toBe(true);
  });

  it('skips fill bytes before a marker', () => {
    const clean = jpegWithoutMetadata();
    const padded = Buffer.concat([
      clean.subarray(0, 2),
      Buffer.from([0xff, 0xff]),
      clean.subarray(2),
    ]);
    expect(stripJpeg(padded).equals(clean)).toBe(true);
  });

  it.each([
    ['not a JPEG', Buffer.from('hello world')],
    ['truncated segment', jpegWithMetadata().subarray(0, 30)],
    ['no EOI', jpegWithoutMetadata().subarray(0, -2)],
    [
      'segment length beyond the end',
      Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00]),
    ],
    ['garbage between segments', Buffer.from([0xff, 0xd8, 0x00, 0x00])],
  ])('rejects a malformed file (%s)', (_name, input) => {
    expect(() => stripJpeg(input)).toThrow(MalformedImageError);
  });
});

describe('stripPng', () => {
  it('removes eXIf/tEXt/zTXt/iTXt/tIME and data after IEND, keeping CRCs valid', async () => {
    const output = stripPng(pngWithMetadata());

    expectNoMarkers(output);
    const chunks = readPngChunks(output);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks.every((c) => c.crcValid)).toBe(true);
    expect(output.equals(plainPng())).toBe(true);
    expect(await fileTypeFromBuffer(output)).toMatchObject({
      ext: 'png',
      mime: 'image/png',
    });
  });

  it('keeps unknown ancillary chunks that are not metadata', () => {
    const png = plainPng();
    const gama = pngChunk('gAMA', Buffer.from([0, 0, 0xb1, 0x8f]));
    const input = Buffer.concat([png.subarray(0, 33), gama, png.subarray(33)]);
    expect(readPngChunks(stripPng(input)).map((c) => c.type)).toEqual([
      'IHDR',
      'gAMA',
      'IDAT',
      'IEND',
    ]);
  });

  it.each([
    ['bad signature', Buffer.from('not a png at all')],
    ['no IEND', plainPng().subarray(0, -12)],
    [
      'chunk length beyond the end',
      Buffer.concat([
        PNG_SIGNATURE,
        Buffer.from([0x7f, 0, 0, 0]),
        Buffer.from('IHDR'),
        Buffer.alloc(8),
      ]),
    ],
  ])('rejects a malformed file (%s)', (_name, input) => {
    expect(() => stripPng(input)).toThrow(MalformedImageError);
  });
});

describe('stripWebp', () => {
  it('removes EXIF and XMP chunks, clears the VP8X flags and fixes the RIFF size', async () => {
    const input = webpWithMetadata();
    expect(input[20] & VP8X_FLAGS.exif).toBeTruthy();

    const output = stripWebp(input);

    expectNoMarkers(output);
    expect(output.equals(webpWithoutMetadata())).toBe(true);
    expect(output.readUInt32LE(4)).toBe(output.length - 8);
    const flags = output[20];
    expect(flags & (VP8X_FLAGS.exif | VP8X_FLAGS.xmp)).toBe(0);
    expect(flags & VP8X_FLAGS.alpha).toBe(VP8X_FLAGS.alpha);
    expect(await fileTypeFromBuffer(output)).toMatchObject({
      ext: 'webp',
      mime: 'image/webp',
    });
  });

  it('does not modify the input buffer', () => {
    const input = webpWithMetadata();
    const copy = Buffer.from(input);
    stripWebp(input);
    expect(input.equals(copy)).toBe(true);
  });

  it('drops bytes after the RIFF container', () => {
    const clean = webpWithoutMetadata();
    const input = Buffer.concat([clean, Buffer.from(GPS_MARKER)]);
    expect(stripWebp(input).equals(clean)).toBe(true);
  });

  it.each([
    ['not RIFF', Buffer.from('RIFX\0\0\0\0WEBP')],
    [
      'RIFF size beyond the end',
      (() => {
        const b = webpWithoutMetadata();
        b.writeUInt32LE(b.length + 100, 4);
        return b;
      })(),
    ],
    [
      'chunk size beyond RIFF',
      (() => {
        const bad = riffChunk('VP8L', Buffer.alloc(4));
        bad.writeUInt32LE(1000, 4);
        const header = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
        header.writeUInt32LE(4 + bad.length, 4);
        return Buffer.concat([header, bad]);
      })(),
    ],
  ])('rejects a malformed file (%s)', (_name, input) => {
    expect(() => stripWebp(input)).toThrow(MalformedImageError);
  });
});

describe('stripMetadata', () => {
  it('dispatches by detected extension and leaves PDFs untouched', () => {
    expect(stripMetadata(pngWithMetadata(), 'png')).toMatchObject({
      stripped: true,
    });
    const pdf = minimalPdf();
    const result = stripMetadata(pdf, 'pdf');
    expect(result.stripped).toBe(false);
    expect(result.buffer).toBe(pdf);
  });
});

// Why the service sniffs the stripped body again: these fixtures pass the
// sniff of the upload, but stripping moves their markup into the head.
describe('stripping and the active-content sniff', () => {
  it.each([
    ['jpg', jpegWithMarkupBehindMetadata],
    ['png', pngWithMarkupBehindMetadata],
    ['webp', webpWithMarkupBehindMetadata],
  ] as const)('%s: markup surfaces only after stripping', (ext, build) => {
    const input = build();
    expect(hasActiveContent(input)).toBe(false);
    const { buffer } = stripMetadata(input, ext as StoredFileExtension);
    expect(hasActiveContent(buffer)).toBe(true);
  });
});
