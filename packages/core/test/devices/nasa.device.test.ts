import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';
import { NasaDevice } from '../../src/protocol/devices/nasa.device';
import { decodeNasaFrame } from '../../src/protocol/utils/nasa-frame';
import { DeviceConfig, ProtocolConfig } from '../../src/protocol/types';

const PROTOCOL: ProtocolConfig = {
  packet_defaults: {
    rx_header: [0x32],
    rx_footer: [0x34],
  },
};

// Real outdoor-side broadcast targeting indoor #2:
//   src=0x200102 (outdoor, ch 1, indoor index 2)
//   dst=0xB301FF
const FRAME_OUTDOOR_TO_INDOOR2 = Buffer.from(
  '32003b200102b301ffc014dd0b04480000000040382c4203000c4204001442050020420600204208fe0c421700234221000042220000423d0000a37434',
  'hex',
);

const FRAME_OUTDOOR_TO_INDOOR0 = Buffer.from(
  '32003b200100b301ffc0144c0b04480000000040382542030108420400f4420500fa420600fa420bfe0c42170023421c0000423e0000429d0000d5a434',
  'hex',
);

function buildClimateConfig(srcAddr: number): DeviceConfig {
  return {
    id: `aircon_indoor_${(srcAddr & 0xff).toString()}`,
    name: `Aircon ${(srcAddr & 0xff).toString()}`,
    nasa: {
      rx: { src: srcAddr, dst: 0xb301ff },
      tx: { src: 0xb0010f, dst: srcAddr },
      messages: {
        humidity_pct: { id: 0x4038, attribute: 'current_humidity', type: 'enum' },
        target_temp: {
          id: 0x4203,
          attribute: 'target_temperature',
          type: 'int16',
          scale: 0.1,
        },
        current_temp: {
          id: 0x4204,
          attribute: 'current_temperature',
          type: 'int16',
          scale: 0.1,
        },
      },
    },
    // Command specs (tested separately)
    command_temperature: { message: 'target_temp', value_from: 'input', data_type: 'write' },
    command_off: { message: 'humidity_pct', value: 0 },
  } as any;
}

describe('NasaDevice — incoming match + parse', () => {
  it('matches a frame from the configured indoor index', () => {
    const dev = new NasaDevice(buildClimateConfig(0x200102), PROTOCOL);
    expect(dev.matchesPacket(FRAME_OUTDOOR_TO_INDOOR2)).toBe(true);
    expect(dev.matchesPacket(FRAME_OUTDOOR_TO_INDOOR0)).toBe(false);
  });

  it('rejects non-NASA frames', () => {
    const dev = new NasaDevice(buildClimateConfig(0x200102), PROTOCOL);
    const garbage = Buffer.from('f70123456789abcd', 'hex');
    expect(dev.matchesPacket(garbage)).toBe(false);
  });

  it('extracts current_temperature (VAR int16 / 10) from broadcast', () => {
    const dev = new NasaDevice(buildClimateConfig(0x200102), PROTOCOL);
    const updates = dev.parseData(FRAME_OUTDOOR_TO_INDOOR2);
    expect(updates).not.toBeNull();
    // 0x4204 value bytes for indoor #2 = `00 14` = 20 → 2.0°C scale; not realistic but verifies decode
    expect(updates!.current_temperature).toBeCloseTo(2.0, 5);
  });

  it('returns null when no recognized message ids match', () => {
    const cfg = buildClimateConfig(0x200102);
    cfg.nasa!.messages = {
      // bind a message id that isn't actually in the frame
      mystery: { id: 0xffff, attribute: 'mystery_attr' },
    };
    const dev = new NasaDevice(cfg, PROTOCOL);
    const updates = dev.parseData(FRAME_OUTDOOR_TO_INDOOR2);
    expect(updates).toBeNull();
  });
});

describe('NasaDevice — command construction', () => {
  it('builds a valid setpoint write frame', () => {
    const dev = new NasaDevice(buildClimateConfig(0x200102), PROTOCOL);
    const out = dev.constructCommand('temperature', 23.5);
    expect(Array.isArray(out)).toBe(true);
    const frame = Buffer.from(out as number[]);
    const decoded = decodeNasaFrame(frame);
    expect(decoded.src.bytes).toEqual([0xb0, 0x01, 0x0f]);
    expect(decoded.dst.bytes).toEqual([0x20, 0x01, 0x02]);
    expect(decoded.dataTypeName).toBe('write');
    expect(decoded.messages).toHaveLength(1);
    expect(decoded.messages[0].id).toBe(0x4203);
    // 23.5°C / 0.1 scale = 235
    expect(decoded.messages[0].value.readInt16BE(0)).toBe(235);
  });

  it('builds a single-message ENUM write', () => {
    const dev = new NasaDevice(buildClimateConfig(0x200102), PROTOCOL);
    const out = dev.constructCommand('off');
    expect(Array.isArray(out)).toBe(true);
    const frame = Buffer.from(out as number[]);
    const decoded = decodeNasaFrame(frame);
    expect(decoded.messages).toHaveLength(1);
    expect(decoded.messages[0].id).toBe(0x4038);
    expect(decoded.messages[0].value).toEqual(Buffer.from([0])); // enum value = 0
  });

  it('rejects unknown command name', () => {
    const dev = new NasaDevice(buildClimateConfig(0x200102), PROTOCOL);
    expect(dev.constructCommand('bogus')).toBeNull();
  });

  it('builds a multi-message command', () => {
    const cfg = buildClimateConfig(0x200102);
    (cfg as any).command_heat = {
      messages: [
        { name: 'humidity_pct', value: 1 }, // pretend it's the power msg for this test
        { name: 'target_temp', value: 22 },
      ],
    };
    const dev = new NasaDevice(cfg, PROTOCOL);
    const out = dev.constructCommand('heat');
    const frame = Buffer.from(out as number[]);
    const decoded = decodeNasaFrame(frame);
    expect(decoded.messages).toHaveLength(2);
    expect(decoded.messages[0].id).toBe(0x4038);
    expect(decoded.messages[1].id).toBe(0x4203);
    // 22°C / 0.1 scale = 220
    expect(decoded.messages[1].value.readInt16BE(0)).toBe(220);
  });
});

describe('NasaDevice — wildcard address matching', () => {
  it('treats 0xff in any byte as wildcard', () => {
    const cfg: DeviceConfig = {
      id: 'any_outdoor',
      name: 'Any Outdoor',
      nasa: {
        // rx.src = 0x2001ff means: class 0x20, channel 0x01, address ANY
        rx: { src: 0x2001ff, dst: 0xb301ff },
        messages: {},
      },
    } as any;
    const dev = new NasaDevice(cfg, PROTOCOL);
    expect(dev.matchesPacket(FRAME_OUTDOOR_TO_INDOOR0)).toBe(true);
    expect(dev.matchesPacket(FRAME_OUTDOOR_TO_INDOOR2)).toBe(true);
  });
});
