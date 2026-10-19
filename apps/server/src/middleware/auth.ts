import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { verifyToken, verifyTokenType } from '../utils/jwt';

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // An exchanged token was already verified, held to its table of routes and
  // scopes, and its user loaded by `delegatedAuth` (middleware/delegated.ts).
  // Only that middleware sets `req.delegation`; nothing from the request can.
  if (req.delegation && req.user) {
    next();
    return;
  }
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ detail: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      res.status(401).json({ detail: 'Invalid or expired token' });
      return;
    }

    if (!verifyTokenType(payload, 'access')) {
      res.status(401).json({ detail: 'Invalid token type' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ detail: 'User not found or inactive' });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    // Only the checks above prove a session is over. A throw here is our fault
    // (the database could not answer), and a 401 would make the web client log
    // the user out at every hiccup: 503, so it keeps the session and retries.
    console.error('authenticate: could not load the user:', error);
    res.status(503).json({ detail: 'Servizio temporaneamente non disponibile, riprova tra poco.' });
  }
};
