// Plays the HR hero run with a bot, for each starter over several seeds, and prints how each run went, so a balance
// change can be judged on whole runs.
//
//   npx esbuild scripts/hr/playthrough.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/hr.mjs
//   node /tmp/hr.mjs [seeds] [department|all] [verbose|-] [level] [rarity|-] [teamLead|hrManager|recruiter]
//
// With a level, each starter is first grown to that career level (a stat point per level, see `review`) and meets the
// matching difficulty, to check the career curve. Level 1 is a first-day coworker. With a rarity (uncommon, rare or
// legend) the starters' departments are played by pack cards of that rarity instead, to check that a lucky pull is
// stronger but not a walkover.
//
// The bot is a sensible but unhurried player. A few times a second it tries 16 directions, looks where each would take
// it half a second from now and where the foes and foe shots would be by then, and goes the way with the least danger
// and the most gems nearby, keeping clear of the walls and keeping roughly to its last heading. At a level-up it takes
// the best pick on a fixed list: its own weapon, then a heal when low, then other weapons, then passives. A real
// player who herds the horde and plans a build should do better.

import process from 'node:process'
import { generateCoworker, starters } from '../../src/lib/roster/generate.ts'
import type { Rarity } from '../../src/lib/roster/types.ts'
import type { Coworker } from '../../src/lib/roster/types.ts'
import { ARENA, AUDIT_CLOSES, BOSS_AT, INTERVIEW, MINI_BOSS_AT } from '../../src/lib/hr/sim/balance.ts'
import { difficultyFor, interviewDifficultyFor, review, reviewXpToNext } from '../../src/lib/hr/career.ts'
import { choose, createRun, step } from '../../src/lib/hr/sim/run.ts'
import type { Input, InterviewBoss, Pick, Run } from '../../src/lib/hr/sim/types.ts'

/** How far ahead the bot looks, in seconds. */
const LOOK_AHEAD = 0.5
const DIRECTIONS = 16
/** Foes further than this from a spot don't count against it. */
const DANGER_REACH = 220
/** Room the bot likes to keep between itself and a foe's edge. */
const MARGIN = 26
const GEM_REACH = 260
const GEM_WEIGHT = 0.6
const WALL_MARGIN = 80
const KEEP_HEADING = 0.35

const WEAPON_ORDER = ['policyBinder', 'contract', 'rubberDuck', 'serverRack', 'spreadsheet', 'stickyNotes', 'businessCard']
const PASSIVE_ORDER = ['gym', 'ergoChair', 'coffee', 'powerTie', 'sneakers', 'lanyard', 'mentor']

function score(run: Run, pick: Pick): number {
  const signature = run.weapons[0]?.id
  switch (pick.kind) {
    case 'weapon':
      if (pick.id === signature) return 100
      return pick.level > 1 ? 80 - WEAPON_ORDER.indexOf(pick.id) : 60 - WEAPON_ORDER.indexOf(pick.id)
    case 'passive':
      return 50 - PASSIVE_ORDER.indexOf(pick.id) - (pick.level - 1)
    case 'heal':
      return run.hero.hp < run.numbers.maxHp * 0.5 ? 90 : 10
    case 'gold':
      return 0
  }
}

function decidePick(run: Run): number {
  const picks = run.picks ?? []
  let best = 0
  for (let index = 1; index < picks.length; index += 1) if (score(run, picks[index]) > score(run, picks[best])) best = index
  return best
}

/** How bad it would be to stand at (x, y) in `LOOK_AHEAD` seconds. */
function danger(run: Run, x: number, y: number): number {
  let total = 0
  for (const foe of run.foes) {
    // Where the foe will be: walking straight at that spot.
    const dx = x - foe.x
    const dy = y - foe.y
    const now = Math.hypot(dx, dy)
    if (now > DANGER_REACH + foe.speed * LOOK_AHEAD) continue
    const closer = Math.min(now, foe.speed * LOOK_AHEAD)
    const distance = Math.max(1, now - closer - foe.radius)
    const weight = foe.kind === 'auditor' || foe.kind === 'middleManager' ? 6 : foe.kind === 'mondayBlob' || foe.kind === 'printerJam' ? 2 : 1
    total += (weight * MARGIN * MARGIN) / (distance * distance)
  }
  for (const shot of run.foeShots) {
    const distance = Math.max(1, Math.hypot(x - (shot.x + shot.vx * LOOK_AHEAD), y - (shot.y + shot.vy * LOOK_AHEAD)))
    total += (3 * MARGIN * MARGIN) / (distance * distance)
  }
  return total
}

function gems(run: Run, x: number, y: number): number {
  let total = 0
  for (const gem of run.gems) {
    const distance = Math.hypot(gem.x - x, gem.y - y)
    if (distance < GEM_REACH) total += gem.value / (1 + distance / 40)
  }
  return total
}

let heading = { dx: 1, dy: 0 }

function steer(run: Run): Input {
  const { hero } = run
  const reach = run.numbers.speed * LOOK_AHEAD
  let best = { dx: 0, dy: 0 }
  let bestCost = Infinity
  for (let index = 0; index < DIRECTIONS; index += 1) {
    const angle = (index / DIRECTIONS) * Math.PI * 2
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const x = hero.x + dx * reach
    const y = hero.y + dy * reach
    const wall = [x, y, ARENA.width - x, ARENA.height - y].reduce((sum, gap) => sum + (gap < WALL_MARGIN ? (WALL_MARGIN - gap) / 10 : 0), 0)
    const cost = danger(run, x, y) - GEM_WEIGHT * gems(run, x, y) + wall - KEEP_HEADING * (dx * heading.dx + dy * heading.dy)
    if (cost < bestCost) {
      bestCost = cost
      best = { dx, dy }
    }
  }
  heading = best
  return best
}

function play(coworker: Coworker, seed: number, verbose: boolean) {
  const run = createRun(coworker, seed, (boss ? interviewDifficultyFor : difficultyFor)(coworker.level, coworker.rarity), boss ? { boss, candidateId: 99 } : null)
  let tick = 0
  let input: Input = { dx: 0, dy: 0 }
  let nextReport = 60
  while (run.status === 'playing') {
    if (run.picks) {
      choose(run, decidePick(run))
      continue
    }
    // A thumb doesn't change direction sixty times a second.
    if (tick % 6 === 0) input = steer(run)
    step(run, input)
    tick += 1
    if (verbose && run.time >= nextReport) {
      nextReport += 60
      const build = run.weapons.map((weapon) => `${weapon.id}${weapon.level}`).join(' ')
      console.log(`    ${Math.round(run.time)}s: level ${run.level}, hp ${Math.round(run.hero.hp)}/${Math.round(run.numbers.maxHp)}, ${run.foes.length} foes, ${build}`)
    }
  }
  return run
}

function minutes(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

const seeds = Number(process.argv[2] ?? 5)
const only = process.argv[3] === 'all' ? undefined : process.argv[3]
const verbose = process.argv[4] === 'verbose'
const careerLevel = Number(process.argv[5] ?? 1)
const rarity = process.argv[6] && process.argv[6] !== '-' ? (process.argv[6] as Rarity) : undefined
const boss = process.argv[7] as InterviewBoss | undefined
let wins = 0
let runs = 0
for (const [index, base] of starters().entries()) {
  // A pack card of the starter's department, the same one every run of the script.
  const starter = rarity ? generateCoworker({ rng: 1000 + index, nextId: 10 + index }, { department: base.department, rarity }) : base
  let coworker = starter
  while (coworker.level < careerLevel) coworker = review(coworker, reviewXpToNext(coworker.level) - coworker.xp).coworker
  if (only && only !== coworker.department) continue
  console.log(`${coworker.name} (${coworker.rarity} ${coworker.department}, level ${coworker.level}, ${coworker.quirks.join(', ')})`)
  let teamWins = 0
  const taken: Record<string, number> = {}
  for (let seed = 1; seed <= seeds; seed += 1) {
    const started = Date.now()
    const run = play(coworker, seed, verbose)
    runs += 1
    if (run.status === 'won') {
      wins += 1
      teamWins += 1
    }
    const end = run.status === 'won' ? (boss ? `beat the ${boss}` : 'beat the auditor') : run.time >= (boss ? INTERVIEW.closesAt : AUDIT_CLOSES) ? 'the audit closed' : `fell to ${run.lastHitBy}`
    const stage = run.time >= BOSS_AT ? 'boss' : run.time >= MINI_BOSS_AT ? 'past mini-boss' : 'early'
    const dealt = Object.entries(run.dealt)
      .sort((a, b) => b[1] - a[1])
      .map(([weapon, damage]) => `${weapon} ${Math.round(damage / 1000)}k`)
      .join(', ')
    for (const [kind, damage] of Object.entries(run.takenFrom)) taken[kind] = (taken[kind] ?? 0) + damage
    console.log(
      `  seed ${seed}: ${end} at ${minutes(run.time)} (${stage}), level ${run.level}, ${run.kills} kills, ${Math.round(run.gold)} gold | ${dealt} | ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
  }
  const total = Object.values(taken).reduce((sum, damage) => sum + damage, 0)
  const shares = Object.entries(taken)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, damage]) => `${kind} ${Math.round((damage / total) * 100)}%`)
    .join(', ')
  console.log(`  won ${teamWins}/${seeds}; damage taken: ${shares}`)
}
console.log(`all: won ${wins}/${runs} (${Math.round((wins / Math.max(1, runs)) * 100)}%)`)
