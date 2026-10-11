import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseSettings } from '../src/config.js';

const doc = (pets: string, top = '') => `
timezone: America/New_York
group_chat_id: -1001
admins: [1]
${top}
pets:
${pets}`;

function problemsOf(yaml: string): string[] {
  try {
    parseSettings(yaml);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).problems;
  }
  throw new Error('expected ConfigError');
}

describe('fixA 2: reminders that quiet hours would swallow are rejected', () => {
  it('a round due inside quiet hours', () => {
    const pets = `  - name: Twiggy
    topic_id: 1
    rounds:
      - { name: Morning, due: "08:00", late_after: "10:00" }
      - { name: Late, due: "22:30", late_after: "23:30" }
`;
    const p = problemsOf(doc(pets));
    expect(p).toContain(
      'pets[0].rounds[1].due 22:30 is inside quiet hours 22:00-07:00, so its reminder would never be sent; move it or change quiet_hours',
    );
  });

  it('a round whose follow-up midpoint is inside quiet hours (late_after may be anywhere)', () => {
    const pets = `  - name: Twiggy
    topic_id: 1
    rounds:
      - { name: Night, due: "21:00", late_after: "23:30" }
`;
    const p = problemsOf(doc(pets));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^pets\[0\]\.rounds\[0\] follow-up time 22:15 .*inside quiet hours 22:00-07:00.*never be sent/);
  });

  it('late_after inside quiet hours is fine when due and midpoint are not', () => {
    const pets = `  - name: Twiggy
    topic_id: 1
    rounds:
      - { name: Evening, due: "19:00", late_after: "22:30" }
`;
    expect(() => parseSettings(doc(pets))).not.toThrow();
  });

  it('explicit monthly reminder times inside quiet hours', () => {
    const pets = `  - name: Faith
    topic_id: 2
    monthly_reminders: { morning: "06:00", evening: "23:00" }
`;
    const p = problemsOf(doc(pets));
    expect(p).toHaveLength(2);
    expect(p[0]).toContain('pets[0].monthly_reminders.morning 06:00 is inside quiet hours 22:00-07:00');
    expect(p[1]).toContain('pets[0].monthly_reminders.evening 23:00 is inside quiet hours 22:00-07:00');
  });

  it('default monthly times (09:00 / 18:00) are checked against custom quiet hours', () => {
    const pets = `  - { name: Faith, topic_id: 2 }\n`;
    const p = problemsOf(doc(pets, 'quiet_hours: { start: "17:00", end: "08:00" }'));
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('monthly_reminders.evening 18:00 is inside quiet hours 17:00-08:00');
  });

  it('honours custom quiet hours that do not wrap midnight', () => {
    const pets = `  - name: Twiggy
    topic_id: 1
    rounds:
      - { name: Noon, due: "13:00", late_after: "15:00" }
`;
    const p = problemsOf(doc(pets, 'quiet_hours: { start: "12:00", end: "14:00" }'));
    expect(p[0]).toContain('pets[0].rounds[0].due 13:00 is inside quiet hours 12:00-14:00');
  });

  it('start === end means no quiet hours', () => {
    const pets = `  - name: Twiggy
    topic_id: 1
    rounds:
      - { name: Night, due: "23:00", late_after: "23:50" }
`;
    expect(() => parseSettings(doc(pets, 'quiet_hours: { start: "07:00", end: "07:00" }'))).not.toThrow();
  });

  it('monthly morning must be before evening', () => {
    const pets = `  - name: Faith
    topic_id: 2
    monthly_reminders: { morning: "18:00", evening: "09:00" }
`;
    const p = problemsOf(doc(pets));
    expect(p).toEqual(['pets[0].monthly_reminders: morning (18:00) must be before evening (09:00)']);
  });

  it('monthly morning later than the defaulted evening is also caught', () => {
    const pets = `  - name: Faith
    topic_id: 2
    monthly_reminders: { morning: "19:00" }
`;
    expect(problemsOf(doc(pets))[0]).toContain('morning (19:00) must be before evening (18:00)');
  });

  it('is reported together with other problems', () => {
    const pets = `  - name: Twiggy
    topic_id: 1
    rounds:
      - { name: Night, due: "23:00", late_after: "23:50" }
      - { name: Bad, due: "x", late_after: "10:00" }
`;
    const p = problemsOf(doc(pets));
    expect(p.some((x) => x.includes('rounds[0].due 23:00 is inside quiet hours'))).toBe(true);
    expect(p.some((x) => x.includes('rounds[1].due'))).toBe(true);
  });

  it('settings.example.yaml still loads', () => {
    expect(() => parseSettings(readFileSync('settings.example.yaml', 'utf8'))).not.toThrow();
  });
});
