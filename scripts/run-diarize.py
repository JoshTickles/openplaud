#!/usr/bin/env python3
"""
Speaker diarization script for OpenPlaud.

Takes an audio file path, runs CPU-based speaker diarization using the
`diarize` library, and outputs JSON segments to stdout.

Usage:
    python3 scripts/diarize.py /path/to/audio.mp3
    python3 scripts/diarize.py /path/to/audio.mp3 --min-speakers 2 --max-speakers 6
    python3 scripts/diarize.py /path/to/audio.mp3 --merge-threshold 0.55

Output (JSON on stdout):
    {
        "num_speakers": 3,
        "speakers": ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"],
        "audio_duration": 324.5,
        "segments": [
            {"start": 0.5, "end": 4.2, "speaker": "SPEAKER_00", "duration": 3.7},
            ...
        ]
    }
"""

import argparse
import json
import logging
import os
import sys

logging.basicConfig(level=logging.WARNING)


def _configure_threads() -> None:
    """Cap CPU thread usage from env vars to avoid saturating all cores."""
    omp = os.environ.get("DIARIZE_OMP_THREADS", "4")
    onnx = os.environ.get("DIARIZE_ONNX_THREADS", "4")

    os.environ.setdefault("OMP_NUM_THREADS", omp)
    os.environ.setdefault("MKL_NUM_THREADS", omp)
    os.environ.setdefault("OPENBLAS_NUM_THREADS", omp)

    import torch
    torch.set_num_threads(int(omp))
    torch.set_num_interop_threads(int(omp))

    import wespeakerruntime as _wr
    _orig_init = _wr.Speaker.__init__
    _onnx_threads = int(onnx)

    def _patched_init(self, *a, inter_op_num_threads=1, intra_op_num_threads=1, **kw):
        _orig_init(
            self, *a,
            inter_op_num_threads=_onnx_threads,
            intra_op_num_threads=_onnx_threads,
            **kw,
        )

    _wr.Speaker.__init__ = _patched_init


def _merge_similar_clusters(embeddings, labels, threshold: float):
    """Union-find merge of clusters whose centroids are within cosine
    similarity *threshold*. Returns the new labels array and a log of
    merges performed (a list of (from, into, sim) tuples).

    Operates on the raw cluster labels produced by `cluster_speakers`,
    which are integer ids. After merging we renumber to a dense 0..N-1
    range so downstream segment building stays valid.
    """
    import numpy as np

    unique = sorted(set(int(x) for x in labels.tolist()))
    if len(unique) < 2:
        return labels, []

    # L2-normalised centroids per cluster
    centroids = {}
    for u in unique:
        mask = labels == u
        c = embeddings[mask].mean(axis=0)
        n = float(np.linalg.norm(c))
        centroids[u] = c / n if n > 1e-9 else c

    # All pairs, sorted by similarity descending
    pairs = []
    for i, a in enumerate(unique):
        for b in unique[i + 1:]:
            sim = float(np.dot(centroids[a], centroids[b]))
            pairs.append((sim, a, b))
    pairs.sort(reverse=True)

    parent = {u: u for u in unique}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    merges: list[tuple[int, int, float]] = []
    for sim, a, b in pairs:
        if sim < threshold:
            break
        ra, rb = find(a), find(b)
        if ra == rb:
            continue
        # merge ra into rb (lower id wins as the canonical id)
        keep, drop = (rb, ra) if rb < ra else (ra, rb)
        parent[drop] = keep
        merges.append((drop, keep, sim))

    # Build dense renumbering keep_id -> 0..N-1
    canon = sorted({find(u) for u in unique})
    renum = {c: i for i, c in enumerate(canon)}
    new_labels = np.array([renum[find(int(l))] for l in labels], dtype=labels.dtype)
    return new_labels, merges


def main() -> None:
    parser = argparse.ArgumentParser(description="Speaker diarization")
    parser.add_argument("audio_path", help="Path to audio file")
    parser.add_argument("--min-speakers", type=int, default=None)
    parser.add_argument("--max-speakers", type=int, default=None)
    parser.add_argument("--num-speakers", type=int, default=None)
    parser.add_argument(
        "--merge-threshold",
        type=float,
        default=None,
        help=(
            "If set, after clustering, merge any pair of speakers whose "
            "centroid cosine similarity is >= this threshold. Only applied "
            "when --num-speakers is not provided. Typical: 0.5 (aggressive) "
            "to 0.6 (conservative)."
        ),
    )
    args = parser.parse_args()

    _configure_threads()

    # Redirect stdout to stderr during import and processing so that
    # model-download progress bars don't corrupt our JSON output.
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    import numpy as np
    from diarize import (
        run_vad,
        extract_embeddings,
        cluster_speakers,
        get_audio_duration,
    )
    # _build_diarization_segments is private but stable; we fall back to
    # a simple subsegment-based build if it disappears in a future version.
    try:
        from diarize import _build_diarization_segments  # type: ignore
    except ImportError:
        _build_diarization_segments = None  # type: ignore

    audio_path = args.audio_path
    duration = get_audio_duration(audio_path)

    speech_segments = run_vad(audio_path)
    if not speech_segments:
        sys.stdout = real_stdout
        json.dump({
            "num_speakers": 0,
            "speakers": [],
            "audio_duration": duration,
            "segments": [],
        }, sys.stdout)
        return

    embeddings, subsegments = extract_embeddings(audio_path, speech_segments)
    if len(embeddings) == 0:
        sys.stdout = real_stdout
        json.dump({
            "num_speakers": 0,
            "speakers": [],
            "audio_duration": duration,
            "segments": [],
        }, sys.stdout)
        return

    cluster_kwargs: dict = {}
    if args.num_speakers is not None:
        cluster_kwargs["num_speakers"] = args.num_speakers
    else:
        if args.min_speakers is not None:
            cluster_kwargs["min_speakers"] = args.min_speakers
        if args.max_speakers is not None:
            cluster_kwargs["max_speakers"] = args.max_speakers

    labels, _ = cluster_speakers(embeddings, **cluster_kwargs)

    # Post-pass cluster merge: only applies when speaker count was auto-
    # detected (an explicit num_speakers means the caller is confident).
    if args.merge_threshold is not None and args.num_speakers is None:
        before = len(set(int(x) for x in labels.tolist()))
        labels, merges = _merge_similar_clusters(
            embeddings, labels, args.merge_threshold,
        )
        after = len(set(int(x) for x in labels.tolist()))
        if merges:
            print(
                f"[diarize] post-pass merged {before}->{after} clusters: "
                + ", ".join(f"{d}->{k} (sim={s:.3f})" for d, k, s in merges),
                file=sys.stderr,
            )

    # Build segments via the library's smoothing/decoding logic when
    # available; otherwise emit one segment per subsegment.
    if _build_diarization_segments is not None:
        segments = _build_diarization_segments(
            speech_segments, subsegments, labels, embeddings,
        )
        segment_list = [
            {
                "start": float(s.start),
                "end": float(s.end),
                "speaker": s.speaker,
                "duration": float(s.duration),
            }
            for s in segments
        ]
        speakers = sorted({s.speaker for s in segments})
    else:
        segment_list = []
        for sub, lbl in zip(subsegments, labels.tolist()):
            segment_list.append({
                "start": float(sub.start),
                "end": float(sub.end),
                "speaker": f"SPEAKER_{int(lbl):02d}",
                "duration": float(sub.end - sub.start),
            })
        speakers = sorted({s["speaker"] for s in segment_list})

    sys.stdout = real_stdout
    json.dump({
        "num_speakers": len(speakers),
        "speakers": speakers,
        "audio_duration": duration,
        "segments": segment_list,
    }, sys.stdout)


if __name__ == "__main__":
    main()
