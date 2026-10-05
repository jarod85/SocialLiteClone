import type { PlatformConfig } from './types';

export const instagram: PlatformConfig = {
  id: 'instagram',
  name: 'Instagram',
  tagline: 'DMs, profiles and posts from people you follow',
  // www.instagram.com serves the mobile layout to mobile user agents; there is
  // no separate m. host anymore (m.instagram.com just redirects here).
  baseUrl: 'https://www.instagram.com/',
  accentColor: '#D62976',
};
