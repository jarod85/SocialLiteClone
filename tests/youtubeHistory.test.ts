import { historyGroup, MAX_HISTORY, resumePosition, useHistory, watchedFraction } from '@/features/youtube/history';
import type { VideoDetails } from '@/features/youtube/types';

const video = (id: string, durationSeconds = 600): VideoDetails => ({
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Video ${id}`,
  description: '',
  durationSeconds,
  isShort: false,
  isLive: false,
  sources: [],
  qualities: [],
  captions: [],
});

beforeEach(() => useHistory.getState().clear());

describe('watch history', () => {
  it('keeps where you stopped when a video is opened again', () => {
    const { record, savePosition } = useHistory.getState();
    record(video('a'));
    savePosition('a', 125);
    record(video('a'));
    expect(useHistory.getState().entries.a.position).toBe(125);
    useHistory.getState().remove('a');
    expect(useHistory.getState().entries.a).toBeUndefined();
  });

  it('drops the oldest entries past the limit', () => {
    const now = jest.spyOn(Date, 'now');
    for (let i = 0; i <= MAX_HISTORY; i++) {
      now.mockReturnValue(1_000_000 + i);
      useHistory.getState().record(video(`v${i}`));
    }
    now.mockRestore();
    const entries = useHistory.getState().entries;
    expect(Object.keys(entries)).toHaveLength(MAX_HISTORY);
    expect(entries.v0).toBeUndefined();
    expect(entries[`v${MAX_HISTORY}`]).toBeDefined();
  });

  it('resumes only from the middle of a video', () => {
    expect(resumePosition({ position: 5, durationSeconds: 600 })).toBe(0);
    expect(resumePosition({ position: 200, durationSeconds: 600 })).toBe(200);
    expect(resumePosition({ position: 590, durationSeconds: 600 })).toBe(0); // Watched to the end: start over.
    expect(resumePosition(undefined)).toBe(0);
  });

  it('shows how much was watched', () => {
    expect(watchedFraction({ position: 150, durationSeconds: 600 })).toBe(0.25);
    expect(watchedFraction({ position: 595, durationSeconds: 600 })).toBe(1);
    expect(watchedFraction({ position: 0, durationSeconds: 600 })).toBeNull();
    expect(watchedFraction({ position: 50, durationSeconds: null })).toBeNull();
  });

  it('groups by day', () => {
    const now = new Date(2026, 9, 12, 15, 0).getTime();
    expect(historyGroup(new Date(2026, 9, 12, 1, 0).getTime(), now)).toBe('Today');
    expect(historyGroup(new Date(2026, 9, 11, 23, 0).getTime(), now)).toBe('Yesterday');
    expect(historyGroup(new Date(2026, 9, 8, 12, 0).getTime(), now)).toBe('This week');
    expect(historyGroup(new Date(2026, 8, 1).getTime(), now)).toBe('Earlier');
  });
});
