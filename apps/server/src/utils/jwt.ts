import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';

export interface TokenPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
}

export const generateAccessToken = (userId: string, email: string): string => {
  const payload: TokenPayload = {
    userId,
    email,
    type: 'access',
  };

  const options: SignOptions = {
    expiresIn: config.jwt.accessExpiry as jwt.SignOptions['expiresIn'],
  };

  return jwt.sign(payload, config.jwt.secret, options);
};

export const generateRefreshToken = (userId: string, email: string): string => {
  const payload: TokenPayload = {
    userId,
    email,
    type: 'refresh',
  };

  const options: SignOptions = {
    expiresIn: config.jwt.refreshExpiry as jwt.SignOptions['expiresIn'],
  };

  return jwt.sign(payload, config.jwt.secret, options);
};

export const verifyToken = (token: string): TokenPayload | null => {
  try {
    const payload = jwt.verify(token, config.jwt.secret) as TokenPayload;
    return payload;
  } catch (error) {
    return null;
  }
};

export const verifyTokenType = (payload: TokenPayload, expectedType: 'access' | 'refresh'): boolean => {
  return payload.type === expectedType;
};
