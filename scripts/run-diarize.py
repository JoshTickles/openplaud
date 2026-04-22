#!/usr/bin/env python3
"""
Speaker diarization script for OpenPlaud.

Takes an audio file path, runs CPU-based speaker diarization using the
`diarize` library, and outputs JSON segments to stdout.

Usage:
    python3 scripts/diarize.py /path/to/audio.mp3
    python3 scripts/diarize.py /path/to/audio.mp3 --min-speakers 2 --max-speakers 6

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

# Suppress torch/torchaudio warnings that clutter stderr
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

    # Monkey-patch wespeakerruntime to use more ONNX threads
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Speaker diarization")
    parser.add_argument("audio_path", help="Path to audio file")
    parser.add_argument("--min-speakers", type=int, default=None)
    parser.add_argument("--max-speakers", type=int, default=None)
    parser.add_argument("--num-speakers", type=int, default=None)
    args = parser.parse_args()

    _configure_threads()

    # Redirect stdout to stderr during import and processing so that
    # model-download progress bars don't corrupt our JSON output.
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    # Import here so arg parsing errors are fast
    from diarize import diarize

    kwargs: dict = {}
    if args.num_speakers is not None:
        kwargs["num_speakers"] = args.num_speakers
    else:
        if args.min_speakers is not None:
            kwargs["min_speakers"] = args.min_speakers
        if args.max_speakers is not None:
            kwargs["max_speakers"] = args.max_speakers

    result = diarize(args.audio_path, **kwargs)

    # Restore stdout for JSON output only
    sys.stdout = real_stdout

    output = {
        "num_speakers": result.num_speakers,
        "speakers": result.speakers,
        "audio_duration": result.audio_duration,
        "segments": result.to_list(),
    }

    json.dump(output, sys.stdout)


if __name__ == "__main__":
    main()
