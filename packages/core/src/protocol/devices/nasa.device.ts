import { Buffer } from 'buffer';
import { Device } from '../device.js';
import {
  DeviceConfig,
  ProtocolConfig,
  CommandResult,
  NasaAddrSpec,
  NasaEntityConfig,
  NasaMessageBinding,
  NasaCommandSpec,
  NasaSingleCommand,
  NasaMultiCommand,
} from '../types.js';
import {
  decodeNasaFrame,
  encodeNasaFrame,
  NasaDecodeError,
  NASA_START_BYTE,
  nasaMessageKind,
  NasaMessage,
} from '../utils/nasa-frame.js';
import { logger } from '../../utils/logger.js';

/**
 * NASA-aware device for Samsung HVAC entities.
 *
 * Unlike GenericDevice (byte-position matching), NasaDevice identifies its frames
 * by the NASA source/destination addresses, then decodes every message in the frame
 * and folds them into a single state update object using the entity's `nasa.messages`
 * lookup.
 *
 * One frame can update multiple attributes (e.g. mode + setpoint + current_temp in
 * a single broadcast).
 */
export class NasaDevice extends Device {
  private readonly nasaConfig: NasaEntityConfig;
  private readonly idToBinding: Map<number, NasaMessageBinding & { id: number; logicalName: string }>;
  private readonly nameToBinding: Map<string, NasaMessageBinding & { id: number }>;
  private readonly rxSrc: ParsedAddrFilter | null;
  private readonly rxDst: ParsedAddrFilter | null;
  private readonly txSrc: [number, number, number] | null;
  private readonly txDst: [number, number, number] | null;
  private packetCounter: number = 0;

  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
    if (!config.nasa) {
      throw new Error(`NasaDevice ${config.id}: missing 'nasa' entity config`);
    }
    this.nasaConfig = config.nasa;

    this.idToBinding = new Map();
    this.nameToBinding = new Map();
    for (const [name, binding] of Object.entries(this.nasaConfig.messages || {})) {
      const enriched = { ...binding, logicalName: name };
      this.idToBinding.set(binding.id, enriched);
      this.nameToBinding.set(name, binding);
    }

    this.rxSrc = parseAddrFilter(this.nasaConfig.rx?.src);
    this.rxDst = parseAddrFilter(this.nasaConfig.rx?.dst);
    this.txSrc = resolveAddrBytes(this.nasaConfig.tx?.src) ?? null;
    this.txDst = resolveAddrBytes(this.nasaConfig.tx?.dst) ?? null;
  }

  public matchesPacket(packet: Buffer): boolean {
    if (packet.length < 16 || packet[0] !== NASA_START_BYTE) {
      return false;
    }
    if (this.rxSrc && !addrMatches(this.rxSrc, packet, 3)) return false;
    if (this.rxDst && !addrMatches(this.rxDst, packet, 6)) return false;
    return true;
  }

  public parseData(packet: Buffer): Record<string, any> | null {
    if (!this.matchesPacket(packet)) return null;
    let frame;
    try {
      frame = decodeNasaFrame(packet);
    } catch (err) {
      if (err instanceof NasaDecodeError) {
        logger.debug({ err: err.message, code: err.code, id: this.config.id }, '[NasaDevice] decode failed');
        return null;
      }
      throw err;
    }

    const updates: Record<string, any> = {};
    for (const message of frame.messages) {
      const binding = this.idToBinding.get(message.id);
      if (!binding) continue;
      const decoded = decodeMessageValue(message, binding);
      if (decoded === undefined) continue;
      updates[binding.attribute] = decoded;
    }
    if (Object.keys(updates).length === 0) {
      return null;
    }
    this.updateState(updates);
    return updates;
  }

  public constructCommand(
    commandName: string,
    value?: any,
    _states?: Map<string, Record<string, any>>,
  ): number[] | CommandResult | null {
    const entityConfig = this.config as any;
    const normalizedName = commandName.startsWith('command_')
      ? commandName
      : `command_${commandName}`;
    const spec = entityConfig[normalizedName] as NasaCommandSpec | undefined;
    if (!spec) {
      this.reportError({
        type: 'command',
        message: `unknown command ${commandName}`,
        context: { command: commandName },
      });
      return null;
    }

    if (!this.txSrc || !this.txDst) {
      this.reportError({
        type: 'command',
        message: `entity ${this.config.id} missing nasa.tx.src/dst — cannot build command`,
        context: { command: commandName },
      });
      return null;
    }

    const messages = collectCommandMessages(spec, value);
    if (!messages) {
      this.reportError({
        type: 'command',
        message: `command ${commandName} produced no messages`,
        context: { command: commandName },
      });
      return null;
    }

    const resolvedMessages: Array<{ id: number; value: number }> = [];
    for (const m of messages) {
      const binding = this.nameToBinding.get(m.name);
      if (!binding) {
        this.reportError({
          type: 'command',
          message: `command ${commandName} references unknown message '${m.name}'`,
          context: { command: commandName },
        });
        return null;
      }
      const numericValue = m.value;
      if (typeof numericValue !== 'number' || Number.isNaN(numericValue)) {
        this.reportError({
          type: 'command',
          message: `command ${commandName} (msg ${m.name}) has no numeric value`,
          context: { command: commandName, value },
        });
        return null;
      }
      // For VAR with scale (e.g. temperature 0.1°C), multiply by 1/scale before encoding
      const scaled = binding.scale ? Math.round(numericValue / binding.scale) : numericValue;
      resolvedMessages.push({ id: binding.id, value: scaled });
    }

    const dataTypeName = (spec as NasaSingleCommand | NasaMultiCommand).data_type ?? 'write';
    const dataType = DATA_TYPE_NUMBERS[dataTypeName];

    const frame = encodeNasaFrame({
      src: this.txSrc,
      dst: this.txDst,
      isInfo: false,
      protocolVersion: 2,
      retryCount: 0,
      packetType: 1,
      dataType,
      packetNumber: this.nextPacketNumber(),
      messages: resolvedMessages,
    });
    return Array.from(frame);
  }

  public getOptimisticState(commandName: string, value?: any): Record<string, any> | null {
    // Map a few common climate commands to optimistic state attributes.
    const lc = commandName.replace(/^command_/, '');
    if (lc === 'temperature' && typeof value === 'number') {
      return { target_temperature: value };
    }
    if (lc === 'mode' && typeof value === 'string') {
      return { mode: value };
    }
    if (['off', 'heat', 'cool', 'auto', 'dry', 'fan_only'].includes(lc)) {
      return { mode: lc };
    }
    return null;
  }

  private nextPacketNumber(): number {
    const n = this.packetCounter;
    this.packetCounter = (this.packetCounter + 1) & 0xff;
    return n;
  }
}

const DATA_TYPE_NUMBERS: Record<string, number> = {
  read: 0x1,
  write: 0x2,
  request: 0x3,
  notification: 0x4,
  response: 0x5,
};

interface ParsedAddrFilter {
  bytes: [number, number, number];
  /** Mask: 1 means byte must match, 0 means wildcard (`0xff` in spec) */
  mask: [number, number, number];
}

function resolveAddrBytes(spec: NasaAddrSpec | undefined): [number, number, number] | undefined {
  if (spec === undefined) return undefined;
  if (Array.isArray(spec)) return [spec[0] & 0xff, spec[1] & 0xff, spec[2] & 0xff];
  if (typeof spec === 'number')
    return [(spec >> 16) & 0xff, (spec >> 8) & 0xff, spec & 0xff];
  return undefined;
}

function parseAddrFilter(spec: NasaAddrSpec | undefined): ParsedAddrFilter | null {
  const bytes = resolveAddrBytes(spec);
  if (!bytes) return null;
  // Treat 0xff bytes as wildcards; everything else is exact-match.
  const mask: [number, number, number] = [
    bytes[0] === 0xff ? 0 : 1,
    bytes[1] === 0xff ? 0 : 1,
    bytes[2] === 0xff ? 0 : 1,
  ];
  return { bytes, mask };
}

function addrMatches(filter: ParsedAddrFilter, packet: Buffer, offset: number): boolean {
  if (filter.mask[0] && packet[offset] !== filter.bytes[0]) return false;
  if (filter.mask[1] && packet[offset + 1] !== filter.bytes[1]) return false;
  if (filter.mask[2] && packet[offset + 2] !== filter.bytes[2]) return false;
  return true;
}

function decodeMessageValue(
  message: NasaMessage,
  binding: NasaMessageBinding,
): string | number | undefined {
  const explicitType = binding.type ?? 'auto';
  const kind = explicitType === 'auto' ? nasaMessageKind(message.id) : explicitType;
  let raw: number;
  switch (kind) {
    case 'enum':
    case 'uint8':
      if (message.value.length < 1) return undefined;
      raw = message.value[0];
      break;
    case 'var':
    case 'int16':
      if (message.value.length < 2) return undefined;
      raw = message.value.readInt16BE(0);
      break;
    case 'uint16':
      if (message.value.length < 2) return undefined;
      raw = message.value.readUInt16BE(0);
      break;
    case 'lvar':
    case 'int32':
      if (message.value.length < 4) return undefined;
      raw = message.value.readInt32BE(0);
      break;
    case 'uint32':
      if (message.value.length < 4) return undefined;
      raw = message.value.readUInt32BE(0);
      break;
    default:
      return undefined;
  }

  if (binding.values && raw in binding.values) {
    return binding.values[raw];
  }
  if (binding.scale) {
    return raw * binding.scale;
  }
  return raw;
}

function collectCommandMessages(
  spec: NasaCommandSpec,
  value: any,
): Array<{ name: string; value: number }> | null {
  const list: Array<{ name: string; value: number }> = [];
  const single = spec as NasaSingleCommand;
  const multi = spec as NasaMultiCommand;
  if (multi.messages && Array.isArray(multi.messages)) {
    for (const m of multi.messages) {
      const v = m.value_from === 'input' ? Number(value) : (m.value as number | undefined);
      if (typeof v !== 'number' || Number.isNaN(v)) return null;
      list.push({ name: m.name, value: v });
    }
    return list;
  }
  if (single.message) {
    const v = single.value_from === 'input' ? Number(value) : single.value;
    if (typeof v !== 'number' || Number.isNaN(v)) return null;
    list.push({ name: single.message, value: v });
    return list;
  }
  return null;
}
