import type { AppLang } from "@/lib/apps/lang";
import { QUIRKS } from "@/lib/roster/data";
import type { DepartmentId, Effect, QuirkId, Rarity, Stat } from "@/lib/roster/types";
import type { Blurb } from "@/lib/tower/i18n";
import type { FoeKind, PassiveId, WeaponId } from "./sim/types";

export interface HrText {
  title: string;
  tagline: string;
  howTo: string[];
  home: string;
  whoGoesIn: string;
  continueRun: string;
  continueHint: (name: string, time: string) => string;
  chooseCareer: string;
  careerBlurb: string;
  startCareer: string;
  goToWork: string;
  day: (day: number) => string;
  /** Rank titles, lowest first; the last one repeats. */
  ranks: string[];
  careerLevel: (level: number) => string;
  reviewProgress: (xp: number, next: number) => string;
  savings: (gold: string) => string;
  reviewEarned: (xp: number) => string;
  leveledUp: (level: number) => string;
  promoted: (rank: string) => string;
  openPack: (price: string) => string;
  packHint: string;
  packOpened: (rarity: string) => string;
  nice: string;
  yourCards: string;
  makeFocus: string;
  rarities: Record<Rarity, string>;
  sealedTitle: string;
  sealedHint: (boss: string) => string;
  interview: (boss: string) => string;
  interviewClock: (boss: string, time: string) => string;
  hired: string;
  hiredLine: (name: string) => string;
  interviewFailed: string;
  tryAgain: string;
  startOver: string;
  startOverConfirm: string;
  departments: Record<DepartmentId, string>;
  stats: Record<Stat, string>;
  quirks: Record<QuirkId, string>;
  /** What a quirk effect changes, after its percent. */
  effects: Record<Effect, string>;
  weapons: Record<WeaponId, Blurb>;
  passives: Record<PassiveId, Blurb>;
  heal: Blurb;
  gold: Blurb;
  levelUp: string;
  pickOne: string;
  isNew: string;
  level: (level: number) => string;
  hp: string;
  goldAmount: (amount: number) => string;
  foes: Record<FoeKind, string>;
  /** What comes next on the clock, e.g. "Auditor in 1:20". */
  next: (who: string, time: string) => string;
  auditCloses: (time: string) => string;
  pause: string;
  paused: string;
  resume: string;
  walkOut: string;
  walkOutHint: string;
  won: string;
  fell: string;
  auditClosed: string;
  walkedOut: string;
  lasted: (time: string) => string;
  reached: (level: number) => string;
  kills: (kills: number) => string;
  goldEarned: (amount: number) => string;
  playAgain: string;
  menu: string;
  fieldLabel: string;
}

export const HR_TEXT: Record<AppLang, HrText> = {
  en: {
    title: "HR Department",
    tagline: "Send a coworker into the office horde. They fight on their own; you steer.",
    howTo: [
      "Drag anywhere to move; your coworker attacks on their own.",
      "Pick up the gems to level up, then choose an upgrade.",
      "The Middle Manager turns up at 2:30 and the Auditor at 5:00. Beat the Auditor before the audit closes at 7:30.",
    ],
    home: "← All apps",
    whoGoesIn: "Who goes in today?",
    continueRun: "Continue the run",
    continueHint: (name, time) => `${name}, at ${time}`,
    chooseCareer: "Who will you grow?",
    careerBlurb: "Pick one coworker and grow them over the coming weeks. One run is one day. The rest of the office can be hired later.",
    startCareer: "Start career",
    goToWork: "Go to work",
    day: (day) => `Day ${day}`,
    ranks: ["Trainee", "Junior", "Specialist", "Senior", "Lead", "Director"],
    careerLevel: (level) => `Level ${level}`,
    reviewProgress: (xp, next) => `Review: ${xp} / ${next} XP`,
    savings: (gold) => `Savings: ${gold}`,
    reviewEarned: (xp) => `+${xp} review XP`,
    leveledUp: (level) => `Level up: ${level}!`,
    promoted: (rank) => `Promoted to ${rank}!`,
    openPack: (price) => `Open a pack (${price})`,
    packHint: "A pack holds one new coworker. Rarer ones are stronger, but the office pushes back harder.",
    packOpened: (rarity) => `New coworker: ${rarity}!`,
    nice: "Nice",
    yourCards: "Your cards",
    makeFocus: "Make focus",
    rarities: { common: "Common", uncommon: "Uncommon", rare: "Rare", legend: "Legend" },
    sealedTitle: "Waiting for an interview",
    sealedHint: (boss) => `Your focus has to beat the ${boss} before they join.`,
    interview: (boss) => `Interview: ${boss}`,
    interviewClock: (boss, time) => `${boss}, ${time} left`,
    hired: "Hired!",
    hiredLine: (name) => `${name} joins your cards`,
    interviewFailed: "Interview failed",
    tryAgain: "Try again",
    startOver: "Start a new career",
    startOverConfirm: "Start over? Your coworker's level and savings will be lost.",
    departments: {
      engineering: "Engineering",
      finance: "Finance",
      legal: "Legal",
      sales: "Sales",
      it: "IT",
      hr: "HR",
      interns: "Interns",
    },
    stats: { grit: "Grit", output: "Output", hustle: "Hustle", focus: "Focus", luck: "Luck" },
    quirks: {
      caffeinated: "Caffeinated",
      stealsLunches: "Steals lunches",
      overachiever: "Overachiever",
      loyal: "Loyal",
      networker: "Networker",
      nightOwl: "Night owl",
      gymRegular: "Gym regular",
      perfectionist: "Perfectionist",
      clockWatcher: "Clock-watcher",
      officeGossip: "Office gossip",
      unionRep: "Union rep",
      coffeeSnob: "Coffee snob",
      standingDesk: "Standing desk",
    },
    effects: {
      grit: "health",
      output: "damage",
      hustle: "speed",
      focus: "attack speed",
      luck: "gold",
      gold: "gold",
      xp: "XP",
      damageTaken: "damage taken",
      quitChance: "chance to quit",
      teamQuitChance: "colleagues' chance to quit",
      salary: "salary",
    },
    weapons: {
      stickyNotes: { name: "Sticky notes", description: "A stream of notes that chase the nearest foes." },
      spreadsheet: { name: "Spreadsheet", description: "Thrown at the nearest foe, straight through several." },
      serverRack: { name: "Server rack", description: "Dropped on a foe nearby; hits everything under it." },
      policyBinder: { name: "Policy binder", description: "A swing that hits everything close and knocks it back." },
      rubberDuck: { name: "Rubber duck", description: "Ducks circle you and bump whatever they meet." },
      contract: { name: "Fine print", description: "Everything close is slowed and keeps taking damage." },
      businessCard: { name: "Business cards", description: "A fan of cards thrown the way you face." },
    },
    passives: {
      coffee: { name: "Coffee", description: "Every weapon is ready 8% sooner." },
      gym: { name: "Gym membership", description: "15% more health." },
      sneakers: { name: "Sneakers", description: "Move 8% faster." },
      lanyard: { name: "Lanyard", description: "Gems fly to you from 30% further." },
      mentor: { name: "Mentor", description: "10% more XP." },
      ergoChair: { name: "Ergonomic chair", description: "Take 8% less damage." },
      powerTie: { name: "Power tie", description: "Deal 10% more damage." },
    },
    heal: { name: "Snack break", description: "Heal 30% of your health." },
    gold: { name: "Petty cash", description: "Take 10 gold." },
    levelUp: "Level up!",
    pickOne: "Pick one",
    isNew: "New",
    level: (level) => `Level ${level}`,
    hp: "Health",
    goldAmount: (amount) => `${amount} gold`,
    foes: {
      replyAll: "Reply-All Storm",
      mondayBlob: "Monday Blob",
      meetingInvite: "Meeting Invite",
      printerJam: "Printer Jam",
      middleManager: "Middle Manager",
      auditor: "Auditor",
      teamLead: "Team Lead",
      hrManager: "HR Manager",
      recruiter: "Recruiter",
    },
    next: (who, time) => `${who} in ${time}`,
    auditCloses: (time) => `The audit closes in ${time}`,
    pause: "Pause",
    paused: "Paused",
    resume: "Resume",
    walkOut: "Walk out",
    walkOutHint: "Walking out counts as falling.",
    won: "Audit passed!",
    fell: "Down for the day",
    auditClosed: "The audit closed",
    walkedOut: "Walked out",
    lasted: (time) => `Lasted ${time}`,
    reached: (level) => `Reached level ${level}`,
    kills: (kills) => `${kills} foes cleared`,
    goldEarned: (amount) => `${amount} gold earned`,
    playAgain: "Again",
    menu: "Menu",
    fieldLabel: "The office floor. Drag, or use the arrow keys or WASD, to move. Escape pauses.",
  },
  ru: {
    title: "Отдел кадров",
    tagline: "Отправьте сотрудника против офисной орды. Он дерётся сам, вы ведёте.",
    howTo: [
      "Тяните в любом месте, чтобы идти; сотрудник атакует сам.",
      "Собирайте кристаллы, чтобы расти в уровне и выбирать улучшения.",
      "Менеджер среднего звена приходит в 2:30, аудитор в 5:00. Одолейте аудитора, пока аудит не закрылся в 7:30.",
    ],
    home: "← Все приложения",
    whoGoesIn: "Кто идёт сегодня?",
    continueRun: "Продолжить забег",
    continueHint: (name, time) => `${name}, ${time}`,
    chooseCareer: "Кого будете растить?",
    careerBlurb: "Выберите одного сотрудника и растите его ближайшие недели. Один забег — один день. Остальных можно будет нанять позже.",
    startCareer: "Начать карьеру",
    goToWork: "На работу",
    day: (day) => `День ${day}`,
    ranks: ["Стажёр", "Младший", "Специалист", "Старший", "Ведущий", "Директор"],
    careerLevel: (level) => `Уровень ${level}`,
    reviewProgress: (xp, next) => `Аттестация: ${xp} / ${next} опыта`,
    savings: (gold) => `Накопления: ${gold}`,
    reviewEarned: (xp) => `+${xp} опыта аттестации`,
    leveledUp: (level) => `Новый уровень: ${level}!`,
    promoted: (rank) => `Повышение: ${rank}!`,
    openPack: (price) => `Открыть пакет (${price})`,
    packHint: "В пакете один новый сотрудник. Редкие сильнее, но офис давит на них сильнее.",
    packOpened: (rarity) => `Новый сотрудник: ${rarity}!`,
    nice: "Отлично",
    yourCards: "Ваши карточки",
    makeFocus: "Сделать главным",
    rarities: { common: "Обычный", uncommon: "Необычный", rare: "Редкий", legend: "Легенда" },
    sealedTitle: "Ждут собеседования",
    sealedHint: (boss) => `Ваш главный сотрудник должен победить: ${boss}.`,
    interview: (boss) => `Собеседование: ${boss}`,
    interviewClock: (boss, time) => `${boss}, осталось ${time}`,
    hired: "Принят!",
    hiredLine: (name) => `${name} теперь в вашей коллекции`,
    interviewFailed: "Собеседование провалено",
    tryAgain: "Ещё раз",
    startOver: "Начать новую карьеру",
    startOverConfirm: "Начать заново? Уровень сотрудника и накопления пропадут.",
    departments: {
      engineering: "Разработка",
      finance: "Финансы",
      legal: "Юристы",
      sales: "Продажи",
      it: "ИТ",
      hr: "Кадры",
      interns: "Стажёры",
    },
    stats: { grit: "Закалка", output: "Отдача", hustle: "Напор", focus: "Фокус", luck: "Удача" },
    quirks: {
      caffeinated: "Кофеман",
      stealsLunches: "Ворует обеды",
      overachiever: "Трудоголик",
      loyal: "Преданный",
      networker: "Нетворкер",
      nightOwl: "Сова",
      gymRegular: "Завсегдатай зала",
      perfectionist: "Перфекционист",
      clockWatcher: "Смотрит на часы",
      officeGossip: "Сплетник",
      unionRep: "Профорг",
      coffeeSnob: "Кофейный сноб",
      standingDesk: "Стол для работы стоя",
    },
    effects: {
      grit: "здоровья",
      output: "урона",
      hustle: "скорости",
      focus: "скорости атаки",
      luck: "золота",
      gold: "золота",
      xp: "опыта",
      damageTaken: "получаемого урона",
      quitChance: "шанса уволиться",
      teamQuitChance: "шанса уволиться у коллег",
      salary: "зарплаты",
    },
    weapons: {
      stickyNotes: { name: "Стикеры", description: "Поток стикеров летит за ближайшими врагами." },
      spreadsheet: { name: "Таблица", description: "Летит в ближайшего врага и пробивает нескольких." },
      serverRack: { name: "Серверная стойка", description: "Падает на врага рядом и бьёт всех под собой." },
      policyBinder: { name: "Папка регламентов", description: "Удар по всем рядом с отбрасыванием." },
      rubberDuck: { name: "Резиновая уточка", description: "Уточки кружат вокруг и бьют всех, кого встретят." },
      contract: { name: "Мелкий шрифт", description: "Все рядом замедляются и постоянно получают урон." },
      businessCard: { name: "Визитки", description: "Веер визиток туда, куда вы смотрите." },
    },
    passives: {
      coffee: { name: "Кофе", description: "Всё оружие готово на 8% быстрее." },
      gym: { name: "Абонемент в зал", description: "На 15% больше здоровья." },
      sneakers: { name: "Кроссовки", description: "Ходите на 8% быстрее." },
      lanyard: { name: "Бейдж на шнурке", description: "Кристаллы летят к вам на 30% издалека." },
      mentor: { name: "Наставник", description: "На 10% больше опыта." },
      ergoChair: { name: "Эргономичное кресло", description: "На 8% меньше урона." },
      powerTie: { name: "Галстук власти", description: "На 10% больше урона." },
    },
    heal: { name: "Перекус", description: "Восстановить 30% здоровья." },
    gold: { name: "Касса", description: "Взять 10 золота." },
    levelUp: "Новый уровень!",
    pickOne: "Выберите одно",
    isNew: "Новое",
    level: (level) => `Уровень ${level}`,
    hp: "Здоровье",
    goldAmount: (amount) => `${amount} ${plural(amount, "золотой", "золотых", "золотых")}`,
    foes: {
      replyAll: "Ответ всем",
      mondayBlob: "Понедельник",
      meetingInvite: "Приглашение на встречу",
      printerJam: "Зажевало бумагу",
      middleManager: "Менеджер среднего звена",
      auditor: "Аудитор",
      teamLead: "Тимлид",
      hrManager: "HR-менеджер",
      recruiter: "Рекрутёр",
    },
    next: (who, time) => `${who} через ${time}`,
    auditCloses: (time) => `Аудит закроется через ${time}`,
    pause: "Пауза",
    paused: "Пауза",
    resume: "Продолжить",
    walkOut: "Уйти",
    walkOutHint: "Уход считается поражением.",
    won: "Аудит пройден!",
    fell: "На сегодня всё",
    auditClosed: "Аудит закрылся",
    walkedOut: "Ушли",
    lasted: (time) => `Продержались ${time}`,
    reached: (level) => `Дошли до уровня ${level}`,
    kills: (kills) => `Разобрано врагов: ${kills}`,
    goldEarned: (amount) => `Заработано золота: ${amount}`,
    playAgain: "Ещё раз",
    menu: "Меню",
    fieldLabel: "Офис. Тяните пальцем, стрелками или WASD, чтобы идти. Escape ставит паузу.",
  },
};

/** "+20% speed, +15% damage taken": a quirk's effects in the reader's words. */
export function quirkLine(text: HrText, quirk: QuirkId): string {
  return (Object.entries(QUIRKS[quirk]) as [Effect, number][])
    .map(([effect, percent]) => `${percent > 0 ? "+" : "−"}${Math.abs(percent)}% ${text.effects[effect]}`)
    .join(", ");
}

/** Seconds as m:ss. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Russian noun form for a count: 1 золотой, 2 золотых, 5 золотых. */
function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}
