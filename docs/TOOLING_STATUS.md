# Tooling status

Observed during the October 13, 2026 session on the build host. This records what
was actually reachable and used. Nothing here is inherited from a config label.

| Requirement | Observed state | What was actually done |
| --- | --- | --- |
| Hindsight MCP/API on port 8888, bank `scopepay-ai` | **Available.** `GET http://localhost:8888/health` → 200, port listening. No banks existed at session start, so the first recall returned `Bank 'scopepay-ai' not found`. | Bank `scopepay-ai` was created with the mandated name and a milestone checkpoint was written to it, including the credential blocker. No secrets, buyer data or raw headers were stored. |
| `context-mode` | **Binary present** at `/home/azureuser/.local/node-v22.23.2/bin/context-mode`; no context-mode tools were exposed in this session's tool list. | Not used, and not claimed as active. Large reads were bounded direct file reads and targeted searches. |
| Nori `senior-swe` | **Not installed.** The visible skill catalogs (`~/.agents/skills`, `~/.claude/skills`) contain `nori-info` and the Build With AI skills, but no `senior-swe` skillset. | Not activated. No similarly named package from a guessed repository was installed. |
| Headroom | **Not verified.** No local MCP integration or proxy found on the host. | Not used and not claimed. |
| ADHD ideation (`uditakhourii/adhd`) and `i-have-adhd` response style | **Not installed** in the visible catalogs. | The user-requested response style (short numbered steps, action first, concrete estimates, location → cause → fix) was followed directly; no separate skill was claimed to run. |
| Videowright | **Not installed.** No `videos/` workspace exists. | Not started; no narration was generated. |
| ElevenLabs | Key present in the shared env file under `ELEVENLABS_API_KEY` (name discovery only). | No voice selected, auditioned or billed, so no quota was spent. |
| diagram-design | Not installed. | Architecture SVG/PNG not produced; no placeholder image was embedded in the README. |

## Notes

- Client reference for the missing skills, to be resolved deliberately rather
  than approximated: `tilework-tech/nori-skillsets` (select `senior-swe`),
  `headroomlabs-ai/headroom`, `dietrichgebert/ponytail`, `uditakhourii/adhd`,
  `ayghri/i-have-adhd`, `scosman/videowright`, `cathrynlavery/diagram-design`.
- Activating a skillset rewrites agent configuration and must not overwrite
  `AGENTS.md` or `docs/SESSION_TOOLING.md`; that was not attempted.
- Hindsight and Headroom serve different purposes here. Hindsight is durable
  memory; Headroom is context compression. Neither was conflated with the other.
