import { User } from '../lib/db';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      /**
       * Set only by `delegatedAuth` once an exchanged token has been verified:
       * the request acts for `user` through a connected application.
       */
      /** `readsNotes`: the token has `dossier:text` and its grant was approved with the words naming the notes (G-381 (b)).
       *  `readsActs`: the same, with the words naming a case's acts too (LC56, `TEXT_CONSENT_VERSION` 2).
       *  `readsTexts`: the token and its grant both hold `dossier:text`, whatever the words' version: the text of the
       *  norms a dossier holds, which the consent page promises only with that permission. */
      delegation?: { grantId: string; clientId: string; scopes: string[]; clientName: string | null; readsNotes: boolean; readsActs: boolean; readsTexts: boolean };
      /** Set only by `webSession` (middleware/webSession.ts): the web session, from its cookie, that `user` came from. */
      webSessionId?: string;
      /** Set only by `webSession` when the database could not read the cookie's session: `authenticate` says 503. */
      sessionUnavailable?: boolean;
    }
  }
}
