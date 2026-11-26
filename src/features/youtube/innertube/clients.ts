/**
 * The YouTube InnerTube clients Lite Social presents itself as on iOS.
 *
 * Copied from NewPipe Extractor (the commit pinned in modules/youtube/android/build.gradle,
 * ClientsConstants and InnertubeClientRequestInfo), so Android and iOS ask YouTube the same
 * way. When NewPipe bumps these, bump them here too.
 */

/** Streams: Apple Vision Pro's YouTube app, which YouTube answers with direct stream URLs and HLS. */
export const VISIONOS = {
  id: '101',
  clientName: 'VISIONOS',
  clientVersion: '1.04',
  clientScreen: 'WATCH',
  platform: 'MOBILE',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1',
  osName: 'visionOS',
  osVersion: '26.6.0.23O770',
  userAgentVersion: '26_6_0',
} as const;

/** Search, channels and metadata: the desktop website. */
export const WEB = {
  id: '1',
  clientName: 'WEB',
  clientVersion: '2.20260805.01.00',
} as const;

export type ClientName = 'web' | 'visionos';

export function userAgentFor(client: ClientName, gl: string): string {
  return client === 'visionos'
    ? `com.google.visionos.youtube/${VISIONOS.clientVersion} (${VISIONOS.deviceModel}; U; CPU visionOS ${VISIONOS.userAgentVersion} like Mac OS X; ${gl})`
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
}
