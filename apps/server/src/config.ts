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
    // `enabled` and `flags.*` are getters, not frozen booleans: they are
    // read live from process.env on every access rather than once at module
    // import time. This is what lets `featureGate` (middleware/merlt/
    // featureGate.ts) and integration tests toggle MERLT_*_ENABLED between
    // requests without reloading the whole config/app module graph.
    // All default to `true` when the env var is absent — Wave 1 cleanup
    // wires these flags to an actual kill-switch for the first time (they
    // were previously read but never gated on anywhere); flipping the
    // resting default to `false` would silently disable MERL-T for every
    // existing deployment that doesn't explicitly set these vars.
    get enabled(): boolean { return readBoolean(process.env.MERLT_ENABLED, true); },
    apiUrl: process.env.MERLT_API_URL || 'http://localhost:8000',
    apiKey: process.env.MERLT_API_KEY || '',
    timeoutMs: parseInt(process.env.MERLT_TIMEOUT_MS || '60000', 10),
    flags: {
      get contribution(): boolean { return readBoolean(process.env.MERLT_CONTRIBUTION_ENABLED, true); },
      get validation(): boolean { return readBoolean(process.env.MERLT_VALIDATION_ENABLED, true); },
      get graph(): boolean { return readBoolean(process.env.MERLT_GRAPH_ENABLED, true); },
      get ops(): boolean { return readBoolean(process.env.MERLT_OPS_ENABLED, true); },
    },
  },
};
