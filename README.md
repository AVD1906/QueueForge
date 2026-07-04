# QueueForge

A production-pattern distributed task queue built on Redis Streams — with horizontal worker scaling, exponential backoff retry, dead-letter queue, and a live WebSocket monitoring dashboard.

> Built from scratch without BullMQ or any job queue library. Every primitive — consumer groups, pending entries, crash recovery — implemented directly against the Redis Streams API.

---

## Load Test Results

Tested with [k6](https://k6.io) at 50 concurrent virtual users over 70 seconds:

| Metric | Result |
|---|---|
| Total jobs enqueued | 20,468 |
| Throughput | **292 requests/sec** |
| Avg response time | 6.69ms |
| p95 latency | 13.11ms |
| Failure rate | **0.00%** |
| Checks passed | 40,936 / 40,936 (100%) |

<img width="1114" height="762" alt="WhatsApp Image 2026-07-04 at 18 39 17" src="https://github.com/user-attachments/assets/21426e91-dbb4-4c71-b717-8bfd8ca5dbde" />


---

## Architecture

```
Producers (REST API)
        │
        │  XADD
        ▼
Redis Streams ──────────────────────────────────┐
  queue:email                                    │
  queue:image                 XREADGROUP         │
  queue:report  ◄────────────────────────────-   │
        │                                        │
        │              Workers (Docker replicas) │
        │         ┌──────────┬──────────┐        │
        │         │ worker-1 │ worker-2 │  ...   │
        │         └────┬─────┴────┬─────┘        │
        │              │ XACK     │              | 
        ▼              ▼          ▼              | 
   PostgreSQL    job history + status            | 
   (source of    result / error                  |
    truth)                                       |
        │                                        │
        ▼                                        │
  React Dashboard ◄── Socket.io WebSockets ──────┘
  (live monitoring)
        │
  queue:failed (DLQ) ◄── after 3 failed attempts
```

---

## How it works

### Job lifecycle

```
ENQUEUE → WAITING → ACTIVE → COMPLETED
                        │
                        └── FAILED → retry (backoff) → FAILED → retry → DLQ
```

1. **Enqueue** — Producer calls `POST /jobs`. Job is written to Postgres (status: `waiting`) and pushed to a Redis Stream via `XADD`.

2. **Claim** — Worker calls `XREADGROUP`. Redis atomically delivers the message to exactly one worker. No two workers can claim the same job. This is the key primitive — no explicit locking needed.

3. **Process** — Worker executes the job handler. Emits `job:active` over Socket.io to the dashboard.

4. **Success** — Worker calls `XACK`, removes the message from the pending entries list, updates Postgres to `completed`.

5. **Failure** — Worker increments `attempts`, waits `2^attempts × 1000ms` (exponential backoff), re-enqueues the job.

6. **Dead-letter** — After 3 failures, job moves to `queue:failed` stream with full error trace. Dashboard shows DLQ depth for manual inspection.

### Why XREADGROUP over LPOP

`LPOP` permanently removes a message from the queue. If a worker crashes after popping but before finishing, the job is silently lost.

`XREADGROUP` keeps messages in a **pending entries list** until explicitly acknowledged with `XACK`. If a worker crashes, the message stays in the pending list and can be reclaimed — giving at-least-once delivery guarantees without any external coordination.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Job queue | Redis Streams (XADD, XREADGROUP, XACK) |
| API | Node.js, Express |
| Worker | Node.js consumer loop |
| Database | PostgreSQL (job history + status) |
| Real-time | Socket.io WebSockets |
| Dashboard | React, Recharts |
| Proxy | nginx (reverse proxy + WebSocket upgrade) |
| Containerization | Docker, Docker Compose |
| CI/CD | GitHub Actions |
| Load testing | k6 |

---

## Features

- **Redis Streams consumer groups** — atomic job claiming, no double-processing
- **Exponential backoff** — `2^attempt × 1000ms` delays between retries
- **Dead-letter queue** — failed jobs preserved for inspection, not silently dropped
- **Horizontal scaling** — spin up N workers with `docker compose up --scale worker=N`
- **Live dashboard** — real-time job state transitions via Socket.io
- **Throughput chart** — events/sec visualized as jobs flow through the system
- **Crash recovery** — pending entries list survives worker restarts
- **GitHub Actions CI/CD** — lint, build, Docker image build on every push to `main`

---

## Project Structure

```
task-queue/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── index.js       # Express + Socket.io server
│   │       ├── redis.js       # ioredis client
│   │       ├── db.js          # pg Pool
│   │       ├── queue.js       # enqueue() via XADD
│   │       └── migrate.js     # creates jobs table
│   ├── worker/
│   │   └── src/
│   │       ├── index.js       # entry point
│   │       ├── consumer.js    # XREADGROUP loop + Socket.io events
│   │       ├── processor.js   # job handler
│   │       └── retry.js       # backoff + DLQ logic
│   └── dashboard/
│       ├── nginx/
│       │   └── default.conf   # reverse proxy config
│       └── src/
│           └── App.jsx        # React dashboard
├── load-test/
│   └── k6.js                  # k6 load test script
├── .github/
│   └── workflows/
│       └── ci.yml             # GitHub Actions pipeline
└── docker-compose.yml
```

---

## Running locally

### Prerequisites
- Docker Desktop
- Node.js

### Start infrastructure

```bash
docker compose up -d redis postgres redis-commander
```

### Run API

```bash
cd apps/api
node src/migrate.js   # first time only
node src/index.js
```

### Run Worker

```bash
cd apps/worker
node src/index.js
```

### Open dashboard

```
http://localhost:5173   # local dev (npm run dev in apps/dashboard)
http://localhost        # Docker (docker compose up --build)
```

### Enqueue a job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"queue":"email","payload":{"to":"user@example.com","subject":"Hello"}}'
```

### Scale workers

```bash
docker compose up --scale worker=5
```

Watch 5 workers appear in the dashboard simultaneously claiming jobs.

---

## CI/CD Pipeline

GitHub Actions runs on every push to `main`:

```
push to main
     │
     ├── Test API         (npm install + module load check)
     ├── Test Worker      (npm install + module load check)  
     ├── Build Dashboard  (npm install + vite build)
     └── Docker Build     (builds all 3 images)
              │
              └── all jobs must pass before merge
```

Pipeline: [GitHub Actions](https://github.com/AVD1906/task-queue/actions)

---

## Load Testing

```bash
k6 run load-test/k6.js
```

The script ramps from 0 → 10 → 50 → 0 virtual users over 70 seconds, firing `POST /jobs` requests with randomized queue names. Thresholds: p95 < 500ms, failure rate < 1%.

