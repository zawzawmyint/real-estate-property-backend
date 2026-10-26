import { fromNodeHeaders } from 'better-auth/node';
import type { RequestHandler } from 'express';
import { AppError } from '../../shared/errors/app-error.js';
import { isStaffRole, type StaffAuth, type StaffRole } from './auth.js';

/** Live database authorization; never authorize from cookie presence alone. */
export function requireStaff(
  auth: StaffAuth,
  allowedRoles: readonly StaffRole[] = ['admin', 'manager', 'agent'],
): RequestHandler {
  return async (req, res, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
        query: { disableCookieCache: true, disableRefresh: true },
      });

      if (!session || !isStaffRole(session.user.role))
        throw new AppError(401, 'UNAUTHENTICATED', 'Staff sign-in required');
      if (!allowedRoles.includes(session.user.role))
        throw new AppError(403, 'FORBIDDEN', 'Access denied');

      res.locals.staff = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
