import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { AppError } from '../shared/errors/app-error.js';

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const type =
      typeof error === 'object' && error !== null && 'type' in error
        ? error.type
        : undefined;
    const known =
      error instanceof AppError
        ? error
        : type === 'entity.parse.failed'
          ? new AppError(
              400,
              'INVALID_JSON',
              'Request body must contain valid JSON',
            )
          : type === 'entity.too.large'
            ? new AppError(
                413,
                'PAYLOAD_TOO_LARGE',
                'Request body exceeds the size limit',
              )
            : undefined;

    if (!known)
      logger.error(
        {
          requestId: res.locals.requestId,
          errorType: error instanceof Error ? error.name : 'Unknown',
        },
        'Request failed',
      );

    res.status(known?.status ?? 500).json({
      error: {
        code: known?.code ?? 'INTERNAL_ERROR',
        message: known?.message ?? 'An unexpected error occurred',
        requestId: res.locals.requestId,
      },
    });
  };
}
