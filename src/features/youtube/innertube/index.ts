/** Lite Social's own YouTube engine (used on iOS, where NewPipe Extractor can't run). */
import { parseYouTubeLink } from '../links';
import { channel } from './channel';
import { feed } from './feed';
import { more, search } from './search';
import { video } from './video';

export const engine = {
  search,
  more,
  channel,
  feed,
  video,
  parseVideoId(url: string): string | null {
    const link = parseYouTubeLink(url);
    return link?.kind === 'video' || link?.kind === 'short' ? link.id : null;
  },
};

export { downloadStreams } from './video';
