# Built With

Tags below are **verified by use in this repository**, not planned. Maximum 25
honest tags.

| Tag | Verified by |
| --- | --- |
| `paypal` | Real PayPal **sandbox** REST calls, locally and on the hosted demo (three more captures and real signed webhooks, `PROOF_M2_SANDBOX.md` §11): `POST /v1/oauth2/token` (200), `POST /v2/checkout/orders` (real order created), `GET /v2/checkout/orders/:id`, `POST /v2/checkout/orders/:id/capture` — first refused with 422 `ORDER_NOT_APPROVED`, then completed for real once a sandbox buyer approved, returning capture id `6YS286962F723210Y` (`COMPLETED`, `1640.00 USD`). Recorded in `docs/proof/PROOF_M2_SANDBOX.md`. Sandbox app credentials only; the live host rejects them. |
| `apertus` | Live `swiss-ai/Apertus-v1.5-70B` on CSCS inference for brief extraction and change classification, with real latency/token metadata recorded in `docs/proof/`. |
| `typescript` | The whole codebase; `tsc --noEmit` clean. |
| `react` | The client (`app/src`), built by Vite. |
| `zod` | Every untrusted input boundary: HTTP bodies, model output, provider payloads. |
| `vitest` | 125 tests (`npm test`), including a D1 suite on Miniflare. |
| `hono` | Server routes in `server/app.ts`, run on `@hono/node-server` locally and on Workers in the demo. |
| `cloudflare-workers` | The live demo, https://scopepay.young-disk-9d1c.workers.dev, from `worker/index.ts` and `wrangler.toml`, with a Rate Limiting binding on the model routes. |
| `cloudflare-d1` | The demo's storage (database `scopepay`, migration `migrations/0001_init.sql`). Real hosted captures are stored there; see `docs/proof/PROOF_M2_SANDBOX.md` §11. |
| `vite` | Client build (`npm run build`). |
| `diagram-design` | `docs/architecture` and `docs/payment-flow`, built from a checkout pinned at `11b08ea`. Its `self_check.py` and `verify-geometry.py` pass on both. |
| `playwright` | Rasterises both diagrams (`videos/scripts/export-diagram.mjs`), checks them (`videos/scripts/check-diagram.mjs`), and drives Videowright's render. |
| `videowright` | The demo video: `videos/videos/m2_sandbox_demo`, rendered to `demo.mp4` (139.7s, 1920x1080, 30fps). |
| `elevenlabs` | The demo narration: voice Alice, `eleven_multilingual_v2`, synthesised once through `/with-timestamps`. Segment timing and captions come from its word timestamps. |
| `ffmpeg` | Encodes the video, builds the audio track, and backs `videos/scripts/check-export.mjs`. |

Deliberately **not** claimed:

- `vinext` / Sites — the Sites/Vinext tooling is not installed on this host, so
  the project uses Vite + React + Hono instead.
- No Qloo, OpenAI or other sponsor tag: none has any role in this build.

## AI tools used to build it

Apertus is the only model inside the product. These tools helped build it:

- **Claude Code** (Anthropic Claude Opus): code, tests, the PayPal integration,
  the Cloudflare deploy, docs and proof runs.
- **Freebuff:** agent host, reported by the owner.
- **Nori skillsets:** planning, test-driven development and PR workflow.
- **Hindsight:** project memory between sessions (bank `scopepay-ai`).
- **ElevenLabs:** the demo narration.
