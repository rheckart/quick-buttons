import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { inQuietHours, instantAt, isLocalTime, isValidZone, midpoint, type QuietHours } from './time.js';
import type { LocalTime, PetConfig, RoundConfig, Settings } from './types.js';

/** One error listing every problem found in the settings file, one per line. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid settings (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const DEFAULTS = {
  quietHours: { start: '22:00', end: '07:00' },
  backupTime: '03:00',
  monthlyMorning: '09:00',
  monthlyEvening: '18:00',
};

// ───────────────────────── Shape (zod) ─────────────────────────

const time = z.string().refine(isLocalTime, {
  error: (iss) => `must be a 24h time like "08:00", got ${JSON.stringify(iss.input)}`,
});
const userId = z.int();
const name = z.string().trim().min(1, 'must not be empty');

const roundSchema = z.strictObject({
  name,
  emoji: z.string().min(1).optional(),
  due: time,
  late_after: time,
});

const petSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase letters, digits and dashes').optional(),
  name,
  topic_id: userId,
  rounds: z.array(roundSchema).default([]),
  monthly_reminders: z.strictObject({ morning: time.optional(), evening: time.optional() }).optional(),
});

const settingsSchema = z.strictObject({
  timezone: z.string().refine(isValidZone, {
    error: (iss) => `unknown time zone ${JSON.stringify(iss.input)} (use a name like "America/New_York")`,
  }),
  group_chat_id: userId,
  admins: z.array(userId).min(1, 'needs at least one admin'),
  givers: z.array(z.strictObject({ user_id: userId, name })).default([]),
  quiet_hours: z.strictObject({ start: time, end: time }).optional(),
  backup: z.strictObject({ chat_id: userId.optional(), time: time.optional() }).optional(),
  pets: z.array(petSchema).min(1, 'needs at least one pet'),
});

type Parsed = z.infer<typeof settingsSchema>;

// ───────────────────────── Derivations ─────────────────────────

export function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultEmoji(due: LocalTime): string {
  if (due < '12:00') return '☀️';
  if (due < '17:00') return '🌤️';
  return '🌙';
}

function buildRound(r: Parsed['pets'][number]['rounds'][number]): RoundConfig {
  return { key: slug(r.name), name: r.name, emoji: r.emoji ?? defaultEmoji(r.due), due: r.due, lateAfter: r.late_after };
}

/** Monthly reminder times when not set: earliest / latest round due (two or more rounds), else 09:00 / 18:00. */
function monthlyDefaults(dues: LocalTime[]): { morning: LocalTime; evening: LocalTime } {
  if (dues.length < 2) return { morning: DEFAULTS.monthlyMorning, evening: DEFAULTS.monthlyEvening };
  const sorted = [...dues].sort();
  return { morning: sorted[0]!, evening: sorted[sorted.length - 1]! };
}

function buildPet(p: Parsed['pets'][number]): PetConfig {
  const rounds = p.rounds.map(buildRound).sort((a, b) => a.due.localeCompare(b.due));
  const defaults = monthlyDefaults(rounds.map((r) => r.due));
  return {
    id: p.id ?? slug(p.name),
    name: p.name,
    topicId: p.topic_id,
    rounds,
    monthlyMorning: p.monthly_reminders?.morning ?? defaults.morning,
    monthlyEvening: p.monthly_reminders?.evening ?? defaults.evening,
  };
}

function build(p: Parsed): Settings {
  return {
    timezone: p.timezone,
    groupChatId: p.group_chat_id,
    admins: [...new Set(p.admins)],
    givers: p.givers.map((g) => ({ userId: g.user_id, name: g.name })),
    pets: p.pets.map(buildPet),
    quietHours: p.quiet_hours ?? DEFAULTS.quietHours,
    backupChatId: p.backup?.chat_id ?? p.admins[0]!,
    backupTime: p.backup?.time ?? DEFAULTS.backupTime,
  };
}

// ───────────────────────── Cross-field checks ─────────────────────────
// Run on the raw document, tolerating bad shapes, so one run reports shape errors
// and these checks together (zod skips object-level refinements when a field is invalid).

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Records `value` under `seen`; returns the path where it first appeared if it is a repeat. */
function firstSeen<T>(seen: Map<T, string>, value: T, path: string): string | undefined {
  const earlier = seen.get(value);
  if (earlier === undefined) seen.set(value, path);
  return earlier;
}

/** Is a wall-clock time inside quiet hours? (Pure clock arithmetic: any date in a fixed zone will do.) */
function quietAt(t: LocalTime, q: QuietHours): boolean {
  return inQuietHours(instantAt('2026-01-01', t, 'UTC'), q, 'UTC');
}

const quietProblem = (what: string, t: LocalTime, q: QuietHours, effect: string, extra = ''): string =>
  `${what} ${t} is inside quiet hours ${q.start}-${q.end}, so its ${effect} would never be sent${extra}; move it or change quiet_hours`;

function roundProblems(rounds: unknown[], petPath: string, quiet: QuietHours | null): string[] {
  const problems: string[] = [];
  const keys = new Map<string, string>();
  rounds.forEach((r, i) => {
    if (!isRecord(r)) return;
    const path = `${petPath}.rounds[${i}]`;
    const roundName = asString(r.name)?.trim();
    if (roundName) {
      const key = slug(roundName);
      if (!key) problems.push(`${path}.name: must contain a letter or digit`);
      else {
        const earlier = firstSeen(keys, key, path);
        if (earlier) problems.push(`${path}.name: round name "${roundName}" repeats ${earlier} (both become "${key}")`);
      }
    }
    const due = asString(r.due);
    const late = asString(r.late_after);
    if (due && late && isLocalTime(due) && isLocalTime(late) && late <= due) {
      problems.push(`${path}.late_after: must be after due (${due}), got "${late}"`);
    }
    // The planner only looks at today's date, so a reminder that falls in quiet hours waits past midnight
    // and is never sent. (late_after may be anywhere: it only marks LATE, nothing is sent.)
    if (quiet && due && isLocalTime(due) && quietAt(due, quiet)) {
      problems.push(quietProblem(`${path}.due`, due, quiet, 'reminder'));
    }
    if (quiet && due && late && isLocalTime(due) && isLocalTime(late) && late > due) {
      const mid = midpoint(due, late);
      if (quietAt(mid, quiet)) {
        const what = `${path} follow-up time`;
        problems.push(quietProblem(what, mid, quiet, 'follow-up', ` (halfway between due ${due} and late_after ${late})`));
      }
    }
  });
  return problems;
}

function monthlyProblems(p: Raw, petPath: string, quiet: QuietHours | null): string[] {
  const problems: string[] = [];
  const rm = isRecord(p.monthly_reminders) ? p.monthly_reminders : {};
  const dues = asArray(p.rounds)
    .map((r) => (isRecord(r) ? asString(r.due) : undefined))
    .filter((d): d is string => d !== undefined && isLocalTime(d));
  const defaults = monthlyDefaults(dues);
  const explicit = { morning: asString(rm.morning), evening: asString(rm.evening) };
  const eff = { morning: explicit.morning ?? defaults.morning, evening: explicit.evening ?? defaults.evening };
  for (const which of ['morning', 'evening'] as const) {
    const t = eff[which];
    if (!quiet || !isLocalTime(t)) continue;
    // Defaults taken from round dues are already covered by the round's own check.
    const fromRounds = explicit[which] === undefined && dues.length >= 2;
    if (fromRounds || !quietAt(t, quiet)) continue;
    const hint = explicit[which] === undefined ? ` (the default; set monthly_reminders.${which})` : '';
    problems.push(quietProblem(`${petPath}.monthly_reminders.${which}`, t, quiet, 'reminder', hint));
  }
  if (isLocalTime(eff.morning) && isLocalTime(eff.evening) && eff.morning >= eff.evening) {
    problems.push(`${petPath}.monthly_reminders: morning (${eff.morning}) must be before evening (${eff.evening})`);
  }
  return problems;
}

function petProblems(pets: unknown[], quiet: QuietHours | null): string[] {
  const problems: string[] = [];
  const ids = new Map<string, string>();
  const topics = new Map<number, string>();
  pets.forEach((p, i) => {
    if (!isRecord(p)) return;
    const path = `pets[${i}]`;
    const petName = asString(p.name)?.trim();
    const id = asString(p.id) ?? (petName ? slug(petName) : undefined);
    if (id !== undefined) {
      if (!id) problems.push(`${path}.name: must contain a letter or digit`);
      else {
        const earlier = firstSeen(ids, id, path);
        if (earlier) problems.push(`${path}: duplicate pet id "${id}" (also ${earlier})`);
      }
    }
    if (Number.isInteger(p.topic_id)) {
      const earlier = firstSeen(topics, p.topic_id as number, path);
      if (earlier) problems.push(`${path}.topic_id: duplicate topic id ${String(p.topic_id)} (also ${earlier})`);
    }
    problems.push(...roundProblems(asArray(p.rounds), path, quiet), ...monthlyProblems(p, path, quiet));
  });
  return problems;
}

/** The quiet-hours window to check against: the file's own if well-formed, the default if absent, else null. */
function rawQuietHours(raw: Raw): QuietHours | null {
  if (raw.quiet_hours === undefined) return DEFAULTS.quietHours;
  const q = raw.quiet_hours;
  const [start, end] = isRecord(q) ? [asString(q.start), asString(q.end)] : [];
  return start !== undefined && end !== undefined && isLocalTime(start) && isLocalTime(end) ? { start, end } : null;
}

function crossProblems(raw: unknown): string[] {
  return isRecord(raw) ? petProblems(asArray(raw.pets), rawQuietHours(raw)) : [];
}

// ───────────────────────── Public API ─────────────────────────

function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return '(top level)';
  return path.reduce<string>((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)), '');
}

export function parseSettings(yamlText: string): Settings {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new ConfigError([`not valid YAML: ${err instanceof Error ? err.message : String(err)}`]);
  }
  const result = settingsSchema.safeParse(raw);
  const shape = result.success ? [] : result.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`);
  const problems = [...shape, ...crossProblems(raw)];
  if (problems.length > 0 || !result.success) throw new ConfigError(problems);
  return build(result.data);
}

export function loadSettings(path: string): Settings {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new ConfigError([`cannot read settings file ${path}: ${why}`]);
  }
  return parseSettings(text);
}
