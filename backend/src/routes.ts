import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';

import { enqueueCommand, isCommandType } from './commands.js';
import {
  getDevice,
  getLatestReading,
  isForeignKeyViolation,
  isUniqueViolation,
  listDevices,
  listReadings,
  registerDevice,
} from './db.js';
import { DEFAULT_DASHBOARD_DIRECTORY, registerDashboard } from './dashboard.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from './errors.js';
import type { Logger } from './logger.js';
import { MAX_DEVICE_ID, MIN_DEVICE_ID } from './models.js';
import { hasExactKeys, isRecord } from './validation.js';

export const MAX_HISTORY_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_HISTORY_RANGE_MS = 60 * 60 * 1000;
export const MAX_DEVICE_NAME_LENGTH = 100;
export const DEFAULT_DEVICE_SAMPLE_RATE = 5;

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface AppOptions {
  pool: Pool;
  logger: Logger;
  dashboardDir?: string;
}

function readBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }

  return body;
}

function readInteger(value: unknown, minimum: number, maximum: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ValidationError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }

  return value;
}

function readDeviceId(value: unknown): number {
  return readInteger(value, MIN_DEVICE_ID, MAX_DEVICE_ID, 'deviceId');
}

function readPathDeviceId(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ValidationError(
      `deviceId must be an integer between ${MIN_DEVICE_ID} and ${MAX_DEVICE_ID}`,
    );
  }

  return readInteger(Number(value), MIN_DEVICE_ID, MAX_DEVICE_ID, 'deviceId');
}

function readDeviceName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('name must be a string');
  }

  const name = value.trim();

  if (name.length === 0) {
    throw new ValidationError('name must not be empty');
  }

  if (name.length > MAX_DEVICE_NAME_LENGTH) {
    throw new ValidationError(`name must be at most ${MAX_DEVICE_NAME_LENGTH} characters`);
  }

  return name;
}

function readTimestamp(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be an ISO 8601 timestamp`);
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    throw new ValidationError(`${field} must be a valid ISO 8601 timestamp`);
  }

  return timestamp;
}

interface HistoryQuery {
  deviceId: number;
  from: Date;
  to: Date;
}

function parseHistoryQuery(query: Record<string, unknown>, now: Date): HistoryQuery {
  if (typeof query.deviceId !== 'string') {
    throw new ValidationError('deviceId is required');
  }

  const deviceId = readPathDeviceId(query.deviceId);
  const to = query.to === undefined ? now : readTimestamp(query.to, 'to');
  const from =
    query.from === undefined
      ? new Date(to.getTime() - DEFAULT_HISTORY_RANGE_MS)
      : readTimestamp(query.from, 'from');

  if (from.getTime() >= to.getTime()) {
    throw new ValidationError('from must be earlier than to');
  }

  if (to.getTime() - from.getTime() > MAX_HISTORY_RANGE_MS) {
    throw new ValidationError(
      `the history range must not exceed ${MAX_HISTORY_RANGE_MS / 86_400_000} days`,
    );
  }

  return { deviceId, from, to };
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.code(statusCode).send({ error: { code, message } });
}

function statusCodeFor(error: unknown): number {
  if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode;
  }

  return 500;
}

async function createDevice(pool: Pool, body: Record<string, unknown>) {
  if (!hasExactKeys(body, ['deviceId', 'name', 'sampleRate'])) {
    throw new ValidationError('Device body requires only deviceId, name, and sampleRate');
  }

  const deviceId = readDeviceId(body.deviceId);
  const name = readDeviceName(body.name);
  const sampleRate = readInteger(body.sampleRate, 1, 255, 'sampleRate');

  try {
    return await registerDevice(pool, { deviceId, name, sampleRate });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(`Device ${deviceId} is already registered`);
    }

    throw error;
  }
}

async function createCommand(pool: Pool, body: Record<string, unknown>) {
  if (!hasExactKeys(body, ['deviceId', 'type', 'payload'])) {
    throw new ValidationError('Command body requires only deviceId, type, and payload');
  }

  const deviceId = readDeviceId(body.deviceId);

  if (!isCommandType(body.type)) {
    throw new ValidationError('type must be toggle_gpio or set_sample_rate');
  }

  try {
    return await enqueueCommand(pool, { deviceId, type: body.type, payload: body.payload });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new NotFoundError(`No device with ID ${deviceId}`);
    }

    throw error;
  }
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return sendError(reply, error.statusCode, error.code, error.message);
    }

    const statusCode = statusCodeFor(error);

    if (statusCode >= 400 && statusCode < 500) {
      return sendError(reply, statusCode, 'validation_error', 'Invalid request');
    }

    options.logger.error(
      { err: error, method: request.method, url: request.url },
      'request failed',
    );
    return sendError(reply, 500, 'internal_error', 'Internal server error');
  });

  app.setNotFoundHandler((_request, reply) => {
    return sendError(reply, 404, 'not_found', 'Route not found');
  });

  app.post('/api/v1/devices', async (request, reply) => {
    const device = await createDevice(options.pool, readBody(request.body));
    return reply.code(201).send({ data: device });
  });

  app.get('/api/v1/devices', async () => {
    return { data: await listDevices(options.pool) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/devices/:id', async (request) => {
    const deviceId = readPathDeviceId(request.params.id);
    const device = await getDevice(options.pool, deviceId);

    if (device === null) {
      throw new NotFoundError(`No device with ID ${deviceId}`);
    }

    const latestReading = await getLatestReading(options.pool, deviceId);

    return { data: { device, latestReading } };
  });

  app.get<{ Querystring: Record<string, unknown> }>('/api/v1/readings', async (request) => {
    const { deviceId, from, to } = parseHistoryQuery(request.query, new Date());
    const device = await getDevice(options.pool, deviceId);

    if (device === null) {
      throw new NotFoundError(`No device with ID ${deviceId}`);
    }

    return { data: await listReadings(options.pool, deviceId, from, to) };
  });

  app.post('/api/v1/commands', async (request, reply) => {
    const command = await createCommand(options.pool, readBody(request.body));
    return reply.code(201).send({ data: command });
  });

  registerDashboard(app, options.dashboardDir ?? DEFAULT_DASHBOARD_DIRECTORY, options.logger);

  return app;
}
