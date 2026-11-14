import { describe, expect, it } from 'vitest';
import { filenameFrom, isAppleTouchDevice } from './files';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

describe('isAppleTouchDevice', () => {
  it('detects the iPhone, in Safari or any other browser', () => {
    expect(isAppleTouchDevice({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(
      isAppleTouchDevice({ userAgent: IPHONE.replace('Version/18.6', 'CriOS/140.0'), maxTouchPoints: 5 }),
    ).toBe(true);
  });

  it('detects an iPad that reports itself as a Mac', () => {
    expect(isAppleTouchDevice({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 5 })).toBe(true);
  });

  it('leaves out a real Mac and Android', () => {
    expect(isAppleTouchDevice({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 0 })).toBe(false);
    expect(isAppleTouchDevice({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(false);
  });
});

describe('filenameFrom', () => {
  it('reads the attachment name and refuses anything odd', () => {
    expect(filenameFrom('attachment; filename="nethstore-007-003.jpg"')).toBe('nethstore-007-003.jpg');
    expect(filenameFrom('attachment; filename="../x y.jpg"')).toBeNull();
    expect(filenameFrom(null)).toBeNull();
  });
});
