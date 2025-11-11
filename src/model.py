"""YOLO モデルのロードとキャッシュ制御。"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ultralytics import YOLO


def load_model(model_path: Path) -> YOLO:
    """ディスクから YOLO ウェイトを読み込み、YOLO インスタンスを返す。"""

    if not model_path.exists():
        raise RuntimeError(f"Model not found at {model_path}")
    return YOLO(model_path.as_posix())


def get_or_load_model(state: Any, model_path: Path) -> YOLO:
    """FastAPI の `app.state` を使って単一インスタンスを共有する。"""

    model = getattr(state, "model", None)
    if model is None:
        model = load_model(model_path)
        state.model = model
    return model


__all__ = ["get_or_load_model", "load_model"]
