import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyToken, verifyTokenType } from '../utils/jwt';

const prisma = new PrismaClient();

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
    res.status(401).json({ detail: 'Authentication failed' });
  }
};
