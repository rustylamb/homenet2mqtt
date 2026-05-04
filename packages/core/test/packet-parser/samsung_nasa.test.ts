import { describe, it, expect } from 'vitest';
import { PacketParser } from '../../src/protocol/packet-parser';
import { PacketDefaults } from '../../src/protocol/types';

describe('PacketParser with Samsung NASA framing', () => {
  // Real Samsung NASA HVAC frames captured via wallpad.py sniff on EW11 (192.168.99.21).
  // Frame structure: [start 0x32][size uint16BE][payload][CRC16 2B][end 0x34]
  // size value = (frame total length) - 2  (excludes start + end bytes)
  // CRC range: data[3:-3] = skip start(1) + size(2), CRC(2) + end(1) auto-excluded

  const NASA_DEFAULTS: PacketDefaults = {
    rx_header: [0x32],
    rx_footer: [0x34],
    rx_length_expr: 'data[1] * 256 + data[2] + 2',
    rx_min_length: 8,
    rx_max_length: 1500,
    rx_checksum: 'none',
    rx_checksum2: 'crc16_xmodem_nasa',
  };

  it('extracts a single short NASA frame (size=17, total=19)', () => {
    const parser = new PacketParser(NASA_DEFAULTS);
    const frame = Buffer.from('320011100100b0ffffc0141501200f00e96d34', 'hex');
    const result = parser.parseChunk(frame);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(frame);
  });

  it('framing-only (no checksum) works as baseline', () => {
    const noChksumDefaults: PacketDefaults = {
      ...NASA_DEFAULTS,
      rx_checksum2: undefined,
    };
    const parser = new PacketParser(noChksumDefaults);
    const frame = Buffer.from('320011100100b0ffffc0141501200f00e96d34', 'hex');
    const result = parser.parseChunk(frame);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts a longer NASA frame (size=60, total=62)', () => {
    const parser = new PacketParser(NASA_DEFAULTS);
    const frame = Buffer.from(
      '32003c100100b001ffc014120c020200000410000000002400ff05ffff240100010000800d00801000801700800301800100804601809d0180b281efdc34',
      'hex',
    );
    const result = parser.parseChunk(frame);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(frame);
  });

  it('skips preamble bytes (0xFD/0x55) before start byte', () => {
    const parser = new PacketParser(NASA_DEFAULTS);
    // Real RS485 stream: 0xFD preamble + frame
    const stream = Buffer.from(
      'fdfdfffdfd320011100100b0ffffc0141501200f00e96d34',
      'hex',
    );
    const result = parser.parseChunk(stream);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(Buffer.from('320011100100b0ffffc0141501200f00e96d34', 'hex'));
  });

  it('extracts multiple frames from one chunk', () => {
    const parser = new PacketParser(NASA_DEFAULTS);
    const f1 = '320011100100b0ffffc0141501200f00e96d34';
    const f2 = '3200116aeeffb0ffffc0146e0120040097d734';
    const chunk = Buffer.from('fdfdfdfdfd' + f1 + 'fdfdfd' + f2, 'hex');
    const result = parser.parseChunk(chunk);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(Buffer.from(f1, 'hex'));
    expect(result[1]).toEqual(Buffer.from(f2, 'hex'));
  });

  it('rejects frame with corrupted CRC', () => {
    const parser = new PacketParser(NASA_DEFAULTS);
    // Original valid:                        320011100100b0ffffc0141501200f00 e96d 34
    // Corrupt last 3 bytes (payload + CRC):  320011100100b0ffffc0141501200faa aaaa 34
    const corrupt = Buffer.from('320011100100b0ffffc0141501200faaaaaa34', 'hex');
    const result = parser.parseChunk(corrupt);
    expect(result).toHaveLength(0);
  });

  it('handles fragmented input across multiple chunks', () => {
    const parser = new PacketParser(NASA_DEFAULTS);
    const full = '320011100100b0ffffc0141501200f00e96d34';
    const buf = Buffer.from(full, 'hex');
    const part1 = buf.subarray(0, 8);
    const part2 = buf.subarray(8);
    const r1 = parser.parseChunk(part1);
    expect(r1).toHaveLength(0);
    const r2 = parser.parseChunk(part2);
    expect(r2).toHaveLength(1);
    expect(r2[0]).toEqual(buf);
  });
});
