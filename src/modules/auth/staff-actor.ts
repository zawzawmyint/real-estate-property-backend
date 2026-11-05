import type { Transaction } from '../../infrastructure/database/transaction.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { Actor } from '../leads/leads.repository.js';
import { isStaffRole } from './auth.js';

export async function requireCurrentStaff(
  identity: Actor,
  tx: Transaction,
): Promise<Actor> {
  const session = await tx.session.findFirst({
    where: {
      id: identity.sessionId,
      userId: identity.id,
      expiresAt: { gt: new Date() },
    },
    select: {
      credentialVersion: true,
      user: {
        select: {
          id: true,
          name: true,
          role: true,
          disabled: true,
          banned: true,
          credentialVersion: true,
        },
      },
    },
  });
  const user = session?.user;
  if (
    !user ||
    user.disabled ||
    user.banned ||
    !isStaffRole(user.role) ||
    session.credentialVersion !== user.credentialVersion
  )
    throw new AppError(401, 'UNAUTHENTICATED', 'Staff sign-in required');

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    sessionId: identity.sessionId,
  };
}
