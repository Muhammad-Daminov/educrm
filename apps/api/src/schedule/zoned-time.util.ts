/**
 * Local wall-clock time in a named IANA timezone <-> UTC instants.
 *
 * Lessons are stored as `timestamptz` (an instant) but authored as wall
 * clock time in the branch's timezone: a rule says "Monday 18:00", and
 * 18:00 means 18:00 to the teacher standing in the classroom. Converting
 * one to the other needs the zone's offset *at that moment*, which is not a
 * constant in general — Asia/Tashkent has no DST today, but `Branch.timezone`
 * is a free-text IANA zone and nothing stops a tenant from being in one
 * that does.
 *
 * Implemented on `Intl.DateTimeFormat` rather than a date library because
 * the ICU data is already in Node and this is the whole requirement.
 */

/** Minutes a zone is ahead of UTC at a given instant. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? 0 : Number(found.value);
  };

  // What the wall clock in `timeZone` reads, re-read as if it were UTC. The
  // gap between that and the real instant *is* the offset.
  const asIfUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  return (asIfUtc - instant.getTime()) / 60_000;
}

/** `HH:MM` -> minutes since midnight. */
export function parseClockTime(time: string): number {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(time);
  if (match === null) {
    throw new RangeError(`Not an HH:MM clock time: ${time}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since midnight -> `HH:MM`. Wraps past 24h (an evening lesson
 * whose length pushes it past midnight is a data error, not a rollover), so
 * callers get a visibly wrong time rather than a silently shifted one. */
export function formatClockTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * The UTC instant at which `HH:MM` on `date` (a `YYYY-MM-DD` local calendar
 * date) occurs in `timeZone`.
 *
 * Two passes: the first guesses the offset by pretending the wall time is
 * UTC, the second re-reads the offset at the instant that guess produced.
 * One pass is wrong near a DST transition (the offset applicable to the
 * guessed instant can differ from the real one); two converge for every
 * real-world zone, because offsets change by at most an hour or two and
 * never twice within the same day.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const naive = Date.parse(`${date}T${time}:00.000Z`);
  if (Number.isNaN(naive)) {
    throw new RangeError(`Not a YYYY-MM-DD / HH:MM pair: ${date} ${time}`);
  }

  let instant = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    instant = naive - zoneOffsetMinutes(new Date(instant), timeZone) * 60_000;
  }
  return new Date(instant);
}

/** The `YYYY-MM-DD` local calendar date an instant falls on in `timeZone`. */
export function utcToZonedDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  // en-CA formats as YYYY-MM-DD, which is what we want verbatim.
  return parts;
}

/** The `HH:MM` local wall-clock time an instant reads in `timeZone`. */
export function utcToZonedTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}
