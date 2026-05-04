import { Buffer } from 'buffer';
import { calculateChecksum2FromBuffer } from './checksum.js';

/**
 * Samsung NASA frame layout (validated against lanwin/esphome_samsung_ac protocol_nasa.cpp).
 *
 *   [start 0x32] [size:uint16BE] [src:3] [dst:3] [cmd1] [cmd2] [pktNum] [msgCount]
 *   [messages...] [crc:uint16BE] [end 0x34]
 *
 * - size value = (frame total length) - 2  (excludes start + end bytes)
 * - src/dst are 3 bytes each: [class][channel][address]
 *     class: 0x10 = indoor unit, 0x20 = outdoor unit, 0x6A = wired remote, 0xB0/0xB3 = controller
 * - cmd1 packs: isInfo(1) | protocolVersion(2) | retryCount(2) | reserved(3)
 * - cmd2 packs: packetType(4 high) | dataType(4 low)
 *     dataType: 0x0=Undefined, 0x1=Read, 0x2=Write, 0x3=Request, 0x4=Notification, 0x5=Response, 0x6=Ack, 0x7=Nack
 * - CRC range: data[3:-3]  (skip start + size, exclude crc + end)
 */

export const NASA_START_BYTE = 0x32;
export const NASA_END_BYTE = 0x34;

export type NasaDataType =
  | 'undefined'
  | 'read'
  | 'write'
  | 'request'
  | 'notification'
  | 'response'
  | 'ack'
  | 'nack';

const DATA_TYPE_NAMES: Record<number, NasaDataType> = {
  0x0: 'undefined',
  0x1: 'read',
  0x2: 'write',
  0x3: 'request',
  0x4: 'notification',
  0x5: 'response',
  0x6: 'ack',
  0x7: 'nack',
};

export type NasaMessageType = 'enum' | 'var' | 'lvar' | 'structure';

export interface NasaAddress {
  /** [class, channel, address] — 3 raw bytes */
  bytes: [number, number, number];
  /** combined 24-bit value for compact comparisons (class<<16 | channel<<8 | addr) */
  value: number;
}

export interface NasaMessage {
  id: number;
  /** Message kind, derived from `id` high nibble: 0-3=enum, 4-7=var, 8-B=lvar, C-F=structure */
  kind: NasaMessageType;
  /** Raw value bytes; structure messages include the leading length byte stripped */
  value: Buffer;
}

export interface NasaFrame {
  src: NasaAddress;
  dst: NasaAddress;
  cmd1: number;
  cmd2: number;
  packetType: number;
  dataType: number;
  dataTypeName: NasaDataType;
  packetNumber: number;
  messages: NasaMessage[];
}

export class NasaDecodeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'too_short'
      | 'bad_start'
      | 'bad_end'
      | 'bad_size'
      | 'truncated_message',
  ) {
    super(message);
    this.name = 'NasaDecodeError';
  }
}

function makeAddress(bytes: Buffer, offset: number): NasaAddress {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  return { bytes: [a, b, c], value: (a << 16) | (b << 8) | c };
}

/**
 * Determine NASA message kind from the 2-byte id.
 *
 * Per lanwin/protocol_nasa.h MessageSet ctor:
 *   `type = (MessageSetType)((messageNumber & 0x600) >> 9)`
 *
 * The kind is encoded in bits 9-10 of the id, NOT the high nibble. Examples:
 * - `0x4000` ENUM (`0x4000 & 0x600 = 0`)
 * - `0x4201` VARIABLE (`& 0x600 = 0x200`)
 * - `0x8413` LONG_VARIABLE (`& 0x600 = 0x400`)
 * - `0x6000` STRUCTURE (`& 0x600 = 0x600`)
 */
export function nasaMessageKind(id: number): NasaMessageType {
  switch ((id & 0x600) >> 9) {
    case 0:
      return 'enum';
    case 1:
      return 'var';
    case 2:
      return 'lvar';
    default:
      return 'structure';
  }
}

function messageFixedSize(kind: NasaMessageType): number {
  switch (kind) {
    case 'enum':
      return 1;
    case 'var':
      return 2;
    case 'lvar':
      return 4;
    default:
      return -1; // structure: variable, fills remaining message region
  }
}

/**
 * Decode a complete NASA frame buffer (including start, size, and end bytes).
 * Does NOT verify the CRC — that is the parser's responsibility (rx_checksum2: crc16_xmodem_nasa).
 */
export function decodeNasaFrame(frame: Buffer): NasaFrame {
  if (frame.length < 16) {
    throw new NasaDecodeError(`frame too short (${frame.length} < 16)`, 'too_short');
  }
  if (frame[0] !== NASA_START_BYTE) {
    throw new NasaDecodeError(
      `expected start byte 0x32, got 0x${frame[0].toString(16)}`,
      'bad_start',
    );
  }
  if (frame[frame.length - 1] !== NASA_END_BYTE) {
    throw new NasaDecodeError(
      `expected end byte 0x34, got 0x${frame[frame.length - 1].toString(16)}`,
      'bad_end',
    );
  }
  const declaredSize = (frame[1] << 8) | frame[2];
  if (declaredSize + 2 !== frame.length) {
    throw new NasaDecodeError(
      `size mismatch: declared ${declaredSize}, actual ${frame.length - 2}`,
      'bad_size',
    );
  }

  const src = makeAddress(frame, 3);
  const dst = makeAddress(frame, 6);
  const cmd1 = frame[9];
  const cmd2 = frame[10];
  const packetType = (cmd2 >> 4) & 0x0f;
  const dataType = cmd2 & 0x0f;
  const packetNumber = frame[11];
  const messageCount = frame[12];

  // Messages occupy bytes 13 .. (frame.length - 3) [last 3 bytes are CRC + end]
  const msgEnd = frame.length - 3;
  const messages: NasaMessage[] = [];
  let cur = 13;
  for (let i = 0; i < messageCount; i++) {
    if (cur + 2 > msgEnd) {
      throw new NasaDecodeError(
        `message ${i + 1}/${messageCount} truncated at id (offset ${cur})`,
        'truncated_message',
      );
    }
    const id = (frame[cur] << 8) | frame[cur + 1];
    cur += 2;
    const kind = nasaMessageKind(id);
    let valueLen: number;
    if (kind === 'structure') {
      // Per lanwin: structure messages consume the rest of the message region
      // and only one structure message is allowed per frame.
      valueLen = msgEnd - cur;
    } else {
      valueLen = messageFixedSize(kind);
    }
    if (valueLen < 0 || cur + valueLen > msgEnd) {
      throw new NasaDecodeError(
        `message ${i + 1} (id=0x${id.toString(16).padStart(4, '0')}) truncated at value`,
        'truncated_message',
      );
    }
    const value = Buffer.from(frame.subarray(cur, cur + valueLen));
    cur += valueLen;
    messages.push({ id, kind, value });
  }

  return {
    src,
    dst,
    cmd1,
    cmd2,
    packetType,
    dataType,
    dataTypeName: DATA_TYPE_NAMES[dataType] ?? 'undefined',
    packetNumber,
    messages,
  };
}

export interface NasaEncodeInput {
  src: [number, number, number] | NasaAddress;
  dst: [number, number, number] | NasaAddress;
  /** Either a packed cmd1 byte, or omit and provide isInfo/protocolVersion/retryCount */
  cmd1?: number;
  isInfo?: boolean;
  protocolVersion?: number;
  retryCount?: number;
  /** Either a packed cmd2 byte, or supply packetType + dataType */
  cmd2?: number;
  packetType?: number;
  dataType?: number;
  packetNumber: number;
  messages: Array<{ id: number; value: number | Buffer | number[] }>;
}

function asAddrBytes(a: [number, number, number] | NasaAddress): [number, number, number] {
  return Array.isArray(a) ? a : a.bytes;
}

function packCmd1(input: NasaEncodeInput): number {
  if (input.cmd1 !== undefined) return input.cmd1 & 0xff;
  const isInfo = input.isInfo ? 1 : 0;
  const proto = (input.protocolVersion ?? 2) & 0x3;
  const retry = (input.retryCount ?? 0) & 0x3;
  return ((isInfo & 0x1) << 7) | (proto << 5) | (retry << 3);
}

function packCmd2(input: NasaEncodeInput): number {
  if (input.cmd2 !== undefined) return input.cmd2 & 0xff;
  const pt = (input.packetType ?? 0) & 0xf;
  const dt = (input.dataType ?? 0) & 0xf;
  return (pt << 4) | dt;
}

function valueBytes(id: number, value: number | Buffer | number[]): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return Buffer.from(value);
  const kind = nasaMessageKind(id);
  switch (kind) {
    case 'enum':
      return Buffer.from([value & 0xff]);
    case 'var': {
      const buf = Buffer.alloc(2);
      buf.writeInt16BE((value | 0) & 0xffff, 0);
      return buf;
    }
    case 'lvar': {
      const buf = Buffer.alloc(4);
      buf.writeInt32BE(value | 0, 0);
      return buf;
    }
    default:
      throw new Error(
        `cannot infer encoding for structure message 0x${id.toString(16)} from numeric value`,
      );
  }
}

/**
 * Encode a NASA frame from header + messages, computing size + CRC + framing bytes.
 *
 * The returned buffer is ready to write to the wire (preamble bytes are wallpad-side,
 * so no 0xFD bytes are emitted here).
 */
export function encodeNasaFrame(input: NasaEncodeInput): Buffer {
  const src = asAddrBytes(input.src);
  const dst = asAddrBytes(input.dst);
  const cmd1 = packCmd1(input);
  const cmd2 = packCmd2(input);

  // Pre-encode message bodies so we know total length.
  const encoded: Array<{ id: number; body: Buffer }> = input.messages.map(({ id, value }) => ({
    id,
    body: valueBytes(id, value),
  }));

  let messagesLen = 0;
  for (const m of encoded) {
    // Structure messages have no length prefix on the wire; the decoder
    // recognizes them by consuming the rest of the message region.
    messagesLen += 2 + m.body.length;
  }

  // Header (after start + size): src(3) + dst(3) + cmd1(1) + cmd2(1) + pktNum(1) + msgCount(1) = 10
  const headerLen = 10;
  // Frame total = start(1) + size(2) + header(10) + messages + crc(2) + end(1)
  const frameLen = 1 + 2 + headerLen + messagesLen + 2 + 1;
  const sizeValue = frameLen - 2; // size excludes start + end

  const out = Buffer.alloc(frameLen);
  out[0] = NASA_START_BYTE;
  out.writeUInt16BE(sizeValue, 1);
  out[3] = src[0];
  out[4] = src[1];
  out[5] = src[2];
  out[6] = dst[0];
  out[7] = dst[1];
  out[8] = dst[2];
  out[9] = cmd1;
  out[10] = cmd2;
  out[11] = input.packetNumber & 0xff;
  out[12] = input.messages.length & 0xff;

  let cur = 13;
  for (const m of encoded) {
    out[cur] = (m.id >> 8) & 0xff;
    out[cur + 1] = m.id & 0xff;
    cur += 2;
    m.body.copy(out, cur);
    cur += m.body.length;
  }

  // CRC range = data[3 .. frameLen - 3]  (skip start + size; exclude crc + end)
  // calculateChecksum2FromBuffer signature: (buffer, type, headerLen, dataEnd, baseOffset)
  //   With headerLen=1 (start byte) and crc16_xmodem_nasa.extraSkip=2 (size field), CRC starts at offset 3.
  const [crcHi, crcLo] = calculateChecksum2FromBuffer(
    out,
    'crc16_xmodem_nasa',
    1, // headerLen — the start byte
    frameLen - 3, // dataEnd (relative to baseOffset 0): up to byte before CRC
    0,
  );
  out[frameLen - 3] = crcHi;
  out[frameLen - 2] = crcLo;
  out[frameLen - 1] = NASA_END_BYTE;
  return out;
}

/** Decode a NASA Variable (VAR) message value as signed int16 BE. */
export function readVarInt16(value: Buffer): number {
  if (value.length !== 2) throw new Error(`var value must be 2 bytes, got ${value.length}`);
  return value.readInt16BE(0);
}

/** Decode a NASA Variable (VAR) message value as unsigned uint16 BE. */
export function readVarUint16(value: Buffer): number {
  if (value.length !== 2) throw new Error(`var value must be 2 bytes, got ${value.length}`);
  return value.readUInt16BE(0);
}

/** Decode a NASA LongVariable (LVAR) message value as signed int32 BE. */
export function readLvarInt32(value: Buffer): number {
  if (value.length !== 4) throw new Error(`lvar value must be 4 bytes, got ${value.length}`);
  return value.readInt32BE(0);
}

/** Decode a NASA LongVariable (LVAR) message value as unsigned uint32 BE. */
export function readLvarUint32(value: Buffer): number {
  if (value.length !== 4) throw new Error(`lvar value must be 4 bytes, got ${value.length}`);
  return value.readUInt32BE(0);
}

/** Decode a NASA ENUM message value as uint8. */
export function readEnumByte(value: Buffer): number {
  if (value.length !== 1) throw new Error(`enum value must be 1 byte, got ${value.length}`);
  return value[0];
}
