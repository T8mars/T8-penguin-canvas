from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import traceback
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SUPPORTED_LANGUAGES = {"ZH", "EN", "JA", "ES", "AR"}
PUNCTUATION = re.compile(r"[\s\W_]+", re.UNICODE)
MODEL = None
MODEL_DEVICE = ""
MODEL_ROOT_PATH: Path | None = None
ASR_MODELS: dict[tuple[str, str], Any] = {}
AuxiliaryManifestPath = Path(__file__).with_name("auxiliary-models.json")
AuxiliaryReceiptName = "t8-auxiliary-models-receipt.json"


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def require_path(value: str, label: str) -> Path:
    path = Path(value).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"{label}不存在：{path}")
    return path


def configure_imports(engine_root: Path) -> None:
    root = str(engine_root)
    if root not in sys.path:
        sys.path.insert(0, root)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(8 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def auxiliary_model_probe(model_root: Path, verify_hashes: bool = False) -> dict[str, Any]:
    missing: list[str] = []
    mismatched: list[str] = []
    fingerprint = ""
    try:
        manifest_raw = AuxiliaryManifestPath.read_bytes()
        manifest_sha256 = hashlib.sha256(manifest_raw).hexdigest()
        manifest = json.loads(manifest_raw.decode("utf-8"))
        if manifest.get("schema") != "t8-indextts25-auxiliary-model-manifest-v1":
            raise RuntimeError("辅助模型清单格式无效")
        cache_root = (model_root / "hf_cache").resolve()
        receipt_path = cache_root / AuxiliaryReceiptName
        receipt = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.is_file() else {}
        receipt_files = {
            str(item.get("destination") or ""): item
            for item in receipt.get("files", [])
            if isinstance(item, dict)
        }
        receipt_valid = bool(
            receipt.get("schema") == "t8-indextts25-auxiliary-model-receipt-v1"
            and receipt.get("manifestSha256") == manifest_sha256
        )
        if not receipt_valid:
            mismatched.append(AuxiliaryReceiptName)
        for entry in manifest.get("files", []):
            relative = str(entry.get("destination") or "")
            candidate = (cache_root / relative).resolve()
            try:
                candidate.relative_to(cache_root)
            except ValueError:
                mismatched.append(relative or "invalid-destination")
                continue
            if not candidate.is_file():
                missing.append(relative)
                continue
            if candidate.stat().st_size != int(entry.get("size") or -1):
                mismatched.append(relative)
                continue
            receipt_entry = receipt_files.get(relative) or {}
            if (
                receipt_entry.get("sha256") != entry.get("sha256")
                or int(receipt_entry.get("size") or -1) != int(entry.get("size") or -1)
                or receipt_entry.get("revision") != entry.get("revision")
            ):
                mismatched.append(relative)
                continue
            if verify_hashes and sha256_file(candidate) != str(entry.get("sha256") or ""):
                mismatched.append(relative)
        ready = not missing and not mismatched
        if ready:
            fingerprint = str(receipt.get("fingerprint") or "")
        return {
            "ready": ready,
            "missing": sorted(set(missing)),
            "mismatched": sorted(set(mismatched)),
            "manifestSha256": manifest_sha256,
            "fingerprint": fingerprint,
            "fileCount": len(manifest.get("files", [])),
        }
    except Exception as exc:
        return {
            "ready": False,
            "missing": missing,
            "mismatched": sorted(set(mismatched + [f"manifest:{type(exc).__name__}"])),
            "manifestSha256": "",
            "fingerprint": "",
            "fileCount": 0,
        }


def runtime_probe(engine_root: Path, model_root: Path) -> dict[str, Any]:
    configure_imports(engine_root)
    import importlib
    import importlib.util

    modules = [
        "torch", "torchaudio", "torchvision", "numpy", "scipy", "soundfile", "librosa",
        "omegaconf", "einops", "transformers", "sentencepiece", "tiktoken",
        "fugashi", "munch",
    ]
    missing: list[str] = []
    imported: dict[str, Any] = {}
    import_errors: dict[str, str] = {}
    for name in modules:
        if importlib.util.find_spec(name) is None:
            missing.append(name)
            continue
        try:
            imported[name] = importlib.import_module(name)
        except Exception as exc:
            missing.append(name)
            import_errors[name] = f"{type(exc).__name__}: {exc}"[-800:]
    torch_info: dict[str, Any] = {"available": False}
    torch = imported.get("torch")
    torchaudio = imported.get("torchaudio")
    torchvision = imported.get("torchvision")
    if torch is not None:
        torch_version = str(torch.__version__)
        torchaudio_version = str(getattr(torchaudio, "__version__", ""))
        torchvision_version = str(getattr(torchvision, "__version__", ""))
        torch_base = torch_version.split("+", 1)[0]
        torchaudio_base = torchaudio_version.split("+", 1)[0]
        torchvision_base = torchvision_version.split("+", 1)[0]
        torch_info = {
            "available": True,
            "version": torch_version,
            "cudaAvailable": bool(torch.cuda.is_available()),
            "cudaVersion": str(torch.version.cuda or ""),
            "mpsAvailable": bool(
                hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
            ),
            "deviceName": (
                str(torch.cuda.get_device_name(0)) if torch.cuda.is_available() else ""
            ),
            "torchaudioVersion": torchaudio_version,
            "torchaudioImportReady": torchaudio is not None,
            "torchvisionVersion": torchvision_version,
            "torchvisionImportReady": torchvision is not None,
            "abiCompatible": bool(torchaudio is not None and torch_base == torchaudio_base),
            "stackCompatible": bool(
                torchaudio is not None
                and torchvision is not None
                and torch_base == "2.10.0"
                and torchaudio_base == "2.10.0"
                and torchvision_base == "0.25.0"
            ),
        }
        if not torch_info["abiCompatible"] and "torchaudio" not in missing:
            missing.append("torchaudio")
        if not torch_info["stackCompatible"] and "torchvision" not in missing:
            missing.append("torchvision")
    model_ready = False
    model_missing: list[str] = []
    model_mismatched: list[str] = []
    model_revision = ""
    model_fingerprint = ""
    auxiliary = auxiliary_model_probe(
        model_root,
        verify_hashes=os.environ.get("T8_INDEXTTS25_VERIFY_AUX_HASHES") == "1",
    )
    try:
        from services.model_store import (
            load_manifest,
            model_fingerprint as calculate_model_fingerprint,
            validate_model_dir,
        )

        validation = validate_model_dir(model_root, verify_hashes=False)
        manifest = load_manifest()
        model_ready = bool(validation.valid)
        model_missing = list(validation.missing)
        model_mismatched = list(validation.mismatched)
        model_revision = str(manifest.get("modelRevision") or "")
        if model_ready:
            model_fingerprint = calculate_model_fingerprint(model_root)
    except Exception:
        model_ready = False
    return {
        "python": sys.executable,
        "pythonVersion": sys.version.split()[0],
        "engineRoot": str(engine_root),
        "modelRoot": str(model_root),
        "dependenciesReady": not missing and not import_errors,
        "missingDependencies": missing,
        "importErrors": import_errors,
        "modelReady": model_ready,
        "modelMissing": model_missing,
        "modelMismatched": model_mismatched,
        "modelRevision": model_revision,
        "modelFingerprint": model_fingerprint,
        "auxiliaryReady": auxiliary["ready"],
        "auxiliaryMissing": auxiliary["missing"],
        "auxiliaryMismatched": auxiliary["mismatched"],
        "auxiliaryManifestSha256": auxiliary["manifestSha256"],
        "auxiliaryFingerprint": auxiliary["fingerprint"],
        "auxiliaryFileCount": auxiliary["fileCount"],
        "torch": torch_info,
    }


def resolve_device(torch_module: Any) -> str:
    requested = str(os.environ.get("T8_INDEXTTS25_DEVICE", "auto")).strip().lower()
    if requested.startswith("cuda") and torch_module.cuda.is_available():
        return requested
    if requested == "mps" and hasattr(torch_module.backends, "mps") and torch_module.backends.mps.is_available():
        return "mps"
    if requested == "cpu":
        return "cpu"
    if torch_module.cuda.is_available():
        return "cuda:0"
    if hasattr(torch_module.backends, "mps") and torch_module.backends.mps.is_available():
        return "mps"
    return "cpu"


def save_engine_pcm_wav(path: str, wav: Any, sampling_rate: int) -> None:
    """Write IndexTTS' PCM-scale tensor without torchaudio/TorchCodec."""
    import numpy as np
    import torch

    samples = wav.detach().to(device="cpu", dtype=torch.float32).numpy()
    if samples.ndim == 1:
        samples = samples.reshape(1, -1)
    if samples.ndim != 2 or samples.shape[-1] == 0:
        raise RuntimeError("IndexTTS 2.5 返回了无效 PCM 波形。")
    channels = int(samples.shape[0])
    pcm = np.clip(samples, -32767.0, 32767.0).T.astype("<i2", copy=False)
    destination = Path(path).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as stream:
        stream.setnchannels(channels)
        stream.setsampwidth(2)
        stream.setframerate(int(sampling_rate))
        stream.writeframes(pcm.tobytes())


def load_model(engine_root: Path, model_root: Path):
    global MODEL, MODEL_DEVICE, MODEL_ROOT_PATH
    if MODEL is not None:
        return MODEL
    auxiliary = auxiliary_model_probe(model_root, verify_hashes=False)
    if not auxiliary["ready"]:
        details = auxiliary["missing"] + auxiliary["mismatched"]
        raise RuntimeError(
            "IndexTTS 2.5 辅助模型未通过固定版本校验，拒绝在推理时临时联网下载："
            + "、".join(details[:12])
        )
    configure_imports(engine_root)
    import torch
    import indextts.infer_v2_5 as infer_v2_5

    # torchaudio 2.9+ delegates WAV writing to TorchCodec, whose Windows wheel
    # additionally requires shared FFmpeg DLLs. IndexTTS already hands us a
    # PCM-scale tensor, so use the standard-library WAV writer and keep the
    # inference process offline and self-contained.
    infer_v2_5.save_pcm_wav = save_engine_pcm_wav
    IndexTTS2 = infer_v2_5.IndexTTS2

    MODEL_DEVICE = resolve_device(torch)
    MODEL_ROOT_PATH = model_root.resolve()
    MODEL = IndexTTS2(
        cfg_path=str(model_root / "config.yaml"),
        model_dir=str(model_root),
        use_bf16=MODEL_DEVICE.startswith("cuda"),
        device=MODEL_DEVICE,
        use_cuda_kernel=False,
        use_deepspeed=False,
        use_accel=False,
        use_torch_compile=False,
        use_qwen_emo=False,
    )
    return MODEL


def read_wav(path: Path) -> tuple[int, Any]:
    import numpy as np
    import soundfile as sf

    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    if audio.size == 0:
        raise RuntimeError("IndexTTS 2.5 返回了空音频。")
    mono = audio.mean(axis=1).astype(np.float32, copy=False)
    return int(sample_rate), mono


def resample_to_length(audio: Any, length: int) -> Any:
    import numpy as np
    from scipy.signal import resample

    target = max(1, int(length))
    if len(audio) == target:
        return audio
    if len(audio) == 0:
        return np.zeros(target, dtype=np.float32)
    return resample(audio, target).astype(np.float32, copy=False)


def fit_audio(audio: Any, target_samples: int, mode: str) -> tuple[Any, str]:
    import numpy as np

    target = max(1, int(target_samples))
    if mode == "natural" or target <= 0:
        return audio, "natural"
    if mode == "exact":
        return resample_to_length(audio, target), "time-stretch"
    if len(audio) > target:
        # The default pad/native policies must never cut a spoken sentence.
        # Timeline composition shifts later lines and reports the overrun.
        return audio, "overrun-preserved"
    if len(audio) < target:
        return np.pad(audio, (0, target - len(audio))), "pad"
    return audio, "unchanged"


def normalized_review_text(text: str, language: str) -> str:
    value = str(text or "").strip().lower()
    if language == "ZH":
        try:
            from opencc import OpenCC

            value = OpenCC("t2s").convert(value)
        except Exception:
            pass
        value = value.translate(str.maketrans("0123456789", "零一二三四五六七八九"))
        return PUNCTUATION.sub("", value)
    if language == "JA":
        return PUNCTUATION.sub("", value)
    return " ".join(PUNCTUATION.sub(" ", value).split())


def similarity(expected: str, actual: str, language: str) -> float:
    from difflib import SequenceMatcher

    left = normalized_review_text(expected, language)
    right = normalized_review_text(actual, language)
    if not left and not right:
        return 1.0
    return float(SequenceMatcher(None, left, right).ratio())


def transcribe(path: Path, language: str, model_name: str, device: str) -> str:
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        raise RuntimeError("本地 ASR 组件未安装完整。") from exc
    resolved_device = "cuda" if device == "cuda" else "cpu"
    compute_type = "float16" if resolved_device == "cuda" else "int8"
    key = (model_name, resolved_device)
    model = ASR_MODELS.get(key)
    if model is None:
        if MODEL_ROOT_PATH is None:
            raise RuntimeError("IndexTTS 2.5 模型根目录尚未初始化。")
        local_model = (MODEL_ROOT_PATH / "hf_cache" / "faster-whisper-small").resolve()
        if not local_model.is_dir():
            raise RuntimeError("本地 ASR 模型未安装完整，拒绝在推理时临时联网下载。")
        model = WhisperModel(str(local_model), device=resolved_device, compute_type=compute_type)
        ASR_MODELS[key] = model
    language_map = {"ZH": "zh", "EN": "en", "JA": "ja", "ES": "es", "AR": "ar"}
    segments, _info = model.transcribe(
        str(path), language=language_map.get(language), vad_filter=True, beam_size=3
    )
    return "".join(str(segment.text or "").strip() for segment in segments).strip()


def resolve_asr_device() -> str:
    requested = str(os.environ.get("T8_INDEXTTS25_ASR_DEVICE", "cpu")).strip().lower()
    if requested == "cuda" and MODEL_DEVICE.startswith("cuda"):
        return "cuda"
    return "cpu"


def format_srt_time(milliseconds: int) -> str:
    value = max(0, int(milliseconds))
    hours, remainder = divmod(value, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


@dataclass
class GeneratedLine:
    index: int
    role: str
    text: str
    spoken_text: str
    start_ms: int
    end_ms: int
    audio: Any
    sample_rate: int
    report: dict[str, Any]


def generate_line(
    model: Any,
    unit: dict[str, Any],
    reference: Path,
    language: str,
    seed: int,
    timing_mode: str,
    asr_enabled: bool,
    asr_retry_count: int,
    asr_threshold: float,
    work_dir: Path,
) -> GeneratedLine:
    index = int(unit.get("index") or 0)
    role = str(unit.get("role") or "旁白").strip()
    text = str(unit.get("translatedText") or unit.get("text") or "").strip()
    spoken_text = str(unit.get("pronunciation") or "").strip() or text
    emotion = str(unit.get("emotion") or "").strip()
    start_ms = max(0, int(unit.get("startMs") or 0))
    end_ms = max(start_ms + 1, int(unit.get("endMs") or start_ms + 1000))
    if not text:
        raise ValueError(f"第 {index} 条译文为空。")
    slot_seconds = (end_ms - start_ms) / 1000.0
    candidates: list[tuple[float, Any, int, dict[str, Any]]] = []
    maximum_attempts = max(1, min(4, int(asr_retry_count) + 1 if asr_enabled else 1))
    for attempt in range(maximum_attempts):
        line_seed = int(seed) + index + attempt * 100_003
        raw_path = work_dir / f"line-{index:05d}-attempt-{attempt + 1}.wav"
        kwargs = dict(
            spk_audio_prompt=str(reference),
            text=spoken_text,
            output_path=str(raw_path),
            lang=language,
            use_random=False,
            interval_silence=0,
            verbose=False,
            max_text_tokens_per_segment=120,
            duration_factor=1.0,
            text_normalization=True,
            seed=line_seed,
            diffusion_steps=25,
            inference_cfg_rate=0.7,
            cfm_temperature=1.0,
            do_sample=False,
            temperature=0.8,
            top_p=0.8,
            top_k=30,
            num_beams=3,
            repetition_penalty=10.0,
            length_penalty=0.0,
            max_mel_tokens=1500,
        )
        if emotion:
            kwargs.update(use_emo_text=True, emo_text=emotion, emo_alpha=0.8)
        if timing_mode == "native":
            kwargs["target_duration"] = slot_seconds
        result = model.infer(**kwargs)
        if not raw_path.is_file() and isinstance(result, str) and Path(result).is_file():
            raw_path = Path(result)
        sample_rate, audio = read_wav(raw_path)
        fitted, adjustment = fit_audio(audio, round(slot_seconds * sample_rate), timing_mode)
        review: dict[str, Any] = {
            "enabled": bool(asr_enabled),
            "recognizedText": "",
            "similarity": 0.0,
            "passed": False,
        }
        score = 1.0 if not asr_enabled else 0.0
        if asr_enabled:
            review_path = work_dir / f"line-{index:05d}-review-{attempt + 1}.wav"
            write_wav(review_path, sample_rate, fitted)
            recognized = transcribe(
                review_path,
                language,
                "small",
                resolve_asr_device(),
            )
            score = similarity(spoken_text, recognized, language)
            review.update(
                recognizedText=recognized,
                similarity=round(score, 6),
                passed=score >= asr_threshold,
            )
        report = {
            "attempt": attempt + 1,
            "seed": line_seed,
            "durationMs": round(len(fitted) * 1000 / sample_rate),
            "durationAdjustment": adjustment,
            "asr": review,
        }
        candidates.append((score, fitted, sample_rate, report))
        if not asr_enabled or review["passed"]:
            break
    score, audio, sample_rate, report = max(candidates, key=lambda item: item[0])
    report["attemptCount"] = len(candidates)
    return GeneratedLine(index, role, text, spoken_text, start_ms, end_ms, audio, sample_rate, report)


def write_wav(path: Path, sample_rate: int, audio: Any) -> None:
    import numpy as np

    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2", copy=False)
    with wave.open(str(path), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(int(sample_rate))
        stream.writeframes(pcm.tobytes())


def compose(lines: list[GeneratedLine], policy: str, postprocess: str, strength: float) -> tuple[int, Any, list[dict[str, Any]]]:
    import numpy as np

    if not lines:
        raise ValueError("没有可合成的台词。")
    sample_rate = lines[0].sample_rate
    for line in lines:
        if line.sample_rate != sample_rate:
            line.audio = resample_to_length(
                line.audio, round(len(line.audio) * sample_rate / line.sample_rate)
            )
            line.sample_rate = sample_rate
    placements: list[dict[str, Any]] = []
    cursor = 0
    starts: list[int] = []
    for line in lines:
        requested = round(line.start_ms * sample_rate / 1000)
        start = max(requested, cursor) if policy == "shift" else requested
        delay_samples = max(0, start - requested) if policy == "shift" else 0
        end = start + len(line.audio)
        starts.append(start)
        cursor = max(cursor, end)
        placements.append(
            {
                "index": line.index,
                "requestedStartMs": line.start_ms,
                "actualStartMs": round(start * 1000 / sample_rate),
                "actualEndMs": round(end * 1000 / sample_rate),
                "overlapMs": round(delay_samples * 1000 / sample_rate),
                "slotEndMs": line.end_ms,
            }
        )
    total = max(start + len(line.audio) for start, line in zip(starts, lines))
    output = np.zeros(total, dtype=np.float32)
    active = np.zeros(total, dtype=np.float32)
    for start, line in zip(starts, lines):
        output[start:start + len(line.audio)] += line.audio
        active[start:start + len(line.audio)] += 1.0
    if policy == "overlay":
        output /= np.maximum(active, 1.0)
    peak = float(np.max(np.abs(output))) if output.size else 0.0
    if postprocess != "off" and peak > 0 and strength > 0:
        target_peak = 0.92 if postprocess in {"voice_clarity", "broadcast_clean"} else 0.86
        normalized = output * min(3.0, target_peak / peak)
        output = output * (1.0 - strength) + normalized * strength
    return sample_rate, np.clip(output, -1.0, 1.0), placements


def handle_generate(payload: dict[str, Any], engine_root: Path, model_root: Path, request_id: str) -> dict[str, Any]:
    language = str(payload.get("language") or "").strip().upper()
    if language not in SUPPORTED_LANGUAGES:
        raise ValueError(f"IndexTTS 2.5 不支持 {language} 配音。")
    units = payload.get("units") if isinstance(payload.get("units"), list) else []
    roles = payload.get("roles") if isinstance(payload.get("roles"), list) else []
    if not units:
        raise ValueError("没有可配音的译文。")
    role_files: dict[str, Path] = {}
    for role in roles[:16]:
        name = str(role.get("role") or "").strip()
        reference = require_path(str(role.get("referencePath") or ""), f"角色 {name} 的参考音色")
        if not bool(role.get("consentConfirmed")):
            raise ValueError(f"角色 {name} 尚未确认音色授权。")
        role_files[name] = reference
    missing = sorted({str(unit.get("role") or "旁白").strip() for unit in units} - set(role_files))
    if missing:
        raise ValueError("以下角色没有参考音色：" + "、".join(missing))
    model = load_model(engine_root, model_root)
    output_dir = require_path(str(payload.get("outputDir") or ""), "输出目录")
    seed = int(payload.get("seed") or 20260828)
    timing_mode = str(payload.get("timingMode") or "pad")
    if timing_mode not in {"pad", "native", "natural", "exact"}:
        timing_mode = "pad"
    timeline_policy = "overlay" if payload.get("timelinePolicy") == "overlay" else "shift"
    asr_enabled = bool(payload.get("asrEnabled"))
    asr_retry_count = max(0, min(3, int(payload.get("asrRetryCount") or 0)))
    asr_threshold = max(0.0, min(1.0, float(payload.get("asrThreshold") or 0.82)))
    postprocess = str(payload.get("postprocessPreset") or "voice_clarity")
    postprocess_strength = max(0.0, min(1.0, float(payload.get("postprocessStrength") or 0.0)))
    with tempfile.TemporaryDirectory(prefix="t8-indextts25-") as temp_value:
        work_dir = Path(temp_value)
        generated: list[GeneratedLine] = []
        for offset, unit in enumerate(units):
            emit({"id": request_id, "event": "progress", "current": offset, "total": len(units), "message": f"正在生成第 {offset + 1}/{len(units)} 句"})
            role = str(unit.get("role") or "旁白").strip()
            generated.append(
                generate_line(
                    model, unit, role_files[role], language, seed, timing_mode,
                    asr_enabled, asr_retry_count, asr_threshold, work_dir,
                )
            )
        sample_rate, audio, placements = compose(generated, timeline_policy, postprocess, postprocess_strength)
        audio_path = output_dir / f"localization_dub_{request_id}.wav"
        report_path = output_dir / f"localization_report_{request_id}.json"
        subtitle_path = output_dir / f"localization_subtitles_{request_id}.srt"
        write_wav(audio_path, sample_rate, audio)
        report_lines = []
        srt_blocks = []
        for position, (line, placement) in enumerate(zip(generated, placements), 1):
            line_report = {
                "index": line.index,
                "role": line.role,
                "text": line.text,
                "spokenText": line.spoken_text,
                "sourceStartMs": line.start_ms,
                "sourceEndMs": line.end_ms,
                "timeline": placement,
                **line.report,
            }
            report_lines.append(line_report)
            start_ms = placement["actualStartMs"] if payload.get("subtitleTimingMode") != "original" else line.start_ms
            end_ms = placement["actualEndMs"] if payload.get("subtitleTimingMode") != "original" else line.end_ms
            subtitle_text = line.text
            if payload.get("subtitleTextMode") in {"asr_all", "asr_passed"}:
                asr = line.report.get("asr") or {}
                if asr.get("recognizedText") and (payload.get("subtitleTextMode") == "asr_all" or asr.get("passed")):
                    subtitle_text = str(asr["recognizedText"])
            if payload.get("subtitleIncludeRole", True):
                subtitle_text = f"[{line.role}] {subtitle_text}"
            srt_blocks.append(f"{position}\n{format_srt_time(start_ms)} --> {format_srt_time(end_ms)}\n{subtitle_text}")
        report = {
            "schema": "t8-localization-indextts25-execution-report-v1",
            "engine": "embedded-index-tts-2.5",
            "device": MODEL_DEVICE,
            "language": language,
            "sampleRate": sample_rate,
            "durationMs": round(len(audio) * 1000 / sample_rate),
            "lineCount": len(generated),
            "timelinePolicy": timeline_policy,
            "timingMode": timing_mode,
            "asrEnabled": asr_enabled,
            "asrDevice": resolve_asr_device() if asr_enabled else "disabled",
            "postprocessPreset": postprocess,
            "postprocessStrength": postprocess_strength,
            "asrPassed": sum(bool((line.report.get("asr") or {}).get("passed")) for line in generated),
            "lines": report_lines,
        }
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        subtitle_path.write_text("\n\n".join(srt_blocks) + "\n", encoding="utf-8")
        return {
            "audioPath": str(audio_path),
            "reportPath": str(report_path),
            "subtitlePath": str(subtitle_path),
            "report": report,
            "subtitleText": "\n\n".join(srt_blocks) + "\n",
        }


def serve(engine_root: Path, model_root: Path) -> int:
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        request_id = ""
        try:
            request = json.loads(raw)
            request_id = str(request.get("id") or "")
            action = str(request.get("action") or "")
            if action == "probe":
                result = runtime_probe(engine_root, model_root)
            elif action == "generate":
                result = handle_generate(request.get("payload") or {}, engine_root, model_root, request_id)
            elif action == "shutdown":
                emit({"id": request_id, "ok": True, "result": {"stopped": True}})
                return 0
            else:
                raise ValueError(f"未知 Worker 动作：{action}")
            emit({"id": request_id, "ok": True, "result": result})
        except Exception as exc:
            emit({
                "id": request_id,
                "ok": False,
                "error": str(exc).strip() or type(exc).__name__,
                "errorType": type(exc).__name__,
                "trace": traceback.format_exc(limit=8),
            })
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="T8 embedded IndexTTS 2.5 worker")
    parser.add_argument("--engine-root", required=True)
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    engine_root = require_path(args.engine_root, "IndexTTS 2.5 引擎目录")
    model_root = Path(args.model_root).expanduser().resolve()
    if args.probe:
        emit({"ok": True, "result": runtime_probe(engine_root, model_root)})
        return 0
    if args.serve:
        return serve(engine_root, model_root)
    parser.error("必须指定 --probe 或 --serve")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
