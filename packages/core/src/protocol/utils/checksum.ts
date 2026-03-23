import type { ChecksumType, Checksum2Type } from '../types.js';

export type { ChecksumType, Checksum2Type };

export const STANDARD_CHECKSUM_TYPES = [
  'add',
  'add_no_header',
  'xor',
  'xor_no_header',
  'samsung_rx',
  'samsung_tx',
  'samsung_xor',
  'bestin_sum',
  'none',
] as const satisfies readonly ChecksumType[];

export const STANDARD_CHECKSUM2_TYPES = [
  'xor_add',
  'crc_ccitt_xmodem',
  'crc16_xmodem',
  'crc16_xmodem_no_header',
  'crc16_ccitt_false',
  'crc16_ccitt_false_no_header',
  'crc16_modbus',
  'crc16_modbus_no_header',
  'crc16_ibm',
  'crc16_ibm_no_header',
  'crc16_kermit',
  'crc16_kermit_no_header',
  'crc16_x25',
  'crc16_x25_no_header',
] as const satisfies readonly Checksum2Type[];

type Crc16Variant =
  | 'crc16_xmodem'
  | 'crc16_ccitt_false'
  | 'crc16_modbus'
  | 'crc16_ibm'
  | 'crc16_kermit'
  | 'crc16_x25';

type Checksum2Resolution = {
  normalizedType: Checksum2Type;
  baseType: Crc16Variant | 'xor_add';
  includeHeader: boolean;
};

interface Crc16Spec {
  poly: number;
  init: number;
  refin: boolean;
  refout: boolean;
  xorOut: number;
}

const CRC16_SPECS: Record<Crc16Variant, Crc16Spec> = {
  crc16_xmodem: { poly: 0x1021, init: 0x0000, refin: false, refout: false, xorOut: 0x0000 },
  crc16_ccitt_false: {
    poly: 0x1021,
    init: 0xffff,
    refin: false,
    refout: false,
    xorOut: 0x0000,
  },
  crc16_modbus: { poly: 0x8005, init: 0xffff, refin: true, refout: true, xorOut: 0x0000 },
  crc16_ibm: { poly: 0x8005, init: 0x0000, refin: true, refout: true, xorOut: 0x0000 },
  crc16_kermit: { poly: 0x1021, init: 0x0000, refin: true, refout: true, xorOut: 0x0000 },
  crc16_x25: { poly: 0x1021, init: 0xffff, refin: true, refout: true, xorOut: 0xffff },
};

function resolveChecksum2Type(type: Checksum2Type): Checksum2Resolution {
  if (type === 'xor_add') {
    return { normalizedType: type, baseType: 'xor_add', includeHeader: true };
  }
  if (type === 'crc_ccitt_xmodem') {
    return {
      normalizedType: type,
      baseType: 'crc16_xmodem',
      includeHeader: false,
    };
  }

  const includeHeader = !type.endsWith('_no_header');
  const baseType = (includeHeader ? type : type.replace(/_no_header$/, '')) as Crc16Variant;
  return { normalizedType: type, baseType, includeHeader };
}

export type ByteArray = number[] | Buffer | Uint8Array;

export type Checksum2Verifier = (
  buffer: ByteArray,
  start: number,
  end: number,
  expectedHigh: number,
  expectedLow: number,
) => boolean;

/**
 * Calculate 1-byte checksum
 * @param header Header bytes
 * @param data Data bytes (excluding header and checksum)
 * @param type Checksum type
 * @returns Single byte checksum value
 */
export function calculateChecksum(header: ByteArray, data: ByteArray, type: ChecksumType): number {
  switch (type) {
    case 'add':
      return add(header, data);
    case 'add_no_header':
      return addNoHeader(data);
    case 'xor':
      return xor(header, data);
    case 'xor_no_header':
      return xorNoHeader(data);
    case 'samsung_rx':
      return samsungRx(data);
    case 'samsung_tx':
      return samsungTx(data);
    case 'samsung_xor':
      return samsungXorAllMsb0(header, data);
    case 'bestin_sum':
      return bestinSum(header, data);
    case 'none':
      throw new Error("Checksum type 'none' should not be calculated");
    default:
      throw new Error(`Unknown checksum type: ${type}`);
  }
}

/**
 * Calculate 1-byte checksum from a single buffer without slicing
 * @param buffer Full packet buffer
 * @param type Checksum type
 * @param headerLength Length of the header
 * @param dataEnd Index where data ends (exclusive, typically checks starts here)
 */
export function calculateChecksumFromBuffer(
  buffer: ByteArray,
  type: ChecksumType,
  _headerLength: number,
  dataEnd: number,
  baseOffset: number = 0,
): number {
  const dataStart = baseOffset;
  const headerStart = baseOffset + _headerLength;
  const dataStop = baseOffset + dataEnd;
  switch (type) {
    case 'add':
      return addRange(buffer, dataStart, dataStop);
    case 'add_no_header':
      return addRange(buffer, headerStart, dataStop);
    case 'xor':
      return xorRange(buffer, dataStart, dataStop);
    case 'xor_no_header':
      return xorRange(buffer, headerStart, dataStop);
    case 'samsung_rx':
      return samsungRxFromBuffer(buffer, headerStart, dataStop);
    case 'samsung_tx':
      return samsungTxFromBuffer(buffer, headerStart, dataStop);
    case 'samsung_xor':
      return samsungXorAllMsb0FromBuffer(buffer, dataStart, dataStop);
    case 'bestin_sum':
      return bestinSumFromBuffer(buffer, dataStart, dataStop);
    case 'none':
      throw new Error("Checksum type 'none' should not be calculated");
    default:
      throw new Error(`Unknown checksum type: ${type}`);
  }
}

function add(header: ByteArray, data: ByteArray): number {
  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  for (const byte of data) {
    sum += byte;
  }
  return sum & 0xff;
}

function addNoHeader(data: ByteArray): number {
  let sum = 0;
  for (const byte of data) {
    sum += byte;
  }
  return sum & 0xff;
}

function addRange(buffer: ByteArray, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += buffer[i];
  }
  return sum & 0xff;
}

function xor(header: ByteArray, data: ByteArray): number {
  let checksum = 0;
  for (const byte of header) {
    checksum ^= byte;
  }
  for (const byte of data) {
    checksum ^= byte;
  }
  return checksum;
}

function xorNoHeader(data: ByteArray): number {
  let checksum = 0;
  for (const byte of data) {
    checksum ^= byte;
  }
  return checksum;
}

function xorRange(buffer: ByteArray, start: number, end: number): number {
  let checksum = 0;
  for (let i = start; i < end; i++) {
    checksum ^= buffer[i];
  }
  return checksum;
}

function samsungRx(data: ByteArray): number {
  let crc = 0xb0;
  for (const byte of data) {
    crc ^= byte;
  }
  if (data[0] < 0x7c) {
    crc ^= 0x80;
  }
  return crc;
}

function samsungRxFromBuffer(buffer: ByteArray, start: number, end: number): number {
  let crc = 0xb0;
  for (let i = start; i < end; i++) {
    crc ^= buffer[i];
  }
  if (start < end && buffer[start] < 0x7c) {
    crc ^= 0x80;
  }
  return crc;
}

function samsungTx(data: ByteArray): number {
  let crc = 0x00;
  for (const byte of data) {
    crc ^= byte;
  }
  crc ^= 0x80;
  return crc;
}

function samsungTxFromBuffer(buffer: ByteArray, start: number, end: number): number {
  let crc = 0x00;
  for (let i = start; i < end; i++) {
    crc ^= buffer[i];
  }
  crc ^= 0x80;
  return crc;
}

function samsungXorAllMsb0(header: ByteArray, data: ByteArray): number {
  let crc = 0;
  for (const byte of header) {
    crc ^= byte;
  }
  for (const byte of data) {
    crc ^= byte;
  }
  return crc & 0x7f;
}

function samsungXorAllMsb0FromBuffer(buffer: ByteArray, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= buffer[i];
  }
  return crc & 0x7f;
}

function bestinSum(header: ByteArray, data: ByteArray): number {
  let sum = 3;
  for (const byte of header) {
    sum = ((byte ^ sum) + 1) & 0xff;
  }
  for (const byte of data) {
    sum = ((byte ^ sum) + 1) & 0xff;
  }
  return sum;
}

function bestinSumFromBuffer(buffer: ByteArray, start: number, end: number): number {
  let sum = 3;
  for (let i = start; i < end; i++) {
    sum = ((buffer[i] ^ sum) + 1) & 0xff;
  }
  return sum;
}

/**
 * Calculate 2-byte checksum
 * @param header Header bytes
 * @param data Data bytes (excluding header and checksum)
 * @param type Checksum type
 * @returns Array of 2 bytes [high, low]
 */
export function calculateChecksum2(
  header: ByteArray,
  data: ByteArray,
  type: Checksum2Type,
): number[] {
  const resolved = resolveChecksum2Type(type);
  switch (resolved.baseType) {
    case 'xor_add':
      return xorAdd(header, data);
    case 'crc16_xmodem':
    case 'crc16_ccitt_false':
    case 'crc16_modbus':
    case 'crc16_ibm':
    case 'crc16_kermit':
    case 'crc16_x25':
      return resolved.includeHeader
        ? crc16FromParts(header, data, CRC16_SPECS[resolved.baseType])
        : crc16FromBytes(data, CRC16_SPECS[resolved.baseType]);
    default:
      throw new Error(`Unknown 2-byte checksum type: ${resolved.normalizedType}`);
  }
}

/**
 * Calculate 2-byte checksum from buffer without slicing
 */
export function calculateChecksum2FromBuffer(
  buffer: ByteArray,
  type: Checksum2Type,
  _headerLength: number,
  dataEnd: number,
  baseOffset: number = 0,
): number[] {
  const dataStart = baseOffset;
  const headerStart = baseOffset + _headerLength;
  const dataStop = baseOffset + dataEnd;
  const resolved = resolveChecksum2Type(type);
  switch (resolved.baseType) {
    case 'xor_add':
      // xorAdd processes header then data linearly, so we can process range 0..dataEnd
      return xorAddRange(buffer, dataStart, dataStop);
    case 'crc16_xmodem':
    case 'crc16_ccitt_false':
    case 'crc16_modbus':
    case 'crc16_ibm':
    case 'crc16_kermit':
    case 'crc16_x25':
      return crc16Range(
        buffer,
        resolved.includeHeader ? dataStart : headerStart,
        dataStop,
        CRC16_SPECS[resolved.baseType],
      );
    default:
      throw new Error(`Unknown 2-byte checksum type: ${resolved.normalizedType}`);
  }
}

/**
 * Verify 2-byte checksum from buffer without slicing and allocation
 */
export function verifyChecksum2FromBuffer(
  buffer: ByteArray,
  type: Checksum2Type,
  _headerLength: number,
  dataEnd: number,
  baseOffset: number = 0,
  expectedHigh: number,
  expectedLow: number,
): boolean {
  const dataStart = baseOffset;
  const headerStart = baseOffset + _headerLength;
  const dataStop = baseOffset + dataEnd;
  const resolved = resolveChecksum2Type(type);
  switch (resolved.baseType) {
    case 'xor_add':
      return verifyXorAddRange(buffer, dataStart, dataStop, expectedHigh, expectedLow);
    case 'crc16_xmodem':
    case 'crc16_ccitt_false':
    case 'crc16_modbus':
    case 'crc16_ibm':
    case 'crc16_kermit':
    case 'crc16_x25':
      return verifyCrc16Range(
        buffer,
        resolved.includeHeader ? dataStart : headerStart,
        dataStop,
        expectedHigh,
        expectedLow,
        CRC16_SPECS[resolved.baseType],
      );
    default: {
      const calculated = calculateChecksum2FromBuffer(
        buffer,
        resolved.normalizedType,
        _headerLength,
        dataEnd,
        baseOffset,
      );
      return calculated[0] === expectedHigh && calculated[1] === expectedLow;
    }
  }
}

/**
 * XOR_ADD 2-byte checksum
 * Based on user-provided algorithm:
 * - Accumulates ADD and XOR separately for header and data
 * - Adds XOR result to ADD accumulator
 * - Packs as [XOR, ADD&0xFF]
 */
function xorAdd(header: ByteArray, data: ByteArray): number[] {
  let crc = 0;
  let temp = 0;

  // Process header bytes
  for (const byte of header) {
    crc += byte;
    temp ^= byte;
  }

  // Process data bytes
  for (const byte of data) {
    crc += byte;
    temp ^= byte;
  }

  crc += temp;

  // Pack into 2 bytes: [XOR, ADD]
  const high = temp & 0xff;
  const low = crc & 0xff;

  return [high, low];
}

export function verifyXorAddRange(
  buffer: ByteArray,
  start: number,
  end: number,
  expectedHigh: number,
  expectedLow: number,
): boolean {
  let crc = 0;
  let temp = 0;

  for (let i = start; i < end; i++) {
    const byte = buffer[i];
    crc += byte;
    temp ^= byte;
  }

  crc += temp;

  const high = temp & 0xff;
  const low = crc & 0xff;

  return high === expectedHigh && low === expectedLow;
}

/**
 * Returns the optimized checksum function for a given type.
 * Used to bypass switch statements in hot loops.
 */
export function getChecksumFunction(
  type: ChecksumType,
): ((buffer: ByteArray, start: number, end: number) => number) | null {
  switch (type) {
    case 'add':
      return addRange;
    case 'add_no_header':
      return addRange; // Caller must adjust start
    case 'xor':
      return xorRange;
    case 'xor_no_header':
      return xorRange; // Caller must adjust start
    case 'samsung_rx':
      return samsungRxFromBuffer;
    case 'samsung_tx':
      return samsungTxFromBuffer;
    case 'samsung_xor':
      return samsungXorAllMsb0FromBuffer;
    case 'bestin_sum':
      return bestinSumFromBuffer;
    default:
      return null;
  }
}

/**
 * Returns the optimized 2-byte checksum verifier function for a given type.
 * Used to bypass switch statements in hot loops.
 */
export function getChecksum2Verifier(type: Checksum2Type): Checksum2Verifier | null {
  const resolved = resolveChecksum2Type(type);
  switch (resolved.baseType) {
    case 'xor_add':
      return verifyXorAddRange;
    case 'crc16_xmodem':
    case 'crc16_ccitt_false':
    case 'crc16_modbus':
    case 'crc16_ibm':
    case 'crc16_kermit':
    case 'crc16_x25':
      if (!resolved.includeHeader) return null;
      const baseType = resolved.baseType as Crc16Variant;
      return (buffer, start, end, expectedHigh, expectedLow) =>
        verifyCrc16Range(buffer, start, end, expectedHigh, expectedLow, CRC16_SPECS[baseType]);
    default:
      return null;
  }
}

/**
 * Returns the offset type for the checksum function.
 * 'header': start = offset + headerLength
 * 'base': start = offset
 */
export function getChecksumOffsetType(type: ChecksumType): 'base' | 'header' {
  switch (type) {
    case 'add_no_header':
    case 'xor_no_header':
    case 'samsung_rx':
    case 'samsung_tx':
      return 'header';
    default:
      return 'base';
  }
}

function xorAddRange(buffer: ByteArray, start: number, end: number): number[] {
  let crc = 0;
  let temp = 0;

  for (let i = start; i < end; i++) {
    const byte = buffer[i];
    crc += byte;
    temp ^= byte;
  }

  crc += temp;

  // Pack into 2 bytes: [XOR, ADD]
  const high = temp & 0xff;
  const low = crc & 0xff;

  return [high, low];
}

function verifyCrc16Range(
  buffer: ByteArray,
  start: number,
  end: number,
  expectedHigh: number,
  expectedLow: number,
  spec: Crc16Spec,
): boolean {
  const [high, low] = crc16Range(buffer, start, end, spec);
  return high === expectedHigh && low === expectedLow;
}

function crc16FromBytes(data: ByteArray, spec: Crc16Spec): number[] {
  let crc = spec.init & 0xffff;
  for (const byte of data) {
    crc = updateCrc16(crc, byte, spec);
  }
  return finalizeCrc16(crc, spec);
}

function crc16FromParts(header: ByteArray, data: ByteArray, spec: Crc16Spec): number[] {
  let crc = spec.init & 0xffff;
  for (const byte of header) {
    crc = updateCrc16(crc, byte, spec);
  }
  for (const byte of data) {
    crc = updateCrc16(crc, byte, spec);
  }
  return finalizeCrc16(crc, spec);
}

function crc16Range(buffer: ByteArray, start: number, end: number, spec: Crc16Spec): number[] {
  let crc = spec.init & 0xffff;
  for (let i = start; i < end; i++) {
    crc = updateCrc16(crc, buffer[i], spec);
  }
  return finalizeCrc16(crc, spec);
}

function updateCrc16(crc: number, byte: number, spec: Crc16Spec): number {
  if (spec.refin) {
    let cur = (crc ^ byte) & 0xffff;
    const poly = reflect16(spec.poly);
    for (let i = 0; i < 8; i++) {
      cur = cur & 1 ? ((cur >>> 1) ^ poly) & 0xffff : (cur >>> 1) & 0xffff;
    }
    return cur;
  }

  let cur = (crc ^ ((byte & 0xff) << 8)) & 0xffff;
  for (let i = 0; i < 8; i++) {
    cur = cur & 0x8000 ? ((cur << 1) ^ spec.poly) & 0xffff : (cur << 1) & 0xffff;
  }
  return cur;
}

function finalizeCrc16(crc: number, spec: Crc16Spec): number[] {
  let final = crc & 0xffff;
  if (spec.refout !== spec.refin) {
    final = reflect16(final);
  }
  final = (final ^ spec.xorOut) & 0xffff;
  return [(final >> 8) & 0xff, final & 0xff];
}

function reflect16(value: number): number {
  let reflected = 0;
  for (let i = 0; i < 16; i++) {
    if (value & (1 << i)) {
      reflected |= 1 << (15 - i);
    }
  }
  return reflected & 0xffff;
}
