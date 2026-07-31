import * as fs from 'fs';
import { CalendarRepository } from '../repositories/calendar.repository';
import { ChronicleWindow } from '../types';

jest.mock('fs');
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

const window: ChronicleWindow = { start: '2026-07-23', end: '2026-07-23' };

const makeIcs = (events: { summary: string; dtstart: string; uid?: string }[]): string => {
  const blocks = events.map((e) => {
    const lines = ['BEGIN:VEVENT', `SUMMARY:${e.summary}`, `DTSTART:${e.dtstart}`];
    if (e.uid) lines.push(`UID:${e.uid}`);
    lines.push('END:VEVENT');
    return lines.join('\n');
  });
  return ['BEGIN:VCALENDAR', ...blocks, 'END:VCALENDAR'].join('\n');
};

describe('CalendarRepository.getActivity', () => {
  let repo: CalendarRepository;

  beforeEach(() => {
    repo = new CalendarRepository();
    jest.resetAllMocks();
  });

  it('returns [] when icsPath is absent', async () => {
    expect(await repo.getActivity(window)).toEqual([]);
    expect(await repo.getActivity(window, '')).toEqual([]);
  });

  it('returns [] when the file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    expect(await repo.getActivity(window, '/path/to/cal.ics')).toEqual([]);
  });

  it('returns [] when the file cannot be read', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => { throw new Error('EACCES'); });
    expect(await repo.getActivity(window, '/path/to/cal.ics')).toEqual([]);
  });

  it('returns one activity per in-window meeting', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeIcs([
        { summary: 'Team standup', dtstart: '20260723T100000Z', uid: 'uid-1' },
        { summary: 'Design review', dtstart: '20260723T140000Z', uid: 'uid-2' },
      ]),
    );
    const activities = await repo.getActivity(window, '/cal.ics');
    expect(activities).toHaveLength(2);
    expect(activities[0].summary).toBe('Team standup');
    expect(activities[1].summary).toBe('Design review');
    expect(activities.every((a) => a.source === 'calendar')).toBe(true);
  });

  it('filters out meetings outside the window', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeIcs([
        { summary: 'Yesterday', dtstart: '20260722T100000Z' },
        { summary: 'Today', dtstart: '20260723T110000Z' },
        { summary: 'Tomorrow', dtstart: '20260724T100000Z' },
      ]),
    );
    const activities = await repo.getActivity(window, '/cal.ics');
    expect(activities).toHaveLength(1);
    expect(activities[0].summary).toBe('Today');
  });

  it('uses the UID as the activity id when present', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeIcs([{ summary: 'Standup', dtstart: '20260723T100000Z', uid: 'my-stable-uid' }]),
    );
    const [a] = await repo.getActivity(window, '/cal.ics');
    expect(a.id).toBe('my-stable-uid');
  });

  it('derives a stable id from summary+start when no UID', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeIcs([{ summary: 'No UID', dtstart: '20260723T120000Z' }]),
    );
    const [a1] = await repo.getActivity(window, '/cal.ics');
    const [a2] = await repo.getActivity(window, '/cal.ics');
    expect(a1.id).toBe(a2.id);
    expect(a1.id).toHaveLength(12);
  });

  it('includes attendee names in the summary', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      `BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Sync\nDTSTART:20260723T150000Z\nATTENDEE;CN=Alice:mailto:alice@x.com\nATTENDEE;CN=Bob:mailto:bob@x.com\nEND:VEVENT\nEND:VCALENDAR`,
    );
    const [a] = await repo.getActivity(window, '/cal.ics');
    expect(a.summary).toBe('Sync (with Alice, Bob)');
  });

  it('returns activities sorted by timestamp', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      makeIcs([
        { summary: 'Late meeting', dtstart: '20260723T160000Z', uid: 'u2' },
        { summary: 'Morning standup', dtstart: '20260723T090000Z', uid: 'u1' },
      ]),
    );
    const activities = await repo.getActivity(window, '/cal.ics');
    expect(activities[0].summary).toBe('Morning standup');
    expect(activities[1].summary).toBe('Late meeting');
  });
});
