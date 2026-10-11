import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadSettings, parseSettings } from '../src/config.js';

const BASE = `
timezone: America/New_York
group_chat_id: -1001
admins: [1, 2]
givers:
  - { user_id: 1, name: Rob }
pets:
  - name: Twiggy
    topic_id: 11
    rounds:
      - { name: Evening, due: "18:00", late_after: "20:00" }
      - { name: Morning, due: "08:00", late_after: "10:00" }
`;

/** Replace the pets block of BASE. */
const withPets = (pets: string) => BASE.slice(0, BASE.indexOf('pets:')) + pets;
/** Insert extra top-level YAML before the pets block of BASE. */
const withTop = (extra: string) => BASE.replace('pets:', `${extra}\npets:`);

function problemsOf(yaml: string): string[] {
  try {
    parseSettings(yaml);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).problems;
  }
  throw new Error('expected ConfigError');
}

describe('parseSettings: valid', () => {
  it('maps keys and derives round and pet fields', () => {
    const s = parseSettings(BASE);
    expect(s.timezone).toBe('America/New_York');
    expect(s.groupChatId).toBe(-1001);
    expect(s.admins).toEqual([1, 2]);
    expect(s.givers).toEqual([{ userId: 1, name: 'Rob' }]);
    const pet = s.pets[0]!;
    expect(pet).toMatchObject({ id: 'twiggy', name: 'Twiggy', topicId: 11 });
    expect(pet.rounds).toEqual([
      { key: 'morning', name: 'Morning', emoji: '☀️', due: '08:00', lateAfter: '10:00' },
      { key: 'evening', name: 'Evening', emoji: '🌙', due: '18:00', lateAfter: '20:00' },
    ]);
  });

  it('applies defaults', () => {
    const s = parseSettings(BASE);
    expect(s.quietHours).toEqual({ start: '22:00', end: '07:00' });
    expect(s.backupChatId).toBe(1);
    expect(s.backupTime).toBe('03:00');
    expect(s.pets[0]).toMatchObject({ monthlyMorning: '08:00', monthlyEvening: '18:00' });
  });

  it('uses 09:00 / 18:00 monthly defaults with fewer than two rounds', () => {
    const none = parseSettings(withPets('pets:\n  - { name: Faith, topic_id: 22 }\n')).pets[0]!;
    expect(none.rounds).toEqual([]);
    expect([none.monthlyMorning, none.monthlyEvening]).toEqual(['09:00', '18:00']);
    const one = parseSettings(
      withPets('pets:\n  - { name: Faith, topic_id: 22, rounds: [{ name: Noon, due: "12:30", late_after: "14:00" }] }\n'),
    ).pets[0]!;
    expect([one.monthlyMorning, one.monthlyEvening]).toEqual(['09:00', '18:00']);
    expect(one.rounds[0]!.emoji).toBe('🌤️');
  });

  it('honours explicit overrides', () => {
    const s = parseSettings(
      withTop('quiet_hours: { start: "23:00", end: "06:30" }\nbackup: { chat_id: 99, time: "04:15" }').replace(
        '    rounds:',
        '    id: twig\n    monthly_reminders: { morning: "07:00" }\n    rounds:',
      ),
    );
    expect(s.quietHours).toEqual({ start: '23:00', end: '06:30' });
    expect(s.backupChatId).toBe(99);
    expect(s.backupTime).toBe('04:15');
    expect(s.pets[0]).toMatchObject({ id: 'twig', monthlyMorning: '07:00', monthlyEvening: '18:00' });
  });

  it('uses an explicit emoji and slugs round and pet names', () => {
    const s = parseSettings(
      withPets(`pets:
  - name: Mr. Café Cat
    topic_id: 5
    rounds: [{ name: "Late Night!", emoji: "💤", due: "21:00", late_after: "22:00" }]
`),
    );
    expect(s.pets[0]!.id).toBe('mr-cafe-cat');
    expect(s.pets[0]!.rounds[0]).toMatchObject({ key: 'late-night', emoji: '💤' });
  });
});

describe('parseSettings: validation', () => {
  it('rejects a bad time zone', () => {
    expect(problemsOf(BASE.replace('America/New_York', 'Mars/Olympus'))).toEqual([
      expect.stringContaining('timezone: unknown time zone "Mars/Olympus"'),
    ]);
  });

  it('rejects a bad HH:MM with its path', () => {
    const p = problemsOf(BASE.replace('"08:00"', '"8:00"'));
    expect(p).toEqual([expect.stringMatching(/^pets\[0\]\.rounds\[1\]\.due: must be a 24h time.*"8:00"/)]);
  });

  it('rejects a bad quiet-hours time', () => {
    const p = problemsOf(withTop('quiet_hours: { start: "25:00", end: "07:00" }'));
    expect(p.join('\n')).toContain('quiet_hours.start');
  });

  it('rejects late_after at or before due', () => {
    const equal = problemsOf(BASE.replace('late_after: "10:00"', 'late_after: "08:00"'));
    expect(equal).toEqual([expect.stringContaining('pets[0].rounds[1].late_after: must be after due (08:00)')]);
    const before = problemsOf(BASE.replace('late_after: "10:00"', 'late_after: "07:00"'));
    expect(before).toHaveLength(1);
  });

  it('rejects duplicate pet ids', () => {
    const p = problemsOf(withPets('pets:\n  - { name: Twiggy, topic_id: 1 }\n  - { name: "twiggy!", topic_id: 2 }\n'));
    expect(p).toEqual(['pets[1]: duplicate pet id "twiggy" (also pets[0])']);
  });

  it('rejects duplicate round keys within a pet', () => {
    const p = problemsOf(
      withPets(`pets:
  - name: Twiggy
    topic_id: 1
    rounds:
      - { name: Morning, due: "08:00", late_after: "09:00" }
      - { name: "morning ", due: "10:00", late_after: "11:00" }
`),
    );
    expect(p).toEqual([expect.stringContaining('pets[0].rounds[1].name: round name "morning" repeats pets[0].rounds[0]')]);
  });

  it('allows the same round name on different pets', () => {
    const round = 'rounds: [{ name: Morning, due: "08:00", late_after: "09:00" }]';
    expect(() => parseSettings(withPets(`pets:\n  - { name: A, topic_id: 1, ${round} }\n  - { name: B, topic_id: 2, ${round} }\n`))).not.toThrow();
  });

  it('rejects no pets', () => {
    expect(problemsOf(withPets('pets: []\n'))).toEqual(['pets: needs at least one pet']);
  });

  it('rejects empty admins', () => {
    expect(problemsOf(BASE.replace('admins: [1, 2]', 'admins: []'))).toEqual(['admins: needs at least one admin']);
  });

  it('rejects duplicate topic ids', () => {
    const p = problemsOf(withPets('pets:\n  - { name: A, topic_id: 7 }\n  - { name: B, topic_id: 7 }\n'));
    expect(p).toEqual(['pets[1].topic_id: duplicate topic id 7 (also pets[0])']);
  });

  it('rejects non-integer ids', () => {
    const p = problemsOf(
      BASE.replace('group_chat_id: -1001', 'group_chat_id: -10.5').replace('admins: [1, 2]', 'admins: [1, "two"]').replace('topic_id: 11', 'topic_id: 1.5'),
    );
    expect(p.map((x) => x.split(':')[0])).toEqual(['group_chat_id', 'admins[1]', 'pets[0].topic_id']);
  });

  it('rejects unknown keys so typos are caught', () => {
    const p = problemsOf(BASE.replace('timezone:', 'timezoen: x\ntimezone:').replace('late_after: "10:00"', 'late_after: "10:00", emojii: x'));
    expect(p).toHaveLength(2);
    expect(p.join('\n')).toContain('"timezoen"');
    expect(p.join('\n')).toContain('pets[0].rounds[1]');
    expect(p.join('\n')).toContain('"emojii"');
  });

  it('rejects an empty file and invalid YAML', () => {
    expect(problemsOf('')).toHaveLength(1);
    expect(problemsOf('pets: [unclosed')[0]).toMatch(/^not valid YAML/);
  });

  it('reports every problem together, one per line', () => {
    const yaml = `
timezone: Nowhere/Land
group_chat_id: abc
admins: []
pets:
  - name: Twiggy
    topic_id: 3
    rounds:
      - { name: Morning, due: "9am", late_after: "10:00" }
      - { name: Evening, due: "18:00", late_after: "17:00" }
  - name: Twiggy
    topic_id: 3
`;
    let err: ConfigError | undefined;
    try {
      parseSettings(yaml);
    } catch (e) {
      err = e as ConfigError;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect(err!.problems).toHaveLength(7);
    const lines = err!.message.split('\n');
    expect(lines[0]).toBe('Invalid settings (7 problems):');
    expect(lines).toHaveLength(8);
    for (const needle of ['timezone', 'group_chat_id', 'admins', 'rounds[0].due', 'rounds[1].late_after', 'duplicate pet id', 'duplicate topic id']) {
      expect(err!.message).toContain(needle);
    }
  });
});

describe('loadSettings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'petmeds-config-'));

  it('loads a file from disk', () => {
    const path = join(dir, 'settings.yaml');
    writeFileSync(path, BASE);
    expect(loadSettings(path).pets[0]!.id).toBe('twiggy');
  });

  it('reports a missing file clearly', () => {
    const path = join(dir, 'nope.yaml');
    expect(() => loadSettings(path)).toThrow(ConfigError);
    expect(() => loadSettings(path)).toThrow(/cannot read settings file .*nope\.yaml/);
  });

  it('parses settings.example.yaml', () => {
    const s = loadSettings(new URL('../settings.example.yaml', import.meta.url).pathname);
    expect(s.pets.map((p) => p.id)).toEqual(['twiggy', 'faith']);
    expect(s.pets[0]!.rounds.map((r) => [r.key, r.due, r.lateAfter])).toEqual([
      ['morning', '08:00', '10:00'],
      ['evening', '18:00', '20:00'],
    ]);
    expect(s.pets[1]!.rounds).toEqual([]);
    expect(s.admins).toHaveLength(2);
  });
});
