// Better Auth needs the raw request body. Mount this handler before express.json():
// app.all('/api/auth/*splat', authHandler)
export { auth, authHandler, initializeAuthPersistence } from '../services/auth.js';
