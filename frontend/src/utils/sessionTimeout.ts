export const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

export function isSessionTimedOut(): boolean {
  const authToken =
    sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
  const lastActivity =
    sessionStorage.getItem('lastActivity') || localStorage.getItem('lastActivity');

  if (!authToken || !lastActivity) {
    return false;
  }

  const timeSinceActivity = Date.now() - parseInt(lastActivity, 10);
  return !Number.isNaN(timeSinceActivity) && timeSinceActivity >= INACTIVITY_TIMEOUT_MS;
}

export function clearSessionCredentials(): void {
  sessionStorage.removeItem('authToken');
  localStorage.removeItem('authToken');
  sessionStorage.removeItem('manualAuthUser');
  localStorage.removeItem('manualAuthUser');
  sessionStorage.removeItem('lastActivity');
  localStorage.removeItem('lastActivity');
}

export function redirectToLoginAfterTimeout(): void {
  clearSessionCredentials();
  window.location.replace('/login');
}
