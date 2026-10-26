/* AI주간 리듬게임 - 모드 3가지 (곡 선택 화면에서 고름)
 *  1) 댄스 (웹캠)   : 화면의 목표 동작을 웹캠 + YOLO 포즈로 따라 하기
 *  2) 댄스 (키보드) : 카메라 없이 숫자키 1~9로 동작을 입력 (연습/테스트용)
 *  3) 노트 (D F J K): 떨어지는 노트를 키보드(또는 터치)로 치는 기본 리듬게임
 * 주소 끝에 ?test 를 붙이면 '댄스 (키보드)' 모드로 시작합니다.
 */
const W = 960, H = 540;
const LEAD_DANCE = 5.0;       // 댄스: 시작 전 준비 시간(초)
const LEAD_NOTES = 3.0;       // 노트: 시작 전 준비 시간(초)
const FIRST_CUE = 4.5;        // 댄스: 첫 동작이 나오는 최소 시각(초)
const SYNC_OFFSET_MS = 0;     // (개발용) 음악과 판정 시간이 어긋날 때만 조정. 사용자 옵션 아님
const CAM_LAG = 0.08;         // 웹캠: 카메라 + AI 처리 지연 보정(초)
const MISS_RESETS_COMBO = false; // true: 미스하면 콤보 0 / false: 미스해도 콤보 유지

/* ----- 댄스 설정 ----- */
const APPROACH = 2.5;         // 동작 링이 줄어드는 시간(초)
const JW_BEFORE = 0.35;       // 박자 앞쪽 판정 범위(초)
const JW_AFTER = 0.30;        // 박자 뒤쪽 판정 범위(초)
const JW_WAIT = 0.30;         // 뒤쪽 범위 이후 AI 결과를 기다려 주는 시간(초)
// gap: 동작 사이 최소 간격(초), k: 박 감지 민감도(작을수록 많이 잡음)
// th: [PERFECT, GREAT, GOOD] 기준 일치도(0~1)
const DIFF = {
  easy:   { gap: 3.2, k: 2.0, th: [0.70, 0.55, 0.40] },
  normal: { gap: 2.4, k: 1.8, th: [0.78, 0.65, 0.50] },
  hard:   { gap: 1.7, k: 1.5, th: [0.85, 0.72, 0.58] },
};

/* ----- 노트 설정 ----- */
const KEYS = ["d", "f", "j", "k"];
const NOTE = { lanes: 4, x0: 240, laneW: 120, hitY: 460, travel: 1.6,
               win: { perfect: 0.045, great: 0.09, good: 0.13 } };
const NOTE_DIFF = {
  easy:   { minGap: 0.42, k: 1.9 },
  normal: { minGap: 0.28, k: 1.5 },
  hard:   { minGap: 0.17, k: 1.2 },
};

const HINTS = {
  cam:   "카메라에서 2~3m 떨어져 상체와 양팔이 다 보이게 서 주세요. 밝은 곳이 좋아요.",
  dkey:  "카메라 없이 연습: 화면에 나온 동작의 번호를 키보드 숫자 1~9로 눌러요. (번호 목록은 게임 화면 오른쪽에 있어요)",
  notes: "키보드 D F J K (또는 화면 터치)로 떨어지는 노트를 쳐요.",
};

const $ = (s) => document.querySelector(s);
const canvas = $("#game");
const g = canvas.getContext("2d");
const video = $("#cam");

const opt = { diff: "normal", mode: "cam" };
let selected = null;
let audioCtx = null;
const bufferCache = {};
const cueCache = {};
let run = null;

const setStatus = (t) => { $("#status").textContent = t; };
const setCam = (t) => { $("#cam-state").textContent = t; };

/* ---------- 화면 전환 ---------- */
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $("#screen-" + id).classList.add("active");
}

/* ---------- 곡 선택 UI ---------- */
const listEl = $("#song-list");
SONGS.forEach((s) => {
  const b = document.createElement("button");
  b.className = "song";
  b.style.setProperty("--c", s.color);
  b.innerHTML = `<span class="dot"></span><div><div class="t">${s.title}</div><div class="a">${s.artist || "&nbsp;"}</div></div><span class="tag" id="tag-${s.id}"></span>`;
  b.onclick = () => {
    selected = s;
    document.querySelectorAll(".song").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    $("#btn-start").disabled = false;
    $("#btn-start").textContent = "▶ " + s.title + " 시작";
    setStatus("");
  };
  listEl.appendChild(b);
});

async function refreshTags() {
  for (const s of SONGS) {
    const el = $("#tag-" + s.id);
    try {
      const r = await fetch(s.file, { method: "HEAD" });
      if (!r.ok) throw 0;
      el.textContent = "";
    } catch { el.textContent = "음원 없음 (데모 모드)"; }
  }
}

function setMode(m) {
  opt.mode = m;
  document.querySelectorAll("#mode-buttons button").forEach((x) => x.classList.toggle("on", x.dataset.mode === m));
  $("#cam-row").style.display = m === "cam" ? "" : "none";
  $("#hint").textContent = HINTS[m];
  setStatus("");
}
document.querySelectorAll("#mode-buttons button").forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });

document.querySelectorAll("#diff-buttons button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("#diff-buttons button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    opt.diff = b.dataset.diff;
  };
});

$("#btn-start").onclick = () => startSong();
$("#btn-retry").onclick = () => startSong();
$("#btn-menu").onclick = () => { show("select"); refreshTags(); };
$("#btn-quit").onclick = () => quitGame();
$("#btn-cam").onclick = () => testCamera();
refreshTags();
setMode(new URLSearchParams(location.search).has("test") ? "dkey" : "cam");

/* ---------- 카메라 테스트 (곡 선택 화면) ---------- */
async function testCamera() {
  const btn = $("#btn-cam");
  btn.disabled = true;
  setCam("카메라/AI 준비 중... (처음에는 몇 초 걸려요)");
  try {
    POSE.clock = () => performance.now() / 1000;
    POSE.onSample = null;
    await POSE.start(video);
    const t0 = performance.now();
    while (!POSE.latest && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 100));
    setCam(POSE.latest ? "카메라: 준비 완료 ✅ (사람이 인식돼요)" : "카메라: 켜졌지만 사람이 안 보여요. 상체가 다 보이게 서 보세요");
  } catch (e) {
    setCam("카메라: ⚠ " + e.message);
  }
  POSE.stop();
  btn.disabled = false;
}

/* ---------- 유틸 ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function roundRect(x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function txt(s, x, y, size, color, align, weight) {
  g.textAlign = align || "left"; g.textBaseline = "top";
  g.fillStyle = color; g.font = (weight || "bold") + " " + size + "px sans-serif";
  g.fillText(s, x, y);
}

/* ---------- 음원 로드 / 박 감지 ---------- */
async function loadBuffer(song) {
  if (bufferCache[song.id] !== undefined) return bufferCache[song.id];
  try {
    const res = await fetch(song.file);
    if (!res.ok) throw new Error("not found");
    const arr = await res.arrayBuffer();
    bufferCache[song.id] = await audioCtx.decodeAudioData(arr);
  } catch (e) {
    bufferCache[song.id] = null; // 데모 모드
  }
  return bufferCache[song.id];
}

// 소리가 갑자기 커지는 지점(박) 찾기
function detectOnsets(buffer, minGap, k) {
  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const hop = 512;
  const frames = Math.floor(ch0.length / hop);
  const energy = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let j = 0; j < hop; j++) { const v = (ch0[i * hop + j] + ch1[i * hop + j]) * 0.5; s += v * v; }
    energy[i] = Math.sqrt(s / hop);
  }
  const flux = new Float32Array(frames);
  for (let i = 1; i < frames; i++) flux[i] = Math.max(0, energy[i] - energy[i - 1]);

  const dt = hop / sr;
  const win = Math.round(1 / dt);
  const times = [];
  let last = -10;
  for (let i = 2; i < frames - 2; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - win); j < Math.min(frames, i + win); j++) { sum += flux[j]; cnt++; }
    const thr = (sum / cnt) * k + 0.0015;
    const t = i * dt;
    if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && t - last >= minGap) {
      times.push(t);
      last = t;
    }
  }
  return times;
}

/* ---------- 댄스: 동작 큐 만들기 ---------- */
function makeCues(song, buffer, diff) {
  const rng = mulberry32(hash(song.id + diff));
  const { gap, k } = DIFF[diff];
  const duration = buffer ? buffer.duration : 62;
  const end = duration - 3;

  const times = buffer ? detectOnsets(buffer, gap, k).filter((t) => t >= FIRST_CUE && t <= end) : [];

  // 비어 있는 구간은 일정 간격으로 채우기
  const out = [];
  let prev = FIRST_CUE - gap;
  for (const t of times) {
    while (t - prev > gap * 1.8) { prev += gap; out.push(prev); }
    out.push(t); prev = t;
  }
  while (end - prev > gap * 1.8) { prev += gap; out.push(prev); }

  // 동작 배정 (같은 동작이 연속으로 나오지 않게)
  let last = -1, last2 = -1;
  const cues = out.map((t) => {
    let i;
    do { i = Math.floor(rng() * POSES.length); } while (i === last || i === last2);
    last2 = last; last = i;
    return { t, idx: i, pose: POSES[i] };
  });
  return { cues, duration };
}

/* ---------- 노트: 노트 만들기 ---------- */
function makeNotes(song, buffer, diff) {
  const rng = mulberry32(hash(song.id + diff + "notes"));
  const { minGap, k } = NOTE_DIFF[diff];
  const times = [];
  if (buffer) detectOnsets(buffer, minGap, k).forEach((t) => { if (t > 1.0) times.push(t); });
  else for (let t = 1; t < 60; t += 0.5) times.push(t); // 데모: 120BPM 8분음표

  const notes = [];
  for (const t of times) {
    let lane = Math.floor(rng() * NOTE.lanes);
    const n = notes.length;
    // 같은 레인 3연속 방지
    if (n >= 2 && notes[n - 1].lane === lane && notes[n - 2].lane === lane) lane = (lane + 1 + Math.floor(rng() * 3)) % NOTE.lanes;
    notes.push({ t, lane });
  }
  return { notes, duration: buffer ? buffer.duration : 62 };
}

/* ---------- 게임 시작 ---------- */
async function startSong() {
  if (!selected) return;
  if (run) { cancelAnimationFrame(run.raf); try { run.src && run.src.stop(); } catch {} run = null; }

  const isNotes = opt.mode === "notes";

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") await audioCtx.resume();

  setStatus("곡 불러오는 중...");
  const buffer = await loadBuffer(selected);
  const key = selected.id + opt.diff + (isNotes ? "N" : "D");
  if (!cueCache[key]) cueCache[key] = isNotes ? makeNotes(selected, buffer, opt.diff) : makeCues(selected, buffer, opt.diff);
  const tpl = cueCache[key];

  if (opt.mode === "cam") {
    setStatus("카메라/AI 준비 중... (처음에는 몇 초 걸려요)");
    try {
      POSE.clock = () => (run ? songTime() - CAM_LAG : -99);
      POSE.onSample = onSample;
      await POSE.start(video);
    } catch (e) {
      POSE.stop();
      setStatus("⚠ " + e.message);
      return;
    }
  }
  setStatus(buffer ? "" : "⚠ 음원 파일이 없어 데모 모드로 실행합니다 (소리 없음)");

  run = {
    type: isNotes ? "notes" : "dance",
    keyInput: opt.mode === "dkey",
    song: selected,
    cues: isNotes ? [] : tpl.cues.map((c) => ({ ...c, state: 0, best: 0, kind: "" })),
    notes: isNotes ? tpl.notes.map((n) => ({ ...n, state: 0 })) : [],
    duration: tpl.duration,
    startAt: audioCtx.currentTime + (isNotes ? LEAD_NOTES : LEAD_DANCE),
    src: null,
    score: 0, combo: 0, maxCombo: 0,
    count: { perfect: 0, great: 0, good: 0, miss: 0 },
    judge: { text: "", t: -10, color: "#fff" },
    particles: [],
    flash: [0, 0, 0, 0],
    held: [false, false, false, false],
    ang: null, lastSeen: -10, testPose: -1,
    done: false, raf: 0,
  };
  if (buffer) {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    src.start(run.startAt);
    run.src = src;
  }
  show("game");
  run.raf = requestAnimationFrame(loop);
}

function songTime() { return audioCtx.currentTime - run.startAt - SYNC_OFFSET_MS / 1000; }

function endRun() {
  if (!run) return;
  cancelAnimationFrame(run.raf);
  try { run.src && run.src.stop(); } catch {}
  POSE.stop();
}

function quitGame() {
  if (!run) return;
  endRun();
  run = null;
  show("select");
  refreshTags();
}

/* ---------- 판정 공통 ---------- */
function applyJudge(kind, px, py) {
  run.count[kind]++;
  if (kind === "miss") {
    if (MISS_RESETS_COMBO) run.combo = 0;
  } else {
    run.combo++;
    run.maxCombo = Math.max(run.maxCombo, run.combo);
    const base = { perfect: 1000, great: 700, good: 400 }[kind];
    run.score += Math.round(base * (1 + Math.min(run.combo, 50) / 100));
    if (px !== undefined) {
      for (let i = 0; i < 14; i++) run.particles.push({ x: px, y: py, vx: (Math.random() - 0.5) * 400, vy: (Math.random() - 0.7) * 360, life: 0.5 });
    }
  }
  const label = { perfect: "PERFECT", great: "GREAT", good: "GOOD", miss: "MISS" }[kind];
  const color = { perfect: "#ffe14a", great: "#6cf5a0", good: "#6cb5ff", miss: "#ff5b5b" }[kind];
  run.judge = { text: label, t: performance.now() / 1000, color };
}

/* ---------- 댄스: 입력과 판정 ---------- */
// 웹캠: AI가 읽은 자세가 들어올 때마다 호출됨
function onSample(s) {
  if (!run || run.done || run.type !== "dance") return;
  const ang = POSE.angles(s.kp);
  run.ang = ang;
  run.lastSeen = performance.now() / 1000;
  for (const c of run.cues) {
    if (c.state !== 0) continue;
    if (s.t >= c.t - JW_BEFORE && s.t <= c.t + JW_AFTER) c.best = Math.max(c.best, POSE.score(ang, c.pose.a));
  }
}

// 키보드 모드: 숫자키 = 해당 번호 동작을 정확히 한 것으로 처리
function testPress(n) {
  if (!run || run.done || run.type !== "dance") return;
  const now = songTime();
  run.testPose = n; run.lastSeen = performance.now() / 1000;
  for (const c of run.cues) {
    if (c.state !== 0) continue;
    if (now >= c.t - JW_BEFORE && now <= c.t + JW_AFTER) c.best = Math.max(c.best, c.idx === n ? 1 : 0.25);
  }
}

function settle(c, kind) { c.state = 1; c.kind = kind; applyJudge(kind, 240, 225); }

function judgeCues(now) {
  const th = DIFF[opt.diff].th;
  for (const c of run.cues) {
    if (c.state !== 0) continue;
    if (c.best >= th[0] && now >= c.t - JW_BEFORE) { settle(c, "perfect"); continue; }
    if (now > c.t + JW_AFTER + JW_WAIT) settle(c, c.best >= th[1] ? "great" : c.best >= th[2] ? "good" : "miss");
  }
}

/* ---------- 노트: 입력과 판정 ---------- */
function pressLane(lane) {
  if (!run || run.done || run.type !== "notes") return;
  run.held[lane] = true;
  run.flash[lane] = 1;
  const now = songTime();
  let best = null;
  for (const n of run.notes) {
    if (n.state !== 0 || n.lane !== lane) continue;
    const d = Math.abs(n.t - now);
    if (d <= NOTE.win.good && (!best || d < Math.abs(best.t - now))) best = n;
    if (n.t - now > NOTE.win.good) break;
  }
  if (!best) return;
  const d = Math.abs(best.t - now);
  const kind = d <= NOTE.win.perfect ? "perfect" : d <= NOTE.win.great ? "great" : "good";
  best.state = 1;
  applyJudge(kind, NOTE.x0 + lane * NOTE.laneW + NOTE.laneW / 2, NOTE.hitY);
}

function judgeNotes(now) {
  for (const n of run.notes) {
    if (n.state === 0 && now - n.t > NOTE.win.good) { n.state = 2; applyJudge("miss"); }
  }
}

/* ---------- 키보드 / 터치 입력 ---------- */
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "Escape") return quitGame();
  if (!run) return;
  if (run.type === "notes") {
    const i = KEYS.indexOf(e.key.toLowerCase());
    if (i >= 0) pressLane(i);
  } else if (run.keyInput && /^[1-9]$/.test(e.key)) {
    testPress(+e.key - 1);
  }
});
window.addEventListener("keyup", (e) => {
  const i = KEYS.indexOf(e.key.toLowerCase());
  if (i >= 0 && run) run.held[i] = false;
});
canvas.addEventListener("pointerdown", (e) => {
  if (!run || run.type !== "notes") return;
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  const lane = Math.floor((x - NOTE.x0) / NOTE.laneW);
  if (lane >= 0 && lane < NOTE.lanes) pressLane(lane);
});
canvas.addEventListener("pointerup", () => run && run.held.fill(false));

/* ---------- 메인 루프 ---------- */
let lastFrame = 0;
function loop(ts) {
  if (!run) return;
  const dt = Math.min(0.05, (ts - lastFrame) / 1000 || 0.016);
  lastFrame = ts;
  const now = songTime();

  if (run.type === "dance") { judgeCues(now); drawDance(now, dt); }
  else { judgeNotes(now); drawNotes(now, dt); }

  const items = run.type === "dance" ? run.cues : run.notes;
  const last = items.length ? items[items.length - 1].t : 0;
  if (now > Math.min(run.duration, last + 3) + 0.5) return finish();
  run.raf = requestAnimationFrame(loop);
}

/* ---------- 그리기: 노트 ---------- */
function drawNotes(now, dt) {
  const color = run.song.color;
  const X0 = NOTE.x0, LW = NOTE.laneW, HY = NOTE.hitY;

  g.clearRect(0, 0, W, H);
  g.fillStyle = "#05060d"; g.fillRect(0, 0, W, H);

  // 레인
  for (let i = 0; i < NOTE.lanes; i++) {
    const x = X0 + i * LW;
    g.fillStyle = i % 2 ? "#0b0e1c" : "#0e1122";
    g.fillRect(x, 0, LW, H);
    if (run.flash[i] > 0) {
      const grad = g.createLinearGradient(0, HY - 260, 0, HY);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, hexA(color, 0.35 * run.flash[i]));
      g.fillStyle = grad; g.fillRect(x, HY - 260, LW, 260);
      run.flash[i] = Math.max(0, run.flash[i] - dt * 4);
    }
    g.strokeStyle = "#1a1f38"; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  g.strokeStyle = "#1a1f38"; g.beginPath(); g.moveTo(X0 + LW * NOTE.lanes, 0); g.lineTo(X0 + LW * NOTE.lanes, H); g.stroke();

  // 판정선 + 키 표시
  g.fillStyle = color; g.fillRect(X0, HY - 2, LW * NOTE.lanes, 4);
  for (let i = 0; i < NOTE.lanes; i++) {
    g.fillStyle = run.held[i] ? color : "#1c2140";
    g.fillRect(X0 + i * LW + 6, HY + 14, LW - 12, 44);
    g.fillStyle = run.held[i] ? "#000" : "#8b90b0";
    g.font = "bold 22px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(KEYS[i].toUpperCase(), X0 + i * LW + LW / 2, HY + 36);
  }

  // 노트
  for (const n of run.notes) {
    if (n.state !== 0) continue;
    const y = HY - ((n.t - now) / NOTE.travel) * HY;
    if (y < -30) break;
    if (y > H + 30) continue;
    g.fillStyle = color;
    roundRect(X0 + n.lane * LW + 8, y - 11, LW - 16, 22, 6);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.55)";
    roundRect(X0 + n.lane * LW + 12, y - 8, LW - 24, 6, 3);
    g.fill();
  }

  // 파티클
  run.particles = run.particles.filter((p) => (p.life -= dt) > 0);
  for (const p of run.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 700 * dt;
    g.fillStyle = hexA(color, Math.max(0, p.life * 2));
    g.fillRect(p.x, p.y, 4, 4);
  }

  // HUD
  txt(String(run.score).padStart(7, "0"), 20, 14, 24, "#fff");
  txt(run.song.title, 20, 44, 13, "#8b90b0", "left", "normal");
  const prog = run.duration > 0 ? Math.max(0, Math.min(1, now / run.duration)) : 0;
  g.fillStyle = "#1a1f38"; g.fillRect(0, 0, W, 4);
  g.fillStyle = color; g.fillRect(0, 0, W * prog, 4);

  if (run.combo >= 2) {
    txt(String(run.combo), W / 2, 120, 54, "rgba(255,255,255,.85)", "center");
    txt("COMBO", W / 2, 184, 14, "#8b90b0", "center", "normal");
  }
  const age = performance.now() / 1000 - run.judge.t;
  if (age < 0.6) {
    g.globalAlpha = 1 - age / 0.6;
    txt(run.judge.text, W / 2, 250 - age * 20, 28, run.judge.color, "center");
    g.globalAlpha = 1;
  }
  if (now < -0.05) txt(String(Math.ceil(-now)), W / 2, 190, 90, "#fff", "center");
}

/* ---------- 그리기: 댄스 ---------- */
function liveScore(tgt) {
  if (!tgt) return 0;
  const seen = performance.now() / 1000 - run.lastSeen < 0.7;
  if (!seen) return 0;
  if (run.keyInput) return run.testPose === tgt.idx ? 1 : 0.2;
  return run.ang ? POSE.score(run.ang, tgt.pose.a) : 0;
}

function drawDance(now, dt) {
  const color = run.song.color;
  const th = DIFF[opt.diff].th;
  const pending = run.cues.filter((c) => c.state === 0);
  const tgt = pending[0];
  const live = liveScore(tgt);
  const seen = performance.now() / 1000 - run.lastSeen < 0.7;

  g.clearRect(0, 0, W, H);
  g.fillStyle = "#05060d"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#0b0e1c"; g.fillRect(0, 0, 480, H);
  g.fillStyle = "#1a1f38"; g.fillRect(479, 0, 2, H);

  /* --- 왼쪽: 목표 동작 --- */
  if (tgt) {
    const cx = 240, cy = 150;
    const prog = Math.max(0, Math.min(1, (tgt.t - now) / APPROACH));
    g.save();
    g.beginPath(); g.rect(0, 0, 480, H); g.clip();
    g.lineWidth = 4; g.strokeStyle = "rgba(255,255,255,.22)";
    g.beginPath(); g.arc(cx, cy + 70, 140, 0, Math.PI * 2); g.stroke();
    if (prog > 0 && prog < 1) {
      g.lineWidth = 7; g.strokeStyle = color; g.globalAlpha = 1 - prog * 0.6;
      g.beginPath(); g.arc(cx, cy + 70, 140 + 90 * prog, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    g.restore();

    g.save();
    if (live >= th[2]) { g.shadowColor = color; g.shadowBlur = 24; }
    drawFigure(g, tgt.pose, cx, cy, 0.85, "#ffffff", 1);
    g.restore();
    txt(tgt.pose.name, cx, 345, 28, color, "center");
  }

  // 다음 동작 미리보기
  txt("NEXT", 20, 428, 12, "#8b90b0");
  pending.slice(1, 4).forEach((c, i) => {
    const x = 110 + i * 130;
    drawFigure(g, c.pose, x, 452, 0.26, color, 0.8);
    txt(c.pose.name, x, 512, 11, "#8b90b0", "center", "normal");
  });

  // 파티클
  run.particles = run.particles.filter((p) => (p.life -= dt) > 0);
  for (const p of run.particles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 700 * dt;
    g.fillStyle = hexA(color, Math.max(0, p.life * 1.6));
    g.fillRect(p.x, p.y, 5, 5);
  }

  /* --- HUD --- */
  txt(String(run.score).padStart(7, "0"), 20, 14, 24, "#fff");
  txt(run.song.title, 20, 44, 13, "#8b90b0", "left", "normal");
  if (run.combo >= 2) txt(run.combo + " COMBO", 460, 16, 24, "rgba(255,255,255,.9)", "right");
  const age = performance.now() / 1000 - run.judge.t;
  if (age < 0.7) {
    g.globalAlpha = 1 - age / 0.7;
    txt(run.judge.text, 240, 384 - age * 14, 34, run.judge.color, "center");
    g.globalAlpha = 1;
  } else if (tgt && now > tgt.t - 0.25 && now < tgt.t + 0.25) {
    txt("지금!", 240, 386, 30, "#ffe14a", "center");
  }
  const prog = run.duration > 0 ? Math.max(0, Math.min(1, now / run.duration)) : 0;
  g.fillStyle = "#1a1f38"; g.fillRect(0, 0, W, 4);
  g.fillStyle = color; g.fillRect(0, 0, W * prog, 4);

  /* --- 오른쪽: 내 모습 --- */
  const x0 = 490, w = 460;
  const h = Math.round(w / (run.keyInput ? 16 / 9 : POSE.aspect));
  const y0 = 100;
  g.save();
  g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  g.fillStyle = "#000"; g.fillRect(x0, y0, w, h);
  if (run.keyInput) {
    txt("키보드 모드", x0 + 14, y0 + 12, 16, "#ffe14a");
    POSES.forEach((p, i) => txt((i + 1) + "  " + p.name, x0 + 14, y0 + 40 + i * 24, 15, run.testPose === i ? "#6cf5a0" : "#cfd3f0", "left", "normal"));
  } else {
    if (video.readyState >= 2) {
      g.save(); g.translate(x0 + w, y0); g.scale(-1, 1); g.drawImage(video, 0, 0, w, h); g.restore();
    }
    if (seen && POSE.latest) drawSkeleton(g, POSE.latest.kp, x0, y0, w, h, color);
  }
  g.restore();
  g.lineWidth = 3; g.strokeStyle = seen ? "#6cf5a0" : "#ff5b5b";
  g.strokeRect(x0, y0, w, h);

  txt(run.keyInput ? "숫자키 1~9로 동작 입력" : seen ? "● 사람 인식됨" : "● 사람이 안 보여요 (상체가 다 보이게 서 주세요)",
      x0, y0 - 24, 15, seen ? "#6cf5a0" : "#ff5b5b");
  if (!run.keyInput) txt("AI " + POSE.fps.toFixed(0) + "fps", x0 + w, y0 - 22, 12, "#8b90b0", "right", "normal");

  // 일치도 막대
  const by = y0 + h + 40;
  txt("일치도 " + Math.round(live * 100) + "%", x0, by - 26, 15, "#fff");
  g.fillStyle = "#1a1f38"; g.fillRect(x0, by, w, 20);
  g.fillStyle = live >= th[0] ? "#ffe14a" : live >= th[1] ? "#6cf5a0" : live >= th[2] ? "#6cb5ff" : "#5a6080";
  g.fillRect(x0, by, w * live, 20);
  g.fillStyle = "rgba(255,255,255,.6)";
  for (const t of th) g.fillRect(x0 + w * t - 1, by - 4, 2, 28);
  txt("GOOD", x0 + w * th[2], by + 26, 11, "#8b90b0", "center", "normal");
  txt("GREAT", x0 + w * th[1], by + 26, 11, "#8b90b0", "center", "normal");
  txt("PERFECT", x0 + w * th[0], by + 26, 11, "#8b90b0", "center", "normal");

  // 준비 카운트다운
  if (now < -0.05) {
    g.fillStyle = "rgba(5,6,13,.55)"; g.fillRect(0, 0, W, H);
    txt(String(Math.ceil(-now)), 240, 160, 110, "#fff", "center");
    txt(run.keyInput ? "숫자키로 동작을 입력하세요" : "카메라 앞에 서세요", 240, 300, 24, "#fff", "center");
    txt(run.keyInput ? "화면에 나온 동작의 번호를 눌러요" : "상체와 양팔이 다 보이게!", 240, 336, 16, "#8b90b0", "center", "normal");
  }
}

/* ---------- 결과 ---------- */
function finish() {
  run.done = true;
  endRun();
  const c = run.count;
  const total = (c.perfect + c.great + c.good + c.miss) || 1;
  const acc = ((c.perfect * 1 + c.great * 0.7 + c.good * 0.4) / total) * 100;
  const grade = acc >= 95 ? "S" : acc >= 90 ? "A" : acc >= 80 ? "B" : acc >= 70 ? "C" : "D";
  $("#r-title").textContent = run.song.title + (run.song.artist ? " - " + run.song.artist : "");
  $("#r-grade").textContent = grade;
  $("#r-grade").style.color = run.song.color;
  $("#r-score").textContent = run.score.toLocaleString() + "점 (" + acc.toFixed(1) + "%)";
  $("#r-table").innerHTML = `
    <tr><td>PERFECT</td><td>${c.perfect}</td></tr>
    <tr><td>GREAT</td><td>${c.great}</td></tr>
    <tr><td>GOOD</td><td>${c.good}</td></tr>
    <tr><td>MISS</td><td>${c.miss}</td></tr>
    <tr><td>MAX COMBO</td><td>${run.maxCombo}</td></tr>`;
  show("result");
}