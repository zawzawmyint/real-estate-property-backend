import { AppError } from '../../shared/errors/app-error.js';

export const publicChatUnavailable = () =>
  new AppError(503, 'SERVICE_UNAVAILABLE', 'Property assistant unavailable');

export const publicChatRateLimited = () =>
  new AppError(
    429,
    'RATE_LIMITED',
    'Property assistant is busy; try again later',
  );
