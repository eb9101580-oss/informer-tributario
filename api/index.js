import { app } from '../back/src/app.js';

export default function handler(request, response) {
  const path = String(request.query.path || '').replace(/^\/+/, '');
  const query = new URLSearchParams(request.query);
  query.delete('path');
  request.url = `/api/${path}${query.size ? `?${query}` : ''}`;
  return app(request, response);
}
