// Team radio: the bots talk. Round plans, contact calls, plant and defuse warnings —
// short lines in the left feed that make the squad's decisions visible. Lines are
// event-driven (perception, orders, round hooks) with a small cooldown so the feed
// reads like a net, not a log file. Callout names come from map.js regions.
import { calloutAt } from './map.js';

const PLAN_LINES = [
  (site, name) => `Going ${site} — hit ${name} together, smoke the cross.`,
  (site, name) => `Execute on ${site}. Carrier plants, rest watch ${name}.`,
  (site, name) => `Split look, commit ${site}. Call what you see.`,
];
const HOLD_LINES = [
  (site, name) => `Set on ${site}. Crossfire ${name}, call the push.`,
  (site, name) => `Holding ${site} — nothing through ${name} without a call.`,
];

export function createRadio(rng) {
  let lastAt = -10;
  const api = {
    onLine: null, // (speaker, text, team) => void — wired to the HUD by main
    say(speaker, text, team, now, force = false) {
      if (!force && now - lastAt < 1.1) return;
      lastAt = now;
      if (api.onLine) api.onLine(speaker, text, team);
    },
    plan(attacking, siteKey, siteName, now) {
      const lines = attacking ? PLAN_LINES : HOLD_LINES;
      const line = lines[Math.floor(rng() * lines.length)];
      api.say('Plan', line(siteKey, siteName), attacking ? 0 : 1, now, true);
    },
    contact(bot, enemyPos, now) {
      api.say(bot.name, `Contact — ${calloutAt(enemyPos.x, enemyPos.z)}!`, bot.team, now);
    },
    heard(bot, pos, now) {
      api.say(bot.name, `Heard shots, ${calloutAt(pos.x, pos.z)}.`, bot.team, now);
    },
    rotating(bot, siteKey, now) {
      api.say(bot.name, `Rotating to ${siteKey}.`, bot.team, now);
    },
    planting(bot, siteKey, now) {
      api.say(bot.name, `Planting at ${siteKey} — cover me.`, bot.team, now, true);
    },
    defusing(bot, now) {
      api.say(bot.name, 'Defusing — hold them off!', bot.team, now, true);
    },
    planted(team, siteKey, now) {
      api.say('Radio', `Charge planted at ${siteKey}. ${team === 0 ? 'Hold the site.' : 'Retake, now.'}`, team, now, true);
    },
    down(bot, now) {
      api.say(bot.name, 'Man down!', bot.team, now);
    },
    smoke(bot, now) {
      api.say(bot.name, 'Smoke out — crossing behind it.', bot.team, now);
    },
    pickup(bot, now) {
      api.say(bot.name, 'Charge is down — I am on it.', bot.team, now, true);
    },
  };
  return api;
}
