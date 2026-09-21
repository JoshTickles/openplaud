#!/usr/bin/env python3
"""
Per-speaker voiceprint embedding for OpenPlaud.

Given audio and a set of time windows already attributed to each speaker
(from the transcript's own timestamps), produce one L2-normalised centroid
per speaker label.

This replaces running full-file diarization purely to obtain voiceprints.
Two properties matter and are deliberate:

*   **Fixed-length windows.** The WeSpeaker ONNX model leaks memory when the
    input feature matrix changes shape between calls, so every window is the
    same duration and therefore the same fbank shape.
*   **Seek-based reads.** Only the requested windows are decoded, so memory
    does not grow with recording length.

Input (JSON on stdin):
    {
        "window_seconds": 3.0,
        "windows": {
            "Speaker 1": [12.5, 40.0, 88.25],   # window START times, seconds
            "Speaker 2": [30.0, 61.5]
        }
    }

Output (JSON on stdout):
    {
        "centroids": {"Speaker 1": [...256 floats...], ...},
        "window_counts": {"Speaker 1": 3, "Speaker 2": 2},
        "sample_embeddings": {"Speaker 1": [[...], ...], ...}
    }

`sample_embeddings` carries the per-window vectors so the caller can check
that a speaker's windows agree with each other before trusting the centroid.
"""

import json
import os
import sys

MIN_WINDOW_SECONDS = 0.5


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


def _read_window(handle, sr: int, start_s: float, frames: int):
    """Decode exactly *frames* samples starting at *start_s*, mono float32.

    Returns None when the window runs past the end of the audio.
    """
    import numpy as np

    start_frame = int(start_s * sr)
    if start_frame < 0 or start_frame >= handle.frames:
        return None
    handle.seek(start_frame)
    data = handle.read(frames, dtype="float32", always_2d=True)
    if data.shape[0] < frames:
        return None
    mono = data.mean(axis=1) if data.shape[1] > 1 else data[:, 0]
    return np.ascontiguousarray(mono)


def main() -> None:
    spec = json.load(sys.stdin)
    audio_path = spec["audio_path"]
    window_seconds = float(spec.get("window_seconds", 3.0))
    windows: dict[str, list[float]] = spec.get("windows", {})

    if window_seconds < MIN_WINDOW_SECONDS:
        raise ValueError(
            f"window_seconds must be >= {MIN_WINDOW_SECONDS}, got {window_seconds}"
        )

    _configure_threads()

    # Model download progress and library chatter must not corrupt stdout.
    real_stdout = sys.stdout
    sys.stdout = sys.stderr

    import numpy as np
    import soundfile as sf
    import tempfile
    import wespeakerruntime as wespeaker_rt

    model = wespeaker_rt.Speaker(lang="en")

    centroids: dict[str, list[float]] = {}
    sample_embeddings: dict[str, list[list[float]]] = {}
    window_counts: dict[str, int] = {}

    with sf.SoundFile(audio_path) as handle:
        sr = handle.samplerate
        frames = int(window_seconds * sr)

        for label, starts in windows.items():
            vectors: list[np.ndarray] = []
            for start_s in starts:
                audio = _read_window(handle, sr, float(start_s), frames)
                if audio is None:
                    continue

                tmp_path = None
                try:
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                        tmp_path = tmp.name
                        sf.write(tmp_path, audio, sr)
                    emb = model.extract_embedding(tmp_path)
                except Exception as exc:  # noqa: BLE001 - one bad window must not fail the run
                    print(
                        f"[embed] window {start_s:.2f}s for {label} failed: {exc}",
                        file=sys.stderr,
                    )
                    continue
                finally:
                    if tmp_path is not None:
                        try:
                            os.unlink(tmp_path)
                        except OSError:
                            pass

                if emb is None:
                    continue
                if getattr(emb, "ndim", 1) == 2:
                    emb = emb[0]
                norm = float(np.linalg.norm(emb))
                if norm <= 1e-9:
                    continue
                vectors.append(np.asarray(emb, dtype=np.float64) / norm)

            window_counts[label] = len(vectors)
            if not vectors:
                continue

            stacked = np.stack(vectors)
            mean = stacked.mean(axis=0)
            mean_norm = float(np.linalg.norm(mean))
            if mean_norm <= 1e-9:
                continue
            centroids[label] = [float(x) for x in (mean / mean_norm).tolist()]
            sample_embeddings[label] = [
                [float(x) for x in v.tolist()] for v in vectors
            ]

    sys.stdout = real_stdout
    json.dump(
        {
            "centroids": centroids,
            "window_counts": window_counts,
            "sample_embeddings": sample_embeddings,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
