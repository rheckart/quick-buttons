import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { isLocalTime, isValidZone } from './time.js';
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

function buildPet(p: Parsed['pets'][number]): PetConfig {
  const rounds = p.rounds.map(buildRound).sort((a, b) => a.due.localeCompare(b.due));
  const hasSpread = rounds.length >= 2;
  return {
    id: p.id ?? slug(p.name),
    name: p.name,
    topicId: p.topic_id,
    rounds,
    monthlyMorning: p.monthly_reminders?.morning ?? (hasSpread ? rounds[0]!.due : DEFAULTS.monthlyMorning),
    monthlyEvening: p.monthly_reminders?.evening ?? (hasSpread ? rounds[rounds.length - 1]!.due : DEFAULTS.monthlyEvening),
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

function roundProblems(rounds: unknown[], petPath: string): string[] {
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
  });
  return problems;
}

function petProblems(pets: unknown[]): string[] {
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
    problems.push(...roundProblems(asArray(p.rounds), path));
  });
  return problems;
}

function crossProblems(raw: unknown): string[] {
  return isRecord(raw) ? petProblems(asArray(raw.pets)) : [];
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
