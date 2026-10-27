import { z } from 'zod';

export const phoneSchema = z
  .string()
  .transform((value) => value.replace(/\s/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(3)
      .max(40)
      .regex(/^[+\d ()-]+$/)
      .regex(/\d/),
  );
