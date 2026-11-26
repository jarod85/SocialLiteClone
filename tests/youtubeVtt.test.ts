import { cueAt, parseVtt } from '@/features/youtube/vtt';

import { fixture } from './fixtures';

describe('parseVtt', () => {
  const cues = parseVtt(fixture('youtube/captions.vtt'));

  it('reads the cues of a YouTube WebVTT file', () => {
    expect(cues[0]).toEqual({ start: 1.36, end: 3.04, text: '[♪♪♪]' });
    expect(cues[1]).toEqual({ start: 18.64, end: 21.88, text: "♪ We're no strangers to love ♪" });
    expect(cues[2].text).toBe('♪ You know the rules\nand so do I ♪');
  });

  it('drops cue settings and inline tags', () => {
    const text = 'WEBVTT\n\n00:01:02.500 --> 00:01:04.000 align:start position:0%\nhello <c>there</c><00:01:03.000>\n';
    expect(parseVtt(text)).toEqual([{ start: 62.5, end: 64, text: 'hello there' }]);
  });
});

describe('cueAt', () => {
  const cues = parseVtt(fixture('youtube/captions.vtt'));

  it('finds the cue showing at a time, or none between cues', () => {
    expect(cueAt(cues, 19)?.text).toBe("♪ We're no strangers to love ♪");
    expect(cueAt(cues, 10)).toBeNull();
    expect(cueAt(cues, 0)).toBeNull();
    expect(cueAt([], 5)).toBeNull();
  });
});
