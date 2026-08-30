from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any


MANIFEST_PATH = Path(__file__).with_name("auxiliary-models.json")
RECEIPT_NAME = "t8-auxiliary-models-receipt.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(8 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest() -> tuple[dict[str, Any], str]:
    raw = MANIFEST_PATH.read_bytes()
    manifest = json.loads(raw.decode("utf-8"))
    if manifest.get("schema") != "t8-indextts25-auxiliary-model-manifest-v1":
        raise RuntimeError("IndexTTS 2.5 辅助模型清单格式无效。")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError("IndexTTS 2.5 辅助模型清单为空。")
    return manifest, hashlib.sha256(raw).hexdigest()


def resolve_destination(cache_root: Path, relative: str) -> Path:
    candidate = (cache_root / str(relative)).resolve()
    try:
        candidate.relative_to(cache_root)
    except ValueError as exc:
        raise RuntimeError("辅助模型目标路径越界。") from exc
    return candidate


def validate_one(path: Path, entry: dict[str, Any], verify_hash: bool) -> tuple[bool, str]:
    if not path.is_file():
        return False, "missing"
    if path.stat().st_size != int(entry["size"]):
        return False, "size"
    if verify_hash and sha256_file(path) != str(entry["sha256"]):
        return False, "sha256"
    return True, "ready"


def install_one(cache_root: Path, entry: dict[str, Any]) -> dict[str, Any]:
    destination = resolve_destination(cache_root, entry["destination"])
    valid, _reason = validate_one(destination, entry, verify_hash=True)
    if not valid:
        from huggingface_hub import hf_hub_download

        downloaded = Path(hf_hub_download(
            repo_id=str(entry["repository"]),
            filename=str(entry["source"]),
            revision=str(entry["revision"]),
        )).resolve()
        source_valid, reason = validate_one(downloaded, entry, verify_hash=True)
        if not source_valid:
            raise RuntimeError(
                f"辅助模型下载校验失败：{entry['repository']}/{entry['source']} ({reason})"
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix=f".{destination.name}.", suffix=".part", dir=destination.parent, delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
            with downloaded.open("rb") as source:
                shutil.copyfileobj(source, temporary, length=8 * 1024 * 1024)
            temporary.flush()
            os.fsync(temporary.fileno())
        try:
            staged_valid, staged_reason = validate_one(temporary_path, entry, verify_hash=True)
            if not staged_valid:
                raise RuntimeError(
                    f"辅助模型落盘校验失败：{entry['destination']} ({staged_reason})"
                )
            os.replace(temporary_path, destination)
        finally:
            temporary_path.unlink(missing_ok=True)
    return {
        "destination": str(entry["destination"]),
        "repository": str(entry["repository"]),
        "revision": str(entry["revision"]),
        "size": int(entry["size"]),
        "sha256": str(entry["sha256"]),
    }


def validate_all(cache_root: Path, manifest: dict[str, Any], verify_hash: bool) -> list[dict[str, Any]]:
    results = []
    for entry in manifest["files"]:
        destination = resolve_destination(cache_root, entry["destination"])
        valid, reason = validate_one(destination, entry, verify_hash=verify_hash)
        if not valid:
            raise RuntimeError(f"辅助模型校验失败：{entry['destination']} ({reason})")
        results.append({
            "destination": str(entry["destination"]),
            "repository": str(entry["repository"]),
            "revision": str(entry["revision"]),
            "size": int(entry["size"]),
            "sha256": str(entry["sha256"]),
        })
    return results


def write_receipt(cache_root: Path, manifest_sha256: str, files: list[dict[str, Any]]) -> Path:
    receipt = {
        "schema": "t8-indextts25-auxiliary-model-receipt-v1",
        "manifestSha256": manifest_sha256,
        "fingerprint": hashlib.sha256(
            "\n".join(f"{item['destination']}:{item['sha256']}" for item in files).encode("utf-8")
        ).hexdigest(),
        "files": files,
    }
    destination = cache_root / RECEIPT_NAME
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(receipt, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, destination)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description="安装并校验固定版本的 IndexTTS 2.5 辅助模型")
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    model_root = Path(args.model_root).expanduser().resolve()
    cache_root = (model_root / "hf_cache").resolve()
    cache_root.mkdir(parents=True, exist_ok=True)
    manifest, manifest_sha256 = load_manifest()
    if args.verify_only:
        files = validate_all(cache_root, manifest, verify_hash=True)
    else:
        files = []
        for index, entry in enumerate(manifest["files"], 1):
            print(json.dumps({
                "event": "auxiliary-model",
                "current": index,
                "total": len(manifest["files"]),
                "destination": entry["destination"],
            }, ensure_ascii=False), flush=True)
            files.append(install_one(cache_root, entry))
        files = validate_all(cache_root, manifest, verify_hash=True)
    receipt = write_receipt(cache_root, manifest_sha256, files)
    print(json.dumps({
        "ok": True,
        "schema": "t8-indextts25-auxiliary-install-result-v1",
        "fileCount": len(files),
        "manifestSha256": manifest_sha256,
        "receipt": receipt.name,
    }, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
