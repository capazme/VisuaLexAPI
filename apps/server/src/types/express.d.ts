import { User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      /**
       * Set only by `delegatedAuth` once an exchanged token has been verified:
       * the request acts for `user` through a connected application.
       */
      delegation?: { grantId: string; clientId: string; scopes: string[]; clientName: string | null };
    }
  }
}
