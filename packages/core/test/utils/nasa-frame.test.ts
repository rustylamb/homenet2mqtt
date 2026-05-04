import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';
import {
  decodeNasaFrame,
  encodeNasaFrame,
  nasaMessageKind,
  readVarInt16,
  readEnumByte,
  NasaDecodeError,
} from '../../src/protocol/utils/nasa-frame';

const SHORT_FRAME = Buffer.from('320011100100b0ffffc014a901200f004c7834', 'hex');

const MEDIUM_FRAME = Buffer.from(
  '320030100100b001ffc0140e0782080064829f005f821cfff682f30007841700000043841b00000000841c0000000000a934',
  'hex',
);

const TRIPLE_FRAME_FIRST = Buffer.from(
  '32003b200100b301ffc0144c0b04480000000040382542030108420400f4420500fa420600fa420bfe0c42170023421c0000423e0000429d0000d5a434',
  'hex',
);

describe('nasaMessageKind', () => {
  // Type is bits 9-10 of the id, NOT the high nibble (per lanwin protocol_nasa.h).
  it.each([
    [0x0000, 'enum'], // bits 9-10 = 00
    [0x4000, 'enum'], // ENUM_in_operation_power
    [0x4001, 'enum'], // ENUM_in_operation_mode
    [0x4038, 'enum'], // ENUM_in_state_humidity_percent
    [0x4201, 'var'], // VAR_in_temp_target_f
    [0x4204, 'var'], // VAR_in_temp_room_f
    [0x8204, 'var'], // VAR_out_sensor_airout
    [0x0448, 'lvar'], // bits 9-10 = 10
    [0x8413, 'lvar'], // LVAR_OUT_CONTROL_WATTMETER_1W_1MIN_SUM
    [0x8414, 'lvar'], // LVAR_OUT_CONTROL_WATTMETER_ALL_UNIT_ACCUM
    [0x4600, 'structure'], // bits 9-10 = 11
    [0x4609, 'structure'],
  ])('classifies 0x%s as %s', (id, expected) => {
    expect(nasaMessageKind(id)).toBe(expected);
  });
});

describe('decodeNasaFrame — short frame', () => {
  const decoded = decodeNasaFrame(SHORT_FRAME);

  it('extracts 3-byte source address', () => {
    expect(decoded.src.bytes).toEqual([0x10, 0x01, 0x00]); // indoor unit, channel 1, addr 0
    expect(decoded.src.value).toBe(0x100100);
  });

  it('extracts 3-byte destination address', () => {
    expect(decoded.dst.bytes).toEqual([0xb0, 0xff, 0xff]); // controller broadcast
  });

  it('decodes packet command bytes', () => {
    expect(decoded.cmd1).toBe(0xc0);
    expect(decoded.cmd2).toBe(0x14);
    expect(decoded.packetType).toBe(0x1);
    expect(decoded.dataType).toBe(0x4); // notification
    expect(decoded.dataTypeName).toBe('notification');
  });

  it('decodes packet number and message count', () => {
    expect(decoded.packetNumber).toBe(0xa9);
    expect(decoded.messages).toHaveLength(1);
  });

  it('decodes the single ENUM message', () => {
    const m = decoded.messages[0];
    expect(m.id).toBe(0x200f);
    expect(m.kind).toBe('enum');
    expect(readEnumByte(m.value)).toBe(0x00);
  });
});

describe('decodeNasaFrame — outdoor temperature broadcast', () => {
  const decoded = decodeNasaFrame(TRIPLE_FRAME_FIRST);

  it('identifies outdoor unit source', () => {
    expect(decoded.src.bytes).toEqual([0x20, 0x01, 0x00]);
  });

  it('targets channel via b3 class', () => {
    expect(decoded.dst.bytes).toEqual([0xb3, 0x01, 0xff]);
  });

  it('decodes 11 messages with mixed kinds (1 lvar, 1 enum, 9 vars)', () => {
    expect(decoded.messages).toHaveLength(11);
    const byKind = decoded.messages.reduce<Record<string, number>>((acc, m) => {
      acc[m.kind] = (acc[m.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(byKind).toEqual({ lvar: 1, enum: 1, var: 9 });

    const byId = new Map(decoded.messages.map((m) => [m.id, m]));
    // 0x4204..0x4206 are eva-in / eva-out / room VAR messages (int16, scale 0.1°C)
    expect(readVarInt16(byId.get(0x4204)!.value)).toBe(0x00f4); // 244 → 24.4°C
    expect(readVarInt16(byId.get(0x4205)!.value)).toBe(0x00fa); // 250 → 25.0°C
    expect(readVarInt16(byId.get(0x4206)!.value)).toBe(0x00fa); // 250 → 25.0°C
  });
});

describe('decodeNasaFrame — medium 0x82xx VAR + 0x84xx LVAR', () => {
  const decoded = decodeNasaFrame(MEDIUM_FRAME);

  it('parses 4 VARs + 3 LVARs', () => {
    expect(decoded.messages).toHaveLength(7);
    const byKind = decoded.messages.reduce<Record<string, number>>((acc, m) => {
      acc[m.kind] = (acc[m.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(byKind).toEqual({ var: 4, lvar: 3 });
  });

  it('consumes exactly the message region', () => {
    const total = decoded.messages.reduce((acc, m) => acc + 2 + m.value.length, 0);
    // Header(13) + messages + crc(2) + end(1) = frame.length
    expect(13 + total + 3).toBe(MEDIUM_FRAME.length);
  });
});

describe('decodeNasaFrame — error cases', () => {
  it('rejects too-short buffer', () => {
    expect(() => decodeNasaFrame(Buffer.alloc(8))).toThrow(NasaDecodeError);
  });

  it('rejects bad start byte', () => {
    const bad = Buffer.from(SHORT_FRAME);
    bad[0] = 0x00;
    expect(() => decodeNasaFrame(bad)).toThrow(/start byte/);
  });

  it('rejects bad end byte', () => {
    const bad = Buffer.from(SHORT_FRAME);
    bad[bad.length - 1] = 0x00;
    expect(() => decodeNasaFrame(bad)).toThrow(/end byte/);
  });

  it('rejects size mismatch', () => {
    const bad = Buffer.from(SHORT_FRAME);
    bad[2] = 0xff; // declare wildly wrong size
    expect(() => decodeNasaFrame(bad)).toThrow(/size mismatch/);
  });
});

describe('encodeNasaFrame', () => {
  it('roundtrips a short single-message frame', () => {
    const frame = encodeNasaFrame({
      src: [0x10, 0x01, 0x00],
      dst: [0xb0, 0xff, 0xff],
      cmd1: 0xc0,
      cmd2: 0x14,
      packetNumber: 0xa9,
      messages: [{ id: 0x200f, value: 0x00 }],
    });
    expect(frame).toEqual(SHORT_FRAME);
  });

  it('roundtrips by decoding then re-encoding', () => {
    const decoded = decodeNasaFrame(MEDIUM_FRAME);
    const re = encodeNasaFrame({
      src: decoded.src,
      dst: decoded.dst,
      cmd1: decoded.cmd1,
      cmd2: decoded.cmd2,
      packetNumber: decoded.packetNumber,
      messages: decoded.messages.map((m) => ({ id: m.id, value: m.value })),
    });
    expect(re).toEqual(MEDIUM_FRAME);
  });

  it('packs cmd1/cmd2 from semantic fields', () => {
    const frame = encodeNasaFrame({
      src: [0x00, 0xb0, 0xff],
      dst: [0x10, 0x01, 0x00],
      isInfo: true,
      protocolVersion: 2,
      retryCount: 0,
      packetType: 1,
      dataType: 2, // write
      packetNumber: 0,
      messages: [{ id: 0x4000, value: 1 }],
    });
    const decoded = decodeNasaFrame(frame);
    expect(decoded.cmd1 & 0x80).toBe(0x80); // isInfo bit set
    expect(decoded.packetType).toBe(1);
    expect(decoded.dataType).toBe(2);
    expect(decoded.dataTypeName).toBe('write');
  });

  it('encodes a VAR message and roundtrips the int16 value', () => {
    const frame = encodeNasaFrame({
      src: [0x00, 0xb0, 0xff],
      dst: [0x10, 0x01, 0x00],
      cmd1: 0xc0,
      cmd2: 0x12,
      packetNumber: 7,
      messages: [{ id: 0x4201, value: 250 }], // setpoint = 25.0°C
    });
    const decoded = decodeNasaFrame(frame);
    expect(decoded.messages).toHaveLength(1);
    expect(decoded.messages[0].id).toBe(0x4201);
    expect(readVarInt16(decoded.messages[0].value)).toBe(250);
  });
});
