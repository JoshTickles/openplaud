# Speaker Fingerprinting

How OpenPlaud decides who is speaking, keeps speaker labels consistent, and
remembers voices across recordings.

## The short version

The transcription model labels speakers itself from the audio and prefixes every
turn with a `[m:ss]` timestamp. Those timestamps make the transcript
self-describing, so afterwards we can sample a small amount of audio per label,
embed it into a voiceprint, and use those voiceprints for two things:

1. **Repair the labels.** Two labels whose voiceprints match are the same person
   split in two, so they are merged and the speakers renumbered.
2. **Remember the voice.** Naming a speaker saves their voiceprint, so the next
   recording can suggest the name.

There is no separate diarization pass over the audio. See
[Why the diarization pre-pass was removed](#why-the-diarization-pre-pass-was-removed).

```mermaid
flowchart TD
    A[audio] --> B[transcribe unaided<br/>'[m:ss] Speaker N: ...']
    B --> C[parse turns<br/>label + time range]
    C --> D[select sample windows<br/>~18s per label, 3s each]
    D --> E[embed-speaker-turns.py<br/>one centroid per label]
    E --> F{two labels<br/>similarity >= 0.6?}
    F -->|yes| G[merge + renumber<br/>rewrite transcript]
    F -->|no| H[keep as distinct speakers]
    G --> I[store centroids keyed by final label]
    H --> I
    I --> J[match against voiceprint library<br/>-> suggest a name]
    J --> K[user names a speaker<br/>-> enrol / update voiceprint]
```

## Sampling

`selectSampleWindows` in `src/lib/transcription/speaker-sampling.ts` picks which
seconds to embed. The rules exist for specific reasons:

| Rule | Value | Why |
|------|-------|-----|
| Window length | 3 s, always | Constant length means a constant model input shape, which is what stops the embedding model leaking memory (see below) |
| Audio per speaker | ~18 s | Enough for a stable centroid; more adds cost, not accuracy |
| Edge trim | 0.5 s each end | An approximate timestamp must not clip into the neighbouring voice |
| Turn ordering | longest first, round-robin | A speaker with many turns is sampled at many different moments rather than draining one monologue |

Turns too short to hold a full window are skipped, so **a speaker who only ever
interjects gets no voiceprint**. They keep their own label and simply cannot be
name-matched. A speaker who appears only at the very end is sampled normally,
because sampling is per turn, not spread across the timeline.

## Merging over-split speakers

`resolveSpeakerLabels` walks the labels in numeric order and groups any whose
centroid is within `DEFAULT_MERGE_SIMILARITY` (0.6 cosine) of a group already
formed, recomputing the group centroid as it goes. The lowest-numbered label
wins, and the surviving groups are renumbered to a contiguous `Speaker 1..N`.

The threshold is set from measurements on real recordings in this deployment:

| Comparison | Measured |
|------------|----------|
| Two different speakers in the same meeting | 0.13 - 0.35 (0.158 on a 12 s vs 9 s sample pair) |
| Same person, two unrelated meetings | 0.91 |
| Sampled speaker vs their own library voiceprint | 0.75 (Josh), 0.62 (Parm) from 12 s and 9 s of audio |

The same/different gap is wide, so the exact threshold is not delicate. It is not
unlimited, though: the closest pair of *different* people in the library measures
0.54, so 0.6 is deliberately above that rather than comfortably clear of it. If
two people are ever wrongly merged, raise `DEFAULT_MERGE_SIMILARITY` rather than
adding a second mechanism.

Why this is needed at all: unaided, the model over-splits about one meeting in
five. Measured against hand-named speakers across 97 transcripts, on four-person
meetings it emitted 5.0 labels on average for 4 real people. Given an explicit
count it emitted exactly 4.0. Rather than pay for a full diarization pass to
obtain that count, the voiceprints supply the correction after the fact, which
only requires answering "are these two the same voice".

A per-recording speaker count is still available in the UI. When set, it is
passed to the model as an exact count and the merge step runs as usual.

## Storage

| Column | Contents |
|--------|----------|
| `transcriptions.speaker_centroids` | Final label -> 256-dim L2-normalised centroid |
| `transcriptions.speaker_segments` | Final label -> longest turn `{start, end}`, capped at 12 s, for snippet playback |
| `transcriptions.speaker_map` | Final label -> human name, set by the user |
| `speaker_voiceprints` / `voiceprint_samples` | The cross-recording library; see [Voiceprints](#voiceprints) |

Centroids are keyed by the **final** transcript label (`Speaker 2`), so naming a
speaker attaches the name to the right voice with no extra mapping step.
Recordings transcribed before 2026-09 stored diarizer-native keys
(`SPEAKER_00`); `centroidForTranscriptLabel` still reads those by sorted-order
fallback, so older transcripts keep working.

## Voiceprints

A voiceprint is the mean of its samples, one sample per recording, so a voice
improves as it is seen again. Matching is **suggest-only**: a name is never
written automatically. `DEFAULT_MATCH_THRESHOLD` is 0.5.

There is no separate enrolment step. Naming a speaker on a transcript *is* the
enrolment: the save stores the name and files that speaker's voiceprint under
it. Names are matched case- and whitespace-insensitively, so "Hara-san" after
"Hara-San" strengthens the one voice instead of starting a second, and the
editor offers names already in the library as you type. Renaming a voiceprint
onto a name that already exists merges the two rather than erroring, which is
how two entries for one person get reconciled.

Individual samples can be auditioned and removed in Settings -> Voiceprints,
which recomputes the mean; that is the remedy if a mislabelled turn ever
poisons a voiceprint.

### Auditing the library

Two checks catch a poisoned library, both of which come free from the stored
sample embeddings:

- **Internal consistency.** Samples sharing a name should be mutually similar.
  One sample with a low median similarity to its siblings was attributed to the
  wrong person in that recording.
- **Cross-name collision.** Two different names whose centroids sit above the
  merge threshold are either one person under two spellings, or two names that
  have been swapped.

Libraries built before 2026-09 can contain both faults, because centroids were
keyed by diarizer label and matched back to names by sorted order, which
guesses wrong whenever the diarizer's ordering does not match the transcript's.

## When it does not run

Fingerprinting is skipped, and the UI shows a warning toast explaining which
case applies, when:

- the embedding runtime is missing from the image,
- the transcript came back without `[m:ss]` timestamps, so there are no turn
  ranges to sample,
- no turn was long enough to hold a window,
- or the embedding subprocess failed.

In every case the transcript itself is unaffected. What is lost is the label
repair and the saved voiceprints, so speakers may be over-split and no name
suggestions will appear for that recording.

## Why the diarization pre-pass was removed

Earlier versions ran `scripts/run-diarize.py` over the whole file before
transcription, using pyannote-style VAD plus WeSpeaker embeddings, both to count
speakers and to produce centroids. It was removed because:

- **It was OOM-killed on long recordings.** A 29-minute meeting produced 695
  speech segments and 2,619 overlapping embedding windows, peaking at 4.3 GB in
  a 6.1 GB container (exit 137). The failure was caught and logged, then
  transcription continued without fingerprints, so it looked like the feature
  silently did nothing. Only 24 of 132 transcriptions had any fingerprint data.
- **The leak was shape-dependent.** The WeSpeaker ONNX model leaks roughly
  600 KB per call when the input feature matrix changes shape between calls.
  Fixed-shape input leaks nothing measurable. ONNX Runtime arena and thread
  options made no difference. The 3-second fixed window exists because of this.
- **Its timeline hurt attribution.** It chopped continuous speech into 0.4-3 s
  fragments and mis-assigned the short ones; feeding that to the model made it
  reproduce the scrambled attribution.
- **It was enormously wasteful.** Roughly 7 minutes of audio embedded per
  speaker to describe four voices, where 18 seconds does the job.

The current path embeds around 24 windows for a four-person meeting instead of
2,619, reads only the windows it needs via seek rather than loading the whole
file, and keeps memory flat regardless of recording length.

## Files

| Path | Role |
|------|------|
| `scripts/embed-speaker-turns.py` | Reads windows from stdin, emits one centroid per label |
| `src/lib/transcription/voiceprint-extract.ts` | Spawns the script, availability check |
| `src/lib/transcription/speaker-sampling.ts` | Window selection, merging, transcript relabelling (pure) |
| `src/lib/transcription/speaker-linking.ts` | Parses `[m:ss]` turns out of a transcript, strips timestamps (pure) |
| `src/lib/transcription/voiceprint-match.ts` | Cosine matching against the library, enrolment maths (pure) |
| `src/lib/voiceprints/recompute.ts` | Recomputes a voiceprint from its samples |
| `src/lib/transcription/providers/google-speech-provider.ts` | Orchestration inside `finalizeTranscript` |

`DIARIZE_OMP_THREADS` and `DIARIZE_ONNX_THREADS` (both default 4) cap CPU thread
usage in the embedding script.
