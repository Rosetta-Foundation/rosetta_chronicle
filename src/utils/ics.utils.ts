/**
 * Pure iCalendar (RFC 5545) parsing helpers. No I/O, no DI. Deliberately
 * minimal — enough to pull the day's meetings out of a `.ics` export
 * (`SUMMARY`, `DTSTART`, `ATTENDEE`), not a full calendar implementation.
 */

/** A single parsed calendar event. */
export interface IcsEvent {
  /** Event title (SUMMARY), or a fallback when absent. */
  summary: string;
  /** Raw DTSTART value as it appeared (e.g. `20260723T140000Z` or `20260723`). */
  dtstart: string;
  /** ISO-8601 start timestamp derived from DTSTART. */
  start: string;
  /** Attendee display names / emails (from ATTENDEE properties). */
  attendees: string[];
  /** Stable-ish identifier: the event UID when present, else derived. */
  uid?: string;
}

/**
 * Unfold RFC 5545 folded lines: a CRLF (or LF) followed by a space or tab is a
 * continuation of the previous line. Applied before property parsing.
 */
const unfold = (raw: string): string[] => {
  const out: string[] = [];
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
};

/**
 * Split an unfolded content line into its property name (before `;` params or
 * `:`) and value (after the first unquoted `:`). Returns null for blank lines.
 */
const splitProp = (line: string): { name: string; value: string } | null => {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const namePart = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const name = namePart.split(';')[0].toUpperCase();
  return { name, value };
};

/**
 * Convert an iCalendar DTSTART value to an ISO-8601 timestamp.
 * Handles `YYYYMMDDTHHMMSSZ` (UTC), `YYYYMMDDTHHMMSS` (floating/local), and
 * date-only `YYYYMMDD`. Returns null if it doesn't match a known shape.
 */
export const icsDateToIso = (value: string): string | null => {
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (dateTime) {
    const [, y, mo, d, h, mi, s, z] = dateTime;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`;
  }
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return `${y}-${mo}-${d}T00:00:00`;
  }
  return null;
};

/** Extract a human name from an ATTENDEE line's params/value (CN= or mailto:). */
const attendeeName = (line: string): string => {
  const cn = /[;:]CN=([^;:]+)/i.exec(line);
  if (cn) return cn[1].replace(/^"|"$/g, '').trim();
  const mailto = /mailto:([^\s;:]+)/i.exec(line);
  if (mailto) return mailto[1].trim();
  return line.trim();
};

/**
 * Parse iCalendar text into events. Only `VEVENT` blocks are considered; each
 * yields one {@link IcsEvent}. Events without a parseable DTSTART are skipped.
 */
export const parseIcs = (raw: string): IcsEvent[] => {
  const lines = unfold(raw);
  const events: IcsEvent[] = [];

  let inEvent = false;
  let summary: string | undefined;
  let dtstart: string | undefined;
  let uid: string | undefined;
  let attendees: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      summary = dtstart = uid = undefined;
      attendees = [];
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (inEvent && dtstart) {
        const start = icsDateToIso(dtstart);
        if (start) {
          events.push({
            summary: summary?.trim() || '(untitled meeting)',
            dtstart,
            start,
            attendees,
            ...(uid ? { uid } : {}),
          });
        }
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const prop = splitProp(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'SUMMARY':
        summary = unescapeText(prop.value);
        break;
      case 'DTSTART':
        dtstart = prop.value.trim();
        break;
      case 'UID':
        uid = prop.value.trim();
        break;
      case 'ATTENDEE':
        attendees.push(attendeeName(line));
        break;
    }
  }

  return events;
};

/** Unescape RFC 5545 TEXT escaping (`\,` `\;` `\n` `\\`). */
const unescapeText = (v: string): string =>
  v
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
