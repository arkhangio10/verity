# Verity <sub><sup>(codename — single rename point in [`packages/core/src/branding.ts`](packages/core/src/branding.ts))</sup></sub>

A web-based, document-grounded **AI agent for corporate loan covenants**. One shared engine, two modes:

- **BEFORE — Design covenants.** Reads a company's financial statements, computes the covenant ratios, measures volatility across historical quarters, runs stress tests, and **proposes a covenant package** (which ratios, what thresholds, step-downs) with justified, cited numbers.
- **AFTER — Monitor covenants.** Re-verifies every ratio against an executed credit agreement's own definitions, measures headroom, detects **drift toward a breach**, cross-checks the transaction ledger for the likely cause, and produces a **cited escalation memo** with a calibrated confidence level.

It is a genuine multi-step agent — plan → retrieve (repeatedly) → call tools → decide → compose — not a single retrieve-then-answer RAG call. The live reasoning trace is a first-class product surface: the UI streams every plan step, retrieval, tool call, decision, and confidence assessment as it happens.

> **Demo data notice:** the bundled company (*Alimentos Andinos S.A.A.*), its financial statements, the credit agreement, and the transaction ledger are **synthetic and illustrative**. They are not real filings and not a real contract.

---

## Quickstart

```bash
npm install
npm test          # 135 unit + integration tests
npm run dev       # → http://localhost:3000
```

That's it — **no API key required**. Without credentials the app runs fully offline: a deterministic planner drives the agent and a lexical (BM25) retriever serves document search, so both modes work end-to-end on the bundled dataset.

To use **Vultr Serverless Inference** as the AI brain, copy [`.env.example`](.env.example) to `.env` (or `apps/web/.env.local`) and set:

| Variable | Purpose |
| --- | --- |
| `VULTR_API_KEY` | Enables live inference (plan narration, reasoning notes, memo drafting). |
| `VULTR_INFERENCE_BASE_URL` | OpenAI-compatible endpoint, default `https://api.vultrinference.com/v1`. |
| `VULTR_CHAT_MODEL` | Chat model id (list them via `GET {base}/models`). |
| `VULTR_EMBED_MODEL` | Enables the **VultronRetriever** (embedding search). Unset → lexical fallback. |
| `AGENT_LOOP_MODE` | `scripted` (default, deterministic control flow) or `model` (LLM-driven ReAct tool loop, experimental). |

The header badge in the UI always shows which brain is active (`VULTR · <model>` vs `OFFLINE · deterministic planner`) and which retriever is serving search.

Other commands: `npm run build` / `npm start` (production), `npm run typecheck`, `npm run test:watch`, `docker build -t covenant .` (standalone image, port 3000).

---

## The demo storyline

The 12-quarter seed ([`packages/sample-data/src/seed.ts`](packages/sample-data/src/seed.ts)) is tuned so both modes have something real to find:

- **AFTER** (test period 2026-Q1): net leverage sits at ~**3.3× vs a 3.50× cap** — compliant but *tight* (< 10% headroom) and **drifting**: the trend projects a breach in **2026-Q3**. The cross-checker finds the cause: a **S/ 45m special distribution** on 2026-02-15, funded with revolver draws (which the memo explains are net-debt-neutral by themselves). Stress shows even a −10% EBITDA quarter trips the covenant. Everything is cited down to statement lines, agreement clauses, and ledger entries.
- **BEFORE** (design/refinancing basis): quarterly EBITDA is seasonal (CoV ≈ 16%, above the 12% policy cutoff), so the proposal policy sizes the opening leverage cap off the **worst stressed level (≈4.1×) plus a volatility cushion → ≤ 4.50×**, stepping down to 3.75× over eight quarters, with DSCR/current-ratio/FCCR floors derived the same way.

---

## Architecture

```
apps/web            Next.js UI + API routes (SSE streaming, docs, meta)
     │  assembles RunDataset, picks providers, streams TraceEvents
     ▼
packages/agent      plan-act loop · 7 tools · reasoning trace · fact table
     │              calibrated confidence · number-guarded composer
     │ uses                                   │ retrieves via
     ▼                                        ▼
packages/core       packages/providers       packages/adapters
deterministic       InferenceClient iface    CountryAdapter iface
engine (pure math,  ├ VultrInferenceClient   └ PeruAdapter (SMV JSON,
zero deps, no I/O,  ├ VultronRetriever            PDF text path, NIIF
never calls an LLM) └ LexicalRetriever            terms, PEN/USD, IFRS 16)
     ▲
     └── packages/sample-data   seed → SMV fixtures + rendered filings +
                                agreement + ledger (single source of truth)
```

### Non-negotiable principles (and where they live)

1. **Deterministic calculation core.** All financial math is real, tested code in [`packages/core`](packages/core/src) — ratios, LTM aggregation, headroom, volatility, stress, drift, proposal policy. The engine has **zero dependencies and never talks to a model or the network**. The LLM orchestrates, reads and writes; it never computes.
2. **The model can't invent numbers — structurally.** Every number that can appear in output is first registered in the **fact table** ([`facts.ts`](packages/agent/src/facts.ts)) by the engine or an adapter, with its full citation tree. Drafted prose refers to facts only as `{{fact:id}}` tokens; the renderer substitutes registered values, unknown ids reject the draft, and a **number guard** ([`compose.ts`](packages/agent/src/compose.ts)) rejects any drafted text containing digits outside a small whitelist (quarter labels, dates, clause refs, shock labels). Guard-failing drafts fall back to deterministic templates, visibly (`LLM-drafted · guard-verified` vs `template` in the UI).
3. **Contract definitions override textbook accounting.** Every metric is parameterized by a **definition object** ([`definitions.ts`](packages/core/src/definitions.ts)): Covenant EBITDA add-backs with LTM caps, whether IFRS 16 / NIIF 16 lease liabilities count as debt, cash vs accrual interest, lease principal in debt service, unfinanced vs gross capex. In AFTER mode the definitions come from the executed agreement and are **verbatim-verified** against the document text at run time; in BEFORE mode disclosed templates apply (themselves cited to a rendered template document).
4. **Multi-country by design.** The engine and agent are country-blind. Everything Peru-specific — SMV Open Data ingestion, Spanish NIIF terminology, PEN (USD via cited FX), filing-date staleness — lives behind the [`CountryAdapter`](packages/adapters/src/types.ts) interface. See *Adding a country adapter* below.
5. **Everything is cited.** Adapters attach a `SourceRef` (document, section, line locator, quote) to every extracted value; engine computations carry their full input trees; the memo renders numbers as clickable fact chips that open a provenance drawer (label → formula → sources → highlighted document section).

### The agent loop

Control flow is **scripted and auditable by default** (a feature for credit workflows): the mode orchestrations ([`modes/after.ts`](packages/agent/src/modes/after.ts), [`modes/before.ts`](packages/agent/src/modes/before.ts)) decide *what happens*; the planner contributes wording, one-line reasoning notes, and section drafts when Vultr is configured. `AGENT_LOOP_MODE=model` switches to a fully **model-driven ReAct tool loop** ([`llmLoop.ts`](packages/agent/src/llmLoop.ts)) in which the LLM chooses tools and when to stop — every call still passes through the same validated tool registry and the same fact/number guards, and any failure falls back to the scripted orchestrator.

The tools (zod-validated args, uniform trace events):

| Tool | Does |
| --- | --- |
| `ratio_calculator` | DSCR, leverage, ICR, current ratio, FCCR — point or full historical series, LTM basis, per governing definitions. |
| `headroom_calculator` | Absolute cushion + % headroom vs the effective threshold (step-downs honored) → compliant / tight / breach. |
| `volatility_analyzer` | Coefficient of variation + trend of quarterly EBITDA or of a ratio series. |
| `stress_tester` | EBITDA −10/−20%, rates +200 bps (via disclosed floating-rate share), combined — recomputed ratios + re-tested covenants. |
| `document_retriever` | Clause/line-item retrieval with doc/section/scores — called repeatedly (definitions, covenants, market standards). |
| `transaction_cross_checker` | Decomposes a ratio movement, attributes each ledger entry a deterministic net-debt effect (draws/amortization are neutral; distributions/leases/capex are not), ranks causes by share of gross adverse pressure with evidence links. |
| `covenant_proposer` | The deterministic proposal policy ([`proposal.ts`](packages/core/src/proposal.ts)): ratio selection, thresholds, volatility cushions, step-down glide paths — the LLM justifies, never picks numbers. |

### How confidence works

Confidence is **calibrated from observable signals, never self-reported by the model**, and deliberately categorical (LOW / MEDIUM / HIGH) — a precise percentage would imply calibration we can't demonstrate. The rubric ([`confidence.ts`](packages/agent/src/confidence.ts)):

| Signal | Effect |
| --- | --- |
| Required inputs missing | **LOW** |
| Template definitions used in *monitoring* mode | **LOW** (monitoring must use the executed agreement) |
| Stale filing (freshness policy) | cap MEDIUM (LOW if inputs also defaulted) |
| Agreement clause not verbatim-matched in the document | cap MEDIUM |
| Optional inputs defaulted to zero | cap MEDIUM |
| Cross-checks inconsistent (no cause explains the movement) | cap MEDIUM |
| LLM drafting samples disagree on cited facts (Jaccard < 0.75) | cap MEDIUM |

Every assessment ships with a one-line justification. **LOW routes the item to a "needs human review" state** — the UI banners it and it must not be auto-published.

### Repository map

```
packages/core          engine: units, citations, periods, statements, definitions,
                       resolver (LTM), ratios, headroom, volatility, stress, drift,
                       proposal policy, shared data shapes  ·  tests/
packages/providers     InferenceClient + VultrInferenceClient (OpenAI-compatible,
                       env-configured, retrying) · Retriever + VultronRetriever
                       (embeddings) + LexicalRetriever (BM25, diacritics-folding)
packages/agent         trace, fact table, confidence, composer + number guard,
                       toolkit + 7 tools, planners, scripted modes, model loop
packages/adapters      CountryAdapter interface + registry · PeruAdapter (SMV
                       client, NIIF term table, mapper, PDF text path, freshness)
packages/sample-data   12-quarter seed → SMV fixtures, rendered Spanish filings,
                       illustrative credit agreement (verbatim-checkable),
                       treasury ledger, knowledge docs, dataset assembly
apps/web               Next.js App Router: SSE run endpoint, runs/documents/meta
                       APIs, two-panel UI (live trace | cited memo), doc viewer
tests/                 end-to-end integration tests (both modes, offline)
```

### Why this stack

TypeScript end-to-end in an npm-workspaces monorepo: the engine, agent, adapters and UI share types with zero serialization drift, and the workspace boundaries physically enforce the layering (core cannot import providers). **Next.js** (App Router) serves the UI and the streaming SSE API from one process — trivially runnable locally, containerizable via the standalone output, and free of any hosting-platform lock-in. No Streamlit.

---

## Adding a country adapter

The engine and agent never change. To add e.g. Mexico:

1. Create `packages/adapters/src/mexico/` and implement [`CountryAdapter`](packages/adapters/src/types.ts): `countryCode`, `accountingStandard`, `defaultCurrency`, `fetchStatements()` (primary structured source — e.g. CNBV/BMV), `parseFilingText()` (PDF path), `assessFreshness()` (local filing calendar).
2. Write the **term table** mapping local statement labels to `CanonicalFieldPath`s (see [`peru/terms.ts`](packages/adapters/src/peru/terms.ts)) and a mapper that attaches a `SourceRef` to every value it extracts. Unmapped lines must become warnings, never silent drops.
3. Handle local specifics inside the adapter only: currency conversion takes a cited FX rate; IFRS 16-style lease treatment stays a *definition object* decision, not adapter logic.
4. Register it (`registerAdapter(new MexicoAdapter(...))`), point the app's dataset assembly at it, and add mapper/freshness tests mirroring [`adapters/tests/peru.test.ts`](packages/adapters/tests/peru.test.ts).

## Testing

`npm test` runs 135 tests: engine functions against hand-computed expectations (ratios, caps, headroom, CoV/OLS, stress, drift, proposal policy, rounding), providers (request shaping, retries, BM25 ranking, embedding fallback), agent guards (confidence matrix, number guard, draft parsing, net-debt attribution), the Peru adapter (term normalization, cited mapping, USD conversion, PDF text parsing, staleness), dataset consistency (balance sheet ties by construction, cash roll, scenario assertions), and full end-to-end runs of both modes asserting the trace shape, the story (tight → drift → cause), digit-free prose, and resolvable citations.

## Deployment

No hosting platform is assumed. The app is a standard Next.js server: run it anywhere Node 22 runs, or build the container (`docker build -t covenant .`) — a multi-stage image over the standalone output, configured entirely via environment variables, no secrets baked in. CI (GitHub Actions) typechecks, tests, and builds on every push.

## Roadmap (deliberately out of scope for this foundation)

Persistence for runs/datasets (the `RunStore` and dataset assembly are already behind seams), authentication, live SMV pulls with response-mapping confirmation, more shock types (FX, working-capital), covenant cure/waiver workflow state, ESLint/prettier config, and a decimal-arithmetic swap-in for the engine's money type if sub-unit precision ever matters (ratios are display-rounded only).
