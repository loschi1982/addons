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

// Wird auf true gesetzt während ein Backup-Export oder -Import läuft.
// In diesem Fall wird der automatische Logout bei 401 unterdrückt,
// da lange Backup-Requests den Token-Ablauf auslösen können.
let _backupRunning = false;
export function setBackupRunning(active: boolean) { _backupRunning = active; }

// Response-Interceptor: Bei 401 automatisch ausloggen
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Setup- und Login-Endpunkte nicht umleiten
      const url = error.config?.url || '';
      if (!url.includes('/auth/setup') && !url.includes('/auth/login')) {
        // Während eines laufenden Backups keinen Logout auslösen
        if (_backupRunning) return Promise.reject(error);
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.hash = '#/login';
      }
    }
    return Promise.reject(error);
  }
);
