// Get redirect URL from environment variable
const EVENT_REDIRECT_URL = process.env.EVENT_REDIRECT_URL || 'https://htvn.vn/dem-nhac-ngan-vang-khat-vong-dai-ngan/';

export function getRedirectUrl(code: string): string | null {
  // If there's any code parameter, redirect to the event page
  if (code && code.trim()) {
    return EVENT_REDIRECT_URL;
  }
  return null;
}