import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'express-async-errors';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
import { globalRateLimiter, writeRateLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import folderRoutes from './routes/folders';
import bookmarkRoutes from './routes/bookmarks';
import highlightRoutes from './routes/highlights';
import annotationRoutes from './routes/annotations';
import dossierRoutes from './routes/dossiers';
import feedbackRoutes from './routes/feedback';
import historyRoutes from './routes/history';
import sharedEnvironmentRoutes from './routes/sharedEnvironments';
import environmentRoutes from './routes/environments';
import quickNormRoutes from './routes/quickNorms';
import customAliasRoutes from './routes/customAliases';
import notificationRoutes from './routes/notifications';
import articleDiscussionRoutes from './routes/articleDiscussions';
import { PrismaClient } from '@prisma/client';

const app = express();
const healthPrisma = new PrismaClient();

// Trust first proxy (load balancer) for accurate req.ip
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: config.nodeEnv === 'production' ? undefined : false, // Disable CSP in dev for hot reload
  crossOriginEmbedderPolicy: false, // Allow embedding resources
}));

// CORS must be registered before any middleware that can short-circuit
// the request (rate limiter, auth, etc.). Otherwise early responses
// (429, 401) miss the Access-Control-Allow-Origin header and the
// browser flags them as CORS failures instead of surfacing the real
// status code.
app.use(cors({
  origin: config.cors.origins,
  credentials: true,
}));

// Rate limiting: anonymous 100/min, authenticated 300/min, writes 20/min
// Uses Redis if REDIS_ENABLED=true, otherwise in-memory
app.use(globalRateLimiter);

// 2 MB, not the 100 kB default: the saved-norm check posts the article's
// full text (art. 1 of a legge di bilancio is close to 1 MB), and dossier
// items carry article content too. Bounded again per field by the Zod
// schemas, and per client by the rate limiter above.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Additional write rate limit on mutation endpoints (POST/PUT/PATCH/DELETE)
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    writeRateLimiter(req, res, next);
    return;
  }
  next();
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

app.get('/api/health/detailed', async (_req, res) => {
  const started = Date.now();
  try {
    await healthPrisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', timestamp: new Date().toISOString(), services: { database: { status: 'ok', latency_ms: Date.now() - started } } });
  } catch {
    res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString(), services: { database: { status: 'error', latency_ms: Date.now() - started } } });
  }
});

// Routes
app.use('/api', authRoutes);
app.use('/api', adminRoutes);
app.use('/api', folderRoutes);
app.use('/api', bookmarkRoutes);
app.use('/api', highlightRoutes);
app.use('/api', annotationRoutes);
app.use('/api', dossierRoutes);
app.use('/api', feedbackRoutes);
app.use('/api/history', historyRoutes);
app.use('/api', sharedEnvironmentRoutes);
app.use('/api', environmentRoutes);
app.use('/api', quickNormRoutes);
app.use('/api', customAliasRoutes);
app.use('/api', notificationRoutes);
app.use('/api', articleDiscussionRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ detail: 'Not Found' });
});

// Error handler (must be last)
app.use(errorHandler);

export default app;
