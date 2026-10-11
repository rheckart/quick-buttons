import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../src/service/index.js';
import { BOT_USER, Chat, DANI, KID, labels, makeAdminKit, ROB } from './bot.admin.kit.js';
import type { AdminKit, Msg } from './bot.admin.kit.js';
import { seedDayOneMeds } from './helpers/harness.js';

let kit: AdminKit;
let rob: Chat;

beforeEach(async () => {
  kit = await makeAdminKit();
  rob = kit.chat(ROB);
});
afterEach(() => kit.close());

const activeMeds = async (petId: string) => (await kit.service.listMeds(petId)).map((m) => m.name);
const medNamed = async (petId: string, name: string) => (await kit.service.listMeds(petId)).find((m) => m.name === name)!;
/** Messages posted in a pet's topic of the group. */
const topic = (id: number) => kit.tg.messages.filter((m) => m.chatId === kit.h.settings.groupChatId && m.threadId === id).map((m) => m.text);

/** Opens the menu, Start, and returns the draft card message. */
async function newCard(): Promise<Msg> {
  const menu = await rob.openMenu();
  await rob.tap(menu, 'Start');
  return menu;
}

/** Taps a card button that asks for typed text, then types the answer. */
async function type(card: Msg, button: string, text: string): Promise<void> {
  await rob.tap(card, button);
  await rob.say(text);
}

describe('the menu', () => {
  it('any message, /start and /menu from an admin in private chat shows the menu', async () => {
    for (const text of ['hello', '/start', '/menu', '/start@PetMedsBot']) {
      await rob.say(text);
      expect(rob.screen.text).toBe('What do you want to change?');
      expect(labels(rob.screen)).toEqual(['➕ Start', '⏹ Stop', '✏️ Edit', '📜 Fix a past log']);
    }
    expect(kit.tg.live(ROB.id)).toHaveLength(4);
  });

  it('other commands (like /ids) and unrelated chats are passed on, not answered', async () => {
    await rob.say('/ids');
    await kit.chat(ROB, -100).say('hello');
    await kit.chat(ROB, -100).say('/menu');
    expect(kit.tg.messages).toEqual([]);
    expect(kit.passedOn).toHaveLength(3);
  });

  it('a second admin gets the menu too', async () => {
    await kit.chat(DANI).say('hi');
    expect(kit.tg.last(DANI.id).text).toBe('What do you want to change?');
  });
});

describe('non-admins', () => {
  it('get nothing from this flow: messages are passed on', async () => {
    const kid = kit.chat(KID);
    await kid.say('hi');
    await kid.say('/menu');
    expect(kit.tg.messages).toEqual([]);
    expect(kit.passedOn).toHaveLength(2);
  });

  it('their admin taps are answered silently and change nothing', async () => {
    const menu = await rob.openMenu();
    const kid = kit.chat(KID, ROB.id); // the same chat, a different person: cannot happen in Telegram, but be safe
    const answer = await kid.tap(menu, 'Start');
    expect(answer).toEqual({ text: undefined, alert: false });
    expect(menu.text).toBe('What do you want to change?');
    expect(menu.edits).toBe(0);
  });

  it('an admin tap from a group chat is answered silently and ignored', async () => {
    const msg = { chatId: -100, id: 1, threadId: null, text: '', keyboard: [], forceReply: false, deleted: false, edits: 0 };
    const answer = await kit.chat(ROB, -100).tapData(msg, 'ad:menu:start');
    expect(answer).toEqual({ text: undefined, alert: false });
    expect(kit.tg.count('editMessageText')).toBe(0);
  });
});

describe('Start: the day-one meds', () => {
  it('Twiggy antibiotic: a 10-day course, morning + evening, Started on 1 Oct', async () => {
    const menu = await newCard();
    // The card is the menu message, edited in place.
    expect(rob.screen).toBe(menu);
    expect(menu.text).toContain('New med');
    expect(menu.text).toContain('Pet: —');
    expect(labels(menu)).toContain('✅ Start (fill in: Pet, Name, Kind)');

    await rob.tap(menu, 'Pet');
    expect(labels(menu)).toEqual(expect.arrayContaining(['Twiggy', 'Faith', 'Cancel']));
    await rob.tap(menu, 'Twiggy');
    expect(menu.text).toContain('Pet: Twiggy');

    await rob.tap(menu, 'Name');
    expect(menu.text).toBe('Type the name of the med (up to 40 characters).');
    await rob.say('Antibiotic');
    expect(menu.text).toContain('Name: Antibiotic');
    expect(kit.tg.count('deleteMessage')).toBe(1); // the typed answer is tidied away

    await rob.tap(menu, 'Kind');
    await rob.tap(menu, 'Course');
    expect(menu.text).toContain('Kind: course');
    expect(labels(menu)).toEqual(expect.arrayContaining(['Rounds', 'Days', 'Started on']));

    await rob.tap(menu, 'Rounds');
    await rob.tap(menu, 'Morning');
    await rob.tap(menu, 'Evening');
    expect(labels(menu).filter((l) => l.startsWith('✅'))).toEqual(['✅ ☀️ Morning', '✅ 🌙 Evening', '✅ Done']);
    await rob.tap(menu, 'Done');
    expect(menu.text).toContain('Rounds: Morning + Evening');

    await type(menu, 'Days', '10');
    expect(menu.text).toContain('Days: 10');
    expect(menu.text).toContain('Started on: first dose');
    await type(menu, 'Started on', '1 Oct');
    expect(menu.text).toContain('Started on: Thu 1 Oct');
    expect(labels(menu)).toContain('✅ Start');

    expect(await rob.tap(menu, '✅ Start')).toEqual({ text: undefined, alert: false });

    const med = await medNamed('twiggy', 'Antibiotic');
    expect(med).toMatchObject({ kind: 'course', days: 10, startedOn: '2026-10-01', roundKeys: ['morning', 'evening'], doseNote: null });
    expect(topic(11)).toContain('Rob started Antibiotic: 10 days, morning + evening');
    // The card becomes the confirmation and the menu is offered again.
    expect(menu.text).toContain('✅ You started Antibiotic: 10 days, morning + evening');
    expect(menu.keyboard).toEqual([]);
    expect(rob.screen.text).toBe('What do you want to change?');
    expect(rob.screen).not.toBe(menu);
  });

  it('Twiggy eye drops: ongoing in the morning with a dose note', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Twiggy');
    await type(card, 'Name', 'Eye drops');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Ongoing');
    expect(labels(card)).not.toContain('Days');
    await rob.tap(card, 'Rounds');
    await rob.tap(card, 'Morning');
    await rob.tap(card, 'Done');
    await type(card, 'Dose note', '2 drops each eye');
    expect(card.text).toContain('Dose note: 2 drops each eye');
    await rob.tap(card, '✅ Start');

    expect(await medNamed('twiggy', 'Eye drops')).toMatchObject({ kind: 'ongoing', roundKeys: ['morning'], doseNote: '2 drops each eye', days: null });
    expect(topic(11)).toContain('Rob started Eye drops: daily, morning — "2 drops each eye"');
  });

  it('Simparica for both pets: monthly with Last given', async () => {
    for (const [pet, last, expected] of [['Twiggy', '14 Sep', '2026-09-14'], ['Faith', '3 weeks ago', null]] as const) {
      const card = await newCard();
      await rob.tap(card, 'Pet');
      await rob.tap(card, pet);
      await type(card, 'Name', 'Simparica Trio');
      await rob.tap(card, 'Kind');
      await rob.tap(card, 'Monthly');
      expect(labels(card)).toEqual(expect.arrayContaining(['Last given']));
      expect(labels(card)).not.toContain('Rounds');
      await rob.tap(card, 'Last given');
      await rob.say(last);
      if (expected) {
        expect(card.text).toContain('Last given: Mon 14 Sep');
      } else {
        expect(card.text).toContain('⚠️'); // "3 weeks ago" is not a form we read
        expect(card.text).toContain('could not read');
        await rob.say('20 Sep');
        expect(card.text).toContain('Last given: Sun 20 Sep');
      }
      await rob.tap(card, '✅ Start');
    }
    const twiggy = await medNamed('twiggy', 'Simparica Trio');
    const faith = await medNamed('faith', 'Simparica Trio');
    expect([twiggy.seedLastGiven, faith.seedLastGiven]).toEqual(['2026-09-14', '2026-09-20']);
    expect(topic(12)).toContain('Rob started Simparica Trio: monthly');
  });

  it('an as-needed med needs only a pet, a name and a kind', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Faith');
    await type(card, 'Name', 'Ear cleaner');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'As needed');
    await rob.tap(card, '✅ Start');
    expect(await activeMeds('faith')).toEqual(['Ear cleaner']);
  });
});

describe('Start: the card', () => {
  it('Start does nothing until the card is complete', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Twiggy');
    const answer = await rob.tap(card, '✅ Start');
    expect(answer.text).toBe('Still to fill in: Name, Kind');
    expect(await activeMeds('twiggy')).toEqual([]);
    expect(card.text).toContain('New med');
  });

  it('changing the kind drops the fields that no longer apply', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Twiggy');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Course');
    await rob.tap(card, 'Rounds');
    await rob.tap(card, 'Morning');
    await rob.tap(card, 'Done');
    await type(card, 'Days', '5');
    await type(card, 'Started on', 'yesterday');
    await type(card, 'Dose note', 'with food');

    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Ongoing');
    expect(card.text).toContain('Rounds: Morning');
    expect(card.text).not.toContain('Days');
    expect(card.text).not.toContain('Started on');
    expect(card.text).toContain('Dose note: with food');

    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Monthly');
    expect(card.text).not.toContain('Rounds');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Course');
    expect(card.text).toContain('Rounds: —');
    expect(card.text).toContain('Days: —');
    expect(card.text).toContain('Started on: first dose');
  });

  it('changing the pet drops the rounds', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Twiggy');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Ongoing');
    await rob.tap(card, 'Rounds');
    await rob.tap(card, 'Evening');
    await rob.tap(card, 'Done');
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Faith');
    expect(card.text).toContain('Pet: Faith');
    expect(card.text).toContain('Rounds: —');
  });

  it('a pet with no rounds says so instead of showing an empty list', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Faith');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Ongoing');
    const answer = await rob.tap(card, 'Rounds');
    expect(answer).toMatchObject({ alert: true });
    expect(answer.text).toContain('Faith has no rounds');
    expect(card.text).toContain('New med');
  });

  it('Rounds needs a pet first', async () => {
    const card = await newCard();
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Ongoing');
    expect((await rob.tap(card, 'Rounds')).text).toBe('Pick a pet first.');
  });

  it('« Back from a choice returns to the card; Cancel clears the draft and shows the menu', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, '« Back');
    expect(card.text).toContain('New med');
    await rob.tap(card, 'Kind');
    await rob.tap(card, '« Back');
    await type(card, 'Name', 'Thing');
    await rob.tap(card, 'Name');
    await rob.tap(card, '« Back');
    expect(card.text).toContain('Name: Thing');

    await rob.tap(card, 'Cancel');
    expect(card.text).toBe('What do you want to change?');
    expect(card.edits).toBeGreaterThan(0);
    // The draft is gone: typing is just a message again.
    await rob.say('Whatever');
    expect(rob.screen.text).toBe('What do you want to change?');
    expect(rob.screen).not.toBe(card);
  });

  it('Start again after Cancel gives a fresh empty card', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Twiggy');
    await rob.tap(card, 'Cancel');
    await rob.tap(card, 'Start');
    expect(card.text).toContain('Pet: —');
  });
});

describe('Start: typed answers are validated', () => {
  async function pickedCourse(): Promise<Msg> {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Twiggy');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Course');
    return card;
  }

  it('name: 1 to 40 characters', async () => {
    const card = await newCard();
    await rob.tap(card, 'Name');
    await rob.say('x'.repeat(41));
    expect(card.text).toContain('too long (40 characters at most)');
    await rob.say('   ');
    expect(card.text).toContain('cannot be empty');
    await rob.say('x'.repeat(40));
    expect(card.text).toContain(`Name: ${'x'.repeat(40)}`);
  });

  it.each(['0', '366', '-3', 'ten', '2.5', ''])('days %j is refused and asked again', async (bad) => {
    const card = await pickedCourse();
    await rob.tap(card, 'Days');
    await rob.say(bad || ' ');
    expect(card.text).toContain('whole number of days from 1 to 365');
    expect(card.text).toContain('Type the number of days.');
    await rob.say('7 days');
    expect(card.text).toContain('Days: 7');
  });

  it('Last given cannot be in the future; Started on can', async () => {
    const card = await pickedCourse();
    await rob.tap(card, 'Started on');
    await rob.say('tomorrow');
    expect(card.text).toContain('Started on: Sun 11 Oct');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Monthly');
    await rob.tap(card, 'Last given');
    await rob.say('tomorrow');
    expect(card.text).toContain('in the future');
    await rob.say('2026-02-30');
    expect(card.text).toContain('does not exist');
    await rob.say('yesterday');
    expect(card.text).toContain('Last given: Fri 9 Oct');
  });

  it('"-" clears the dose note and the dates', async () => {
    const card = await pickedCourse();
    await type(card, 'Dose note', 'with food');
    expect(card.text).toContain('Dose note: with food');
    await type(card, 'Dose note', '-');
    expect(card.text).toContain('Dose note: —');
    await type(card, 'Started on', '1 Oct');
    await type(card, 'Started on', '-');
    expect(card.text).toContain('Started on: first dose');
  });

  it('a too long dose note is refused', async () => {
    const card = await newCard();
    await type(card, 'Dose note', 'n'.repeat(101));
    expect(card.text).toContain('too long');
  });

  it('typing HTML is shown as text, not markup', async () => {
    const card = await newCard();
    await type(card, 'Name', '<b>&Co');
    expect(card.text).toContain('Name: &lt;b&gt;&amp;Co');
  });

  it('/menu while a question is open drops the question: the card shows again and the next message is not an answer', async () => {
    const card = await newCard();
    await rob.tap(card, 'Name');
    await rob.say('/menu');
    expect(card.text).toContain('New med');
    expect(rob.screen.text).toBe('What do you want to change?');
    expect(rob.screen).not.toBe(card);
    const deletes = kit.tg.count('deleteMessage');
    await rob.say('Antibiotic');
    expect(card.text).toContain('Name: —');
    expect(kit.tg.count('deleteMessage')).toBe(deletes);
    expect(rob.screen.text).toBe('What do you want to change?');
  });

});

describe('Stop', () => {
  beforeEach(async () => {
    await seedDayOneMeds(kit.h);
  });

  it('pet, med, confirm: the med ends and is announced', async () => {
    const menu = await rob.openMenu();
    await rob.tap(menu, 'Stop');
    expect(menu.text).toContain('which pet');
    await rob.tap(menu, 'Twiggy');
    expect(labels(menu)).toEqual(expect.arrayContaining(['Antibiotic · course', 'Eye drops · ongoing', 'Allergy · ongoing', 'Simparica · monthly']));
    await rob.tap(menu, 'Eye drops');
    expect(menu.text).toBe('Stop Eye drops for Twiggy? It ends right away.');
    await rob.tap(menu, 'Yes, stop');

    expect(await activeMeds('twiggy')).toEqual(['Antibiotic', 'Allergy', 'Simparica']);
    expect(topic(11)).toContain('Rob stopped Eye drops');
    expect(menu.text).toContain('Stopped Eye drops');
    expect(menu.keyboard).toEqual([]);
    expect(rob.screen.text).toBe('What do you want to change?');
  });

  it('« Back walks back one step at a time and Cancel returns to the menu', async () => {
    const menu = await rob.openMenu();
    await rob.tap(menu, 'Stop');
    await rob.tap(menu, 'Faith');
    expect(labels(menu)).toContain('Simparica · monthly');
    await rob.tap(menu, 'Simparica');
    await rob.tap(menu, '« Back');
    expect(menu.text).toContain('Stop which med for Faith');
    await rob.tap(menu, '« Back');
    expect(menu.text).toContain('which pet');
    await rob.tap(menu, 'Cancel');
    expect(menu.text).toBe('What do you want to change?');
    expect(await activeMeds('faith')).toEqual(['Simparica']);
  });

  it('says so when a pet has no active meds', async () => {
    const menu = await rob.openMenu();
    await rob.tap(menu, 'Stop');
    await rob.tap(menu, 'Faith');
    await rob.tap(menu, 'Simparica');
    await rob.tap(menu, 'Yes, stop');
    await rob.tap(rob.screen, 'Stop');
    await rob.tap(rob.screen, 'Faith');
    expect(rob.screen.text).toContain('No active meds.');
  });

  it('a med someone else already stopped gives a plain message and stays put', async () => {
    const menu = await rob.openMenu();
    await rob.tap(menu, 'Stop');
    await rob.tap(menu, 'Twiggy');
    await rob.tap(menu, 'Allergy');
    await kit.service.stopMed((await medNamed('twiggy', 'Allergy')).id, { userId: 2, name: 'Danielle' });
    const answer = await rob.tap(menu, 'Yes, stop');
    expect(answer).toEqual({ text: 'That med is not active.', alert: true });
    expect(menu.text).toContain('Stop Allergy');
  });
});

describe('Edit', () => {
  beforeEach(async () => {
    await seedDayOneMeds(kit.h);
  });

  async function pickMed(pet: string, med: string): Promise<Msg> {
    const menu = await rob.openMenu();
    await rob.tap(menu, 'Edit');
    await rob.tap(menu, pet);
    await rob.tap(menu, med);
    return menu;
  }

  it('a course: change the days', async () => {
    const s = await pickMed('Twiggy', 'Antibiotic');
    expect(labels(s)).toEqual(['✏️ Dose note', 'Days', 'Rounds', '« Back', 'Cancel']);
    await rob.tap(s, 'Days');
    expect(s.text).toBe('Type the new number of days.');
    await rob.say('14');
    expect(s.text).toBe('Change Antibiotic (Twiggy)?\nDays: 10 → 14');
    await rob.tap(s, 'Yes, change');

    expect((await medNamed('twiggy', 'Antibiotic')).days).toBe(14);
    expect(topic(11)).toContain('Rob changed Antibiotic: 14 days, morning + evening — "1 tablet"');
    expect(s.text).toContain('✅ You changed Antibiotic: 14 days');
    expect(rob.screen.text).toBe('What do you want to change?');
  });

  it('rounds: a multi-select that starts from the current rounds', async () => {
    const s = await pickMed('Twiggy', 'Eye drops');
    expect(labels(s)).toEqual(['✏️ Dose note', 'Rounds', '« Back', 'Cancel']);
    await rob.tap(s, 'Rounds');
    expect(labels(s)).toEqual(['✅ ☀️ Morning', '⬜ 🌙 Evening', '✅ Done', 'Cancel']);
    expect((await rob.tap(s, 'Done')).text).toBe('That is already the current rounds.');
    await rob.tap(s, 'Evening');
    await rob.tap(s, 'Evening');
    expect(labels(s)).toEqual(['✅ ☀️ Morning', '⬜ 🌙 Evening', '✅ Done', 'Cancel']);
  });

  it('rounds: change and confirm', async () => {
    const s = await pickMed('Twiggy', 'Eye drops');
    await rob.tap(s, 'Rounds');
    await rob.tap(s, 'Evening');
    await rob.tap(s, 'Done');
    expect(s.text).toBe('Change Eye drops (Twiggy)?\nRounds: Morning → Morning + Evening');
    await rob.tap(s, 'Yes, change');
    expect((await medNamed('twiggy', 'Eye drops')).roundKeys).toEqual(['morning', 'evening']);
    expect(topic(11)).toContain('Rob changed Eye drops: daily, morning + evening — "2 drops each eye"');
  });

  it('rounds: at least one must stay on', async () => {
    const s = await pickMed('Twiggy', 'Eye drops');
    await rob.tap(s, 'Rounds');
    await rob.tap(s, 'Morning');
    expect((await rob.tap(s, 'Done')).text).toBe('Pick at least one round.');
  });

  it('dose note: change it, and "-" removes it', async () => {
    const s = await pickMed('Twiggy', 'Eye drops');
    await rob.tap(s, 'Dose note');
    await rob.say('1 drop');
    expect(s.text).toBe('Change Eye drops (Twiggy)?\nDose note: "1 drop"');
    await rob.tap(s, 'Yes, change');
    expect((await medNamed('twiggy', 'Eye drops')).doseNote).toBe('1 drop');

    await rob.tap(rob.screen, 'Edit');
    await rob.tap(rob.screen, 'Twiggy');
    await rob.tap(rob.screen, 'Eye drops');
    const s2 = rob.screen;
    await rob.tap(s2, 'Dose note');
    await rob.say('-');
    expect(s2.text).toBe('Change Eye drops (Twiggy)?\nRemove the dose note');
    await rob.tap(s2, 'Yes, change');
    expect((await medNamed('twiggy', 'Eye drops')).doseNote).toBeNull();
  });

  it('only offers what fits the med: monthly meds get a dose note only', async () => {
    const s = await pickMed('Faith', 'Simparica');
    expect(labels(s)).toEqual(['✏️ Dose note', '« Back', 'Cancel']);
  });

  it('refuses a value that is already there, and bad days', async () => {
    const s = await pickMed('Twiggy', 'Antibiotic');
    await rob.tap(s, 'Days');
    await rob.say('10');
    expect(s.text).toContain('already the current value');
    await rob.say('0');
    expect(s.text).toContain('whole number of days');
    await rob.tap(s, '« Back');
    expect(s.text).toContain('what do you want to change?');
  });

  it('« Back from the confirmation returns to the field list', async () => {
    const s = await pickMed('Twiggy', 'Antibiotic');
    await rob.tap(s, 'Days');
    await rob.say('12');
    await rob.tap(s, '« Back');
    expect(labels(s)).toContain('Days');
    expect((await medNamed('twiggy', 'Antibiotic')).days).toBe(10);
  });

  it('a med stopped meanwhile is reported plainly and the edit does not happen', async () => {
    const s = await pickMed('Twiggy', 'Antibiotic');
    await rob.tap(s, 'Days');
    await rob.say('12');
    const med = await medNamed('twiggy', 'Antibiotic');
    await kit.service.stopMed(med.id, { userId: 2, name: 'Danielle' });
    const answer = await rob.tap(s, 'Yes, change');
    expect(answer).toEqual({ text: 'That med is not active.', alert: true });
  });
});

describe('Fix a past log', () => {
  it('lists the pet\'s recent logs and opens the service\'s fix panel in the private chat', async () => {
    const meds = await seedDayOneMeds(kit.h);
    await kit.h.repos.entries.create({
      petId: 'twiggy', roundKey: 'morning', forDate: '2026-10-08', by: { userId: 2, name: 'Danielle' },
      givenAt: new Date('2026-10-08T12:15:00Z'), loggedAt: new Date('2026-10-08T12:16:00Z'),
      items: [{ medId: meds.antibiotic.id, status: 'given' }, { medId: meds.eyeDrops.id, status: 'given' }],
    });
    const menu = await rob.openMenu();
    await rob.tap(menu, 'Fix a past log');
    await rob.tap(menu, 'Twiggy');
    expect(menu.text).toContain('which log do you want to fix');
    expect(labels(menu)).toEqual(['☀️ Morning · 8 Oct · Danielle 8:15', '« Back', 'Cancel']);

    const answer = await rob.tap(menu, 'Morning');
    expect(answer.text).toBe('The fix panel is below.');
    const panel = rob.screen;
    expect(panel).not.toBe(menu);
    expect(panel.chatId).toBe(ROB.id);
    expect(panel.text).toContain('Antibiotic');
    expect(labels(panel).join(' ')).toContain('Undo');
  });

  it('says so when there is nothing to fix', async () => {
    const menu = await rob.openMenu();
    await rob.tap(menu, 'Fix a past log');
    await rob.tap(menu, 'Faith');
    expect(menu.text).toContain('no logs in the last 2 weeks');
    expect(labels(menu)).toEqual(['« Back', 'Cancel']);
  });

  it('a log that was undone meanwhile gives a plain message', async () => {
    const meds = await seedDayOneMeds(kit.h);
    const entry = await kit.h.repos.entries.create({
      petId: 'twiggy', roundKey: 'morning', forDate: '2026-10-09', by: { userId: 2, name: 'Danielle' },
      givenAt: new Date('2026-10-09T12:15:00Z'), loggedAt: new Date('2026-10-09T12:16:00Z'),
      items: [{ medId: meds.eyeDrops.id, status: 'given' }],
    });
    const menu = await rob.openMenu();
    await rob.tap(menu, 'Fix a past log');
    await rob.tap(menu, 'Twiggy');
    await kit.h.repos.entries.revise(entry.id, { kind: 'undo', by: { userId: 2, name: 'Danielle' }, at: kit.h.clock.now() });
    const answer = await rob.tap(menu, 'Morning');
    expect(answer).toMatchObject({ alert: true });
    expect(answer.text).toContain('no longer exists');
  });

  it('a typed reply to a bot message is handed to the service (the panel\'s "Type a time")', async () => {
    const spy = vi.spyOn(kit.service, 'handleTypedTime').mockResolvedValueOnce({ handled: true, reply: 'Saved <8:00>' });
    await rob.say('7:45', { replyTo: 4242 });
    expect(spy).toHaveBeenCalledWith({ from: { userId: 1, name: 'Rob' }, chatId: 1, replyToMessageId: 4242, text: '7:45' });
    expect(rob.screen.text).toBe('Saved &lt;8:00&gt;');
    expect(kit.passedOn).toHaveLength(0);
  });

  it('a reply the service does not want is passed on, and a reply to someone else is just a message', async () => {
    const spy = vi.spyOn(kit.service, 'handleTypedTime').mockResolvedValue({ handled: false });
    await rob.say('hello', { replyTo: 4242 });
    expect(kit.passedOn).toHaveLength(1);
    expect(kit.tg.messages).toEqual([]);
    await rob.say('hello', { replyTo: 4243, replyToFrom: 999 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(rob.screen.text).toBe('What do you want to change?');
  });
});

describe('stale and odd buttons', () => {
  it('every tap is answered exactly once, whatever the data, and nothing changes', async () => {
    const menu = await rob.openMenu();
    for (const data of ['ad:nope', 'ad:menu', 'ad:menu:zzz', 'ad:pick', 'ad:pick:stop:rex', 'ad:pick:eat:twiggy', 'ad:med:stop:99999',
      'ad:med:edit:abc', 'ad:med:fly:1', 'ad:stopyes', 'ad:stopyes:77777', 'ad:entry:abc', 'ad:entry:99999', 'ad:field:name', 'ad:start', 'ad:round:morning',
      'ad:editYes', 'ad:ef:days', 'ad:noop', 'ad:pet:twiggy']) {
      await rob.tapData(menu, data); // tapData fails unless the tap was answered exactly once
    }
    expect(await activeMeds('twiggy')).toEqual([]);
    expect(menu.text).toBe('What do you want to change?');
  });

  it('buttons of an old card say it is out of date', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Twiggy');
    const stale = { ...card, keyboard: card.keyboard.map((r) => r.map((b) => ({ ...b }))) };
    const fresh = await rob.openMenu();
    await rob.tap(fresh, 'Start'); // a new draft replaces the old card
    expect(card.deleted).toBe(true);
    const answer = await rob.tap(stale, 'Name');
    expect(answer.text).toBe('That is out of date. Send any message to open the menu.');
    expect(fresh.text).toContain('Pet: —');
  });

  it('after Cancel, the old card\'s buttons do nothing', async () => {
    const card = await newCard();
    const old = { ...card, keyboard: card.keyboard.map((r) => r.map((b) => ({ ...b }))) };
    await rob.tap(card, 'Cancel');
    expect((await rob.tap(old, 'Pet')).text).toContain('out of date');
    expect((await rob.tap(old, 'Cancel')).text).toBeUndefined(); // Cancel is harmless: it just shows the menu again
  });

  it('a double tap on Start makes one med', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Faith');
    await type(card, 'Name', 'Ear cleaner');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'As needed');
    const start = { ...card, keyboard: card.keyboard.map((r) => r.map((b) => ({ ...b }))) };
    await rob.tap(start, '✅ Start');
    const second = await rob.tap(start, '✅ Start');
    expect(second.text).toContain('out of date');
    expect(await activeMeds('faith')).toEqual(['Ear cleaner']);
    expect(topic(12).filter((t) => t.includes('started'))).toHaveLength(1);
  });

  it('a field button that does not fit the kind is refused', async () => {
    const card = await newCard();
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Ongoing');
    const answer = await rob.tapData(card, 'ad:field:days');
    expect(answer.text).toBe('That does not apply to this kind of med.');
    expect(card.text).toContain('New med');
  });

  it('a round the pet does not have is ignored', async () => {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Twiggy');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'Ongoing');
    await rob.tap(card, 'Rounds');
    await rob.tapData(card, 'ad:round:lunch');
    expect(labels(card).filter((l) => l.startsWith('✅'))).toEqual(['✅ Done']);
  });

  it('typing while no question is open just shows the menu', async () => {
    const card = await newCard();
    await rob.say('Antibiotic');
    expect(rob.screen.text).toBe('What do you want to change?');
    expect(rob.screen).not.toBe(card);
    expect(card.text).toContain('New med'); // the card is untouched
  });
});

describe('errors', () => {
  async function completeCard(): Promise<Msg> {
    const card = await newCard();
    await rob.tap(card, 'Pet');
    await rob.tap(card, 'Faith');
    await type(card, 'Name', 'Ear cleaner');
    await rob.tap(card, 'Kind');
    await rob.tap(card, 'As needed');
    return card;
  }

  it('a long service error is cut to what Telegram accepts for a toast (200 characters)', async () => {
    const card = await completeCard();
    vi.spyOn(kit.service, 'startMed').mockRejectedValueOnce(new ServiceError('x'.repeat(500)));
    const answer = await rob.tap(card, '✅ Start');
    expect(answer.text).toHaveLength(200);
    expect(answer.alert).toBe(true);
  });

  it('a service error is shown plainly and the draft is kept', async () => {
    const card = await completeCard();
    const spy = vi.spyOn(kit.service, 'startMed').mockRejectedValueOnce(new ServiceError('That name is too long.'));
    const answer = await rob.tap(card, '✅ Start');
    expect(answer).toEqual({ text: 'That name is too long.', alert: true });
    expect(card.text).toContain('Name: Ear cleaner');
    // ... and it still works afterwards.
    spy.mockRestore();
    await rob.tap(card, '✅ Start');
    expect(await activeMeds('faith')).toEqual(['Ear cleaner']);
  });

  it('an unexpected error is logged and the admin sees a generic line', async () => {
    const card = await completeCard();
    vi.spyOn(kit.service, 'startMed').mockRejectedValueOnce(new Error('db down'));
    const answer = await rob.tap(card, '✅ Start');
    expect(answer).toEqual({ text: 'Something went wrong, please try again.', alert: true });
    expect(kit.h.logger.errors).toHaveLength(1);
    expect(card.text).toContain('Name: Ear cleaner');
    kit.h.logger.errors.length = 0;
  });

  it('a Telegram failure on a typed answer is logged, not thrown', async () => {
    const card = await newCard();
    await rob.tap(card, 'Name');
    kit.bot.api.config.use(async (prev, method, payload) => {
      if (method === 'deleteMessage') throw new Error('network');
      return prev(method, payload);
    });
    await rob.say('Thing');
    expect(card.text).toContain('Name: Thing');
    expect(kit.h.logger.warnings.some((w) => w.includes('delete answer'))).toBe(true);
  });
});

describe('together with the core handlers (createBot)', () => {
  it('admins get the menu, /ids still works, non-admins get the fixed text, and admin taps are answered once', async () => {
    const { createBot, NON_ADMIN_TEXT } = await import('../src/bot/index.js');
    const { registerAdmin } = await import('../src/bot/admin.js');
    const bot = createBot({
      token: '1:fake', service: kit.service, settings: kit.h.settings, logger: kit.h.logger, botInfo: BOT_USER,
      registerExtra: (b) => registerAdmin(b, { service: kit.service, settings: kit.h.settings, logger: kit.h.logger, clock: kit.h.clock }),
    });
    kit.tg.install(bot); // the service's own sends land in the same fake Telegram
    const tg = kit.tg;
    const both: AdminKit = { ...kit, bot };
    const robChat = new Chat(both, ROB, ROB.id);
    const kidChat = new Chat(both, KID, KID.id);

    await robChat.say('/ids');
    expect(robChat.screen.text).toBe('chat_id=1 topic_id=none user_id=1');
    await robChat.say('hi');
    expect(robChat.screen.text).toBe('What do you want to change?');
    await robChat.tap(robChat.screen, 'Start');
    expect(robChat.screen.text).toContain('New med');
    await kidChat.say('hi');
    expect(kidChat.screen.text).toBe(NON_ADMIN_TEXT);
    expect(tg.answers).toHaveLength(1);
  });

  it('Fix a past log works end to end: a time typed in reply to the panel prompt is applied', async () => {
    const { createBot } = await import('../src/bot/index.js');
    const { registerAdmin } = await import('../src/bot/admin.js');
    const meds = await seedDayOneMeds(kit.h);
    const entry = await kit.h.repos.entries.create({
      petId: 'twiggy', roundKey: 'morning', forDate: '2026-10-10', by: { userId: 2, name: 'Danielle' },
      givenAt: new Date('2026-10-10T12:15:00Z'), loggedAt: new Date('2026-10-10T12:16:00Z'),
      items: [{ medId: meds.eyeDrops.id, status: 'given' }],
    });
    const bot = createBot({
      token: '1:fake', service: kit.service, settings: kit.h.settings, logger: kit.h.logger, botInfo: BOT_USER,
      registerExtra: (b) => registerAdmin(b, { service: kit.service, settings: kit.h.settings, logger: kit.h.logger, clock: kit.h.clock }),
    });
    kit.tg.install(bot);
    const chat = new Chat({ ...kit, bot }, ROB, ROB.id);

    const menu = await chat.openMenu();
    await chat.tap(menu, 'Fix a past log');
    await chat.tap(menu, 'Twiggy');
    await chat.tap(menu, 'Morning');
    const panel = chat.screen;
    await chat.tap(panel, 'Given at');
    await chat.tap(panel, 'Type a time');
    const prompt = chat.screen;
    expect(prompt.forceReply).toBe(true);

    await chat.say('7:45', { replyTo: prompt.id });
    expect(labels(panel).join(' ')).toContain('7:45');
    await chat.tap(panel, 'Save');
    expect((await kit.h.repos.entries.get(entry.id))!.givenAt).toEqual(new Date('2026-10-10T11:45:00Z'));
    expect(kit.h.logger.errors).toEqual([]);
  });
});
