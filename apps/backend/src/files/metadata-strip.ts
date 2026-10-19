import type { StoredFileExtension } from '../storage/storage.types.js';

/** The image structure could not be parsed; the upload is refused. */
export class MalformedImageError extends Error {
  constructor(format: string) {
    super(`Malformed ${format} structure`);
    this.name = 'MalformedImageError';
  }
}

export interface StripResult {
  buffer: Buffer;
  /** True when the format is supported and the output carries no metadata. */
  stripped: boolean;
}

/**
 * Removes metadata (EXIF incl. GPS, XMP, IPTC, comments, text chunks) from
 * JPEG, PNG and WebP by rewriting the container and copying image data
 * unchanged. Other formats are returned as they are.
 */
export function stripMetadata(
  buffer: Buffer,
  ext: StoredFileExtension,
): StripResult {
  switch (ext) {
    case 'jpg':
      return { buffer: stripJpeg(buffer), stripped: true };
    case 'png':
      return { buffer: stripPng(buffer), stripped: true };
    case 'webp':
      return { buffer: stripWebp(buffer), stripped: true };
    default:
      return { buffer, stripped: false };
  }
}

// --- JPEG -------------------------------------------------------------------

const JPEG_SOI = 0xd8;
const JPEG_EOI = 0xd9;
const JPEG_SOS = 0xda;
const JPEG_APP0 = 0xe0;
const JPEG_APP2 = 0xe2;
const JPEG_APP14 = 0xee;
/** DQT, DNL, DRI. */
const JPEG_TABLE_MARKERS = new Set([0xdb, 0xdc, 0xdd]);
const JFIF_IDS = [
  Buffer.from('JFIF\0', 'latin1'),
  Buffer.from('JFXX\0', 'latin1'),
];
const ICC_PROFILE_ID = Buffer.from('ICC_PROFILE\0', 'latin1');
const ADOBE_ID = Buffer.from('Adobe', 'latin1');

function isStandaloneJpegMarker(marker: number): boolean {
  // TEM and RST0..RST7 carry no length field.
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

function hasJpegId(segment: Buffer, id: Buffer): boolean {
  return segment.subarray(4, 4 + id.length).equals(id);
}

/**
 * Positive allowlist: only the segments a decoder needs (SOFn, DHT, DAC,
 * DQT, DNL, DRI, SOS) plus APP0 (JFIF), APP2 when it is an ICC profile and
 * APP14 (Adobe colour transform). Everything else — APP1 Exif/XMP, APP13
 * IPTC, MPF, COM, JPGn and reserved markers — can carry arbitrary data and
 * is dropped, wherever it appears in the file.
 */
function keepJpegSegment(marker: number, segment: Buffer): boolean {
  // SOF0..SOF15 and DHT (0xC4) / DAC (0xCC); 0xC8 (JPG) is reserved.
  if (marker >= 0xc0 && marker <= 0xcf) return marker !== 0xc8;
  if (marker === JPEG_SOS || JPEG_TABLE_MARKERS.has(marker)) return true;
  if (marker === JPEG_APP0)
    return JFIF_IDS.some((id) => hasJpegId(segment, id));
  if (marker === JPEG_APP2) return hasJpegId(segment, ICC_PROFILE_ID);
  if (marker === JPEG_APP14) return hasJpegId(segment, ADOBE_ID);
  return false;
}

export function stripJpeg(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== JPEG_SOI) {
    throw new MalformedImageError('JPEG');
  }
  const parts: Buffer[] = [input.subarray(0, 2)];
  let offset = 2;
  while (offset < input.length) {
    if (input[offset] !== 0xff) throw new MalformedImageError('JPEG');
    // Fill bytes: any number of 0xFF may precede a marker.
    let markerAt = offset;
    while (markerAt + 1 < input.length && input[markerAt + 1] === 0xff) {
      markerAt += 1;
    }
    if (markerAt + 1 >= input.length) throw new MalformedImageError('JPEG');
    const marker = input[markerAt + 1];
    if (marker === JPEG_EOI) {
      // Trailing bytes after EOI are dropped.
      parts.push(Buffer.from([0xff, JPEG_EOI]));
      return Buffer.concat(parts);
    }
    if (isStandaloneJpegMarker(marker)) {
      parts.push(Buffer.from([0xff, marker]));
      offset = markerAt + 2;
      continue;
    }
    if (markerAt + 4 > input.length) throw new MalformedImageError('JPEG');
    const length = input.readUInt16BE(markerAt + 2);
    const end = markerAt + 2 + length;
    if (length < 2 || end > input.length) {
      throw new MalformedImageError('JPEG');
    }
    const segment = input.subarray(markerAt, end);
    if (keepJpegSegment(marker, segment)) parts.push(segment);
    offset = end;
    if (marker === JPEG_SOS) {
      // Entropy-coded data is copied verbatim; segment parsing resumes at
      // the next marker, so metadata between scans (progressive JPEGs) is
      // filtered like any other.
      const dataEnd = endOfEntropyCodedData(input, end);
      parts.push(input.subarray(end, dataEnd));
      offset = dataEnd;
    }
  }
  throw new MalformedImageError('JPEG');
}

/** Offset of the first real marker after a scan's entropy-coded data. */
function endOfEntropyCodedData(input: Buffer, from: number): number {
  for (let i = from; i + 1 < input.length; i += 1) {
    if (input[i] !== 0xff) continue;
    const next = input[i + 1];
    // 0xFF00 is a stuffed data byte and RST0..RST7 sit inside the scan;
    // any other 0xFFxx starts a marker.
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
      i += 1;
      continue;
    }
    return i;
  }
  throw new MalformedImageError('JPEG');
}

// --- PNG --------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

export function stripPng(input: Buffer): Buffer {
  if (!input.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new MalformedImageError('PNG');
  }
  const parts: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > input.length) throw new MalformedImageError('PNG');
    // Kept chunks are copied byte for byte, so their CRCs stay valid.
    if (!PNG_METADATA_CHUNKS.has(type)) parts.push(input.subarray(offset, end));
    offset = end;
    // Anything after IEND (e.g. an appended payload) is dropped.
    if (type === 'IEND') return Buffer.concat(parts);
  }
  throw new MalformedImageError('PNG');
}

// --- WebP -------------------------------------------------------------------

const WEBP_METADATA_CHUNKS = new Set(['EXIF', 'XMP ']);
const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

export function stripWebp(input: Buffer): Buffer {
  if (
    input.length < 12 ||
    input.toString('latin1', 0, 4) !== 'RIFF' ||
    input.toString('latin1', 8, 12) !== 'WEBP'
  ) {
    throw new MalformedImageError('WebP');
  }
  const riffEnd = 8 + input.readUInt32LE(4);
  if (riffEnd > input.length) throw new MalformedImageError('WebP');

  const chunks: Buffer[] = [];
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const fourcc = input.toString('latin1', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const dataEnd = offset + 8 + size;
    if (dataEnd > riffEnd) throw new MalformedImageError('WebP');
    if (!WEBP_METADATA_CHUNKS.has(fourcc)) {
      // A fresh copy (with the even-size padding byte) so the VP8X flags
      // can be edited without touching the input.
      const chunk = Buffer.alloc(8 + size + (size % 2));
      input.copy(chunk, 0, offset, dataEnd);
      if (fourcc === 'VP8X' && size >= 1) {
        chunk[8] &= ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);
      }
      chunks.push(chunk);
    }
    offset = dataEnd + (size % 2);
  }
  if (offset < riffEnd) throw new MalformedImageError('WebP');
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}
