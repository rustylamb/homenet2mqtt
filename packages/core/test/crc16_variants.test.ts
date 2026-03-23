import { describe, expect, it } from 'vitest';
import { calculateChecksum2, verifyChecksum2FromBuffer } from '../src/protocol/utils/checksum';

describe('CRC-16 variants', () => {
  const data = Array.from(Buffer.from('123456789', 'ascii'));

  it('should support legacy alias crc_ccitt_xmodem', () => {
    const legacy = calculateChecksum2([], data, 'crc_ccitt_xmodem');
    const modern = calculateChecksum2([], data, 'crc16_xmodem');
    expect(legacy).toEqual(modern);
    expect(modern).toEqual([0x31, 0xc3]);
  });

  it('should calculate crc16_ccitt_false correctly', () => {
    expect(calculateChecksum2([], data, 'crc16_ccitt_false')).toEqual([0x29, 0xb1]);
  });

  it('should calculate crc16_modbus correctly', () => {
    expect(calculateChecksum2([], data, 'crc16_modbus')).toEqual([0x4b, 0x37]);
  });

  it('should calculate crc16_ibm correctly', () => {
    expect(calculateChecksum2([], data, 'crc16_ibm')).toEqual([0xbb, 0x3d]);
  });

  it('should calculate crc16_kermit correctly', () => {
    expect(calculateChecksum2([], data, 'crc16_kermit')).toEqual([0x21, 0x89]);
  });

  it('should calculate crc16_x25 correctly', () => {
    expect(calculateChecksum2([], data, 'crc16_x25')).toEqual([0x90, 0x6e]);
  });

  it('should verify crc16_modbus from buffer', () => {
    const payload = Buffer.from([0xaa, 0xbb, ...data]);
    const [high, low] = calculateChecksum2([], data, 'crc16_modbus');
    const packet = Buffer.from([...payload, high, low]);

    const ok = verifyChecksum2FromBuffer(
      packet,
      'crc16_modbus',
      2,
      packet.length - 2,
      0,
      high,
      low,
    );
    expect(ok).toBe(true);
  });
});
