import { fromNodeHeaders } from 'better-auth/node';
import { auth, initializeAuthPersistence } from '../services/auth.js';
import { databaseConfigured } from '../services/db.js';

export function rolesOf(user) {
  return String(user?.role || 'user')
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
}

export function userHasRole(user, allowedRoles) {
  const allowed = new Set(allowedRoles.map((role) => String(role).toLowerCase()));
  return rolesOf(user).some((role) => allowed.has(role));
}

export async function getRequestSession(request) {
  await initializeAuthPersistence();
  return auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
}

export function createRequireAuth({ getSession = getRequestSession } = {}) {
  return async function requireAuth(request, response, next) {
    try {
      const session = request.auth || await getSession(request);
      if (!session?.user || !session?.session) {
        return response.status(401).json({ message: 'Faça login para continuar.', code: 'AUTH_REQUIRED' });
      }
      request.auth = session;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const requireAuth = createRequireAuth();

export function requireRole(...allowedRoles) {
  if (!allowedRoles.length) throw new TypeError('Informe pelo menos um papel permitido.');
  return async function roleMiddleware(request, response, next) {
    try {
      const session = request.auth || await getRequestSession(request);
      if (!session?.user || !session?.session) {
        return response.status(401).json({ message: 'Faça login para continuar.', code: 'AUTH_REQUIRED' });
      }
      request.auth = session;
      if (!userHasRole(session.user, allowedRoles)) {
        return response.status(403).json({ message: 'Você não tem permissão para esta ação.', code: 'FORBIDDEN' });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const requireAdmin = requireRole('admin');

export function createOptionalAuth({
  getSession = getRequestSession,
  isAuthConfigured = databaseConfigured,
} = {}) {
  return async function optionalAuth(request, _response, next) {
    try {
      if (request.auth) return next();
      if (!isAuthConfigured()) {
        request.auth = null;
        return next();
      }
      request.auth = await getSession(request);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const optionalAuth = createOptionalAuth();
