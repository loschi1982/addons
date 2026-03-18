import axios from 'axios';

/**
 * HA Ingress-Basispfad erkennen.
 * Unter Ingress ist der Pfad z.B. /api/hassio_ingress/<token>/
 * Direkt ist er einfach /
 */
function getIngressBasePath(): string {
  const path = window.location.pathname;
  // HA Ingress-Pfad erkennen
  const match = path.match(/^(\/api\/hassio_ingress\/[^/]+)/);
  if (match) {
    return match[1];
  }
  return '';
}

const ingressBase = getIngressBasePath();

/**
 * Zentraler API-Client mit Interceptors für Auth-Token und Error-Handling.
 */
export const apiClient = axios.create({
  baseURL: ingressBase,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request-Interceptor: JWT-Token an jeden Request anhängen
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response-Interceptor: Bei 401 automatisch ausloggen
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.hash = '#/login';
    }
    return Promise.reject(error);
  }
);
