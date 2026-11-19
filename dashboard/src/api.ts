import type { BoardProfile, CommandRow, CommandType, Device, Reading, ServerEvent } from './types';

const API_BASE = '/api/v1';

interface DataEnvelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message !== '') {
    return error.message;
  }

  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDataEnvelope(value: unknown): value is DataEnvelope<unknown> {
  return isRecord(value) && 'data' in value;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }

  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('accept', 'application/json');

  if (init?.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = null;

  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(
        'invalid_response',
        'The server returned a response that is not JSON',
        response.status,
      );
    }
  }

  if (!response.ok) {
    const error = isErrorEnvelope(body) ? body.error : null;
    throw new ApiError(
      error?.code ?? 'request_failed',
      error?.message ?? `The request failed with status ${response.status}`,
      response.status,
    );
  }

  if (!isDataEnvelope(body)) {
    throw new ApiError(
      'invalid_response',
      'The server response did not use the data envelope',
      response.status,
    );
  }

  return body.data as T;
}

export function listDevices(): Promise<Device[]> {
  return request<Device[]>('/devices');
}

export function listBoards(): Promise<BoardProfile[]> {
  return request<BoardProfile[]>('/boards');
}

export function listReadings(deviceId: number, from: number, to: number): Promise<Reading[]> {
  const query = new URLSearchParams({
    deviceId: String(deviceId),
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  });

  return request<Reading[]>(`/readings?${query.toString()}`);
}

export function enqueueCommand(input: {
  deviceId: number;
  type: CommandType;
  payload: unknown;
}): Promise<CommandRow> {
  return request<CommandRow>('/commands', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function parseServerEvent(raw: string): ServerEvent | null {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.event !== 'string' || !isRecord(value.data)) {
    return null;
  }

  const { event, data } = value;

  if (event === 'reading') {
    if (
      typeof data.deviceId !== 'number' ||
      !Number.isInteger(data.deviceId) ||
      typeof data.ts !== 'string' ||
      typeof data.temperature !== 'number' ||
      typeof data.gpioState !== 'number'
    ) {
      return null;
    }

    return {
      event,
      data: {
        deviceId: data.deviceId,
        ts: data.ts,
        temperature: data.temperature,
        gpioState: data.gpioState,
      },
    };
  }

  if (event === 'device:status') {
    if (
      typeof data.deviceId !== 'number' ||
      !Number.isInteger(data.deviceId) ||
      (data.status !== 'online' && data.status !== 'offline')
    ) {
      return null;
    }

    return { event, data: { deviceId: data.deviceId, status: data.status } };
  }

  if (event === 'error') {
    if (typeof data.code !== 'string' || typeof data.message !== 'string') {
      return null;
    }

    return { event, data: { code: data.code, message: data.message } };
  }

  return null;
}
