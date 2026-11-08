import { User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      /**
       * Set only by `delegatedAuth` once an exchanged token has been verified:
       * the request acts for `user` through a connected application.
       */
      /** `readsNotes`: the token has `dossier:text` and its grant was approved with the words naming the notes (G-381 (b)). */
      delegation?: { grantId: string; clientId: string; scopes: string[]; clientName: string | null; readsNotes: boolean };
    }
  }
}
