# GridStage

Open-source collaborative stage formation & choreography editor — for choreographers,
cheer coaches, stage managers, and dance studios.

## This copy

This repository is a modified copy of
[GridStage](https://github.com/ChangShengHsun/GridStage) by the GridStage
contributors. The browser app is published at
<https://victorch2023.github.io/gridstage/>. The application code stays under the MIT License in `LICENSE`
(Copyright (c) 2026 GridStage contributors). Third-party pieces keep their own
licenses and notices, and are not covered by that MIT grant:

- YOLOX and RTMPose models: Apache License 2.0
  (`apps/web/public/models/NOTICE-yolox.txt`, `NOTICE-rtmpose.txt`)
- OSNet model: MIT (`apps/web/public/models/NOTICE-osnet.txt`,
  Copyright (c) 2018 Kaiyang Zhou)
- Noto Sans TC: SIL Open Font License
  (`apps/web/src/assets/NotoSansTC-OFL.txt`)

<!-- Media hosted on GitHub's CDN (uploaded via an issue), NOT committed to the repo. -->

<img alt="GridStage in action" width="880"
     src="https://github.com/user-attachments/assets/ce746d9e-b8fd-4e75-9762-316497d29f79" />

<!-- promo.mp4 — bare URL on its own line renders as an inline video player. -->

https://github.com/user-attachments/assets/ad08d005-feaa-490f-8fcd-8b9ab6f40284

**▶ Full walkthrough:** [watch the demo on YouTube](https://youtu.be/pYeI-zq6FSQ)

Plan formations on a top-down 2D stage, sync them to music, preview transitions
in 2D and 3D, capture formations straight from a rehearsal video with on-device
AI, and export walk-chart PDFs, videos or GIFs. Real-time multi-user editing
(cursors, presence, per-user undo) is built in via CRDT.

Full feature manual (Traditional Chinese): [docs/manual.md](docs/manual.md).

## Get GridStage

Pick whichever fits you — no account needed for any of them.

### Desktop app — Windows / macOS (most users)

No Node.js, no terminal, everything bundled and fully offline:

1. Go to the [**Releases**](https://github.com/ChangShengHsun/GridStage/releases)
   page and download the latest `GridStage Setup <version>.exe` (Windows) or
   `GridStage <version>.pkg` (macOS).
2. Run it. The app is not code-signed yet, so Windows SmartScreen may show a
   blue "Windows protected your PC" box — click **More info → Run anyway**;
   on macOS right-click the `.pkg` → **Open**.
3. Launch **GridStage** from the Start menu / Applications. Windows builds
   auto-update on new releases.

Your work saves automatically on that computer (no cloud account yet) — move a
piece to another machine with **Export → File (.json)**.

### Phone / tablet — Android & iOS

GridStage is a **PWA** (a web page that installs like a native app), no app
store needed:

1. Open **<https://changshenghsun.github.io/GridStage/>** in the phone's
   browser.
2. Install it — **Android / Chrome:** menu **⋮ → Add to Home screen →
   Install; iOS / Safari:** **Share → Add to Home Screen**.
3. Launch from the home screen: full-screen, works offline after the first
   visit, saves on the device.

On a phone the side panels tuck behind the **Cast** / **Props** edge tabs; on
a tablet the full three-column layout appears. Live collaboration needs a
self-hosted collab server (below), so it is off on the public page.

### Self-host — the full stack with Docker

```bash
cp .env.example .env  # fill in secrets
docker compose up -d
```

| Service       | Port      | Notes                                   |
| ------------- | --------- | --------------------------------------- |
| web           | 8080      | production build served by nginx        |
| api           | 3000      | NestJS REST, `/api/health` health check |
| collab-server | 1234      | y-websocket (powers Share live)         |
| postgres      | 5432      | schema in `apps/api/db/`                |
| redis         | 6379      | cache + pub-sub                         |
| minio         | 9000/9001 | S3-compatible object storage (+console) |

> **Status note:** integration-tested 2026-07-13 — all six services come up,
> migrations apply, `/api/health` responds. The API itself is still a skeleton
> (health check only; auth/CRUD/media are roadmap V4).

### From source (developers)

Needs **Node.js 20+** and **pnpm**:

```bash
pnpm install
pnpm dev:web          # editor at http://localhost:5173, saves to localStorage
```

Realtime collaboration locally:

```bash
HOST=127.0.0.1 PORT=1234 pnpm --filter @gridstage/collab-server start
pnpm dev:web
```

Click **Share live** in the top bar — the app reloads into a `?room=` URL you
can send to collaborators. Peers see each other's cursors, selections, and
edits live; Ctrl+Z only reverts your own changes. **View link** copies a
`?mode=view` variant that hides editing UI (a convenience, not access
control — real permissions need the backend).

Building the desktop installer yourself:

```bash
pnpm --filter @gridstage/desktop start   # run the desktop app without packaging
pnpm --filter @gridstage/desktop dist    # build the installer -> apps/desktop/release/
```

> **Windows note:** `dist` uses electron-builder, which extracts a toolchain
> containing symbolic links. Turn on **Settings → System → For developers →
> Developer Mode** first (or run the command from an Administrator terminal),
> otherwise the extraction fails with a "cannot create symbolic link" error.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (apps/web)                      │
│  React + Vite + Zustand                                         │
│  ├─ 2D editor ......... react-konva (top-down stage canvas)     │
│  ├─ 3D preview ........ @react-three/fiber                      │
│  ├─ Audio ............. Web Audio API (waveform, beat markers)  │
│  ├─ Vision ............ onnxruntime-web (video → formations)    │
│  └─ Collab client ..... Yjs + y-websocket                       │
└───────────────┬──────────────────────────────┬──────────────────┘
                │ REST + JWT                   │ WebSocket (Yjs sync)
┌───────────────▼──────────────┐  ┌────────────▼─────────────────┐
│   apps/api (NestJS)          │  │  apps/collab-server          │
│   auth, orgs, performances,  │  │  y-websocket rooms,          │
│   assets, comments, exports  │  │  awareness (cursors)         │
└──────┬────────┬────────┬─────┘  └────────────┬─────────────────┘
       │        │        │                     │
┌──────▼───┐ ┌──▼────┐ ┌─▼──────────┐  ┌───────▼──────┐
│ Postgres │ │ Redis │ │   MinIO    │  │   Redis      │
│ relational│ │ cache/│ │ audio/media│  │  pub-sub     │
│ + JSONB  │ │ pubsub│ │  (S3 API)  │  │              │
└──────────┘ └───────┘ └────────────┘  └──────────────┘

packages/
  shared-types   — domain types shared by web / api / collab-server
  path-planner   — Hungarian assignment + sweep-line collision detection
```

## Project structure

```
gridstage/
├── apps/
│   ├── web/            # React + Vite frontend (editor, timeline, audio, vision, exports)
│   ├── desktop/        # Electron wrapper (installers, auto-update)
│   ├── api/            # NestJS REST API (auth, CRUD, media)          [needs Docker]
│   └── collab-server/  # Yjs y-websocket server
├── packages/
│   ├── shared-types/   # TypeScript domain model shared by all apps
│   └── path-planner/   # transition matching & collision detection
├── docker-compose.yml  # postgres + redis + minio + api + collab-server + web
├── pnpm-workspace.yaml
└── tsconfig.base.json  # strict mode, shared by all packages
```

## Development

```bash
pnpm lint         # ESLint (flat config) across the monorepo
pnpm typecheck    # tsc --noEmit in every package
pnpm build        # build every package
pnpm test         # unit tests (vitest) in every package
pnpm e2e          # Playwright end-to-end suite
```

TypeScript runs in strict mode plus `noUncheckedIndexedAccess` everywhere.
Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

## Roadmap

- **MVP** ✅ — 2D editor with performer orientation, formation timeline (drag +
  zoom), audio upload + manual beat markers, PDF export (walk charts + roster)
- **V1** ✅ — Yjs real-time collaboration (cursors/presence/per-user undo),
  comments, formation template library, CSV roster import, view-only share links
- **V2** ✅ — 3D preview, curved (Bézier) transition paths, auto-transition
  (Hungarian matching) + collision warnings, version history
- **V3** ✅ — 2D & 3D video export, GIF export, tap-tempo BPM + count segments,
  formation tools & suggestions, named sections, 3D camera presets +
  follow-a-performer, PWA offline + responsive touch UI
- **AI video** (in progress) — reference-video synced playback ✅, stage
  calibration ✅, capture formation + facing from a paused frame ✅, whole-video
  scan ✅; next: rehearsal-vs-plan deviation report
- **V4** — accounts + cloud sync, plugin architecture, one-click self-host,
  community template marketplace

## License

MIT — see [LICENSE](LICENSE).
