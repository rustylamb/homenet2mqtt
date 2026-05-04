/**
 * Supported 1-byte checksum algorithms.
 *
 * - `add`: Sum of all bytes (header + data) & 0xFF.
 * - `add_no_header`: Sum of data bytes (excluding header) & 0xFF.
 * - `xor`: XOR of all bytes (header + data).
 * - `xor_no_header`: XOR of data bytes (excluding header).
 * - `samsung_rx`: (@deprecated) Specialized Samsung Wallpad RX checksum (0xB0 ^ XOR). If data[0] < 0x7C, result ^= 0x80.
 * - `samsung_tx`: (@deprecated) Specialized Samsung Wallpad TX checksum.
 * - `samsung_xor`: XOR of all bytes & 0x7F (Msb 0).
 * - `bestin_sum`: Cumulative XOR-based sum algorithm.
 * - `crc8*`: CRC-8 variants. 기본형은 헤더+데이터, `_no_header`는 데이터만.
 * - `none`: No checksum calculation.
 */
export type ChecksumType =
  | 'add'
  | 'xor'
  | 'add_no_header'
  | 'xor_no_header'
  | 'samsung_rx'
  | 'samsung_tx'
  | 'samsung_xor'
  | 'bestin_sum'
  | 'crc8'
  | 'crc8_no_header'
  | 'crc8_maxim'
  | 'crc8_maxim_no_header'
  | 'crc8_rohc'
  | 'crc8_rohc_no_header'
  | 'crc8_wcdma'
  | 'crc8_wcdma_no_header'
  | 'none';

/**
 * Supported 2-byte checksum algorithms.
 *
 * - `xor_add`: 헤더 + 데이터 대상.
 * - 기본 CRC16 이름(`crc16_*`): 헤더 + 데이터 대상.
 * - `_no_header` 접미사 CRC16(`crc16_*_no_header`): 데이터만 대상.
 * - `crc_ccitt_xmodem`: 레거시 alias (`crc16_xmodem_no_header`와 동일 동작).
 * - `crc16_xmodem_nasa`: Samsung NASA HVAC variant. CRC over `data[3:-3]` —
 *   skips 1-byte header + 2-byte size field at start; CRC bytes (2) + footer (1) auto-excluded.
 *   Use with `rx_header: [0x32]`, `rx_footer: [0x34]`,
 *   `rx_length_expr: 'data[1] * 256 + data[2] + 2'`.
 */
export type Checksum2Type =
  | 'xor_add'
  | 'crc_ccitt_xmodem'
  | 'crc16_xmodem'
  | 'crc16_xmodem_no_header'
  | 'crc16_xmodem_nasa'
  | 'crc16_ccitt_false'
  | 'crc16_ccitt_false_no_header'
  | 'crc16_modbus'
  | 'crc16_modbus_no_header'
  | 'crc16_ibm'
  | 'crc16_ibm_no_header'
  | 'crc16_kermit'
  | 'crc16_kermit_no_header'
  | 'crc16_x25'
  | 'crc16_x25_no_header';

/**
 * Value encoding/decoding strategies for numeric states.
 */
export type DecodeEncodeType =
  | 'none'
  | 'bcd' // Binary Coded Decimal
  | 'ascii' // ASCII string to number
  | 'signed_byte_half_degree' // Signed byte where 1 unit = 0.5 degrees
  | 'multiply' // Use mapping/factor logic
  | 'add_0x80'; // Add 0x80 to value

export type EndianType = 'big' | 'little';

/**
 * Default packet structure and timing configuration.
 * Can be defined globally or overridden per entity.
 */
export interface PacketDefaults {
  /**
   * Header bytes for received packets.
   * @example [0xAA, 0x55]
   */
  rx_header?: number[];

  /**
   * Footer bytes for received packets.
   * @example [0x0D, 0x0D]
   */
  rx_footer?: number[];

  /**
   * Checksum algorithm or CEL expression for received packets.
   * If CEL, `data` (List<int>) and `len` (int) variables are available.
   * @example 'add_no_header' or 'data[0] + data[1]'
   */
  rx_checksum?: ChecksumType | string;

  /**
   * Secondary checksum algorithm (2 bytes) or CEL expression.
   */
  rx_checksum2?: Checksum2Type | string;

  /**
   * Fixed length of the packet (including header/footer).
   * If set, parser will wait for this many bytes.
   */
  rx_length?: number;

  /**
   * Minimum packet length allowed (including header/footer).
   * Packets shorter than this length will be ignored.
   */
  rx_min_length?: number;

  /**
   * Maximum packet length allowed (including header/footer).
   * Packets longer than this length will be ignored.
   */
  rx_max_length?: number;

  /**
   * CEL expression to calculate dynamic packet length.
   * Returns the expected total length, or 0/negative to fallback to Checksum Sweep.
   * Available variables: `data` (current buffer), `len` (buffer length).
   */
  rx_length_expr?: string;

  /**
   * List of valid start bytes.
   * Even if checksum passes, packet is invalid if the first byte is not in this list.
   * Useful for avoiding false positives on noisy lines.
   */
  rx_valid_headers?: number[];

  /**
   * Header bytes for transmitted packets.
   */
  tx_header?: number[];

  /**
   * Footer bytes for transmitted packets.
   */
  tx_footer?: number[];

  /**
   * Checksum algorithm or CEL expression for transmitted packets.
   */
  tx_checksum?: ChecksumType | string;

  /**
   * Secondary checksum algorithm for transmitted packets.
   */
  tx_checksum2?: Checksum2Type | string;

  /**
   * Delay (in ms) before retrying a failed transmission.
   * @default 50
   */
  tx_delay?: number;

  /**
   * Number of times to retry transmission if no response is received.
   * @default 5
   */
  tx_retry_cnt?: number;

  /**
   * Maximum time (in ms) to wait for an ACK or response after transmission.
   * @default 100
   */
  tx_timeout?: number;

  /**
   * Maximum time (in ms) to wait for a status update packet.
   */
  rx_timeout?: number;
}

/**
 * Schema for matching and extracting state from a packet.
 */
export interface StateSchema {
  /**
   * Exact sequence of bytes to match.
   */
  data?: number[];

  /**
   * Bitmask to apply to the value byte(s).
   */
  mask?: number | number[];

  /**
   * Byte index in the full packet where the state value is located.
   */
  index?: number;

  /**
   * Legacy alias for `index`.
   * @deprecated Use `index` instead.
   */
  offset?: number;

  /**
   * If true, inverts the boolean logic or bits.
   */
  inverted?: boolean;

  /**
   * CEL expression condition that must be true for this state to match.
   */
  guard?: string;

  /**
   * List of schemas to explicitly exclude.
   */
  except?: StateSchema[];
}

/**
 * Extended schema for numeric values.
 */
export interface StateNumSchema extends StateSchema {
  /**
   * Number of bytes representing the value.
   */
  length?: number;

  /**
   * Number of decimal places.
   */
  precision?: number;

  /**
   * If true, treat as signed integer.
   */
  signed?: boolean;

  /**
   * Byte order (endianness).
   */
  endian?: EndianType;

  /**
   * specialized decoding strategy.
   */
  decode?: DecodeEncodeType;

  /**
   * Map of raw values to human-readable strings or numbers.
   */
  mapping?: { [key: number]: string | number };
}

// New Uartex-style types

export interface ProtocolConfig {
  packet_defaults?: PacketDefaults;
  rx_priority?: 'data' | 'loop';
}

export interface DeviceConfig {
  id: string;
  name: string;
  // Add other common device properties here
  state?: StateSchema;
  optimistic?: boolean;
  state_proxy?: boolean;
  target_id?: string;
  /**
   * Samsung NASA HVAC config (entity is matched by NASA frame src/dst rather than byte position).
   * When present, the entity is parsed by NasaDevice instead of GenericDevice.
   */
  nasa?: NasaEntityConfig;
}

/**
 * Samsung NASA address: `[class, channel, address]`.
 * Each accepts either a 24-bit number (`0x100100`) or a 3-byte array (`[0x10, 0x01, 0x00]`).
 * Use `0xff` in any byte to wildcard that position when matching incoming frames.
 */
export type NasaAddrSpec = number | [number, number, number];

/** How to interpret a NASA message value into an entity attribute. */
export interface NasaMessageBinding {
  /** Resulting attribute on the entity state object (e.g. `mode`, `target_temperature`). */
  attribute: string;
  /** Value type. `auto` infers from the message id (recommended). */
  type?: 'auto' | 'enum' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32';
  /** Multiply the decoded numeric value by this factor (e.g. `0.1` for 0.1°C scaling). */
  scale?: number;
  /** Map raw integer values to enum strings: `{ 0: 'off', 1: 'on' }`. */
  values?: Record<number, string | number>;
}

/** Single-message command spec (e.g. `power: off` writes one ENUM message). */
export interface NasaSingleCommand {
  /** Logical message name (must exist in `nasa.messages`). */
  message: string;
  /** Static value to send. Mutually exclusive with `value_from`. */
  value?: number;
  /** When set, take the numeric value from the runtime command argument. */
  value_from?: 'input';
  /** Override packet's data type (default: 'write' = 0x2). */
  data_type?: 'read' | 'write' | 'request' | 'notification' | 'response';
}

/** Multi-message command (sets several messages atomically — e.g. heat sets power+mode). */
export interface NasaMultiCommand {
  messages: Array<{ name: string; value?: number; value_from?: 'input' }>;
  data_type?: 'read' | 'write' | 'request' | 'notification' | 'response';
}

export type NasaCommandSpec = NasaSingleCommand | NasaMultiCommand;

export interface NasaEntityConfig {
  /** Filter incoming frames by source address (24-bit). 0xff bytes act as wildcards. */
  rx?: { src?: NasaAddrSpec; dst?: NasaAddrSpec };
  /** Outgoing frame source/dest used by command_* specs. */
  tx?: { src?: NasaAddrSpec; dst?: NasaAddrSpec };
  /**
   * Constant messages emitted before every command frame.
   * Korean Commax / Samsung DVM Home wallpads prepend `{id: 0x4050, value: 0}`
   * to all control packets — omitting it makes the indoor unit beep an alarm.
   */
  tx_prefix?: Array<{ id: number; value: number }>;
  /**
   * Logical message names whose value is auto-appended from the device's
   * current state if not already supplied by a command. Mirrors the wallpad's
   * "always send full state bundle on every change" pattern. Order matters —
   * messages are emitted in the order listed here.
   */
  tx_carry_state?: string[];
  /** Logical message map: `<name>: { id: 0x4001, attribute: 'mode', ... }` */
  messages: Record<string, NasaMessageBinding & { id: number }>;
}

/**
 * Result of constructing a command packet.
 * Can include optional ACK matching information when using CEL expressions.
 */
export interface CommandResult {
  packet: number[];
  ack?: StateSchema;
}

/**
 * State schema that can be either a structured schema object or a CEL expression string.
 * CEL expressions are evaluated at runtime to extract values from packet data.
 * @example { index: 5, length: 2 } or 'data[5] * 256 + data[6]'
 */
export type StateSchemaOrCEL = StateSchema | string;

/**
 * Numeric state schema that can be either a structured schema object or a CEL expression string.
 * CEL expressions are evaluated at runtime to extract numeric values from packet data.
 * @example { index: 5, length: 1, precision: 1 } or 'data[5] / 10.0'
 */
export type StateNumSchemaOrCEL = StateNumSchema | string;
