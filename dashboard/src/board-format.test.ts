import { describe, expect, it } from 'vitest';

import {
  formatAdcChannel,
  formatClock,
  formatGpioList,
  formatI2c,
  formatSpi,
  formatUart,
} from './board-format';

describe('board formatting', () => {
  it.each([
    [64_000_000, '64 MHz'],
    [64_500_000, '64.5 MHz'],
    [16_000_000, '16 MHz'],
    [32_768, '32.77 kHz'],
    [500, '500 Hz'],
    [0, '—'],
    [null, '—'],
  ])('formats %s Hz', (hz, expected) => {
    expect(formatClock(hz)).toBe(expected);
  });

  it('formats an ADC channel with and without a label', () => {
    expect(
      formatAdcChannel({ instance: 'ADC1', channel: 0, pin: 'PA0', label: 'TEMP_SENSE' }),
    ).toBe('ADC1 ch0 · PA0 · TEMP_SENSE');
    expect(formatAdcChannel({ instance: 'ADC2', channel: 7, pin: 'PB1', label: null })).toBe(
      'ADC2 ch7 · PB1',
    );
  });

  it('formats UART, SPI, and I2C instances', () => {
    expect(formatUart({ instance: 'USART2', txPin: 'PB6', rxPin: 'PB7' })).toBe(
      'USART2 · TX PB6 · RX PB7',
    );
    expect(formatUart({ instance: 'USART1', txPin: null, rxPin: 'PA10' })).toBe(
      'USART1 · TX — · RX PA10',
    );
    expect(
      formatSpi({
        instance: 'SPI1',
        sckPin: 'PA5',
        misoPin: 'PA6',
        mosiPin: 'PA7',
        nssPin: null,
      }),
    ).toBe('SPI1 · SCK PA5 · MISO PA6 · MOSI PA7');
    expect(
      formatSpi({ instance: 'SPI2', sckPin: null, misoPin: null, mosiPin: null, nssPin: null }),
    ).toBe('SPI2');
    expect(formatI2c({ instance: 'I2C1', sclPin: 'PB8', sdaPin: 'PB9' })).toBe(
      'I2C1 · SCL PB8 · SDA PB9',
    );
  });

  it('formats GPIO lists', () => {
    expect(formatGpioList([])).toBe('None');
    expect(
      formatGpioList([
        { pin: 'PC13', label: 'STATUS_LED' },
        { pin: 'PA11 [PA9]', label: null },
      ]),
    ).toBe('PC13 (STATUS_LED), PA11 [PA9]');
  });
});
