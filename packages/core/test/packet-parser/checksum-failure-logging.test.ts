import { beforeEach, describe, expect, it, vi } from 'vitest';

const { debugMock } = vi.hoisted(() => ({
  debugMock: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: debugMock,
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { PacketParser } from '../../src/protocol/packet-parser';

describe('PacketParser checksum failure logging', () => {
  beforeEach(() => {
    debugMock.mockClear();
  });

  it('전략 A(rx_length)에서 체크섬 실패 로그를 남긴다', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_length: 5,
      rx_checksum: 'add',
    });

    const packet = Buffer.from([0xaa, 0x01, 0x02, 0x00, 0x00]);
    parser.parseChunk(packet);

    expect(debugMock).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'A',
        offset: 0,
        length: 5,
        packet,
        expected: 0xad,
        got: 0x00,
      }),
      expect.stringContaining('expected: 0xad, got: 0x00'),
    );
  });

  it('전략 B(rx_footer)에서 체크섬 실패 로그를 남긴다', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_footer: [0x55],
      rx_checksum: 'add',
    });

    const packet = Buffer.from([0xaa, 0x01, 0x02, 0x00, 0x55]);
    parser.parseChunk(packet);

    expect(debugMock).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'B',
        offset: 0,
        length: 5,
        packet,
        expected: 0xad,
        got: 0x00,
      }),
      expect.stringContaining('expected: 0xad, got: 0x00'),
    );
  });

  it('전략 C(rx_length_expr)에서 체크섬 실패 로그를 남긴다', () => {
    const parser = new PacketParser({
      rx_header: [0xaa],
      rx_checksum: 'add',
      rx_length_expr: '5',
    });

    const packet = Buffer.from([0xaa, 0x01, 0x02, 0x00, 0x00]);
    parser.parseChunk(packet);

    expect(debugMock).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'C',
        offset: 0,
        length: 5,
        packet,
        expected: 0xad,
        got: 0x00,
      }),
      expect.stringContaining('expected: 0xad, got: 0x00'),
    );
  });
});
