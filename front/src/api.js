const BASE_URL = import.meta.env.VITE_API_URL || '/api';

async function request(path, options) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });

  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || 'Não foi possível concluir a solicitação.');
    error.status = response.status;
    throw error;
  }
  return body;
}

export const api = {
  dashboard: () => request('/dashboard'),
  alerts: (params = {}) => request(`/alerts?${new URLSearchParams(params)}`),
  sendFeedback: (payload) => request('/feedback', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request('/me'),
  requestMagicLink: (email, callbackURL) => request('/auth/sign-in/magic-link', { method: 'POST', body: JSON.stringify({ email, callbackURL }) }),
  logout: () => request('/auth/sign-out', { method: 'POST', body: JSON.stringify({}) }),
  setReaction: (alertId, value, metadata = {}) => request('/me/reactions', { method: 'POST', body: JSON.stringify({ alertId, value, ...metadata }) }),
  saveAlert: (alert) => request(`/me/saved/${encodeURIComponent(alert.id)}`, { method: 'POST', body: JSON.stringify({ publication: alert }) }),
  removeSavedAlert: (alertId) => request(`/me/saved/${encodeURIComponent(alertId)}`, { method: 'DELETE' }),
  updatePreferences: (payload) => request('/me/preferences', { method: 'PATCH', body: JSON.stringify(payload) }),
  suggestions: () => request('/suggestions'),
  createSuggestion: (payload) => request('/suggestions', { method: 'POST', body: JSON.stringify(payload) }),
  adminSuggestions: () => request('/admin/suggestions'),
  updateSuggestion: (id, payload) => request(`/admin/suggestions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminUsers: () => request('/admin/users'),
  inviteUser: (payload) => request('/admin/users/invite', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id, payload) => request(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  customSources: () => request('/sources/custom'),
  createCustomSource: (payload) => request('/sources/custom', { method: 'POST', body: JSON.stringify(payload) }),
  updateCustomSource: (id, payload) => request(`/sources/custom/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  intelligenceStatus: () => request('/intelligence/status'),
  analyzeUrl: (url, persist = true) => request('/intelligence/analyze-url', { method: 'POST', body: JSON.stringify({ url, persist }) }),
  sources: () => request('/sources'),
  sections: () => request('/sections'),
  section: (id) => request(`/sections/${encodeURIComponent(id)}`),
  monitorStatus: () => request('/monitor/status'),
  monitorRuns: () => request('/monitor/runs'),
  monitorCandidates: (status = '', date = '') => request(`/monitor/candidates?${new URLSearchParams({ ...(status ? { status } : {}), ...(date ? { date } : {}) })}`),
  runMonitor: (analyze = true, targetDate = '') => request('/monitor/run', { method: 'POST', body: JSON.stringify({ analyze, ...(targetDate ? { targetDate } : {}) }) }),
  subscriptionStatus: () => request('/subscriptions/status'),
  subscribe: (email) => request('/subscriptions', { method: 'POST', body: JSON.stringify({ email }) }),
  actionsStatus: () => request('/actions/status'),
  actions: () => request('/actions'),
  createAction: (payload) => request('/actions', { method: 'POST', body: JSON.stringify(payload) }),
  updateAction: (id, payload) => request(`/actions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  refreshAction: (id) => request(`/actions/${encodeURIComponent(id)}/refresh`, { method: 'POST' }),
  refreshAllActions: () => request('/actions/refresh-all', { method: 'POST' }),
  removeAction: (id) => request(`/actions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
