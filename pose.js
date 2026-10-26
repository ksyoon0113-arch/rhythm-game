/* 웹캠 + YOLO 포즈(ONNX Runtime Web) + 동작 비교
 * - 모델 파일: models/yolov8n-pose.onnx  (README의 '모델 변환' 참고)
 * - 모든 좌표는 "거울 화면" 기준입니다. (내 오른손이 화면 오른쪽에 보임)
 */
const MODEL_URL = "models/yolov8n-pose.onnx";

/* ---------- 목표 동작 ----------
 * a = [왼팔 윗팔, 왼팔 아랫팔, 오른팔 윗팔, 오른팔 아랫팔]  (화면에서 본 왼/오른쪽)
 * 각도: 0=오른쪽, 90=아래, 180=왼쪽, -90=위
 */
const POSES = [
  { id: "y",     name: "Y자 만세",       a: [-130, -130, -50, -50] },
  { id: "t",     name: "T자 벌리기",     a: [180, 180, 0, 0] },
  { id: "down",  name: "차렷",           a: [100, 100, 80, 80] },
  { id: "lup",   name: "왼팔 위로",      a: [-100, -100, 0, 0] },
  { id: "rup",   name: "오른팔 위로",    a: [180, 180, -80, -80] },
  { id: "crown", name: "손 머리 위로",   a: [200, -60, -20, -120] },
  { id: "hip",   name: "허리에 손",      a: [140, 40, 40, 140] },
  { id: "diag1", name: "대각선 ↗",       a: [-135, -135, 45, 45] },
  { id: "diag2", name: "대각선 ↘",       a: [135, 135, -45, -45] },
];

const LIMB_TOL = 75;   // 팔 각도가 이만큼(도) 틀리면 그 팔은 0점
const MIN_KP_CONF = 0.3;

/* ---------- YOLO 출력 해석 (순수 함수) ----------
 * data: Float32Array, dims: [1, 56, N] 또는 [1, N, 56]
 * 56 = 박스4 + 신뢰도1 + 키포인트17*3(x,y,신뢰도)
 * geo: { scale, padX, padY, vw, vh }  (레터박스 → 영상 좌표 변환)
 */
function decodeYoloPose(data, dims, geo, minConf) {
  if (minConf === undefined) minConf = 0.3;
  let N, get;
  if (dims[1] === 56) { N = dims[2]; get = (c, i) => data[c * N + i]; }
  else if (dims[2] === 56) { N = dims[1]; get = (c, i) => data[i * 56 + c]; }
  else return null;

  let best = -1, bestScore = 0;
  for (let i = 0; i < N; i++) {
    const conf = get(4, i);
    if (conf < minConf) continue;
    const s = conf * get(2, i) * get(3, i); // 신뢰도 × 박스 넓이 → 가까이 선 사람 우선
    if (s > bestScore) { bestScore = s; best = i; }
  }
  if (best < 0) return null;

  const kp = [];
  for (let k = 0; k < 17; k++) {
    const x = get(5 + 3 * k, best), y = get(6 + 3 * k, best), c = get(7 + 3 * k, best);
    kp.push({
      x: 1 - ((x - geo.padX) / geo.scale) / geo.vw, // 거울 화면
      y: ((y - geo.padY) / geo.scale) / geo.vh,
      c,
    });
  }
  return { kp, conf: get(4, best) };
}

/* ---------- 팔 각도 / 점수 (순수 함수) ---------- */
function armAngles(kp, aspect) {
  const ok = (p) => p && p.c >= MIN_KP_CONF;
  const ang = (p, q) => (ok(p) && ok(q)) ? Math.atan2(q.y - p.y, (q.x - p.x) * aspect) * 180 / Math.PI : null;
  // 거울 화면에서 사람의 왼쪽(5,7,9)이 화면 왼쪽에 보입니다.
  return [ang(kp[5], kp[7]), ang(kp[7], kp[9]), ang(kp[6], kp[8]), ang(kp[8], kp[10])];
}

function angDiff(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }

// 0 ~ 1 (1 = 완전히 같은 동작)
function poseScore(ang, target) {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    if (ang[i] == null) continue;
    sum += Math.max(0, 1 - angDiff(ang[i], target[i]) / LIMB_TOL);
  }
  return sum / 4;
}

/* ---------- 그리기 (직접 만든 스틱 인물) ---------- */
function drawFigure(g, pose, cx, cy, s, color, alpha) {
  g.save();
  g.globalAlpha = alpha === undefined ? 1 : alpha;
  g.strokeStyle = color; g.fillStyle = color;
  g.lineCap = "round"; g.lineJoin = "round";
  g.lineWidth = Math.max(2, 10 * s);

  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy + 110 * s); g.stroke();                 // 몸통
  g.beginPath(); g.moveTo(cx - 28 * s, cy); g.lineTo(cx + 28 * s, cy); g.stroke();         // 어깨
  g.beginPath();                                                                            // 다리
  g.moveTo(cx, cy + 110 * s); g.lineTo(cx - 32 * s, cy + 215 * s);
  g.moveTo(cx, cy + 110 * s); g.lineTo(cx + 32 * s, cy + 215 * s);
  g.stroke();
  g.beginPath(); g.arc(cx, cy - 36 * s, 20 * s, 0, Math.PI * 2); g.stroke();               // 머리

  const arm = (sx, sy, a1, a2) => {
    const r1 = a1 * Math.PI / 180, r2 = a2 * Math.PI / 180;
    const ex = sx + 64 * s * Math.cos(r1), ey = sy + 64 * s * Math.sin(r1);
    const wx = ex + 60 * s * Math.cos(r2), wy = ey + 60 * s * Math.sin(r2);
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.lineTo(wx, wy); g.stroke();
    g.beginPath(); g.arc(wx, wy, 8 * s, 0, Math.PI * 2); g.fill();
  };
  arm(cx - 28 * s, cy, pose.a[0], pose.a[1]);
  arm(cx + 28 * s, cy, pose.a[2], pose.a[3]);
  g.restore();
}

function drawSkeleton(g, kp, x0, y0, w, h, color) {
  const pt = (i) => { const p = kp[i]; return p && p.c >= MIN_KP_CONF ? [x0 + p.x * w, y0 + p.y * h] : null; };
  const links = [[5, 7], [7, 9], [6, 8], [8, 10], [5, 6], [5, 11], [6, 12], [11, 12]];
  g.save();
  g.lineWidth = 5; g.lineCap = "round"; g.strokeStyle = color;
  for (const [a, b] of links) {
    const p = pt(a), q = pt(b);
    if (p && q) { g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }
  }
  g.fillStyle = "#fff";
  for (const i of [0, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const p = pt(i);
    if (p) { g.beginPath(); g.arc(p[0], p[1], 5, 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
}

/* ---------- 웹캠 + 모델 실행 ---------- */
const POSE = {
  session: null,
  size: 0,            // 모델 입력 크기 (320 또는 640)
  stream: null,
  video: null,
  running: false,
  latest: null,       // { t, kp, conf }  (사람이 없으면 null)
  fps: 0,
  aspect: 16 / 9,
  clock: () => performance.now() / 1000, // 샘플 시각 기준 (game.js에서 노래 시간으로 교체)
  onSample: null,     // (sample) => void
  _cv: null, _ctx: null, _prev: null, _loopId: 0,

  async loadModel() {
    if (this.session) return;
    if (typeof ort === "undefined") throw new Error("AI 라이브러리(onnxruntime)를 불러오지 못했어요. 인터넷 연결을 확인하세요");
    let buf;
    try {
      const r = await fetch(MODEL_URL);
      if (!r.ok) throw new Error("404");
      buf = await r.arrayBuffer();
    } catch (e) {
      throw new Error("모델 파일(" + MODEL_URL + ")이 없어요. README의 '모델 변환' 순서대로 만들어 넣어주세요");
    }
    try {
      ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
      this.session = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    } catch (e) {
      throw new Error("모델을 열지 못했어요: " + (e.message || e));
    }
    this._in = this.session.inputNames[0];
    this._out = this.session.outputNames[0];

    // 모델 입력 크기 찾기 (imgsz=320 권장, 640도 가능)
    for (const S of [320, 640]) {
      try { await this._run(new Float32Array(3 * S * S), S); this.size = S; break; } catch (e) { /* 다음 크기 */ }
    }
    if (!this.size) { this.session = null; throw new Error("모델 입력 크기가 320/640이 아니에요. imgsz=320으로 다시 변환하세요"); }
    this._cv = document.createElement("canvas");
    this._cv.width = this._cv.height = this.size;
    this._ctx = this._cv.getContext("2d", { willReadFrequently: true });
  },

  async _run(data, S) {
    const t = new ort.Tensor("float32", data, [1, 3, S, S]);
    const res = await this.session.run({ [this._in]: t });
    return res[this._out];
  },

  async openCamera(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      throw new Error("이 주소에서는 카메라를 쓸 수 없어요 (localhost나 https로 열어야 해요)");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" }, audio: false,
      });
    } catch (e) {
      throw new Error(e.name === "NotAllowedError" ? "카메라 사용이 막혀 있어요. 주소창의 카메라 아이콘에서 허용해 주세요"
        : e.name === "NotFoundError" ? "카메라를 찾을 수 없어요"
        : "카메라를 열지 못했어요: " + (e.message || e.name));
    }
    video.srcObject = this.stream;
    video.muted = true;
    await video.play();
    await new Promise((res) => {
      if (video.videoWidth) return res();
      video.onloadedmetadata = () => res();
      setTimeout(res, 3000);
    });
    this.aspect = (video.videoWidth / video.videoHeight) || 16 / 9;
  },

  async start(video) {
    await this.loadModel();
    this.video = video;
    if (!this.stream) await this.openCamera(video);
    if (!this.running) {
      this.running = true;
      this.latest = null; this._prev = null;
      this._loop();
    }
  },

  stop() {
    this.running = false;
    this._loopId++;
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.video) this.video.srcObject = null;
    this.latest = null; this._prev = null; this.fps = 0;
  },

  async _loop() {
    const id = ++this._loopId;
    const S = this.size, ctx = this._ctx;
    const plane = S * S;
    let frames = 0, tFps = performance.now();

    while (this.running && id === this._loopId) {
      const v = this.video;
      if (!v || v.readyState < 2 || !v.videoWidth) { await new Promise((r) => setTimeout(r, 30)); continue; }

      const tCap = this.clock();
      const vw = v.videoWidth, vh = v.videoHeight;
      const scale = Math.min(S / vw, S / vh);
      const nw = Math.round(vw * scale), nh = Math.round(vh * scale);
      const padX = Math.floor((S - nw) / 2), padY = Math.floor((S - nh) / 2);

      ctx.fillStyle = "rgb(114,114,114)"; ctx.fillRect(0, 0, S, S);
      ctx.drawImage(v, padX, padY, nw, nh);
      const px = ctx.getImageData(0, 0, S, S).data;
      const data = new Float32Array(3 * plane);
      for (let i = 0, j = 0; i < plane; i++, j += 4) {
        data[i] = px[j] / 255; data[plane + i] = px[j + 1] / 255; data[2 * plane + i] = px[j + 2] / 255;
      }

      let out;
      try { out = await this._run(data, S); }
      catch (e) { await new Promise((r) => setTimeout(r, 100)); continue; }
      if (!this.running || id !== this._loopId) break;

      const det = decodeYoloPose(out.data, out.dims, { scale, padX, padY, vw, vh }, 0.3);
      if (det) {
        // 떨림 줄이기 (이전 프레임과 섞기)
        if (this._prev) {
          det.kp.forEach((p, i) => {
            const q = this._prev[i];
            if (q && p.c >= MIN_KP_CONF && q.c >= MIN_KP_CONF) { p.x = q.x * 0.4 + p.x * 0.6; p.y = q.y * 0.4 + p.y * 0.6; }
          });
        }
        this._prev = det.kp;
        this.latest = { t: tCap, kp: det.kp, conf: det.conf };
        if (this.onSample) this.onSample(this.latest);
      } else {
        this.latest = null; this._prev = null;
      }

      frames++;
      const now = performance.now();
      if (now - tFps >= 1000) { this.fps = frames * 1000 / (now - tFps); frames = 0; tFps = now; }
      await new Promise((r) => setTimeout(r, 0)); // 화면 그리기에 양보
    }
  },

  angles(kp) { return armAngles(kp, this.aspect); },
  score(ang, target) { return poseScore(ang, target); },
};

if (typeof module !== "undefined") module.exports = { POSES, decodeYoloPose, armAngles, poseScore, angDiff };
