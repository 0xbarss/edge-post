# edge-post

[![CI](https://github.com/0xbarss/edge-post/actions/workflows/ci.yml/badge.svg)](https://github.com/0xbarss/edge-post/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Node.js 22](https://img.shields.io/badge/runtime-Node.js%2022-green.svg)](https://nodejs.org)
[![Firmware: C](https://img.shields.io/badge/firmware-C-blue.svg)](https://en.wikipedia.org/wiki/C_(programming_language))
[![Platform: STM32G0](https://img.shields.io/badge/platform-STM32G0-gray.svg)](https://www.st.com/en/microcontrollers-microprocessors/stm32g0-series.html)

Self-hosted telemetry platform bridging STM32 sensor nodes and a Node.js backend. Binary sensor frames travel over one TCP connection per device into a Fastify API backed by PostgreSQL. A React operator dashboard consumes live readings over WebSocket and enqueues commands that flow back to devices over the same connection. No third-party APIs and no external assets are loaded.

## Table of Contents

- [Why edge-post?](#why-edge-post)
- [Architecture & Design](#architecture--design)
- [Key Features](#key-features)
- [Repository Structure](#repository-structure)
- [Prerequisites & Installation](#prerequisites--installation)
- [Usage & Code Examples](#usage--code-examples)
- [API Reference](#api-reference)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Author & Contributions](#author--contributions)
- [License & Disclaimer](#license--disclaimer)

## Why edge-post?

Existing telemetry platforms either bind operators to a managed cloud service or leave the embedded-to-backend seam as an unintegrated exercise. edge-post is a self-hosted, end-to-end demonstration: a single backend process handles device frames, the operator API, the live feed, and static dashboard hosting, while firmware speaks a fixed-size binary protocol on a constrained link.

Key deficiencies addressed:

- Cloud-only platforms require an external account and an always-on internet connection before a single reading can be stored.
- Rolling your own embedded stack means choosing the frame layout, CRC, command flow, and persistence boundaries from scratch.
- Mixed-language repositories usually ship disconnected firmware and backend halves with no shared test vectors.

edge-post delivers one repository with shared frame vectors, a verified codec in both C and TypeScript, device auto-registration, at-most-once command delivery, presence tracking, and a read-only board catalog derived from STM32CubeMX `.ioc` projects.

## Architecture & Design

### Topology

```text
  ┌──────────────┐  readings, polls, acks (TCP)  ┌────────────────────┐
  │  STM32 node  │ ─────────────────────────────► │  TCP handler       │
  │  firmware    │ ◄──────────────────────────── │  (same process)    │
  └──────────────┘       command frames          └─────────┬──────────┘
                                                           │ writes readings
                                                           ▼
                                                  ┌────────────────────┐
                                                  │     PostgreSQL     │
                                                  └─────────┬──────────┘
                                                            │ history queries
  ┌──────────────┐   HTTP + WebSocket             ┌─────────▼──────────┐
  │   browser    │ ◄─────────────────────────────► │  Fastify API       │
  │  (dashboard) │   dashboard files served here   │  and WS, same app  │
  └──────────────┘                                 └────────────────────┘
```

One backend process owns the TCP device listener, the HTTP API, the WebSocket live feed, and static dashboard hosting on the same origin. PostgreSQL runs alongside it; no third-party APIs are called.

### Protocols and contracts

- **Wire protocol:** four fixed-size big-endian frame types over one TCP connection per device — reading (device → backend), acknowledgement (device → backend), command poll (device → backend), and command (backend → device). CRC-8/ATM on every frame. The magic value identifies both frame type and protocol version.
- **REST API:** operator-only surface under `/api/v1` — device registry, reading history, command enqueue, board catalog. Responses use the `{ data }` / `{ error }` envelope.
- **WebSocket live feed:** `/ws` broadcasts `reading` and `device:status` events to subscribed clients; subscriptions are replaced on a device ID list capped at 1024.
- **Command flow:** the operator enqueues a command through REST; the device polls after each reading; the backend atomically dequeues the oldest pending command; the device applies it and acknowledges.

### Boundaries

- The frame codec is pure encoding and decoding with no I/O; it is tested against identical vectors in firmware and backend.
- `db` owns SQL; routes and the TCP handler issue no ad-hoc queries.
- `commands` owns queue transitions; `presence` owns online/offline status and the 5-second sweep.
- Firmware time comes from an injected clock contract, so the application loop is host-testable on a workstation with no board attached.
- Board facts come from a local CubeMX `.ioc` file; generated `board_config.h` and `boards.json` stay local and ignored by Git. Tracked code references role macros (`BOARD_TEMP_*`, `BOARD_NET_*`, `BOARD_OUT*`) rather than literal pins.

### Trust model

The MVP runs on a trusted network. The device TCP port, REST API, and WebSocket endpoint are unauthenticated, and there is no TLS or device authentication. TLS/mTLS and device authentication are post-MVP work; do not expose this service publicly without adding them.

## Key Features

| Domain | Capability |
|--------|------------|
| Device communication | Binary reading, poll, command, and acknowledgement frames over TCP; CRC-8/ATM validation; bounded stream resynchronisation |
| Ingestion | Auto-registration of unknown devices, per-frame sample rate, skew warnings, presence tracking, offline marking on disconnect |
| Command queue | Enqueue over REST, atomic dequeue with `FOR UPDATE SKIP LOCKED`, acknowledgement transitions, poll throttling floor |
| Live feed | WebSocket reading and status broadcasts, subscription replacement, malformed-message errors, client-side reconnect with backoff |
| Dashboard | Fleet index, live temperature chart, command console, frame ledger, presence health, theme persistence, board catalog |
| Board configuration | `.ioc` parser and generator, `board_config.h` rendering, manifest validation, drift check, board selection |
| Deployment | Multi-stage Docker image, Compose stack with PostgreSQL, health checks, published HTTP and TCP ports |
| Testing | Host C tests under GCC/Clang with ASan/UBSan, backend unit and PostgreSQL integration tests, dashboard unit tests and production build |

## Repository Structure

```text
edge-post/
├── backend/                  # Node.js + Fastify backend (TypeScript)
│   ├── src/
│   │   ├── frame.ts          # Shared frame codec (CRC-8/ATM, four frame types)
│   │   ├── tcp-server.ts     # TCP device listener, frame dispatch, presence
│   │   ├── routes.ts         # REST API under /api/v1
│   │   ├── websocket.ts      # /ws live feed
│   │   ├── dashboard.ts      # Static dashboard hosting with 503 fallback
│   │   ├── board-profile.ts  # CubeMX .ioc parser and header renderer
│   │   ├── board-generate.ts # Board file generation and drift check
│   │   ├── board-cli.ts      # make board / make board-check entry point
│   │   ├── boards.ts         # Generated catalog loader and validator
│   │   ├── commands.ts       # Atomic dequeue and acknowledgement transitions
│   │   ├── presence.ts       # Online/offline sweep and startup reset
│   │   ├── db.ts             # PostgreSQL pool and queries
│   │   ├── config.ts         # Environment loading
│   │   └── index.ts          # Process bootstrap and graceful shutdown
│   ├── schema.sql            # devices, readings, commands DDL
│   ├── tests/                # PostgreSQL integration suite
│   ├── package.json          # edge-post-backend 0.1.0
│   └── package-lock.json
├── dashboard/                # Vite + React operator console (TypeScript)
│   ├── src/
│   │   ├── components/       # Chart, fleet, console, ledger, board catalog
│   │   ├── api.ts            # REST client
│   │   ├── useTelemetry.ts   # WebSocket subscription and history merge
│   │   └── ...
│   ├── package.json          # edge-post-dashboard 0.1.0
│   └── package-lock.json
├── firmware/                 # STM32 application (C)
│   ├── frame.c, frame.h      # Frame codec; host tests
│   ├── command.c             # Poll, validate, apply, acknowledge
│   ├── app.c, app.h          # Link state, sampling and poll cycle
│   ├── config.h              # Compile-time device ID, rate, address, backoff
│   ├── sensors.h, tcp_client.h, clock.h  # Injected hardware contracts
│   ├── boards/               # CubeMX .ioc projects, generated config, catalog
│   ├── tests/                # Host test suites with fake hardware
│   └── Makefile              # test, format-check, lint, board targets
├── docs/                     # Planning and specification (local, untracked)
├── docker-compose.yml        # PostgreSQL 16 + backend, published ports 3000/9000
├── Dockerfile                # Multi-stage image, unprivileged node runtime
├── .dockerignore
├── .github/workflows/ci.yml  # Backend, dashboard, firmware CI jobs
├── .clang-format
├── .clang-tidy
├── LICENSE                   # MIT
└── README.md
```

## Prerequisites & Installation

### Prerequisites

- Node.js 22 and npm
- Docker and Docker Compose (for the container deployment)
- A C compiler (GCC or Clang) for firmware host tests
- PostgreSQL 16 (for local integration tests without Compose)

### Clone

```bash
git clone https://github.com/0xbarss/edge-post.git
cd edge-post
```

### Backend

Install and run the checks from `backend/`:

```bash
cd backend
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

Integration tests require a disposable PostgreSQL 16 container on port 55432:

```bash
docker run -d --rm --name edge-post-test-db \
  -e POSTGRES_USER=edge -e POSTGRES_PASSWORD=edge \
  -e POSTGRES_DB=edge_post_test -p 55432:5432 postgres:16-alpine

TEST_DATABASE_URL=postgres://edge:edge@localhost:55432/edge_post_test \
  npm run test:integration
```

Remove the container when finished with `docker rm -f edge-post-test-db`.

### Dashboard

The dashboard is a separate build step. Build it before starting the backend so the root path serves the operator console:

```bash
cd dashboard
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

A missing `dashboard/dist` returns a 503 placeholder page while the API and TCP listener keep running.

### Firmware host tests

```bash
cd firmware
make test            # GCC and Clang under ASan/UBSan
make format-check    # clang-format
make lint            # clang-tidy
```

### Container deployment

Build and start the stack from the repository root:

```bash
docker compose build
docker compose up -d
```

This starts PostgreSQL 16, applies `backend/schema.sql` to a new database volume, builds the backend image with the dashboard compiled in, and publishes HTTP on port 3000 and device frames on port 9000. `firmware/boards/` is mounted read-only so a locally generated board catalog appears in `GET /api/v1/boards`.

Stop the stack with `docker compose down`; add `-v` to remove the database volume and reapply the schema on the next start.

## Usage & Code Examples

### Register a device over REST

```bash
curl -X POST http://localhost:3000/api/v1/devices \
  -H 'Content-Type: application/json' \
  -d '{"deviceId": 4660, "name": "living-room-node", "sampleRate": 5}'
```

### List devices

```bash
curl http://localhost:3000/api/v1/devices
```

### Read history for a device

```bash
curl "http://localhost:3000/api/v1/readings?deviceId=4660&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z"
```

The default range is one hour; the maximum is seven days.

### Enqueue a command

```bash
curl -X POST http://localhost:3000/api/v1/commands \
  -H 'Content-Type: application/json' \
  -d '{"deviceId": 4660, "type": "toggle_gpio", "payload": {"pin": 3, "state": 1}}'

curl -X POST http://localhost:3000/api/v1/commands \
  -H 'Content-Type: application/json' \
  -d '{"deviceId": 4660, "type": "set_sample_rate", "payload": {"seconds": 10}}'
```

### Open the live feed

Point a browser at `http://localhost:3000/` to load the dashboard, which connects to `ws://localhost:3000/ws` and subscribes to the fleet.

### Send a reading from a device

The device connects to `localhost:9000`, writes a 15-byte reading frame (`0xEE 0x50` magic), then a 5-byte command poll (`0xEE 0x52`), and waits up to two seconds for a 12-byte command frame. See [`PROTOCOL.md`](./docs/PROTOCOL.md) for the exact byte layout.

### Generate board configuration

From a board directory under `firmware/boards/`, run:

```bash
make board            # write board_config.h and boards.json
make board-check      # report drift against generated files
make BOARD=<board>    # add the board directory to the include path
```

## API Reference

All endpoints respond with `{ data }` on success or `{ error: { code, message } }` on failure.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/devices` | POST | Register a device (`deviceId`, `name`, `sampleRate`) |
| `/api/v1/devices` | GET | List devices, newest activity first |
| `/api/v1/devices/:id` | GET | Device detail with latest reading |
| `/api/v1/readings` | GET | History range (`deviceId`, optional `from`/`to`) |
| `/api/v1/commands` | POST | Enqueue a command (`deviceId`, `type`, `payload`) |
| `/api/v1/boards` | GET | Read-only generated board catalog |
| `/ws` | WebSocket | Live `reading` and `device:status` feed |

Command payload shapes:

- `toggle_gpio`: `{ "pin": 0-7, "state": 0\|1 }`
- `set_sample_rate`: `{ "seconds": 1-255 }`

Configuration environment variables:

| Variable | Default | Meaning |
|----------|---------|---------|
| `DATABASE_URL` | `postgres://edge:edge@localhost:5432/edge_post` | PostgreSQL connection |
| `TCP_HOST` | `0.0.0.0` | Device listener bind host |
| `TCP_PORT` | `9000` | Device listener port |
| `HTTP_HOST` | `0.0.0.0` | API bind host |
| `HTTP_PORT` | `3000` | API port |
| `DASHBOARD_DIR` | `dashboard/dist` | Built dashboard directory |
| `BOARDS_FILE` | `firmware/boards/boards.json` | Board catalog path |
| `LOG_LEVEL` | `info` | Structured log level |

## Testing & Quality Assurance

Backend gate (run from `backend/`):

1. `npm run lint` — ESLint flat config
2. `npm run format:check` — Prettier
3. `npm run typecheck` — strict TypeScript, no emit
4. `npm test` — unit suite (Vitest)
5. `TEST_DATABASE_URL=... npm run test:integration` — PostgreSQL 16 integration suite
6. `npm run build` — emit to `backend/dist/`

Dashboard gate (run from `dashboard/`):

1. `npm run format:check`, `npm run lint`
2. `npm run typecheck`
3. `npm test` — unit suite
4. `npm run build` — emit to `dashboard/dist`

Firmware gate (run from `firmware/`):

1. `make test` — codec, command layer, and application loop suites under GCC and Clang with ASan/UBSan
2. `make format-check` — clang-format dry run as error
3. `make lint` — clang-tidy
4. `make board`, `make board-check`, `make BOARD=<board> board-select` — board generation, drift check, selection

CI runs the same `backend`, `dashboard`, and `firmware` jobs on every pull request and push to `main`. The firmware job installs pinned `clang-format` 23.1.5 and `clang-tidy` 23.1.4.

Coverage threshold: none enforced. Adversarial cases (bad magic, bad CRC, split and coalesced reads, unknown command types, poll throttling, presence sweep boundaries) matter more than percentage.

## Troubleshooting & FAQ

**1. The root path returns a 503 placeholder instead of the dashboard.**
Build the dashboard first: `cd dashboard && npm ci && npm run build`. The backend serves `dashboard/dist` on the API origin; a missing build shows the placeholder while the API and TCP listener stay up.

**2. A device connects but never appears in the device list.**
Devices are auto-registered on the first valid reading frame. Confirm the frame magic, CRC, and device ID are valid, and that the backend TCP listener is reachable on port 9000.

**3. A queued command is not delivered.**
The device must send a command poll after each reading. The backend dequeues the oldest pending command on each accepted poll; polls arriving less than 500 ms apart are answered with a no-command frame without querying the queue.

**4. A device shows offline shortly after disconnecting.**
Closing the socket marks it offline immediately; the 5-second presence sweep catches half-open sockets whose `last_seen` is older than `max(3 × sample_rate, 15 seconds)`.

**5. The history chart shows no points.**
History uses the device timestamp `ts`, not arrival time. Query a range that overlaps the device's sampling window, and keep the range within the seven-day maximum.

**6. `make board-check` fails on a fresh clone.**
Run `make board` first to generate `board_config.h` and `boards.json`, then `make board-check` compares generated files against the working tree.

**7. Integration tests fail with a connection error.**
Start the disposable PostgreSQL container described in the backend setup section and confirm `TEST_DATABASE_URL` points at port 55432.

## Author & Contributions

Created and maintained by `0xbarss`. Issues and pull requests are tracked on the repository's issue tracker. This project follows the branch-and-push policy: every implementation change uses its own branch, pushed to `origin` as soon as the first commit exists.

## License & Disclaimer

MIT License. Copyright (c) 2026 0xbarss. See [LICENSE](./LICENSE).

This software is provided "as is", without warranty of any kind. The MVP runs on a trusted network: the device TCP port, REST API, and WebSocket endpoint are unauthenticated and there is no TLS or device authentication. Do not expose this service publicly without adding authentication and transport security.
