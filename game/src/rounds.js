// The match: round phases, economy, the charge (plant / defuse / detonate), team
// orders for the bots, and scoring. Haulers (the player's side) always attack;
// Jackals defend. First to 7 rounds takes the match, at most 12 rounds.
import { TEAM } from './palette.js';
import { WEAPONS, ARMOR_PRICE, GRENADE_PRICE, SMOKE_PRICE } from './weapons.js';

export const ROUND_TIME = 100;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const DETONATE_TIME = 40;
export const BUY_TIME = 12;
export const WIN_SCORE = 7;
export const MAX_ROUNDS = 12;

const REWARD = { win: 1400, loss: 900, kill: 300, plant: 300, teamPlant: 200 };

export function createMatch({ wardens, jackals, map, rng, hooks }) {
  const playerEnt = {
    isPlayer: true, team: TEAM.WARDENS, money: 800, alive: true,
    kit: { primary: null, armor: false, grenades: 0, smokes: 0 },
    kills: 0, deaths: 0,
  };
  const botMoney = new Map();
  for (const b of [...wardens, ...jackals]) botMoney.set(b, 800);

  const state = {
    phase: 'buy', // buy | live | end | matchEnd
    round: 1,
    scoreW: 0,
    scoreJ: 0,
    timer: BUY_TIME,
    planted: false,
    plantSite: null,
    detonateAt: 0,
    phaseEndsAt: 0,
    winner: null, // match winner team
    lastRoundWinner: null,
    lastRoundReason: '',
    attackSite: 'A',
    message: '',
  };

  const charge = {
    state: 'carried', // carried | dropped | planted
    carrier: playerEnt, // fighter object (playerEnt or a bot)
    x: 0, z: 0, site: null,
  };
  let defuseProgress = 0;
  let botPlantProgress = 0;
  let now = 0;

  function aliveCount(team) {
    const list = team === TEAM.WARDENS ? [playerEnt, ...wardens] : jackals;
    return list.filter((f) => f.alive).length;
  }

  function giveMoney(fighter, amount) {
    if (fighter.isPlayer) playerEnt.money += amount;
    else botMoney.set(fighter, botMoney.get(fighter) + amount);
  }

  function teamFighters(team) {
    return team === TEAM.WARDENS ? [playerEnt, ...wardens] : jackals;
  }

  // --- Buying ---
  function botBuy(bot) {
    let money = botMoney.get(bot);
    const spend = (price) => { money -= price; botMoney.set(bot, money); };
    const cur = bot.weapon.def.id;
    let want = cur;
    if (money >= WEAPONS.rifle.price + ARMOR_PRICE) want = 'rifle';
    else if (money >= WEAPONS.rifle.price) want = 'rifle';
    else if (money >= WEAPONS.smg.price) want = 'smg';
    if (bot.team === TEAM.JACKALS && money >= WEAPONS.dmr.price + 600 && rng() < 0.3) want = 'dmr';
    let armor = bot.armor;
    if (!armor && money >= ARMOR_PRICE + (want !== cur ? WEAPONS[want].price : 0)) armor = true;
    const price = (want !== cur ? WEAPONS[want].price : 0) + (armor && !bot.armor ? ARMOR_PRICE : 0);
    if (price <= money) {
      spend(price);
      let grenades = bot.grenades;
      if (money >= GRENADE_PRICE && grenades < 1 && rng() < 0.5) {
        spend(GRENADE_PRICE);
        grenades += 1;
      }
      if (money >= SMOKE_PRICE && bot.smokes < 1 && rng() < 0.45) {
        spend(SMOKE_PRICE);
        bot.smokes += 1;
      }
      bot.setLoadout(want, armor, grenades);
    }
  }

  function buy(item) {
    if (state.phase !== 'buy') return false;
    if (item === 'armor') {
      if (playerEnt.kit.armor || playerEnt.money < ARMOR_PRICE) return false;
      playerEnt.money -= ARMOR_PRICE;
      playerEnt.kit.armor = true;
      return true;
    }
    if (item === 'grenade') {
      if (playerEnt.kit.grenades >= 2 || playerEnt.money < GRENADE_PRICE) return false;
      playerEnt.money -= GRENADE_PRICE;
      playerEnt.kit.grenades += 1;
      return true;
    }
    if (item === 'smoke') {
      if (playerEnt.kit.smokes >= 2 || playerEnt.money < SMOKE_PRICE) return false;
      playerEnt.money -= SMOKE_PRICE;
      playerEnt.kit.smokes += 1;
      return true;
    }
    const def = WEAPONS[item];
    if (!def || item === 'pistol') return false;
    if (playerEnt.kit.primary === item || playerEnt.money < def.price) return false;
    playerEnt.money -= def.price;
    playerEnt.kit.primary = item;
    return true;
  }

  // --- Orders ---
  function assignOrders() {
    const site = map.sites[state.attackSite];
    for (const bot of wardens) {
      if (charge.carrier === bot) bot.order = { type: 'plant', x: site.x, z: site.z, site: state.attackSite };
      else bot.order = { type: 'push', x: site.x + (rng() * 4 - 2), z: site.z + (rng() * 4 - 2) };
    }
    const spotsA = map.holdSpots.A;
    const spotsB = map.holdSpots.B;
    jackals.forEach((bot, i) => {
      const spot = i % 2 === 0 ? spotsA[Math.floor(i / 2) % spotsA.length] : spotsB[Math.floor(i / 2) % spotsB.length];
      bot.order = { type: 'hold', x: spot.x, z: spot.z, yaw: spot.yaw, crouch: i === 3 };
    });
  }

  function ordersAfterPlant() {
    for (const bot of jackals) {
      if (bot.alive) bot.order = { type: 'defuseAt', x: charge.x, z: charge.z };
    }
    for (const bot of wardens) {
      if (bot.alive) {
        bot.order = { type: 'hold', x: bot.body.pos.x, z: bot.body.pos.z, yaw: bot.yaw };
      }
    }
  }

  function ordersAfterDrop() {
    let best = null;
    let bestDist = Infinity;
    for (const bot of wardens) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.body.pos.x - charge.x, bot.body.pos.z - charge.z);
      if (d < bestDist) {
        bestDist = d;
        best = bot;
      }
    }
    if (best) best.order = { type: 'pickup', x: charge.x, z: charge.z };
  }

  // --- Round flow ---
  function startRound() {
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.planted = false;
    state.plantSite = null;
    defuseProgress = 0;
    botPlantProgress = 0;
    state.attackSite = rng() < 0.5 ? 'A' : 'B';
    charge.state = 'carried';
    charge.carrier = playerEnt;
    charge.site = null;
    // Bots that died lose their gun (handled at death); survivors keep theirs.
    for (const bot of [...wardens, ...jackals]) botBuy(bot);
    assignOrders();
    hooks.onRoundStart(state);
  }

  function endRound(winnerTeam, reason) {
    state.phase = 'end';
    state.timer = 4.5;
    state.lastRoundWinner = winnerTeam;
    state.lastRoundReason = reason;
    if (winnerTeam === TEAM.WARDENS) state.scoreW += 1;
    else state.scoreJ += 1;
    for (const f of teamFighters(winnerTeam)) giveMoney(f, REWARD.win);
    const loser = winnerTeam === TEAM.WARDENS ? TEAM.JACKALS : TEAM.WARDENS;
    for (const f of teamFighters(loser)) giveMoney(f, REWARD.loss);
    hooks.onRoundEnd(state, winnerTeam, reason);
    if (state.scoreW >= WIN_SCORE || state.scoreJ >= WIN_SCORE || state.round >= MAX_ROUNDS) {
      state.winner = state.scoreW === state.scoreJ ? winnerTeam : (state.scoreW > state.scoreJ ? TEAM.WARDENS : TEAM.JACKALS);
    }
  }

  function plantCharge(siteKey, planter) {
    const site = map.sites[siteKey];
    state.planted = true;
    state.plantSite = siteKey;
    state.timer = DETONATE_TIME;
    charge.state = 'planted';
    charge.x = site.x;
    charge.z = site.z;
    charge.site = siteKey;
    charge.carrier = null;
    giveMoney(planter, REWARD.plant);
    for (const f of teamFighters(TEAM.WARDENS)) giveMoney(f, REWARD.teamPlant);
    ordersAfterPlant();
    hooks.onPlant(state, siteKey);
  }

  // Called by main when a fighter dies (player or bot), after its own bookkeeping.
  function notifyDeath(fighter, killer) {
    if (killer && killer.team !== undefined && killer !== fighter) {
      giveMoney(killer, REWARD.kill);
      if (killer.isPlayer) playerEnt.kills += 1;
    }
    if (fighter.isPlayer) playerEnt.deaths += 1;
    if (fighter.alive) return; // safety: deaths are final
    if (charge.state === 'carried' && charge.carrier === fighter) {
      charge.state = 'dropped';
      charge.carrier = null;
      charge.x = fighter.isPlayer ? fighter.chargeDropPos.x : fighter.body.pos.x;
      charge.z = fighter.isPlayer ? fighter.chargeDropPos.z : fighter.body.pos.z;
      ordersAfterDrop();
      hooks.onChargeDropped(charge);
    }
  }

  function step(dt) {
    now += dt;
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.phase = 'live';
        state.timer = ROUND_TIME;
        hooks.onLive(state);
      }
      return;
    }
    if (state.phase === 'end') {
      state.timer -= dt;
      if (state.timer <= 0) {
        if (state.winner !== null) {
          state.phase = 'matchEnd';
          hooks.onMatchEnd(state);
        } else {
          state.round += 1;
          hooks.onRoundReset(state);
          startRound();
        }
      }
      return;
    }
    if (state.phase !== 'live') return;

    state.timer -= dt;

    // Charge pickup by a bot walking over it.
    if (charge.state === 'dropped') {
      for (const bot of wardens) {
        if (bot.alive && Math.hypot(bot.body.pos.x - charge.x, bot.body.pos.z - charge.z) < 1.0) {
          charge.state = 'carried';
          charge.carrier = bot;
          const site = map.sites[state.attackSite];
          bot.order = { type: 'plant', x: site.x, z: site.z, site: state.attackSite };
          hooks.onChargePickup(bot);
          break;
        }
      }
    }

    // Bot planting.
    if (!state.planted && charge.state === 'carried' && charge.carrier && !charge.carrier.isPlayer) {
      const planter = charge.carrier;
      if (planter.channel && planter.channel.type === 'plant') {
        botPlantProgress += dt;
        hooks.onChannel('plant', botPlantProgress / PLANT_TIME);
        if (botPlantProgress >= PLANT_TIME) {
          botPlantProgress = 0;
          plantCharge(planter.channel.site, planter);
        }
      } else {
        botPlantProgress = Math.max(0, botPlantProgress - dt * 2);
      }
    }

    // Bot defusing.
    if (state.planted) {
      const defuser = jackals.find((b) => b.alive && b.channel && b.channel.type === 'defuse');
      if (defuser) {
        defuseProgress += dt;
        hooks.onChannel('defuse', defuseProgress / DEFUSE_TIME);
        if (defuseProgress >= DEFUSE_TIME) {
          state.planted = false;
          endRound(TEAM.JACKALS, 'Charge defused');
          return;
        }
      } else {
        defuseProgress = 0;
      }
      if (state.timer <= 0) {
        hooks.onDetonate(state);
        endRound(TEAM.WARDENS, 'Charge detonated');
        return;
      }
    }

    // Elimination and time.
    const wAlive = aliveCount(TEAM.WARDENS);
    const jAlive = aliveCount(TEAM.JACKALS);
    if (jAlive === 0) {
      endRound(TEAM.WARDENS, 'Jackals eliminated');
      return;
    }
    if (wAlive === 0 && !state.planted) {
      endRound(TEAM.JACKALS, 'Haulers eliminated');
      return;
    }
    if (!state.planted && state.timer <= 0) {
      endRound(TEAM.JACKALS, 'Time expired');
    }
  }

  return {
    state,
    charge,
    playerEnt,
    botMoney,
    buy,
    startRound,
    step,
    notifyDeath,
    plantCharge,
    aliveCount,
    get defuseProgress() { return defuseProgress / DEFUSE_TIME; },
    get now() { return now; },
  };
}
