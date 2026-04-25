import dotenv from 'dotenv';

dotenv.config();

const readBoolean = (value: string | undefined, defaultValue = false): boolean => {
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'DATABASE_URL'] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}. Check your .env file.`);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  jwt: {
    secret: process.env.JWT_SECRET!, // Validated above
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '30m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  cors: {
    origins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3001')
      .split(',')
      .map(origin => origin.trim()),
  },

  database: {
    url: process.env.DATABASE_URL!, // Validated above
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379/0',
    enabled: (process.env.REDIS_ENABLED || 'false').toLowerCase() === 'true',
  },

  merlt: {
    enabled: readBoolean(process.env.MERLT_ENABLED, false),
    apiUrl: process.env.MERLT_API_URL || 'http://localhost:8000',
    apiKey: process.env.MERLT_API_KEY || '',
    timeoutMs: parseInt(process.env.MERLT_TIMEOUT_MS || '60000', 10),
    flags: {
      contribution: readBoolean(process.env.MERLT_CONTRIBUTION_ENABLED, false),
      validation: readBoolean(process.env.MERLT_VALIDATION_ENABLED, false),
      graph: readBoolean(process.env.MERLT_GRAPH_ENABLED, true),
      ops: readBoolean(process.env.MERLT_OPS_ENABLED, false),
    },
  },
};
