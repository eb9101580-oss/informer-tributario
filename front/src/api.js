const BASE_URL = import.meta.env.VITE_API_URL || '/api';

async function request(path, options) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Não foi possível concluir a solicitação.');
  return body;
}

export const api = {
  dashboard: () => request('/dashboard'),
  alerts: (params = {}) => request(`/alerts?${new URLSearchParams(params)}`),
  sendFeedback: (payload) => request('/feedback', { method: 'POST', body: JSON.stringify(payload) }),
  intelligenceStatus: () => request('/intelligence/status'),
  analyzeUrl: (url, persist = true) => request('/intelligence/analyze-url', { method: 'POST', body: JSON.stringify({ url, persist }) }),
  sources: () => request('/sources'),
  monitorStatus: () => request('/monitor/status'),
  monitorRuns: () => request('/monitor/runs'),
  monitorCandidates: (status = '') => request(`/monitor/candidates?${new URLSearchParams(status ? { status } : {})}`),
  runMonitor: (analyze = true) => request('/monitor/run', { method: 'POST', body: JSON.stringify({ analyze }) }),
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
