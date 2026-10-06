import type { PlatformConfig } from './types';

export const instagram: PlatformConfig = {
  id: 'instagram',
  name: 'Instagram',
  tagline: 'DMs, profiles and posts from people you follow',
  // www.instagram.com serves the mobile layout to mobile user agents; there is
  // no separate m. host anymore (m.instagram.com just redirects here).
  baseUrl: 'https://www.instagram.com/',
  siteHosts: ['www.instagram.com', 'instagram.com'],
  allowedHosts: [
    'instagram.com',
    '*.instagram.com', // l.instagram.com (outbound link redirector), help., accountscenter.
    'facebook.com',
    '*.facebook.com', // "Log in with Facebook"
    'meta.com',
    '*.meta.com', // Accounts Center and account recovery flows
  ],
  neverBlock: [
    '/accounts/**', // login, signup, settings, password reset, activity
    '/challenge/**', // suspicious-login checks
    '/two_factor/**',
    '/auth_platform/**',
    '/oauth/**',
    '/direct/**', // messages
  ],
  toggles: [
    {
      id: 'blockReels',
      label: 'Block Reels',
      description: 'Removes the Reels tab, collapses Reels and videos in your feed and on profiles, and blocks opening Reels.',
      default: true,
    },
    {
      id: 'allowSharedReels',
      label: 'Watch shared reels',
      description:
        'With Block Reels on, still lets you open a single reel someone sends you, or one on a profile or post. The Reels tab and the swipe-for-more viewer stay blocked, and reels in your home feed stay collapsed.',
      default: true,
    },
    {
      id: 'hideExplore',
      label: 'Hide Explore',
      description: 'Search still works, but the grid of recommended posts under it is hidden.',
      default: true,
    },
    {
      id: 'hideSuggested',
      label: 'Hide suggestions',
      description: 'Hides "Suggested for you" posts and accounts.',
      default: true,
    },
    {
      id: 'followingFeed',
      label: 'Following feed',
      description: "Opens Instagram's chronological feed of accounts you follow instead of the algorithmic one.",
      default: true,
    },
    {
      id: 'limitFeed',
      label: 'Stop the feed',
      description: 'Ends the home feed with a "you\'re all caught up" card after a set number of posts.',
      default: true,
    },
    {
      id: 'hideStories',
      label: 'Hide Stories',
      description: 'Hides the Stories tray where it can be found, and blocks opening stories.',
      default: false,
    },
  ],
  accentColor: '#D62976',
};
