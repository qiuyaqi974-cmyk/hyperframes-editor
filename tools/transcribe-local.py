"""HyperFrames local, word-timestamped transcription helper.

Prints newline-delimited JSON progress to stdout and writes the final transcript
atomically. The Electron process owns job cancellation and result caching.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any


HELPER_VERSION = "1"


def emit(kind: str, **payload: Any) -> None:
    print(json.dumps({"type": kind, **payload}, ensure_ascii=False), flush=True)


def cached_models() -> list[str]:
    cache_root = Path(
        os.environ.get("HF_HUB_CACHE")
        or Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub"
    )
    found: list[str] = []
    for model in ("tiny", "base", "small", "medium", "large-v3"):
        root = cache_root / f"models--Systran--faster-whisper-{model}"
        snapshots = root / "snapshots"
        if snapshots.is_dir() and any(path.is_dir() for path in snapshots.iterdir()):
            found.append(model)
    return found


def check() -> int:
    try:
        import faster_whisper
        import torch

        emit(
            "capabilities",
            available=True,
            version=getattr(faster_whisper, "__version__", "unknown"),
            python=sys.executable,
            cuda=bool(torch.cuda.is_available()),
            deviceName=torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
            models=cached_models(),
            helperVersion=HELPER_VERSION,
        )
        return 0
    except Exception as exc:  # pragma: no cover - environment dependent
        emit("capabilities", available=False, error=str(exc), models=[])
        return 1


def transcribe(args: argparse.Namespace) -> int:
    from faster_whisper import WhisperModel
    import torch

    source = Path(args.source)
    if not source.is_file():
        raise FileNotFoundError(f"Source does not exist: {source}")
    if not args.allow_download and args.model not in cached_models() and not Path(args.model).is_dir():
        raise RuntimeError(f"Model '{args.model}' is not cached. Download it explicitly before transcription.")

    device = "cuda" if args.device == "auto" and torch.cuda.is_available() else ("cpu" if args.device == "auto" else args.device)
    compute_type = args.compute_type
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"
    emit("status", phase="loading-model", model=args.model, device=device)
    model = WhisperModel(
        args.model,
        device=device,
        compute_type=compute_type,
        local_files_only=not args.allow_download,
    )
    segments_iter, info = model.transcribe(
        str(source),
        language=None if args.language == "auto" else args.language,
        beam_size=5,
        word_timestamps=True,
        vad_filter=False,
        condition_on_previous_text=True,
    )
    duration = max(float(info.duration or 0), 0.001)
    emit("status", phase="transcribing", duration=duration, language=info.language)

    output_segments: list[dict[str, Any]] = []
    for index, segment in enumerate(segments_iter):
        words = [
            {
                "start": round(float(word.start), 3),
                "end": round(float(word.end), 3),
                "word": word.word,
                "probability": round(float(word.probability), 4),
            }
            for word in (segment.words or [])
            if word.start is not None and word.end is not None
        ]
        output_segments.append(
            {
                "id": f"whisper-{index + 1}",
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": segment.text.strip(),
                "words": words,
            }
        )
        emit("progress", percent=min(99, round(float(segment.end) / duration * 100)), segments=len(output_segments))

    result = {
        "segments": output_segments,
        "meta": {
            "backend": "faster-whisper",
            "model": args.model,
            "language": info.language,
            "generatedAt": args.generated_at,
            "sourceFingerprint": args.fingerprint,
            "wordTimestamps": True,
        },
    }
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False, suffix=".tmp") as handle:
        json.dump(result, handle, ensure_ascii=False, separators=(",", ":"))
        temporary = Path(handle.name)
    temporary.replace(target)
    emit("progress", percent=100, segments=len(output_segments))
    emit("result", output=str(target), segments=len(output_segments))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--source")
    parser.add_argument("--output")
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--compute-type", default="auto")
    parser.add_argument("--fingerprint", default="")
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--allow-download", action="store_true")
    args = parser.parse_args()
    if args.check:
        return check()
    if not args.source or not args.output:
        parser.error("--source and --output are required")
    return transcribe(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # keep errors machine-readable for Electron
        emit("error", message=str(error))
        raise SystemExit(1)
