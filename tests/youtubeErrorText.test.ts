/**
 * Errors from the native YouTube module reach the screens without Expo's
 * "Call to function … has been rejected." prefix.
 */
import { errorText } from '@/features/youtube/native';

const BLOCKED =
  "YouTube is asking this network to prove it isn't a bot. Try again later or on another network (for example mobile data instead of Wi-Fi).";

describe('errorText', () => {
  it("keeps only the module's message from a rejected native call", () => {
    const e = new Error(`Call to function 'LiteSocialYouTube.video' has been rejected.\n→ Caused by: ${BLOCKED}`);
    expect(errorText(e)).toBe(BLOCKED);
  });

  it('keeps the innermost message when Expo wraps more than once', () => {
    const e = new Error("Outer.\n→ Caused by: Call to function 'LiteSocialYouTube.feed' has been rejected.\n→ Caused by: No connection.");
    expect(errorText(e)).toBe('No connection.');
  });

  it('leaves other errors as they are', () => {
    expect(errorText(new Error('YouTube needs the Android app.'))).toBe('YouTube needs the Android app.');
    expect(errorText('plain text')).toBe('plain text');
  });
});
