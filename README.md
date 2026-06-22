---
title: OMNISCIENT
emoji: 📊
colorFrom: emerald
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
Default password: `omniscient` (change in Settings → Security)

## Secrets (set in Space Settings)
- `APP_PASSWORD` — your login password (default: `omniscient`)
- `DATABASE_URL` — keep default `file:/app/db/custom.db` for SQLite
