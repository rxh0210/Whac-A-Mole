// main.js — 改良：难度选择（Easy/Normal/Hard）、更大命中半径、更明显视觉、命中飘字
// 注：已移除自定义光标和画布内锤子绘制（按要求撤回）

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
  function applyStatsToUI(){ const s = loadStats(); const board = s.leaderboard || []; leaderboardEl.innerHTML = ''; board.slice(0,10).forEach(it=>{ const li=document.createElement('li'); li.textContent = `${it.score} — seed:${it.seed} (${it.mode})`; leaderboardEl.appendChild(li); }); highEl.textContent = (s.highscore||0); bestComboEl.textContent = (s.bestCombo||0); gamesPlayedEl.textContent = (s.gamesPlayed||0); }
  function recordGameResult(mode, seedStr, scoreVal, localBestCombo){ const s = loadStats(); s.leaderboard = s.leaderboard||[]; s.leaderboard.push({score: scoreVal, seed: seedStr, mode: mode, ts: Date.now()}); s.leaderboard.sort((a,b)=>b.score-a.score); s.leaderboard = s.leaderboard.slice(0,50); s.highscore = Math.max(s.highscore||0, scoreVal); s.bestCombo = Math.max(s.bestCombo||0, localBestCombo||0); s.gamesPlayed = (s.gamesPlayed||0) + 1; saveStats(s); applyStatsToUI(); }
  function resetStats(){ localStorage.removeItem(STORAGE_KEY); applyStatsToUI(); }

  // ---------- Grid & drawing ----------
  function resizeCanvas(){ const parentW = canvas.parentElement.clientWidth - 320; const w = Math.min(900, Math.max(300, parentW > 0 ? parentW : 600)); canvasSize = w; canvas.width = canvas.height = canvasSize; computeHoles(); drawStatic(); }
  function computeHoles(){ holes = []; const pad = canvasSize * 0.08; const usable = canvasSize - pad*2; const cellW = usable/GRID_C; const cellH = usable/GRID_R; const r = Math.min(cellW,cellH)*0.38; for(let i=0;i<GRID_R;i++)for(let j=0;j<GRID_C;j++){const cx=pad+j*cellW+cellW/2; const cy=pad+i*cellH+cellH/2; holes.push({x:cx,y:cy,r:r,index:i*GRID_C+j}); } }
  function drawStatic(){ ctx.clearRect(0,0,canvasSize,canvasSize); ctx.fillStyle='#052a2a'; ctx.fillRect(0,0,canvasSize,canvasSize); holes.forEach(h=>{ const g = ctx.createRadialGradient(h.x,h.y-h.r*0.2,h.r*0.2,h.x,h.y+h.r*0.5,h.r*1.4); g.addColorStop(0,'#0b2c2a'); g.addColorStop(1,'#031616'); ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(h.x,h.y+h.r*0.2,h.r*1.3,h.r*0.62,0,0,Math.PI*2); ctx.fill(); }); }

  // ---------- Mole system ----------
  function moleCreate(holeIdx, startAbs, durationMs, type='normal'){
    return {hole:holeIdx, start:startAbs, end:startAbs+durationMs, hit:false, popProgress:0, type:type, glowShown:false, glowStart: startAbs - 120};
  }

  function difficultyConfig(mode){
    const d = difficultySelect.value || 'normal';
    if (d==='easy') return {intervalMul:1.5, durationAdd:250, earlyEase:1.6};
    if (d==='hard') return {intervalMul:0.75, durationAdd:-150, earlyEase:0.9};
    return {intervalMul:1.0, durationAdd:0, earlyEase:1.0};
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
      let type='normal'; const r = rngLocal(); if (r < 0.02) type='gold'; else if (r < 0.05) type='freeze'; else if (r < 0.08) type='bomb';
      const baseDur = 700 - Math.floor(phase*400);
      const duration = Math.max(120, baseDur + Math.floor(rngLocal()*400) + cfg.durationAdd);
      ev.push({time: t, hole, duration, type});
      // interval base
      let interval = 300 + Math.floor(rngLocal()*700) - Math.floor(phase*400);
      // easier: make early part slower
      if (phase < 0.12) interval = Math.floor(interval * cfg.earlyEase);
      interval = Math.max(100, Math.floor(interval * cfg.intervalMul));
      t += interval;
      if (rngLocal() < 0.06) t += Math.floor(rngLocal()*120);
    }
    ev.sort((a,b)=>a.time-b.time);
    return ev;
  }

  // ---------- Particles & floats ----------
  function spawnParticles(x,y,color,count=12){ for(let i=0;i<count;i++){ const angle = Math.random()*Math.PI*2; const speed = 30 + Math.random()*120; particles.push({x,y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed, life:600 + Math.random()*200, born:performance.now(), color}); }}
  function spawnFloat(x,y,text,color='255,255,255'){ floats.push({x,y,text,color,born:performance.now(),life:900,vy:-30}); }
  function updateParticles(now, dt){ for(let i=particles.length-1;i>=0;i--){ const p=particles[i]; const age = now - p.born; if(age>p.life){ particles.splice(i,1); continue;} const t = dt/1000; p.vy += 300*t; p.x += p.vx * t; p.y += p.vy * t; }}
  function drawParticles(now){ particles.forEach(p=>{ const age = now - p.born; const a = 1 - age/p.life; ctx.beginPath(); ctx.fillStyle = `rgba(${p.color},${a})`; ctx.arc(p.x,p.y,4*Math.max(0.6,a),0,Math.PI*2); ctx.fill(); });
    // floats
    for(let i=floats.length-1;i>=0;i--){ const f=floats[i]; const age=now-f.born; if(age>f.life){ floats.splice(i,1); continue;} const a = 1 - age/f.life; ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = `rgba(${f.color},${a})`; ctx.textAlign='center'; ctx.fillText(f.text, f.x, f.y + (age/1000)*f.vy); }}

  // ---------- Loop & rendering ----------
  let rafId = null;
  function startLoop(){ if(rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop); }
  function stopLoop(){ if(rafId) cancelAnimationFrame(rafId); rafId = null; }
  function loop(now){ if (!running) return; if (paused){ rafId = requestAnimationFrame(loop); return; }
    const elapsed = now - startTs + elapsedBeforePause; // ms since game start

    // spawn events -> convert to absolute timestamps
    while(events.length && events[0].time <= elapsed){ const e = events.shift(); const startAbs = startTs + e.time; activeMoles.push(moleCreate(e.hole, startAbs, e.duration, e.type)); }

    // draw
    drawStatic();
    const nowMs = performance.now();
    // update and draw moles
    for(let i=activeMoles.length-1;i>=0;i--){ const m = activeMoles[i]; const hole = holes[m.hole]; const appearIn = 120; const s = m.start; const e = m.end; // absolute
      // glow
      if (!m.glowShown && nowMs >= (m.glowStart || (s-120))){ m.glowShown = true; }
      if (m.glowShown && nowMs < s){ const tTo = Math.max(0, s - nowMs); const a = clamp(1 - tTo/140, 0, 1); ctx.beginPath(); const g = ctx.createRadialGradient(hole.x, hole.y, hole.r*0.2, hole.x, hole.y, hole.r*1.6); g.addColorStop(0, `rgba(255,255,255,${0.12*a})`); g.addColorStop(1, `rgba(255,255,255,${0.01*a})`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hole.x, hole.y - hole.r*0.1, hole.r*1.25 + 6*a, 0, Math.PI*2); ctx.fill(); }
      // pop progress
      let prog = 0; if (nowMs < s) prog = 0; else if (nowMs < s + appearIn) prog = (nowMs - s)/appearIn; else if (nowMs < e) prog = 1; else prog = Math.max(0, 1 - (nowMs - e)/200);
      m.popProgress = prog;
      if (prog > 0.01){ const px = hole.x; const py = hole.y - hole.r * 0.95 * (1 - prog); const scale = 0.9 + 0.35 * prog; ctx.save(); ctx.translate(px, py); ctx.scale(scale, scale);
          // stronger shadow
          ctx.beginPath(); ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.ellipse(0, hole.r*0.7, hole.r*1.05, hole.r*0.5,0,0,Math.PI*2); ctx.fill();
          // body
          let fill = '#d96f5d'; if (m.type==='gold') fill = '#ffd86b'; if (m.type==='freeze') fill = '#6fb3d9'; if (m.type==='bomb') fill = '#6c6c6c'; if (m.hit) fill = '#8ee78e';
          ctx.beginPath(); ctx.fillStyle = fill; ctx.ellipse(0, -hole.r*0.2, hole.r*0.85, hole.r*0.78,0,0,Math.PI*2); ctx.fill();
          // highlight
          ctx.beginPath(); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.ellipse(-hole.r*0.18, -hole.r*0.38, hole.r*0.16, hole.r*0.12,0,0,Math.PI*2); ctx.fill();
          // eyes
          ctx.fillStyle = '#071018'; ctx.beginPath(); ctx.ellipse(-hole.r*0.22,-hole.r*0.35, hole.r*0.12, hole.r*0.12,0,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(hole.r*0.22,-hole.r*0.35,hole.r*0.12,hole.r*0.12,0,0,Math.PI*2); ctx.fill();
          // gold star
          if (m.type==='gold'){ ctx.fillStyle='#fff'; ctx.font = `${hole.r*0.6}px serif`; ctx.textAlign='center'; ctx.fillText('★',0,-hole.r*0.2); }
        ctx.restore(); }
      // remove fully gone
      if (nowMs > m.end + 600) activeMoles.splice(i,1);
    }

    // update & draw particles & floats
    updateParticles(nowMs, 16.67);
    drawParticles(nowMs);

    // UI updates
    if (modeSelect.value === 'timed'){ const remain = Math.max(0, Math.ceil((gameDuration*1000 - elapsed)/1000)); timerLabel.textContent = String(remain); if (elapsed >= gameDuration*1000 && activeMoles.length === 0 && events.length === 0){ endGame(); return; } } else { timerLabel.textContent = '—'; }

    rafId = requestAnimationFrame(loop);
  }

  // ---------- Game control ----------
  function startGame(){ if (running) return; if (audioCtx && audioCtx.state==='suspended') audioCtx.resume(); if (!audioCtx) ensureAudio(); score = 0; combo = 0; lastHitTs = 0; bestCombo = Math.max(bestCombo, combo); gamesPlayed = (loadStats().gamesPlayed||0); scoreEl.textContent = score; comboEl.textContent = combo; multEl.textContent = '1.0'; if (!seed) setSeedFromInput(); const seedNum = parseInt(seed) || hashStringToInt(seed); gameDuration = Math.max(5, Number(durationInput.value) || 30); events = generateEvents(seedNum, modeSelect.value); activeMoles = []; particles = []; floats = []; startTs = performance.now(); elapsedBeforePause = 0; paused = false; running = true; lives = (modeSelect.value==='endless' ? 3 : 0); livesEl.textContent = lives; livesRow.style.display = (modeSelect.value==='endless'?'block':'none'); startBtn.disabled = true; pauseBtn.disabled = false; pauseBtn.textContent='暂停'; modeLabel.textContent = (modeSelect.value==='timed'?'Timed':'Endless');
    canvas.style.cursor = 'default';
    startLoop(); }

  function pauseGame(){ if (!running) return; if (paused){ paused = false; const now = performance.now(); elapsedBeforePause += now - pauseTs; pauseTs = 0; pauseBtn.textContent = '暂停'; startLoop(); } else { paused = true; pauseTs = performance.now(); pauseBtn.textContent = '继续'; stopLoop(); }}

  function endGame(){ running = false; stopLoop(); startBtn.disabled = false; pauseBtn.disabled = true; replayBtn.disabled = false; canvas.style.cursor = 'default'; const seedStr = String(seed); recordGameResult(modeSelect.value, seedStr, score, bestCombo); alert(`游戏结束！得分 ${score}`); }

  function replayGame(){ startGame(); }

  // ---------- Input handling ----------
  function getMousePos(evt){ const rect = canvas.getBoundingClientRect(); const clientX = evt.clientX || (evt.touches && evt.touches[0].clientX); const clientY = evt.clientY || (evt.touches && evt.touches[0].clientY); const x = clientX - rect.left; const y = clientY - rect.top; const scaleX = canvas.width / rect.width; const scaleY = canvas.height / rect.height; return {x: x*scaleX, y: y*scaleY}; }

  function handleHitAtPoint(pt){ if (!running || paused) return; for(const hole of holes){ const dx = pt.x - hole.x, dy = pt.y - hole.y; if (Math.hypot(dx,dy) < hole.r * 1.4){ const now = performance.now(); const cand = activeMoles.find(m => m.hole === hole.index && m.popProgress > 0.18 && !m.hit && now < m.end); if (cand){ cand.hit = true; if (now - lastHitTs < 1000) { combo += 1; } else { combo = 1; } lastHitTs = now; bestCombo = Math.max(bestCombo, combo); const mult = 1 + Math.floor(combo/10)*0.5; let base = 10; if (cand.type==='gold') base = 50; if (cand.type==='bomb'){ score = Math.max(0, score - 30); playHit(false, 'bomb'); vibrate([120]); spawnParticles(hole.x, hole.y, '200,80,60', 18); spawnFloat(hole.x, hole.y - hole.r, '-30', '255,100,100'); } else { score += Math.round(base * mult); playHit(true, cand.type); vibrate([20]); spawnParticles(hole.x, hole.y, '255,220,120', (cand.type==='gold'?28:14)); spawnFloat(hole.x, hole.y - hole.r, `+${Math.round(base * mult)}`, '255,255,255'); } scoreEl.textContent = score; comboEl.textContent = combo; multEl.textContent = mult.toFixed(1); cand.end = performance.now() + 80; if (cand.type==='freeze'){ const freezeMs = 1200; for(const e of events){ e.time += freezeMs * 0.4 * (Math.random()+0.6); } } if (cand.type==='bomb' && modeSelect.value==='endless'){ lives = Math.max(0, lives-1); livesEl.textContent = lives; if (lives<=0){ endGame(); return; } } return; } else { score = Math.max(0, score - 1); playHit(false); vibrate([30]); combo = 0; comboEl.textContent = combo; multEl.textContent = '1.0'; scoreEl.textContent = score; return; } } } score = Math.max(0, score - 1); playHit(false); combo = 0; comboEl.textContent = combo; multEl.textContent = '1.0'; scoreEl.textContent = score; }

  canvas.addEventListener('click', e=>{ if (audioCtx && audioCtx.state==='suspended') audioCtx.resume(); if (!running) return; const pt=getMousePos(e); handleHitAtPoint(pt); }, {passive:true});
  canvas.addEventListener('touchstart', e=>{ e.preventDefault(); if (audioCtx && audioCtx.state==='suspended') audioCtx.resume(); if (!running) return; const pt=getMousePos(e); handleHitAtPoint(pt); }, {passive:false});

  // ---------- Seed and UI ----------
  function setSeedFromInput(){ const v = seedInput.value.trim(); if (v===''){ seed = String(Math.floor(Math.random()*1e9)); } else { const n = Number(v); seed = Number.isFinite(n)? String(Math.floor(n)) : String(hashStringToInt(v)); } seedInput.value = seed; }
  function hashStringToInt(s){ let h=2166136261>>>0; for(let i=0;i<s.length;i++) h=Math.imul(h ^ s.charCodeAt(i), 16777619); return h>>>0; }
  function applySeedFromUrl(){ const params = new URLSearchParams(location.search); const us = params.get('seed'); if (us){ seed = us; seedInput.value = seed; } }

  applySeedBtn.addEventListener('click', ()=>{ setSeedFromInput(); alert('已应用种子，开始游戏时将使用该种子生成关卡。'); });
  startBtn.addEventListener('click', ()=>{ if (!seed) setSeedFromInput(); startGame(); });
  pauseBtn.addEventListener('click', ()=>{ pauseGame(); });
  replayBtn.addEventListener('click', ()=>{ replayGame(); });
  shareBtn.addEventListener('click', async ()=>{ if (!seed) setSeedFromInput(); const url = new URL(location.href); url.searchParams.set('seed', seed); try{ await navigator.clipboard.writeText(url.toString()); shareBtn.textContent='已复制'; setTimeout(()=>shareBtn.textContent='复制带 seed 链接',1200); }catch(e){ prompt('复制此链接：', url.toString()); } });
  resetStatsBtn.addEventListener('click', ()=>{ if(confirm('确认重置本地统计与排行榜？')){ resetStats(); } });
  modeSelect.addEventListener('change', ()=>{ modeLabel.textContent = (modeSelect.value==='timed'?'Timed':'Endless'); livesRow.style.display = (modeSelect.value==='endless'?'block':'none'); });

  // ---------- Startup ----------
  function init(){ window.addEventListener('resize', resizeCanvas); resizeCanvas(); applySeedFromUrl(); applyStatsToUI(); seedInput.placeholder='留空表示随机 seed'; seedInput.addEventListener('keydown', e=>{ if(e.key==='Enter') applySeedBtn.click(); }); }

  init();

  // expose helpers
  window._whack = {generateEvents, mulberry32};

})();
