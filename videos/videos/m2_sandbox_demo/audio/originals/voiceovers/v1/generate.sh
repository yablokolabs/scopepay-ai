#!/usr/bin/env bash
# Generate audio.mp3 and timing.json for this voiceover from provider_script.md.
# Needs ELEVENLABS_API_KEY in the environment. Run from this folder.
set -euo pipefail
VOICE_ID="Xb7hH8MSUJpSbSDYk0k2" # Alice: British, premade (usable on the free API tier)
TEXT=$(sed '1,/^---$/d' provider_script.md)
RESP=$(mktemp)
trap 'rm -f "$RESP"' EXIT
code=$(curl -sS -o "$RESP" -w '%{http_code}' -X POST \
  "https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps" \
  -H "xi-api-key: ${ELEVENLABS_API_KEY}" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg text "$TEXT" '{text: $text, model_id: "eleven_multilingual_v2", voice_settings: {stability: 0.5, similarity_boost: 0.75}}')")
if [ "$code" != 200 ]; then echo "ElevenLabs answered $code: $(head -c 400 "$RESP")" >&2; exit 1; fi
jq -r '.audio_base64' "$RESP" | base64 --decode > audio.mp3
# Characters -> words: a word is a run of non-space characters.
jq '.alignment as $a | reduce range(0; $a.characters|length) as $i
    ({words: [], cur: null};
      if ($a.characters[$i] | test("\\s")) then
        (if .cur then .words += [.cur] | .cur = null else . end)
      else
        (if .cur then .cur.word += $a.characters[$i] | .cur.end = $a.character_end_times_seconds[$i]
         else .cur = {word: $a.characters[$i], start: $a.character_start_times_seconds[$i], end: $a.character_end_times_seconds[$i]} end)
      end)
    | (if .cur then .words += [.cur] else . end) | {words}' "$RESP" > timing.json
echo "audio.mp3 $(stat -c %s audio.mp3) bytes; $(jq '.words|length' timing.json) words"
