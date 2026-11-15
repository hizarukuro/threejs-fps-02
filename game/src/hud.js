// DOM HUD: everything the player reads. render() takes a plain snapshot each frame and
// touches the DOM only when a value actually changed, so the hot loop stays cheap.
import { WEAPONS, ARMOR_PRICE, GRENADE_PRICE, SMOKE_PRICE } from './weapons.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const els = {
    timer: $('timer'), phase: $('phase-label'), scoreW: $('score-w'), scoreJ: $('score-j'),
    round: $('round-label'), health: $('health-fill'), healthText: $('health-text'),
    armor: $('armor-tag'), money: $('money'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'), grenades: $('grenade-count'), hitmarker: $('hitmarker'),
    pipsW: $('pips-w'), pipsJ: $('pips-j'),
    crosshair: $('crosshair'), feed: $('kill-feed'), banner: $('banner'), bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'), prompt: $('prompt'), channel: $('channel'), channelFill: $('channel-fill'),
    channelLabel: $('channel-label'), chargeTag: $('charge-tag'), vignette: $('vignette'),
    buyMenu: $('buy-menu'), buyMoney: $('buy-money'), buyTimer: $('buy-timer'), buyItems: $('buy-items'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    overlayButton: $('overlay-button'), minimap: $('minimap'), radioFeed: $('radio-feed'),
  };
  const cache = new Map();
  function set(key, el, value) {
    if (cache.get(key) !== value) {
      cache.set(key, value);
      el.textContent = value;
    }
  }
  function setWidth(key, el, pct) {
    const v = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    if (cache.get(key) !== v) {
      cache.set(key, v);
      el.style.width = v;
    }
  }

  let hitTtl = 0;
  let hitUntil = -1; // sim-time deadline when set (staged frames freeze sim time)
  let hurtTtl = 0;
  let bannerUntil = 0;

  // --- Buy menu items (built once) ---
  const buyDefs = [
    { item: 'smg', label: WEAPONS.smg.name, key: '1' },
    { item: 'rifle', label: WEAPONS.rifle.name, key: '2' },
    { item: 'dmr', label: WEAPONS.dmr.name, key: '3' },
    { item: 'armor', label: 'Kevlar vest + helmet', key: '4', price: ARMOR_PRICE },
    { item: 'grenade', label: 'Frag grenade', key: '5', price: GRENADE_PRICE },
    { item: 'smoke', label: 'Smoke canister', key: '6', price: SMOKE_PRICE },
  ];
  const buyButtons = new Map();
  for (const def of buyDefs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'buy-item';
    const price = def.price !== undefined ? def.price : WEAPONS[def.item].price;
    btn.innerHTML = `<span class="buy-key">${def.key}</span><span class="buy-name">${def.label}</span><span class="buy-price">$${price}</span>`;
    btn.addEventListener('click', () => hud.onBuy && hud.onBuy(def.item));
    els.buyItems.appendChild(btn);
    buyButtons.set(def.item, btn);
  }

  // --- Minimap: static yard outline painted once, dots per frame. ---
  const mm = els.minimap.getContext('2d');
  const MM_W = els.minimap.width;
  const MM_H = els.minimap.height;
  const toMap = (x, z) => [((x + 34) / 68) * MM_W, ((z + 24) / 48) * MM_H];
  function paintMinimapBase() {
    mm.fillStyle = 'rgba(16,18,24,0.82)';
    mm.fillRect(0, 0, MM_W, MM_H);
    mm.strokeStyle = 'rgba(255,255,255,0.25)';
    mm.strokeRect(...toMap(-30, -10), ((22) / 68) * MM_W, ((20) / 48) * MM_H);
    // Container footprints (mirrors map.js) so the yard's lanes read at a glance.
    mm.fillStyle = 'rgba(238,240,234,0.20)';
    const blocks = [
      [0, -8, 12, 2.4], [0, 6, 12, 2.4], [12, -1, 2.4, 12], [24, 4, 12, 2.4], [24, -8, 2.4, 12],
      [-14, -4, 2.4, 12], [-24, 6, 12, 2.4], [10, 14, 12, 2.4], [30, -16, 2.4, 12], [-24, -14, 2.4, 12],
      [5, -2, 2.2, 2.2], [-2, 3, 2.2, 2.2], [16, -6, 2.2, 2.2],
    ];
    for (const [cx, cz, w, d] of blocks) {
      const [px, py] = toMap(cx - w / 2, cz - d / 2);
      mm.fillRect(px, py, (w / 68) * MM_W, (d / 48) * MM_H);
    }
    mm.fillStyle = '#ffc44d';
    mm.font = '700 10px system-ui';
    const [ax, ay] = toMap(-4.2, -1);
    mm.fillText('A', ax - 3, ay + 3);
    mm.fillStyle = '#6ec3ff';
    const [bx, by] = toMap(24.5, -15);
    mm.fillText('B', bx - 3, by + 3);
    mm.fillStyle = 'rgba(238,240,234,0.5)';
    mm.font = '600 8px system-ui';
    const [dx, dy] = toMap(-4, 6.5);
    mm.fillText('DOCK', dx - 10, dy);
    const [mx, my] = toMap(9, 1);
    mm.fillText('MID', mx - 7, my);
    const [fx, fy] = toMap(21, -19.5);
    mm.fillText('FUEL', fx - 9, fy);
  }
  paintMinimapBase();

  const hud = {
    onBuy: null,
    onOverlayButton: null,

    render(s, now) {
      const mmss = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
      set('timer', els.timer, mmss(s.timer));
      els.timer.classList.toggle('urgent', s.timer < 10 && s.phase === 'live');
      set('phase', els.phase, s.phaseLabel);
      set('scoreW', els.scoreW, String(s.scoreW));
      set('scoreJ', els.scoreJ, String(s.scoreJ));
      // Alive pips beside each score: the round's manpower at a glance.
      const pips = (alive) => '<i class="on"></i>'.repeat(alive) + '<i></i>'.repeat(Math.max(0, 5 - alive));
      const pw = pips(s.aliveW ?? 5);
      if (cache.get('pipsW') !== pw) { cache.set('pipsW', pw); els.pipsW.innerHTML = pw; }
      const pj = pips(s.aliveJ ?? 5);
      if (cache.get('pipsJ') !== pj) { cache.set('pipsJ', pj); els.pipsJ.innerHTML = pj; }
      set('round', els.round, `ROUND ${s.round}`);
      setWidth('health', els.health, s.health);
      set('healthText', els.healthText, `${Math.ceil(s.health)}`);
      els.armor.style.visibility = s.armor ? 'visible' : 'hidden';
      set('money', els.money, `$${s.money}`);
      set('ammoMag', els.ammoMag, s.reloading ? '--' : String(s.ammoMag));
      set('ammoReserve', els.ammoReserve, `/ ${s.ammoReserve}`);
      set('weaponName', els.weaponName, s.weaponName);
      set('grenades', els.grenades, `FRAG × ${s.grenades} · SMOKE × ${s.smokes}`);
      els.crosshair.style.setProperty('--gap', `${6 + s.spreadPx}px`);
      els.chargeTag.style.visibility = s.chargeTag ? 'visible' : 'hidden';
      if (s.chargeTag) set('chargeTag', els.chargeTag, s.chargeTag);

      if (hitUntil >= 0 && now > hitUntil) {
        hitUntil = -1;
        els.hitmarker.classList.remove('on', 'kill');
      }
      if (hitTtl > 0) {
        hitTtl -= 1;
        if (hitTtl === 0) els.hitmarker.classList.remove('on', 'kill');
      }
      if (hurtTtl > 0) {
        hurtTtl -= 1;
        if (hurtTtl === 0) els.vignette.classList.remove('on');
      }
      if (bannerUntil && now > bannerUntil) {
        bannerUntil = 0;
        els.banner.classList.remove('on');
      }
      // Channel bar (planting / defusing).
      if (s.channel) {
        els.channel.classList.add('on');
        set('channelLabel', els.channelLabel, s.channel.label);
        setWidth('channelFill', els.channelFill, s.channel.frac * 100);
      } else {
        els.channel.classList.remove('on');
      }
      set('prompt', els.prompt, s.prompt || '');
      // Minimap dots: teammates + the player arrow; enemies stay hidden (tactical).
      paintMinimapBase();
      for (const d of s.mapDots) {
        const [px, py] = toMap(d.x, d.z);
        mm.fillStyle = d.color;
        mm.beginPath();
        mm.arc(px, py, d.r || 2.4, 0, Math.PI * 2);
        mm.fill();
      }
      if (s.playerArrow) {
        const [px, py] = toMap(s.playerArrow.x, s.playerArrow.z);
        mm.save();
        mm.translate(px, py);
        mm.rotate(-s.playerArrow.yaw);
        mm.fillStyle = '#ffffff';
        mm.beginPath();
        mm.moveTo(0, -5);
        mm.lineTo(3.4, 4);
        mm.lineTo(-3.4, 4);
        mm.closePath();
        mm.fill();
        mm.restore();
      }
    },

    hitmarker(kill, now) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', kill);
      // With a sim time the marker lives on the sim clock (so a frozen staged
      // frame keeps it, like the banner); without one it counts render frames.
      if (typeof now === 'number') {
        hitUntil = now + (kill ? 0.3 : 0.18);
        hitTtl = 0;
      } else {
        hitTtl = kill ? 14 : 7;
      }
    },
    hurt() {
      els.vignette.classList.add('on');
      hurtTtl = 10;
    },
    feed(html, sticky = false) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = html;
      els.feed.appendChild(row);
      while (els.feed.children.length > 5) els.feed.firstChild.remove();
      if (!sticky) {
        setTimeout(() => row.classList.add('fade'), 3600);
        setTimeout(() => row.remove(), 4300);
      }
    },
    radio(speaker, text, team, sticky = false) {
      const row = document.createElement('div');
      row.className = 'radio-row';
      row.innerHTML = `<span class="${team === 0 ? 'w' : 'j'}">${speaker}:</span> ${text}`;
      els.radioFeed.appendChild(row);
      while (els.radioFeed.children.length > 4) els.radioFeed.firstChild.remove();
      if (!sticky) {
        setTimeout(() => row.classList.add('fade'), 5200);
        setTimeout(() => row.remove(), 5900);
      }
    },
    clearFeeds() {
      els.feed.innerHTML = '';
      els.radioFeed.innerHTML = '';
    },
    banner(title, sub, seconds, now) {
      set('bannerTitle', els.bannerTitle, title);
      set('bannerSub', els.bannerSub, sub || '');
      els.banner.classList.add('on');
      bannerUntil = now + seconds;
    },
    clearBanner() {
      bannerUntil = 0;
      els.banner.classList.remove('on');
    },
    showBuy(money, kit) {
      els.buyMenu.classList.add('on');
      hud.refreshBuy(money, kit);
    },
    hideBuy() {
      els.buyMenu.classList.remove('on');
    },
    refreshBuy(money, kit) {
      set('buyMoney', els.buyMoney, `$${money}`);
      for (const [item, btn] of buyButtons) {
        const price = item === 'armor' ? ARMOR_PRICE : item === 'grenade' ? GRENADE_PRICE : item === 'smoke' ? SMOKE_PRICE : WEAPONS[item].price;
        const owned = (item === 'armor' && kit.armor) || (item !== 'armor' && item !== 'grenade' && item !== 'smoke' && kit.primary === item)
          || (item === 'grenade' && kit.grenades >= 2) || (item === 'smoke' && kit.smokes >= 2);
        btn.disabled = owned || money < price;
        btn.classList.toggle('owned', owned);
      }
    },
    setBuyTimer(t) {
      set('buyTimer', els.buyTimer, `Deploy in ${Math.ceil(Math.max(0, t))}s — press B or click Deploy`);
    },
    showOverlay(kind, data = {}) {
      els.overlay.classList.add('on');
      if (kind === 'start') {
        set('ovT', els.overlayTitle, 'NIGHT FREIGHT');
        set('ovC', els.overlayCopy, 'Vesper Yard at golden hour. Your Haulers carry the charge: plant it at the Loading Bay or the Fuel Yard, or wipe the Jackals out. First to 7 rounds.');
        set('ovB', els.overlayButton, 'Click to play');
      } else if (kind === 'pause') {
        set('ovT', els.overlayTitle, 'Paused');
        set('ovC', els.overlayCopy, 'The yard waits. Click to get back in.');
        set('ovB', els.overlayButton, 'Resume');
      } else if (kind === 'matchEnd') {
        set('ovT', els.overlayTitle, data.win ? 'HAULERS TAKE THE YARD' : 'JACKALS HOLD THE YARD');
        set('ovC', els.overlayCopy, `Final score ${data.scoreW} — ${data.scoreJ}. ${data.win ? 'The freight rolls out under your flag.' : 'The depot stays dark another night.'}`);
        set('ovB', els.overlayButton, 'Play again');
      } else if (kind === 'dead') {
        set('ovT', els.overlayTitle, 'You are down');
        set('ovC', els.overlayCopy, 'Your team fights on. Watching from the dock cameras…');
        set('ovB', els.overlayButton, 'Spectate');
      }
    },
    hideOverlay() {
      els.overlay.classList.remove('on');
    },
  };
  els.overlayButton.addEventListener('click', () => hud.onOverlayButton && hud.onOverlayButton());
  return hud;
}
