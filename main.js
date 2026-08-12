// main.js — Pacing-only changes + improved mole/bomb graphics (canvas-drawn, more detailed)

(() => {
  // ---------- Utilities ----------
  function mulberry32(a) {
    return function() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  }
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  const qs = s => document.querySelector(s);

  // ---------- DOM ----------
  const canvas = qs('#game');
  const ctx = canvas.getContext('2d');
  const startBtn = qs('#startBtn');
  const pauseBtn = qs('#pauseBtn');
  const replayBtn = qs('#replayBtn');
  const seedInput = qs('#seedInput');
  const applySeedBtn = qs('#applySeed');
  const shareBtn = qs('#shareBtn');
  const scoreEl = qs('#score');
  const highEl = qs('#highscore');
  const leaderboardEl = qs('#leaderboard');
  const muteChk = qs('#mute');
  const vibrateChk = qs('#vibrate');
  const modeSelect = qs('#modeSelect');
  const durationInput = qs('#durationInput');
  const timerLabel = qs('#timerLabel');
  const modeLabel = qs('#modeLabel');
  const comboEl = qs('#combo');
  const multEl = qs('#mult');
  const livesRow = qs('#livesRow');
  const livesEl = qs('#lives');
  const bestComboEl = qs('#bestCombo');
  const gamesPlayedEl = qs('#gamesPlayed');
  const resetStatsBtn = qs('#resetStats');
  const difficultySelect = qs('#difficultySelect');

  // ---------- Game config ----------
  const GRID_R = 3, GRID_C = 3;
  let holes = [];
  let canvasSize = 900;
  let gameDuration = 30; // seconds for timed

  // dynamic state
  let seed = null;
  let rng = Math.random;
  let events = []; // spawn events (time in ms offset), sorted
  let activeMoles = [];
  let molePool = [];
  let particles = [];
  let floats = []; // floating score texts

  let audioCtx = null;

  // game mechanics
  let running = false;
  let paused = false;
  let startTs = 0;
  let pauseTs = 0;
  let elapsedBeforePause = 0;

  let score = 0;
  let combo = 0;
  let lastHitTs = 0;
  let bestCombo = 0;
  let gamesPlayed = 0;
  let lives = 3; // for endless

  // stats storage
  const STORAGE_KEY = 'wam_v2_stats';

  // ---------- Audio helpers ----------
  function ensureAudio(){
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  function playTone(freq, type='sine', dur=0.08, vol=0.06){
    if (muteChk.checked) return;
    ensureAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = 0;
    o.connect(g); g.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now+0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now+dur);
    o.start(now); o.stop(now+dur+0.02);
  }
  function playHit(ok, special){
    if (special === 'gold') playTone(1200,'sine',0.12,0.11);
    else if (special === 'freeze') playTone(700,'triangle',0.12,0.08);
    else if (special === 'bomb') playTone(160,'square',0.18,0.12);
    else playTone(ok?900:220, ok?'sine':'square', ok?0.06:0.08, ok?0.08:0.05);
  }

  function vibrate(pattern){ if (vibrateChk.checked && navigator.vibrate) navigator.vibrate(pattern); }

  // ---------- Storage ----------
  function loadStats(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }catch(e){return{}} }
  function saveStats(obj){ localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }
  function applyStatsToUI(){ const s = loadStats(); const board = s.leaderboard || []; leaderboardEl.innerHTML = ''; board.slice(0,10).forEach(it=>{ const li=document.createElement('li'); li.textContent = `#${board.indexOf(it)+1} ${it.score} — seed:${it.seed} mode:${it.mode}`; leaderboardEl.appendChild(li); }); gamesPlayedEl.textContent = String(s.gamesPlayed || 0); bestComboEl.textContent = String(s.bestCombo || 0); highEl.textContent = String((s.highscore)||0); }
  function recordGameResult(mode, seedStr, scoreVal, localBestCombo){ const s = loadStats(); s.leaderboard = s.leaderboard||[]; s.leaderboard.push({score: scoreVal, seed: seedStr, mode: mode, ts: Date.now()}); s.gamesPlayed = (s.gamesPlayed||0)+1; s.bestCombo = Math.max(s.bestCombo||0, localBestCombo); s.highscore = Math.max(s.highscore||0, scoreVal); saveStats(s); applyStatsToUI(); }
  function resetStats(){ localStorage.removeItem(STORAGE_KEY); applyStatsToUI(); }

  // ---------- Grid & drawing ----------
  function resizeCanvas(){ const parentW = canvas.parentElement.clientWidth - 320; const w = Math.min(900, Math.max(300, parentW > 0 ? parentW : 600)); canvasSize = w; canvas.width = canvas.height = canvasSize; computeHoles(); }
  function computeHoles(){ holes = []; const pad = canvasSize * 0.08; const usable = canvasSize - pad*2; const cellW = usable/GRID_C; const cellH = usable/GRID_R; const r = Math.min(cellW,cellH)*0.36; for(let ry=0;ry<GRID_R;ry++){ for(let cx=0;cx<GRID_C;cx++){ const x = pad + cx*cellW + cellW/2; const y = pad + ry*cellH + cellH/2; holes.push({x,y,r}); } } }
  function drawStatic(){ ctx.clearRect(0,0,canvasSize,canvasSize); ctx.fillStyle='#052a2a'; ctx.fillRect(0,0,canvasSize,canvasSize); holes.forEach(h=>{ const g = ctx.createRadialGradient(h.x,h.y-h.r*0.36, h.r*0.2, h.x, h.y, h.r*1.2); g.addColorStop(0, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r*1.1, h.r*0.6, 0, 0, Math.PI*2); ctx.fill(); }); }

  // ---------- Mole system ----------
  function moleCreate(holeIdx, startAbs, durationMs, type='normal'){
    return {hole:holeIdx, start:startAbs, end:startAbs+durationMs, hit:false, popProgress:0, type:type, glowShown:false, glowStart: startAbs - 120};
  }

  // Difficulty/pacing configuration
  function difficultyConfig(){
    const d = difficultySelect.value || 'normal';
    if (d === 'easy') return {
      intervalMul: 1.5,
      durationAdd: 300,
      // ramp-up: first 20% of time is slowed
      rampFraction: 0.20,
      rampMul: 1.6,
      minInterval: 350,
      maxConcurrent: 2
    };
    if (d === 'hard') return {
      intervalMul: 0.75,
      durationAdd: -120,
      rampFraction: 0.12,
      rampMul: 1.0,
      minInterval: 140,
      maxConcurrent: 4
    };
    // normal
    return {
      intervalMul: 1.0,
      durationAdd: 0,
      rampFraction: 0.18,
      rampMul: 1.3,
      minInterval: 220,
      maxConcurrent: 3
    };
  }

  function generateEvents(seedNum, mode){
    const cfg = difficultyConfig();
    const durMs = (mode==='timed' ? gameDuration*1000 : 1200000);
    const rngLocal = mulberry32(seedNum|0);
    const ev=[];
    let t = 300 + Math.floor(rngLocal()*400);
    while(t < durMs){
      const phase = t/durMs; // 0..1
      const holesCount = GRID_R*GRID_C;
      const hole = Math.floor(rngLocal()*holesCount);

      // --- choose type with difficulty-aware probabilities ---
      const difficultyLevel = (typeof difficultySelect !== 'undefined' && difficultySelect.value) ? difficultySelect.value : 'normal';
      const probs = {
        easy:   { gold: 0.03, freeze: 0.06, bomb: 0.10 },
        normal: { gold: 0.025, freeze: 0.05, bomb: 0.15 },
        hard:   { gold: 0.02, freeze: 0.04, bomb: 0.22 }
      };
      const p = probs[difficultyLevel] || probs.normal;
      const r = rngLocal();
      let type = 'normal';
      if (r < p.gold) type = 'gold';
      else if (r < p.gold + p.freeze) type = 'freeze';
      else if (r < p.gold + p.freeze + p.bomb) type = 'bomb';

      const baseDur = 700 - Math.floor(phase*400);
      const duration = Math.max(120, baseDur + Math.floor(rngLocal()*400) + cfg.durationAdd);
      ev.push({time: t, hole, duration, type});
      // interval base
      let interval = 300 + Math.floor(rngLocal()*700) - Math.floor(phase*400);
      // apply ramp-up for early phase to slow initial spawns
      if (phase < cfg.rampFraction) interval = Math.floor(interval * cfg.rampMul);
      // apply difficulty multiplier and enforce minimum interval
      interval = Math.max(cfg.minInterval, Math.floor(interval * cfg.intervalMul));
      t += interval;
      if (rngLocal() < 0.06) t += Math.floor(rngLocal()*120);
    }
    ev.sort((a,b)=>a.time-b.time);
    return ev;
  }

  // ---------- Particles & floats ----------
  function spawnParticles(x,y,color,count=12){ for(let i=0;i<count;i++){ const angle = Math.random()*Math.PI*2; const speed = 30 + Math.random()*120; particles.push({x,y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, born:performance.now(), life:800, color}); } }
  function spawnFloat(x,y,text,color='255,255,255'){ floats.push({x,y,text,color,born:performance.now(),life:900,vy:-30}); }
  function updateParticles(now, dt){ for(let i=particles.length-1;i>=0;i--){ const p=particles[i]; const age = now - p.born; if(age>p.life){ particles.splice(i,1); continue;} const t = dt/1000; p.vy += 80 * t; p.x += p.vx * t; p.y += p.vy * t; } for(let i=floats.length-1;i>=0;i--){ const f=floats[i]; const age=now-f.born; if(age>f.life){ floats.splice(i,1); continue;} f.y += f.vy * (dt/1000); } }
  function drawParticles(now){ particles.forEach(p=>{ const age = now - p.born; const a = 1 - age/p.life; ctx.beginPath(); ctx.fillStyle = `rgba(${p.color},${a})`; ctx.arc(p.x,p.y,4*Math.max(0.6,1 - age/p.life), 0, Math.PI*2); ctx.fill(); });
    // floats
    for(let i=floats.length-1;i>=0;i--){ const f=floats[i]; const age=now-f.born; if(age>f.life){ floats.splice(i,1); continue;} const a = 1 - age/f.life; ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = `rgba(${f.color},${a})`; ctx.fillText(f.text, f.x, f.y); } }

  // ---------- Improved Graphics: mole & bomb drawing ----------
  function drawMoleGraphic(ctx, x, y, r, type, prog, hit){
    // x,y = center base position (where hole is); r = hole.r
    // prog: 0..1 pop progress; hit: boolean
    ctx.save();
    // compute scale & vertical offset for pop effect
    const scale = 0.9 + 0.4 * prog;
    const yOffset = -r * 0.95 * (1 - prog) - (1 - Math.pow(1 - prog, 2)) * (r * 0.08);
    ctx.translate(x, y + yOffset);
    ctx.scale(scale, scale);

    // shadow
    ctx.beginPath(); ctx.fillStyle = 'rgba(0,0,0,0.36)'; ctx.ellipse(0, r*0.7, r*1.05, r*0.52, 0, 0, Math.PI*2); ctx.fill();

    // body gradient (fur-like)
    const bodyGrad = ctx.createLinearGradient(-r, -r, r, r);
    if (type === 'gold'){
      bodyGrad.addColorStop(0, '#ffefb2'); bodyGrad.addColorStop(1, '#f7c96e');
    } else if (type === 'freeze'){
      bodyGrad.addColorStop(0, '#bde6f7'); bodyGrad.addColorStop(1, '#6fb3d9');
    } else if (type === 'bomb'){
      bodyGrad.addColorStop(0, '#444'); bodyGrad.addColorStop(1, '#0a0a0a');
    } else {
      bodyGrad.addColorStop(0, '#d7a48d'); bodyGrad.addColorStop(1, '#b35f47');
    }
    ctx.beginPath(); ctx.fillStyle = bodyGrad; ctx.ellipse(0, -r*0.18, r*0.92, r*0.84, 0, 0, Math.PI*2); ctx.fill();

    // subtle fur strokes (quick hack-ish texture)
    ctx.save(); ctx.clip();
    for(let i=0;i<6;i++){ ctx.beginPath(); ctx.strokeStyle = `rgba(0,0,0,${0.03 + i*0.02})`; ctx.lineWidth = 1; const rx = (i-3)*r*0.18; ctx.ellipse(rx, -r*0.2 + i*1.5, r*0.7 - i*3, r*0.35 + i*0.06, 0, 0, Math.PI*2); ctx.stroke(); }
    ctx.restore();

    // ears
    ctx.beginPath(); const earLGrad = ctx.createRadialGradient(-r*0.56, -r*0.9, r*0.06, -r*0.56, -r*1.02, r*0.5); earLGrad.addColorStop(0, '#ffd9c4'); earLGrad.addColorStop(1, '#8b4b3a'); ctx.fillStyle = earLGrad; ctx.ellipse(-r*0.56, -r*0.9, r*0.22, r*0.28, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); const earRGrad = ctx.createRadialGradient(r*0.56, -r*0.9, r*0.06, r*0.56, -r*1.02, r*0.5); earRGrad.addColorStop(0, '#ffd9c4'); earRGrad.addColorStop(1, '#8b4b3a'); ctx.fillStyle = earRGrad; ctx.ellipse(r*0.56, -r*0.9, r*0.22, r*0.28, 0, 0, Math.PI*2); ctx.fill();

    // nose & mouth
    ctx.beginPath(); ctx.fillStyle = hit ? '#66d966' : '#3b1b18'; ctx.ellipse(0, -r*0.06, r*0.12, r*0.09, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.strokeStyle = 'rgba(20,10,8,0.9)'; ctx.lineWidth = 1.6; ctx.moveTo(-r*0.06, -r*0.02); ctx.quadraticCurveTo(0, r*0.06, r*0.2, r*0.12); ctx.moveTo(r*0.06, -r*0.02); ctx.quadraticCurveTo(0, r*0.06, -r*0.2, r*0.12); ctx.stroke();

    // whiskers
    ctx.strokeStyle = 'rgba(60,40,30,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-r*0.12, -r*0.02); ctx.lineTo(-r*0.7, -r*0.1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-r*0.12, r*0.02); ctx.lineTo(-r*0.7, r*0.12); ctx.stroke(); ctx.beginPath(); ctx.moveTo(r*0.12, -r*0.02); ctx.lineTo(r*0.7, -r*0.1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(r*0.12, r*0.02); ctx.lineTo(r*0.7, r*0.12); ctx.stroke();

    // eyes with glossy highlight
    ctx.beginPath(); ctx.fillStyle = '#060606'; ctx.ellipse(-r*0.22, -r*0.36, r*0.12, r*0.12, 0, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.fillStyle = '#060606'; ctx.ellipse(r*0.22, -r*0.36, r*0.12, r*0.12, 0, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.ellipse(-r*0.16, -r*0.42, r*0.04, r*0.04, 0, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.ellipse(r*0.16, -r*0.42, r*0.04, r*0.04, 0, 0, Math.PI*2); ctx.fill();

    // gold star for gold type
    if (type==='gold'){
      ctx.fillStyle='#fff'; ctx.font = `${r*0.6}px serif`; ctx.textAlign='center'; ctx.fillText('★', 0, -r*0.18);
    }

    ctx.restore();
  }

  function drawBombGraphic(ctx, x, y, r, prog){
    // draw a more realistic bomb with glossy metal fuse
    ctx.save();
    const scale = 0.9 + 0.38 * prog;
    const yOffset = -r * 0.95 * (1 - prog);
    ctx.translate(x, y + yOffset);
    ctx.scale(scale, scale);

    // shadow
    ctx.beginPath(); ctx.fillStyle = 'rgba(0,0,0,0.36)'; ctx.ellipse(0, r*0.7, r*1.05, r*0.5, 0, 0, Math.PI*2); ctx.fill();

    // bomb body gradient
    const g = ctx.createRadialGradient(-r*0.2, -r*0.2, r*0.1, 0,0,r*1.1);
    g.addColorStop(0, '#666666'); g.addColorStop(0.6,'#111111'); g.addColorStop(1,'#000000');
    ctx.beginPath(); ctx.fillStyle = g; ctx.arc(0, -r*0.2, r*0.78, 0, Math.PI*2); ctx.fill();

    // glossy highlight
    ctx.beginPath(); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.ellipse(-r*0.28, -r*0.5, r*0.32, r*0.18, -0.6, 0, Math.PI*2); ctx.fill();

    // metal cap
    ctx.beginPath(); const capG = ctx.createLinearGradient(-r, -r*0.5, r, -r*0.5); capG.addColorStop(0,'#bbbbbb'); capG.addColorStop(1,'#777'); ctx.fillStyle = capG; ctx.ellipse(0, -r*0.98, r*0.2, r*0.12, 0, 0, Math.PI*2); ctx.fill();

    // fuse
    ctx.beginPath(); ctx.strokeStyle = '#6b3b1a'; ctx.lineWidth = 3; ctx.moveTo(0, -r*1.05); ctx.quadraticCurveTo(r*0.18, -r*1.32, r*0.5, -r*1.28); ctx.stroke();
    // spark tip if near end
    const sparkSize = 4 + Math.sin(performance.now()/80)*2;
    ctx.beginPath(); ctx.fillStyle = '#ffd86b'; ctx.arc(r*0.5, -r*1.28, sparkSize/2, 0, Math.PI*2); ctx.fill();

    // small 'B' label subtle
    ctx.beginPath(); ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.font = `${r*0.28}px sans-serif`; ctx.textAlign='center'; ctx.fillText('B', 0, -r*0.1);

    ctx.restore();
  }

  // ---------- Loop & rendering ----------
  let rafId = null;
  function startLoop(){ if(rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop); }
  function stopLoop(){ if(rafId) cancelAnimationFrame(rafId); rafId = null; }
  function loop(now){ if (!running) return; if (paused){ rafId = requestAnimationFrame(loop); return; }
    const elapsed = now - startTs + elapsedBeforePause; // ms since game start

    // spawn events -> convert to absolute timestamps
    while(events.length && events[0].time <= elapsed){
      const e = events.shift();
      const cfg = difficultyConfig();
      // if too many active moles, delay this event slightly instead of activating immediately
      if (activeMoles.length >= cfg.maxConcurrent){
        // small randomized delay to spread activations
        const delay = 180 + Math.floor(Math.random()*160);
        e.time += delay;
        events.push(e);
        events.sort((a,b)=>a.time-b.time);
        continue;
      }
      const startAbs = startTs + e.time;
      activeMoles.push(moleCreate(e.hole, startAbs, e.duration, e.type));
    }

    // draw
    drawStatic();
    const nowMs = performance.now();
    // update and draw moles
    for(let i=activeMoles.length-1;i>=0;i--){ const m = activeMoles[i]; const hole = holes[m.hole]; const appearIn = 120; const s = m.start; const e = m.end; // absolute
      // glow
      if (!m.glowShown && nowMs >= (m.glowStart || (s-120))){ m.glowShown = true; }
      if (m.glowShown && nowMs < s){ const tTo = Math.max(0, s - nowMs); const a = clamp(1 - tTo/140, 0, 1); ctx.beginPath(); const g = ctx.createRadialGradient(hole.x, hole.y, hole.r*0.2, hole.x, hole.y, hole.r*1.2); g.addColorStop(0, `rgba(255,255,255,${a*0.18})`); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(hole.x, hole.y, hole.r*1.2, hole.r*0.6,0,0,Math.PI*2); ctx.fill(); }
      // pop progress
      let prog = 0; if (nowMs < s) prog = 0; else if (nowMs < s + appearIn) prog = (nowMs - s)/appearIn; else if (nowMs < e) prog = 1; else prog = Math.max(0, 1 - (nowMs - e)/200);
      m.popProgress = prog;
      if (prog > 0.01){ const px = hole.x; const py = hole.y - hole.r * 0.95 * (1 - prog); // draw according to type
          if (m.type === 'bomb') drawBombGraphic(ctx, px, py, hole.r, prog);
          else drawMoleGraphic(ctx, px, py, hole.r, m.type, prog, m.hit);
        }
      // remove fully gone
      if (nowMs > m.end + 600) activeMoles.splice(i,1);
    }

    // update & draw particles & floats
    updateParticles(nowMs, 16.67);
    drawParticles(nowMs);

    // UI updates
    if (modeSelect.value === 'timed'){ const remain = Math.max(0, Math.ceil((gameDuration*1000 - elapsed)/1000)); timerLabel.textContent = String(remain); if (elapsed >= gameDuration*1000 && activeMoles.length===0){ endGame(); } }

    rafId = requestAnimationFrame(loop);
  }

  // ---------- Game control ----------
  function startGame(){ if (running) return; if (audioCtx && audioCtx.state==='suspended') audioCtx.resume(); if (!audioCtx) ensureAudio(); score = 0; combo = 0; lastHitTs = 0; bestCombo = Math.m[...];
