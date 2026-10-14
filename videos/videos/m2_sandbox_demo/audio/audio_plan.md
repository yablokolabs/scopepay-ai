# Audio Plan

## Plan

VO-only track. Single full-file voiceover placed at 0s.

### Cues

1. **Voiceover v1** — `audio/originals/voiceovers/v1/audio.mp3`, full file, at 0s.

### Final mix command

```bash
ffmpeg -y \
  -i audio/originals/voiceovers/v1/audio.mp3 \
  -c:a libmp3lame -q:a 2 \
  {TRACK_OUT}
```

## Log

## 2026-10-14 -- initial build
**Change:** initial build, voiceover v1 (Alice)
**Why:** first render with narration
**Render:** audio/tracks/v1/track.mp3
