export type AppErrorCode = 'validation_error' | 'not_found' | 'conflict' | 'internal_error';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;

  constructor(code: AppErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('validation_error', 400, message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super('not_found', 404, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('conflict', 409, message);
    this.name = 'ConflictError';
  }
}
