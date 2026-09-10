export const REMINDER_KEY = "111-notification-reminder-dismissed-v1";
export const NOTIFICATION_DEVICE_URL = "/profile?tab=settings&section=notifications#push-device";
let dismissedInMemory = false;

export function isReminderDismissed() {
  if (typeof window === "undefined") return false;
  try {
    return dismissedInMemory || window.localStorage.getItem(REMINDER_KEY) === "1";
  } catch {
    return dismissedInMemory;
  }
}

export function dismissReminder() {
  if (typeof window === "undefined") return;
  dismissedInMemory = true;
  try { window.localStorage.setItem(REMINDER_KEY, "1"); } catch { /* Session fallback. */ }
}

export function shouldShowReminder(state: {
  supported: boolean; authenticated: boolean; loading: boolean;
  active: boolean; dismissed: boolean; masterEnabled: boolean;
}) {
  return state.supported && state.authenticated && !state.loading &&
    !state.active && !state.dismissed && state.masterEnabled;
}
