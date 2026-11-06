import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
import {
  publicChatRateLimited,
  publicChatUnavailable,
} from './public-chat.errors.js';
import type { createPublicChatService } from './public-chat.service.js';

export type PublicChatReplyHandler = ReturnType<
  typeof createPublicChatService
>['reply'];

const input = z.strictObject({
  message: z.string().trim().min(1).max(500),
});

export function createPublicChatController(
  reply: PublicChatReplyHandler,
): RequestHandler {
  return async (req, res) => {
    const parsed = input.safeParse(req.body);
    if (!parsed.success)
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid chat message');

    try {
      res.json(await reply(parsed.data.message));
    } catch (error) {
      if (error instanceof AppError && error.status === 429)
        throw publicChatRateLimited();
      throw publicChatUnavailable();
    }
  };
}
