import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BoardConfigError,
  parseIoc,
  renderBoardHeader,
  renderBoardsManifest,
} from './board-profile.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('../tests/fixtures/synthetic-board.ioc', import.meta.url),
);

async function loadFixture(): Promise<string> {
  return readFile(FIXTURE_PATH, 'utf8');
}

describe('parseIoc', () => {
  it('reads the MCU identity, clock, and peripheral list', async () => {
    const profile = parseIoc(await loadFixture(), 'boards/synthetic/synthetic-board.ioc');

    expect(profile.name).toBe('synthetic-board');
    expect(profile.source).toBe('boards/synthetic/synthetic-board.ioc');
    expect(profile.mcu).toEqual({
      name: 'STM32G071CBTx',
      cpn: 'STM32G071CBT6',
      family: 'STM32G0',
      package: 'LQFP48',
    });
    expect(profile.firmwarePackage).toBe('STM32Cube FW_G0 V1.6.3');
    expect(profile.clock).toEqual({
      sysclkHz: 64000000,
      hclkHz: 64000000,
      rtcSource: 'RCC_RTCCLKSOURCE_LSE',
    });
    expect(profile.peripherals).toEqual(['ADC1', 'DMA', 'NVIC', 'RCC', 'SPI1', 'SYS', 'USART2']);
  });

  it('orders pins from the MCU pin list and skips virtual pins', async () => {
    const profile = parseIoc(await loadFixture(), 'synthetic-board.ioc');

    expect(profile.pins.map((pin) => pin.pin)).toEqual([
      'PA0',
      'PA5',
      'PA6',
      'PA7',
      'PB6',
      'PB7',
      'PB8',
      'PB9',
      'PC13',
      'PA11 [PA9]',
      'PC14-OSC32_IN (PC14)',
      'PB0',
      'PB1',
    ]);
    expect(profile.pins.some((pin) => pin.pin.startsWith('VP_'))).toBe(false);
  });

  it('attaches signals, labels, and initial states', async () => {
    const profile = parseIoc(await loadFixture(), 'synthetic-board.ioc');
    const led = profile.pins.find((pin) => pin.pin === 'PC13');
    const rtc = profile.pins.find((pin) => pin.pin === 'PC14-OSC32_IN (PC14)');

    expect(led).toEqual({
      pin: 'PC13',
      signal: 'GPIO_Output',
      label: 'STATUS_LED',
      initialState: 'set',
    });
    expect(rtc).toEqual({
      pin: 'PC14-OSC32_IN (PC14)',
      signal: 'RCC_OSC32_IN',
      label: 'RTC_CRYSTAL',
      initialState: null,
    });
  });

  it('groups ADCs, UARTs, SPI, I2C, and GPIO by peripheral instance', async () => {
    const profile = parseIoc(await loadFixture(), 'synthetic-board.ioc');

    expect(profile.groups.adc).toEqual([
      { instance: 'ADC1', channel: 0, pin: 'PA0', label: 'TEMP_SENSE' },
    ]);
    expect(profile.groups.uart).toEqual([{ instance: 'USART2', txPin: 'PB6', rxPin: 'PB7' }]);
    expect(profile.groups.spi).toEqual([
      {
        instance: 'SPI1',
        sckPin: 'PA5',
        misoPin: 'PA6',
        mosiPin: 'PA7',
        nssPin: null,
      },
    ]);
    expect(profile.groups.i2c).toEqual([{ instance: 'I2C1', sclPin: 'PB8', sdaPin: 'PB9' }]);
    expect(profile.groups.outputs).toEqual([
      { pin: 'PC13', label: 'STATUS_LED' },
      { pin: 'PA11 [PA9]', label: 'RELAY_1' },
    ]);
    expect(profile.groups.inputs).toEqual([
      { pin: 'PB0', label: 'BUTTON' },
      { pin: 'PB1', label: null },
    ]);
  });

  it('resolves roles from pin labels', async () => {
    const profile = parseIoc(await loadFixture(), 'synthetic-board.ioc');

    expect(profile.roles.temperature).toEqual({
      instance: 'ADC1',
      channel: 0,
      pin: 'PA0',
      label: 'TEMP_SENSE',
    });
    expect(profile.roles.networkSpi).toEqual({
      instance: 'SPI1',
      sckPin: 'PA5',
      misoPin: 'PA6',
      mosiPin: 'PA7',
      nssPin: null,
    });
    expect(profile.roles.networkUart).toBeNull();
    expect(profile.roles.networkCsPin).toBeNull();
    expect(profile.roles.outputs).toEqual([]);
  });

  it('resolves the network chip select and controllable outputs', () => {
    const source = [
      'Mcu.Name=STM32G071CBTx',
      'Mcu.Pin0=PA4',
      'Mcu.Pin1=PA5',
      'Mcu.Pin2=PA6',
      'Mcu.Pin3=PA7',
      'Mcu.Pin4=PB5',
      'PA4.Signal=SPI1_NSS',
      'PA4.GPIO_Label=NET_CS',
      'PA5.Signal=SPI1_SCK',
      'PA5.GPIO_Label=NET_SCK',
      'PA6.Signal=SPI1_MISO',
      'PA6.GPIO_Label=NET_MISO',
      'PA7.Signal=SPI1_MOSI',
      'PA7.GPIO_Label=NET_MOSI',
      'PB5.Signal=GPIO_Output',
      'PB5.GPIO_Label=OUT_RELAY_1',
      '',
    ].join('\n');
    const profile = parseIoc(source, 'roles.ioc');

    expect(profile.roles.networkSpi).toEqual({
      instance: 'SPI1',
      sckPin: 'PA5',
      misoPin: 'PA6',
      mosiPin: 'PA7',
      nssPin: 'PA4',
    });
    expect(profile.roles.networkCsPin).toBe('PA4');
    expect(profile.roles.outputs).toEqual([{ pin: 'PB5', label: 'OUT_RELAY_1' }]);
  });

  it('resolves a network UART from NET_ labels', () => {
    const source = [
      'Mcu.Name=STM32G071CBTx',
      'Mcu.Pin0=PB6',
      'Mcu.Pin1=PB7',
      'PB6.Signal=USART2_TX',
      'PB6.GPIO_Label=NET_TX',
      'PB7.Signal=USART2_RX',
      'PB7.GPIO_Label=NET_RX',
      '',
    ].join('\n');
    const profile = parseIoc(source, 'uart-roles.ioc');

    expect(profile.roles.networkSpi).toBeNull();
    expect(profile.roles.networkUart).toEqual({
      instance: 'USART2',
      txPin: 'PB6',
      rxPin: 'PB7',
    });
  });

  it('rejects more than one TEMP_ ADC channel', () => {
    const source = [
      'Mcu.Name=STM32G071CBTx',
      'Mcu.Pin0=PA0',
      'Mcu.Pin1=PA1',
      'PA0.Signal=ADC1_IN0',
      'PA0.GPIO_Label=TEMP_A',
      'PA1.Signal=ADC1_IN1',
      'PA1.GPIO_Label=TEMP_B',
      '',
    ].join('\n');

    expect(() => parseIoc(source, 'ambiguous.ioc')).toThrow(
      'Only one ADC channel may use the TEMP_ label prefix',
    );
  });

  it('rejects NET_ labels on both SPI and UART', () => {
    const source = [
      'Mcu.Name=STM32G071CBTx',
      'Mcu.Pin0=PA5',
      'Mcu.Pin1=PB6',
      'PA5.Signal=SPI1_SCK',
      'PA5.GPIO_Label=NET_SCK',
      'PB6.Signal=USART2_TX',
      'PB6.GPIO_Label=NET_TX',
      '',
    ].join('\n');

    expect(() => parseIoc(source, 'ambiguous.ioc')).toThrow(
      'The NET_ labels resolve to both SPI and UART',
    );
  });

  it('rejects NET_ labels on two SPI instances', () => {
    const source = [
      'Mcu.Name=STM32G071CBTx',
      'Mcu.Pin0=PA5',
      'Mcu.Pin1=PB13',
      'PA5.Signal=SPI1_SCK',
      'PA5.GPIO_Label=NET_SCK',
      'PB13.Signal=SPI2_SCK',
      'PB13.GPIO_Label=NET_SCK',
      '',
    ].join('\n');

    expect(() => parseIoc(source, 'ambiguous.ioc')).toThrow(
      'Only one SPI instance may use the NET_ label prefix',
    );
  });

  it('rejects more than one NET_CS label', () => {
    const source = [
      'Mcu.Name=STM32G071CBTx',
      'Mcu.Pin0=PB5',
      'Mcu.Pin1=PB6',
      'PB5.Signal=GPIO_Output',
      'PB5.GPIO_Label=NET_CS',
      'PB6.Signal=GPIO_Output',
      'PB6.GPIO_Label=NET_CS',
      '',
    ].join('\n');

    expect(() => parseIoc(source, 'ambiguous.ioc')).toThrow(
      'Only one pin may use the NET_CS label',
    );
  });

  it('falls back to the file name when the project name is absent', () => {
    const profile = parseIoc('Mcu.Name=STM32G071CBTx\n', 'boards/unnamed/board.ioc');

    expect(profile.name).toBe('board');
    expect(profile.mcu.cpn).toBeNull();
    expect(profile.clock.sysclkHz).toBeNull();
  });

  it('rejects a file without an MCU name', () => {
    expect(() => parseIoc('Mcu.Family=STM32G0\n', 'broken.ioc')).toThrow(
      'broken.ioc: Mcu.Name is required',
    );
  });

  it('rejects malformed lines with the line number', () => {
    expect(() => parseIoc('Mcu.Name=STM32G0\nnot a pair\n', 'broken.ioc')).toThrow(
      'broken.ioc:2: Expected a key=value pair',
    );
  });

  it('ignores invalid clock values', () => {
    const profile = parseIoc(
      'Mcu.Name=STM32G071CBTx\nRCC.SYSCLKFreq_VALUE=not-a-number\n',
      'clock.ioc',
    );

    expect(profile.clock.sysclkHz).toBeNull();
  });
});

describe('renderBoardHeader', () => {
  it('emits identity, pin, and peripheral macros', async () => {
    const header = renderBoardHeader(parseIoc(await loadFixture(), 'synthetic-board.ioc'));

    expect(header).toContain('#ifndef EDGE_POST_BOARD_SYNTHETIC_BOARD_CONFIG_H');
    expect(header).toContain('#define BOARD_PROFILE_NAME "synthetic-board"');
    expect(header).toContain('#define BOARD_MCU_NAME "STM32G071CBTx"');
    expect(header).toContain('#define BOARD_MCU_CPN "STM32G071CBT6"');
    expect(header).toContain('#define BOARD_SYSCLK_HZ 64000000u');
    expect(header).toContain('#define BOARD_PIN_COUNT 13u');
    expect(header).toContain('#define BOARD_PIN9_PIN "PA11 [PA9]"');
    expect(header).toContain('#define BOARD_PIN8_LABEL "STATUS_LED"');
    expect(header).toContain('#define BOARD_ADC0_CHANNEL 0u');
    expect(header).toContain('#define BOARD_UART0_INSTANCE "USART2"');
    expect(header).toContain('#define BOARD_SPI0_SCK_PIN "PA5"');
    expect(header).toContain('#define BOARD_I2C0_SDA_PIN "PB9"');
    expect(header).toContain('#define BOARD_GPIO_OUTPUT_COUNT 2u');
    expect(header).toContain('#define BOARD_GPIO_OUTPUT1_LABEL "RELAY_1"');
    expect(header).toContain('#define BOARD_GPIO_INPUT_COUNT 2u');
    expect(header.endsWith('\n')).toBe(true);
  });

  it('emits role macros resolved from labels', async () => {
    const header = renderBoardHeader(parseIoc(await loadFixture(), 'synthetic-board.ioc'));

    expect(header).toContain('#define BOARD_TEMP_ADC_INSTANCE "ADC1"');
    expect(header).toContain('#define BOARD_TEMP_ADC_CHANNEL 0u');
    expect(header).toContain('#define BOARD_TEMP_ADC_PIN "PA0"');
    expect(header).toContain('#define BOARD_NET_SPI_INSTANCE "SPI1"');
    expect(header).toContain('#define BOARD_NET_SPI_SCK_PIN "PA5"');
    expect(header).toContain('#define BOARD_NET_SPI_MISO_PIN "PA6"');
    expect(header).toContain('#define BOARD_NET_SPI_MOSI_PIN "PA7"');
    expect(header).not.toContain('BOARD_NET_UART_INSTANCE');
    expect(header).not.toContain('BOARD_NET_CS_PIN');
    expect(header).toContain('#define BOARD_OUT_COUNT 0u');
  });

  it('escapes quotes and backslashes in labels', () => {
    const source = [
      'Mcu.Name=STM32G071CBTx',
      'Mcu.Pin0=PA0',
      'PA0.Signal=GPIO_Output',
      'PA0.GPIO_Label=He said "hi" \\ bye',
      '',
    ].join('\n');
    const header = renderBoardHeader(parseIoc(source, 'quoted.ioc'));

    expect(header).toContain('#define BOARD_PIN0_LABEL "He said \\"hi\\" \\\\ bye"');
  });
});

describe('renderBoardsManifest', () => {
  it('sorts boards by name and ends with a newline', () => {
    const second = parseIoc(
      'Mcu.Name=STM32G071CBTx\nProjectManager.ProjectName=zeta\n',
      'zeta.ioc',
    );
    const first = parseIoc(
      'Mcu.Name=STM32G071CBTx\nProjectManager.ProjectName=alpha\n',
      'alpha.ioc',
    );
    const manifest = renderBoardsManifest([second, first]);
    const parsed: unknown = JSON.parse(manifest);

    expect(manifest.endsWith('\n')).toBe(true);
    expect(parsed).toMatchObject({
      boards: [{ name: 'alpha' }, { name: 'zeta' }],
    });
  });
});

describe('BoardConfigError', () => {
  it('includes the source and line in the message', () => {
    const error = new BoardConfigError('bad value', 'board.ioc', 7);

    expect(error.message).toBe('board.ioc:7: bad value');
    expect(error.source).toBe('board.ioc');
    expect(error.line).toBe(7);
  });
});
