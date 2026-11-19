import path from 'node:path';

export interface BoardMcu {
  name: string;
  cpn: string | null;
  family: string | null;
  package: string | null;
}

export interface BoardClock {
  sysclkHz: number | null;
  hclkHz: number | null;
  rtcSource: string | null;
}

export interface BoardPin {
  pin: string;
  signal: string;
  label: string | null;
  initialState: 'set' | 'reset' | null;
}

export interface BoardAdcChannel {
  instance: string;
  channel: number;
  pin: string;
  label: string | null;
}

export interface BoardUart {
  instance: string;
  txPin: string | null;
  rxPin: string | null;
}

export interface BoardSpi {
  instance: string;
  sckPin: string | null;
  misoPin: string | null;
  mosiPin: string | null;
  nssPin: string | null;
}

export interface BoardI2c {
  instance: string;
  sclPin: string | null;
  sdaPin: string | null;
}

export interface BoardGpio {
  pin: string;
  label: string | null;
}

export interface BoardGroups {
  adc: BoardAdcChannel[];
  uart: BoardUart[];
  spi: BoardSpi[];
  i2c: BoardI2c[];
  outputs: BoardGpio[];
  inputs: BoardGpio[];
}

export interface BoardProfile {
  name: string;
  source: string;
  mcu: BoardMcu;
  firmwarePackage: string | null;
  clock: BoardClock;
  peripherals: string[];
  pins: BoardPin[];
  groups: BoardGroups;
}

export interface BoardsManifest {
  boards: BoardProfile[];
}

export class BoardConfigError extends Error {
  readonly source: string;
  readonly line: number | null;

  constructor(message: string, source: string, line: number | null = null) {
    super(line === null ? `${source}: ${message}` : `${source}:${line}: ${message}`);
    this.name = 'BoardConfigError';
    this.source = source;
    this.line = line;
  }
}

interface IocEntry {
  value: string;
  line: number;
}

const PIN_KEY_PATTERN = /^P[A-Z]\d/;
const ADC_PATTERN = /^ADC(\d+)_IN(\d+)$/;
const UART_PATTERN = /^(LPUART|USART|UART)(\d+)_(TX|RX)$/;
const SPI_PATTERN = /^SPI(\d+)_(SCK|MISO|MOSI|NSS)$/;
const I2C_PATTERN = /^I2C(\d+)_(SCL|SDA)$/;

function unescapeKey(key: string): string {
  return key.replace(/\\(.)/g, '$1');
}

function parseEntries(text: string, source: string): Map<string, IocEntry> {
  const entries = new Map<string, IocEntry>();
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');

    if (separator < 0) {
      throw new BoardConfigError('Expected a key=value pair', source, index + 1);
    }

    const key = unescapeKey(line.slice(0, separator));
    entries.set(key, { value: line.slice(separator + 1), line: index + 1 });
  }

  return entries;
}

function getValue(entries: Map<string, IocEntry>, ...keys: string[]): string | null {
  for (const key of keys) {
    const entry = entries.get(key);

    if (entry !== undefined && entry.value.trim() !== '') {
      return entry.value;
    }
  }

  return null;
}

function toInteger(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function collectPeripherals(entries: Map<string, IocEntry>): string[] {
  const indexed: Array<{ index: number; name: string }> = [];

  for (const [key, entry] of entries) {
    const match = /^Mcu\.IP(\d+)$/.exec(key);

    if (match === null) {
      continue;
    }

    const index = Number(match[1]);
    const name = entry.value.trim();

    if (name !== '') {
      indexed.push({ index, name });
    }
  }

  indexed.sort((left, right) => left.index - right.index);
  return indexed.map((entry) => entry.name);
}

function collectPinOrder(entries: Map<string, IocEntry>): string[] {
  const indexed: Array<{ index: number; pin: string }> = [];

  for (const [key, entry] of entries) {
    const match = /^Mcu\.Pin(\d+)$/.exec(key);

    if (match === null) {
      continue;
    }

    const pin = entry.value.trim();

    if (pin !== '') {
      indexed.push({ index: Number(match[1]), pin });
    }
  }

  indexed.sort((left, right) => left.index - right.index);
  return indexed.map((entry) => entry.pin);
}

function collectSignalPins(entries: Map<string, IocEntry>): Map<string, IocEntry> {
  const pins = new Map<string, IocEntry>();

  for (const [key, entry] of entries) {
    if (!key.endsWith('.Signal')) {
      continue;
    }

    const pin = key.slice(0, -'.Signal'.length);

    if (PIN_KEY_PATTERN.test(pin)) {
      pins.set(pin, entry);
    }
  }

  return pins;
}

function initialState(entries: Map<string, IocEntry>, pin: string): 'set' | 'reset' | null {
  const value = getValue(entries, `${pin}.PinState`);

  if (value === 'GPIO_PIN_SET') {
    return 'set';
  }

  if (value === 'GPIO_PIN_RESET') {
    return 'reset';
  }

  return null;
}

function sortByInstance<T extends { instance: string }>(groups: T[]): T[] {
  return groups.sort((left, right) =>
    left.instance < right.instance ? -1 : left.instance > right.instance ? 1 : 0,
  );
}

function collectGroups(pins: BoardPin[]): BoardGroups {
  const adc: BoardAdcChannel[] = [];
  const uartByInstance = new Map<string, BoardUart>();
  const spiByInstance = new Map<string, BoardSpi>();
  const i2cByInstance = new Map<string, BoardI2c>();
  const outputs: BoardGpio[] = [];
  const inputs: BoardGpio[] = [];

  for (const pin of pins) {
    const adcMatch = ADC_PATTERN.exec(pin.signal);

    if (adcMatch !== null) {
      adc.push({
        instance: `ADC${adcMatch[1]}`,
        channel: Number(adcMatch[2]),
        pin: pin.pin,
        label: pin.label,
      });
      continue;
    }

    const uartMatch = UART_PATTERN.exec(pin.signal);

    if (uartMatch !== null) {
      const instance = `${uartMatch[1]}${uartMatch[2]}`;
      const uart = uartByInstance.get(instance) ?? {
        instance,
        txPin: null,
        rxPin: null,
      };

      if (uartMatch[3] === 'TX') {
        uart.txPin = pin.pin;
      } else {
        uart.rxPin = pin.pin;
      }

      uartByInstance.set(instance, uart);
      continue;
    }

    const spiMatch = SPI_PATTERN.exec(pin.signal);

    if (spiMatch !== null) {
      const instance = `SPI${spiMatch[1]}`;
      const spi = spiByInstance.get(instance) ?? {
        instance,
        sckPin: null,
        misoPin: null,
        mosiPin: null,
        nssPin: null,
      };

      switch (spiMatch[2]) {
        case 'SCK':
          spi.sckPin = pin.pin;
          break;
        case 'MISO':
          spi.misoPin = pin.pin;
          break;
        case 'MOSI':
          spi.mosiPin = pin.pin;
          break;
        case 'NSS':
          spi.nssPin = pin.pin;
          break;
      }

      spiByInstance.set(instance, spi);
      continue;
    }

    const i2cMatch = I2C_PATTERN.exec(pin.signal);

    if (i2cMatch !== null) {
      const instance = `I2C${i2cMatch[1]}`;
      const i2c = i2cByInstance.get(instance) ?? {
        instance,
        sclPin: null,
        sdaPin: null,
      };

      if (i2cMatch[2] === 'SCL') {
        i2c.sclPin = pin.pin;
      } else {
        i2c.sdaPin = pin.pin;
      }

      i2cByInstance.set(instance, i2c);
      continue;
    }

    if (pin.signal === 'GPIO_Output') {
      outputs.push({ pin: pin.pin, label: pin.label });
      continue;
    }

    if (pin.signal === 'GPIO_Input') {
      inputs.push({ pin: pin.pin, label: pin.label });
    }
  }

  return {
    adc,
    uart: sortByInstance([...uartByInstance.values()]),
    spi: sortByInstance([...spiByInstance.values()]),
    i2c: sortByInstance([...i2cByInstance.values()]),
    outputs,
    inputs,
  };
}

export function parseIoc(text: string, source: string): BoardProfile {
  const entries = parseEntries(text, source);
  const mcuName = getValue(entries, 'Mcu.Name');

  if (mcuName === null) {
    throw new BoardConfigError('Mcu.Name is required', source);
  }

  const signalPins = collectSignalPins(entries);
  const orderedPins = collectPinOrder(entries);
  const pins: BoardPin[] = [];

  for (const pin of orderedPins) {
    const signal = signalPins.get(pin)?.value.trim();

    if (signal === undefined || signal === '') {
      continue;
    }

    pins.push({
      pin,
      signal,
      label: getValue(entries, `${pin}.GPIO_Label`),
      initialState: initialState(entries, pin),
    });
  }

  for (const [pin, entry] of signalPins) {
    if (orderedPins.includes(pin)) {
      continue;
    }

    pins.push({
      pin,
      signal: entry.value.trim(),
      label: getValue(entries, `${pin}.GPIO_Label`),
      initialState: initialState(entries, pin),
    });
  }

  const projectName = getValue(entries, 'ProjectManager.ProjectName');
  const fallbackName = path.basename(source, path.extname(source));

  return {
    name: projectName ?? fallbackName,
    source,
    mcu: {
      name: mcuName,
      cpn: getValue(entries, 'Mcu.CPN'),
      family: getValue(entries, 'Mcu.Family'),
      package: getValue(entries, 'Mcu.Package'),
    },
    firmwarePackage: getValue(entries, 'ProjectManager.FirmwarePackage'),
    clock: {
      sysclkHz: toInteger(getValue(entries, 'RCC.SYSCLKFreq_VALUE', 'RCC.SYSCLKFreq_Value')),
      hclkHz: toInteger(getValue(entries, 'RCC.HCLKFreq_Value', 'RCC.HCLKFreq_VALUE')),
      rtcSource: getValue(entries, 'RCC.RTCClockSelection'),
    },
    peripherals: collectPeripherals(entries),
    pins,
    groups: collectGroups(pins),
  };
}

function cString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function headerGuard(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  return `EDGE_POST_BOARD_${normalized === '' ? 'UNNAMED' : normalized}_CONFIG_H`;
}

function define(lines: string[], name: string, value: string): void {
  lines.push(`#define ${name} ${value}`);
}

export function renderBoardHeader(profile: BoardProfile): string {
  const lines: string[] = [
    '/*',
    ' * Generated board configuration. Do not edit.',
    ` * Source: ${profile.source}`,
    ' * Regenerate with: make board (from firmware/)',
    ' */',
    '',
    `#ifndef ${headerGuard(profile.name)}`,
    `#define ${headerGuard(profile.name)}`,
    '',
  ];

  define(lines, 'BOARD_PROFILE_NAME', cString(profile.name));
  define(lines, 'BOARD_MCU_NAME', cString(profile.mcu.name));

  if (profile.mcu.cpn !== null) {
    define(lines, 'BOARD_MCU_CPN', cString(profile.mcu.cpn));
  }

  if (profile.mcu.family !== null) {
    define(lines, 'BOARD_MCU_FAMILY', cString(profile.mcu.family));
  }

  if (profile.mcu.package !== null) {
    define(lines, 'BOARD_MCU_PACKAGE', cString(profile.mcu.package));
  }

  if (profile.firmwarePackage !== null) {
    define(lines, 'BOARD_FIRMWARE_PACKAGE', cString(profile.firmwarePackage));
  }

  if (profile.clock.sysclkHz !== null) {
    define(lines, 'BOARD_SYSCLK_HZ', `${profile.clock.sysclkHz}u`);
  }

  if (profile.clock.hclkHz !== null) {
    define(lines, 'BOARD_HCLK_HZ', `${profile.clock.hclkHz}u`);
  }

  if (profile.clock.rtcSource !== null) {
    define(lines, 'BOARD_RTC_SOURCE', cString(profile.clock.rtcSource));
  }

  lines.push('', defineCount('BOARD_PIN_COUNT', profile.pins.length));

  for (const [index, pin] of profile.pins.entries()) {
    lines.push('');
    define(lines, `BOARD_PIN${index}_PIN`, cString(pin.pin));
    define(lines, `BOARD_PIN${index}_SIGNAL`, cString(pin.signal));

    if (pin.label !== null) {
      define(lines, `BOARD_PIN${index}_LABEL`, cString(pin.label));
    }

    if (pin.initialState !== null) {
      define(lines, `BOARD_PIN${index}_INITIAL_STATE`, cString(pin.initialState));
    }
  }

  lines.push('', defineCount('BOARD_ADC_COUNT', profile.groups.adc.length));

  for (const [index, adc] of profile.groups.adc.entries()) {
    lines.push('');
    define(lines, `BOARD_ADC${index}_INSTANCE`, cString(adc.instance));
    define(lines, `BOARD_ADC${index}_CHANNEL`, `${adc.channel}u`);
    define(lines, `BOARD_ADC${index}_PIN`, cString(adc.pin));

    if (adc.label !== null) {
      define(lines, `BOARD_ADC${index}_LABEL`, cString(adc.label));
    }
  }

  lines.push('', defineCount('BOARD_UART_COUNT', profile.groups.uart.length));

  for (const [index, uart] of profile.groups.uart.entries()) {
    lines.push('');
    define(lines, `BOARD_UART${index}_INSTANCE`, cString(uart.instance));

    if (uart.txPin !== null) {
      define(lines, `BOARD_UART${index}_TX_PIN`, cString(uart.txPin));
    }

    if (uart.rxPin !== null) {
      define(lines, `BOARD_UART${index}_RX_PIN`, cString(uart.rxPin));
    }
  }

  lines.push('', defineCount('BOARD_SPI_COUNT', profile.groups.spi.length));

  for (const [index, spi] of profile.groups.spi.entries()) {
    lines.push('');
    define(lines, `BOARD_SPI${index}_INSTANCE`, cString(spi.instance));

    if (spi.sckPin !== null) {
      define(lines, `BOARD_SPI${index}_SCK_PIN`, cString(spi.sckPin));
    }

    if (spi.misoPin !== null) {
      define(lines, `BOARD_SPI${index}_MISO_PIN`, cString(spi.misoPin));
    }

    if (spi.mosiPin !== null) {
      define(lines, `BOARD_SPI${index}_MOSI_PIN`, cString(spi.mosiPin));
    }

    if (spi.nssPin !== null) {
      define(lines, `BOARD_SPI${index}_NSS_PIN`, cString(spi.nssPin));
    }
  }

  lines.push('', defineCount('BOARD_I2C_COUNT', profile.groups.i2c.length));

  for (const [index, i2c] of profile.groups.i2c.entries()) {
    lines.push('');
    define(lines, `BOARD_I2C${index}_INSTANCE`, cString(i2c.instance));

    if (i2c.sclPin !== null) {
      define(lines, `BOARD_I2C${index}_SCL_PIN`, cString(i2c.sclPin));
    }

    if (i2c.sdaPin !== null) {
      define(lines, `BOARD_I2C${index}_SDA_PIN`, cString(i2c.sdaPin));
    }
  }

  lines.push('', defineCount('BOARD_GPIO_OUTPUT_COUNT', profile.groups.outputs.length));

  for (const [index, output] of profile.groups.outputs.entries()) {
    lines.push('');
    define(lines, `BOARD_GPIO_OUTPUT${index}_PIN`, cString(output.pin));

    if (output.label !== null) {
      define(lines, `BOARD_GPIO_OUTPUT${index}_LABEL`, cString(output.label));
    }
  }

  lines.push('', defineCount('BOARD_GPIO_INPUT_COUNT', profile.groups.inputs.length));

  for (const [index, input] of profile.groups.inputs.entries()) {
    lines.push('');
    define(lines, `BOARD_GPIO_INPUT${index}_PIN`, cString(input.pin));

    if (input.label !== null) {
      define(lines, `BOARD_GPIO_INPUT${index}_LABEL`, cString(input.label));
    }
  }

  lines.push('', `#endif /* ${headerGuard(profile.name)} */`);

  return `${lines.join('\n')}\n`;
}

function defineCount(name: string, count: number): string {
  return `#define ${name} ${count}u`;
}

export function renderBoardsManifest(boards: BoardProfile[]): string {
  const sorted = [...boards].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );

  return `${JSON.stringify({ boards: sorted }, null, 2)}\n`;
}
