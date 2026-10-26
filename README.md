# 💃 AI주간 댄스 챌린지

곡을 고르면 화면에 **목표 동작**이 박자에 맞춰 나오고, 웹캠 + YOLO 포즈 인식으로 내 동작이 얼마나 비슷한지 판정하는 웹 게임입니다.

## 1. 모델 만들기 (처음 한 번만)

YOLO 포즈 모델을 ONNX 파일로 변환해서 `models/` 폴더에 넣습니다. (파이썬 필요)

```bash
pip install ultralytics
yolo export model=yolov8n-pose.pt format=onnx imgsz=320
```

- 생성된 `yolov8n-pose.onnx`를 `rhythm-game/models/` 폴더에 넣으세요. (폴더가 없으면 만들기)
- `imgsz=320`이 빠르고 가벼워요. 인식이 부정확하면 `imgsz=640`으로 다시 변환해도 되고, 코드가 크기를 자동으로 알아봅니다. (대신 느려져요)
- 모델 파일은 약 13MB라 GitHub에 올려도 됩니다.

## 2. 음원 넣기

`assets/songs/` 폴더에 `songs.js`의 `file` 이름대로 음원을 넣습니다. (GitHub에는 올라가지 않아요)

## 3. 실행

1. VS Code에서 폴더 열기 → `index.html` 우클릭 → **Open with Live Server**
2. 곡 선택 화면의 **카메라 테스트**로 카메라와 AI가 되는지 먼저 확인
3. 곡을 고르고 시작 → 카메라 권한 **허용**
4. 카메라에서 2~3m 떨어져 상체와 양팔이 다 보이게 서고, 화면의 동작을 따라 해요.

※ 인터넷이 필요해요 (AI 라이브러리를 CDN에서 불러옴). 카메라는 `localhost` 또는 `https` 주소에서만 켜져요.

## 4. 카메라 없이 테스트

주소 끝에 `?test`를 붙이면 (예: `http://localhost:5500/?test`) 숫자키 `1`~`9`로 동작을 입력해 게임 흐름을 확인할 수 있어요.

## 5. 조정하는 곳

| 하고 싶은 것 | 위치 |
|---|---|
| 동작이 너무 어려움/쉬움 | `game.js`의 `DIFF` → `th` (일치도 기준, 낮을수록 쉬움) |
| 동작 간격 | `game.js`의 `DIFF` → `gap` (초) |
| 판정 타이밍 범위 | `game.js`의 `JW_BEFORE`, `JW_AFTER` |
| 음악과 판정이 어긋남 | `game.js`의 `SYNC_OFFSET_MS` (개발용, ms) |
| 카메라 지연 보정 | `game.js`의 `CAM_LAG` |
| 팔 각도 허용 오차 | `pose.js`의 `LIMB_TOL` (클수록 쉬움) |
| 동작 추가/수정 | `pose.js`의 `POSES` (팔 각도 4개) |

## 6. 파일 구조

```
rhythm-game/
├─ index.html     화면 구성
├─ style.css      스타일
├─ songs.js       곡 목록
├─ pose.js        웹캠 + YOLO 포즈 + 동작 비교
├─ game.js        게임 로직 (동작 큐, 판정, 점수, 화면)
├─ models/        yolov8n-pose.onnx (직접 변환해서 넣기)
└─ assets/songs/  음원 폴더
```

## 7. 알아둘 점

- 카메라 영상은 브라우저 안에서만 쓰이고 저장되거나 어디로 전송되지 않아요.
- 카메라와 AI 처리에 약 0.1초 지연이 있어서 판정 범위를 넉넉하게 잡았어요.
- 한 번에 한 명만 인식해요. 여러 명이 있으면 카메라에 가장 크게 보이는 사람을 따라가요.
