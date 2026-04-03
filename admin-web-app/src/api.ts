const RAW_API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8788').trim();

const ensureTrailingSlash = (value: string) => (value.endsWith('/') ? value : `${value}/`);

const getAppOrigin = () => {
  if (typeof window === 'undefined') {
    return 'http://localhost';
  }
  return window.location.origin;
};

const getApiBaseUrl = () => new URL(ensureTrailingSlash(RAW_API_URL), getAppOrigin());

export const buildApiUrl = (path: string) => {
  const normalizedPath = path.replace(/^\/+/, '');
  return new URL(normalizedPath, getApiBaseUrl()).toString();
};

export const isApiCrossOrigin = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  return getApiBaseUrl().origin !== window.location.origin;
};

export const buildAdminAccessLoginUrl = (returnTo: string) => {
  const url = new URL('api/admin/session', getApiBaseUrl());
  url.searchParams.set('returnTo', returnTo);
  return url.toString();
};
