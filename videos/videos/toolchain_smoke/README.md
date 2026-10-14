# Toolchain smoke test

A two-segment video that exists to prove this project's video toolchain end to end. It is not a
product video and is not published anywhere.

## Segments

- **hello-intro** — title card with an animated entrance
- **hello-outro** — closing card, fading in after the intro

Both live in the shared library (`segments/<id>/index.ts`), not in this folder. Videowright only
discovers segments from the shared library, so any video in this project can reference them.

## Render

```bash
npx videowright render toolchain_smoke --audio-track none
```

Writes `output.mp4` into the working directory. `--audio-track none` is required while this video
has no audio track: without it the render looks for `default_audio_track`.

## Preview

```bash
npx videowright dev
```

The dev server auto-discovers the most recent timeline. To target this one explicitly:

```bash
npx videowright dev videos/toolchain_smoke/timeline.ts
```

## Editing

- Describe what you want to change and the agent will update segments, timelines, and styles
- The dev server reloads automatically on file changes
- See `PLAN.md` for the video's design and its verified render history
