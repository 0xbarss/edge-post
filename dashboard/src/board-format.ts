import type { BoardAdcChannel, BoardGpio, BoardI2c, BoardSpi, BoardUart } from './types';

function trimNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export function formatClock(hz: number | null): string {
  if (hz === null || hz <= 0) {
    return '—';
  }

  if (hz >= 1_000_000) {
    return `${trimNumber(hz / 1_000_000)} MHz`;
  }

  if (hz >= 1_000) {
    return `${trimNumber(hz / 1_000)} kHz`;
  }

  return `${hz} Hz`;
}

export function formatAdcChannel(channel: BoardAdcChannel): string {
  const label = channel.label === null ? '' : ` · ${channel.label}`;
  return `${channel.instance} ch${channel.channel} · ${channel.pin}${label}`;
}

export function formatUart(uart: BoardUart): string {
  return `${uart.instance} · TX ${uart.txPin ?? '—'} · RX ${uart.rxPin ?? '—'}`;
}

export function formatSpi(spi: BoardSpi): string {
  const pins = [
    spi.sckPin === null ? null : `SCK ${spi.sckPin}`,
    spi.misoPin === null ? null : `MISO ${spi.misoPin}`,
    spi.mosiPin === null ? null : `MOSI ${spi.mosiPin}`,
    spi.nssPin === null ? null : `NSS ${spi.nssPin}`,
  ].filter((pin): pin is string => pin !== null);

  return pins.length === 0 ? spi.instance : `${spi.instance} · ${pins.join(' · ')}`;
}

export function formatI2c(i2c: BoardI2c): string {
  return `${i2c.instance} · SCL ${i2c.sclPin ?? '—'} · SDA ${i2c.sdaPin ?? '—'}`;
}

export function formatGpioList(pins: BoardGpio[]): string {
  if (pins.length === 0) {
    return 'None';
  }

  return pins.map((pin) => (pin.label === null ? pin.pin : `${pin.pin} (${pin.label})`)).join(', ');
}
