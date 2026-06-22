---
title: OMNISCIENT
emoji: 📊
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# OMNISCIENT — Global Market Intelligence

24/7 AI-powered market intelligence dashboard with the Lazy Brain autonomous orchestration engine.

## Features
- **Lazy Brain** — token-economy LLM orchestration (3× token savings on a free stack)
- **7 Edge Modules** — vol-targeting, cointegration, derivatives-v2, triple-barrier, DSR, Hurst, asymmetric F&G
- **5 Free Data Sources** — CoinGecko, blockchain.info, GitHub, Reddit, Deribit
- **32 Pages** — dashboard, brain control panel, crypto, markets, signals, derivatives, correlation, screener, portfolio, analytics, news, macro, settings, + more
- **Zero API Keys** — Pollinations free LLM is the default; works out of the box

## Login
Default password: `omniscient` (change in Settings → Security or set `APP_PASSWORD` Secret)

## Persistence on Hugging Face Spaces

This app uses a **4-layer persistence architecture** so your settings, API keys, and data survive Space restarts and rebuilds:

### Layer 1: HF Space Secrets (highest priority — for credentials)
Set these in **Space Settings → Secrets**. They persist across restarts/rebuilds and override DB values:
- `APP_PASSWORD` — your login password (overrides default `omniscient`)
- `SUPABASE_URL` — your Supabase project URL (`https://xxx.supabase.co`)
- `SUPABASE_ANON_KEY` — your Supabase anon key
- `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `NVIDIA_NIM_API_KEY` — LLM provider keys (any or all)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — for Telegram alerts
- `FINNHUB_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `COINGECKO_API_KEY`, `FMP_API_KEY`, `NEWS_API_KEY` — data source keys

### Layer 2: Supabase cloud sync
On startup, the app pulls all settings from your Supabase `Setting` table into local SQLite (via `instrumentation.ts`). This restores watchlists, alert thresholds, module configs, and any DB-stored API keys. When you save a setting in the UI, it's also pushed to Supabase as a cloud backup.

### Layer 3: HF Storage Bucket (persistent SQLite)
The SQLite DB lives at `/data/custom.db` — a Storage Bucket mounted at `/data`. To set this up (one-time):
```bash
hf buckets create omniscient-data --private
hf spaces volumes set YOUR_USERNAME/YOUR_SPACE -v hf://buckets/YOUR_USERNAME/omniscient-data:/data
```
The DB persists across restarts. The `docker-entrypoint.sh` script only seeds defaults on first run (when the DB file is missing) — it never wipes existing data.

### Layer 4: Local SQLite (fallback)
If no bucket is mounted, the DB falls back to `./db/custom.db` (ephemeral on HF Spaces, persistent locally).

## Quick Start (HF Spaces)
1. Deploy this repo as a Docker Space.
2. In Space Settings → Secrets, add `APP_PASSWORD` and (optionally) `SUPABASE_URL` + `SUPABASE_ANON_KEY`.
3. (Recommended) Create a Storage Bucket and mount at `/data` for DB persistence.
4. The app starts, pulls settings from Supabase (if configured), and is ready.
