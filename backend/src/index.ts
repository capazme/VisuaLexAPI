import express from 'express';
import cors from 'cors';
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

const app = express();

// Middleware
app.use(cors({
  origin: config.cors.origins,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
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

// 404 handler
app.use((req, res) => {
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
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;
