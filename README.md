# NarrateAI

NarrateAI turns a short text "hook" into a publish-ready, faceless short-form video: it writes a narration script with GPT, generates voiceover with OpenAI TTS, selects real (non-AI-generated) stock footage to match the beats of the script, burns word-level synced captions in one of several styles, lays down background music, and uploads the finished MP4 — ready to post to TikTok, YouTube Shorts, or Reels. This is a self-hosted, single-user build: there's no signup, login, or billing, just one operator's own instance.

## Features

- **Script generation** — GPT-4o-mini writes a narration script broken into timed beats from a one-line hook, tuned per niche (Stoicism, Philosophy, Mindset, Motivational, Space) and format (quote drop, workout montage, single quote).
- **AI narration** — OpenAI TTS voiceover in six voices (Onyx, Echo, Fable, Alloy, Nova, Shimmer), with word-level timestamps for caption sync.
- **Real stock footage** — clips matched to each script beat by mood/setting/tone, pulled from a local clip library and/or Pexels/Pixabay, with cross-video usage tracking so the same clips don't repeat too often.
- **Synced captions** — word-level captions burned into the video in one of four styles (clean, bold, cinematic, glow); re-render a finished video with a different caption style without regenerating it.
- **Background music** — mood-matched music track selection and mixing.
- **Social content generation** — auto-generated title and caption/hashtags for the finished video.
- **Video history** — every generated video is recorded with its status, and finished videos can be downloaded or re-rendered.
- **Background job queue** — video rendering runs asynchronously via a BullMQ-backed worker so the API stays responsive while ffmpeg does the heavy lifting.

## Quickstart

### Option A: Docker Compose (recommended)

Brings up the API server, the render worker, Redis, and a local Postgres+PostgREST stack that stands in for Supabase — no cloud account required to get something running.

```bash
git clone <this-repo>
cd narrateai
cp .env.example .env
# edit .env — at minimum set OPENAI_API_KEY, PEXELS_API_KEY or PIXABAY_API_KEY, and R2_*
docker compose up --build
```

The API is now at `http://localhost:3000`. To run the frontend against it:

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`.

See the comments at the top of `docker-compose.yml` for what the bundled Postgres/PostgREST pair is doing and how to swap it for a real Supabase project.

### Option B: Local dev (no Docker)

Requires Node 20+, Redis, ffmpeg, and either a Supabase project or your own PostgREST-compatible endpoint for `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`.

```bash
# Backend
cp .env.example .env      # fill in your values
npm install
npm start                 # API server on :3000
npm run worker             # in a second terminal — the render worker

# Frontend, in a third terminal
cd client
cp .env.example .env
npm install
npm run dev                # dev server on :5173
```

Apply the SQL in `supabase/migrations.sql` and everything under `supabase/migrations/` (in that order) to your database before first use.

## Configuration

### Backend (`.env`, see `.env.example`)

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Script generation (chat completions) and narration (TTS). |
| `PEXELS_API_KEY` | Conditional | Stock-footage fallback. Required unless you only ever use a local clip library via `LIBRARY_PATH`. |
| `PIXABAY_API_KEY` | Conditional | Same as above, second fallback source. |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account ID for video storage. |
| `R2_ACCESS_KEY` | Yes | Cloudflare R2 access key. |
| `R2_SECRET_KEY` | Yes | Cloudflare R2 secret key. |
| `R2_BUCKET_NAME` | Yes | R2 bucket finished videos are uploaded to. |
| `R2_PUBLIC_URL` | No | Public base URL for the bucket. Defaults to `https://pub-<R2_ACCOUNT_ID>.r2.dev`. |
| `SUPABASE_URL` | Yes | Base URL of a Supabase project, or a PostgREST-compatible endpoint (e.g. the one `docker-compose.yml` provides). Used purely as a Postgres data layer — not Supabase Auth. |
| `SUPABASE_SERVICE_KEY` | Yes | Service-role key for the above. With the bundled local PostgREST stack, any non-empty placeholder works since it doesn't verify tokens. |
| `LOCAL_USER_ID` | Yes | Fixed UUID every request is attributed to. Can be any UUID — doesn't need to correspond to a real account anywhere. |
| `LOCAL_USER_EMAIL` | Yes | Email shown/logged for that fixed user. |
| `PORT` | No | API server port. Defaults to `3000`. |
| `ALLOWED_ORIGINS` | No | Comma-separated list of origins allowed to call the API (CORS). Defaults to the local Vite dev server only. |
| `REDIS_URL` | No | BullMQ connection string. Defaults to `redis://127.0.0.1:6379`. |
| `LIBRARY_PATH` | No | Absolute path to a local folder of stock clips. If unset, footage always comes from Pexels/Pixabay. |
| `FFPROBE_PATH` | No | Path to the `ffprobe` binary. Defaults to `ffprobe` on `PATH`. |
| `BACKEND_URL` | No | Only read by `scripts/test-e2e.js`, not the app itself. Defaults to `http://localhost:3000`. |

### Frontend (`client/.env`, see `client/.env.example`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | Yes | Base URL of the backend API. |
| `VITE_POSTHOG_PROJECT_TOKEN` | No | Product analytics. Leave unset to disable. |
| `VITE_POSTHOG_HOST` | No | PostHog ingestion host, only relevant if the token above is set. |
| `VITE_R2_PUBLIC_URL` | No | Only used by a hidden `?preview=completed` dev route; not needed for normal use. |

## Limitations

This is a self-hosted, single-user rebuild of what was originally a hosted, multi-tenant SaaS product. In converting it, the following were deliberately stripped out and are **not** coming back as configuration flags:

- **No signup, login, or sessions.** Every request is attributed to one fixed user configured via `LOCAL_USER_ID`/`LOCAL_USER_EMAIL`. There is no multi-user support.
- **No billing.** Stripe, subscriptions, plans, and usage quotas have been fully removed — nothing gates any feature.
- **No hosted infrastructure assumptions.** The original product's admin tooling, hosted deployment configs, and marketing/legal pages tied to its own domain have been removed. You're responsible for your own deployment, TLS, backups, and legal pages if you need them.
- **Data layer still speaks "Supabase."** The app talks to `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` as a PostgREST-flavored REST API, not a generic SQL connection string. The bundled `docker-compose.yml` stands up a local Postgres+PostgREST pair as a substitute so a real Supabase account isn't required, but it's a minimal dev stand-in, not a production-grade Supabase replacement.
- **Single Redis-backed worker.** Video rendering is not horizontally scaled or retried beyond BullMQ's defaults; a stuck worker means stuck jobs.
- **External API costs.** OpenAI, Pexels/Pixabay, and Cloudflare R2 usage are billed by those providers directly — this project doesn't meter or cap that spend for you.
