import express, { type Express, type RequestHandler } from 'express';
import type { Env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  noStore,
  requireJsonContentType,
  requireTrustedOrigin,
} from '../../shared/http/middleware.js';
import {
  createPublicChatController,
  type PublicChatReplyHandler,
} from './public-chat.controller.js';
import { limitPublicChatClients } from './public-chat.limits.js';
import { publicChatUnavailable } from './public-chat.errors.js';

const jsonParser = express.json({ limit: '8kb', inflate: false });
const parseChatJson: RequestHandler = (req, res, next) => {
  jsonParser(req, res, (error?: unknown) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      (error.type === 'encoding.unsupported' ||
        error.type === 'charset.unsupported')
    ) {
      next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected UTF-8 JSON'));
      return;
    }
    next(error);
  });
};

export function mountPublicChat(
  app: Express,
  env: Env,
  reply?: PublicChatReplyHandler,
) {
  const path = '/api/v1/public/chat';

  if (!env.PUBLIC_CHAT_ENABLED || !reply) {
    app.post(path, noStore, () => {
      throw publicChatUnavailable();
    });
    return;
  }

  app.post(
    path,
    noStore,
    requireTrustedOrigin(env.APP_ORIGIN),
    limitPublicChatClients(env),
    requireJsonContentType,
    parseChatJson,
    createPublicChatController(reply),
  );
}
