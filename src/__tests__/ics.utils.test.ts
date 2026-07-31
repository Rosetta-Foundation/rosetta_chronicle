import { icsDateToIso, parseIcs } from '../utils/ics.utils';

describe('icsDateToIso', () => {
  it('converts a UTC datetime (YYYYMMDDTHHMMSSZ) to ISO 8601 with Z', () => {
    expect(icsDateToIso('20260723T140000Z')).toBe('2026-07-23T14:00:00Z');
  });

  it('converts a floating datetime (YYYYMMDDTHHMMSS) to ISO 8601 without Z', () => {
    expect(icsDateToIso('20260723T093000')).toBe('2026-07-23T09:30:00');
  });

  it('converts a date-only value (YYYYMMDD) to midnight ISO', () => {
    expect(icsDateToIso('20260723')).toBe('2026-07-23T00:00:00');
  });

  it('returns null for unrecognised formats', () => {
    expect(icsDateToIso('')).toBeNull();
    expect(icsDateToIso('20260723T14')).toBeNull();
    expect(icsDateToIso('not-a-date')).toBeNull();
  });
});

describe('parseIcs', () => {
  const minimal = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc-123
SUMMARY:Team standup
DTSTART:20260723T100000Z
END:VEVENT
END:VCALENDAR`;

  it('parses a minimal VEVENT into an IcsEvent', () => {
    const [ev] = parseIcs(minimal);
    expect(ev.summary).toBe('Team standup');
    expect(ev.dtstart).toBe('20260723T100000Z');
    expect(ev.start).toBe('2026-07-23T10:00:00Z');
    expect(ev.uid).toBe('abc-123');
    expect(ev.attendees).toEqual([]);
  });

  it('extracts attendee CN names', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Sync
DTSTART:20260723T110000Z
ATTENDEE;CN=Alice Smith:mailto:alice@example.com
ATTENDEE;CN=Bob:mailto:bob@example.com
END:VEVENT
END:VCALENDAR`;
    const [ev] = parseIcs(ics);
    expect(ev.attendees).toEqual(['Alice Smith', 'Bob']);
  });

  it('falls back to mailto address when CN is absent', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Sync
DTSTART:20260723T110000Z
ATTENDEE:mailto:carol@example.com
END:VEVENT
END:VCALENDAR`;
    const [ev] = parseIcs(ics);
    expect(ev.attendees).toEqual(['carol@example.com']);
  });

  it('skips events with no parseable DTSTART', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Bad event
DTSTART:NOTADATE
END:VEVENT
END:VCALENDAR`;
    expect(parseIcs(ics)).toHaveLength(0);
  });

  it('uses "(untitled meeting)" when SUMMARY is absent', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20260723T120000Z
END:VEVENT
END:VCALENDAR`;
    const [ev] = parseIcs(ics);
    expect(ev.summary).toBe('(untitled meeting)');
  });

  it('handles RFC 5545 folded lines', () => {
    // A long SUMMARY folded with CRLF + space continuation
    const ics =
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Quarterly\r\n  Planning Review\r\nDTSTART:20260723T130000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
    const [ev] = parseIcs(ics);
    expect(ev.summary).toBe('Quarterly Planning Review');
  });

  it('unescapes RFC 5545 TEXT escaping in SUMMARY', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Design\\, Review\\; Q3
DTSTART:20260723T140000Z
END:VEVENT
END:VCALENDAR`;
    const [ev] = parseIcs(ics);
    expect(ev.summary).toBe('Design, Review; Q3');
  });

  it('parses multiple VEVENTs', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:First
DTSTART:20260723T080000Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:Second
DTSTART:20260723T090000Z
END:VEVENT
END:VCALENDAR`;
    const events = parseIcs(ics);
    expect(events).toHaveLength(2);
    expect(events[0].summary).toBe('First');
    expect(events[1].summary).toBe('Second');
  });
});
