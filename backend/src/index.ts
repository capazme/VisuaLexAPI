import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import 'express-async-errors';
import { config } from './config';
import { errorHandler } from './middleware/errorHandler';
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

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: config.nodeEnv === 'production' ? undefined : false, // Disable CSP in dev for hot reload
  crossOriginEmbedderPolicy: false, // Allow embedding resources
}));

// Global rate limiting: 100 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { detail: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// CORS
app.use(cors({
  origin: config.cors.origins,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
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

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ detail: 'Not Found' });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║  VisuaLex Platform Backend                               ║
║                                                           ║
║  Status: Running                                          ║
║  Port: ${config.port}                                             ║
║  Environment: ${config.nodeEnv}                            ║
║                                                           ║
║  API Endpoints:                                           ║
║  - Health: http://localhost:${config.port}/api/health            ║
║  - Auth: http://localhost:${config.port}/api/auth/*              ║
║  - Admin: http://localhost:${config.port}/api/admin/*            ║
║  - Folders: http://localhost:${config.port}/api/folders/*        ║
║  - Bookmarks: http://localhost:${config.port}/api/bookmarks/*    ║
║  - Highlights: http://localhost:${config.port}/api/highlights/*  ║
║  - Annotations: http://localhost:${config.port}/api/annotations/*║
║  - Feedback: http://localhost:${config.port}/api/feedback/*      ║
║  - History: http://localhost:${config.port}/api/history/*        ║
║  - Bulletin: http://localhost:${config.port}/api/shared-environments/*║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;
