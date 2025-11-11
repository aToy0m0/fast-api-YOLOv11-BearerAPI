"""画像読み込み・エンコード・描画処理。"""
from __future__ import annotations

import base64
import io
from typing import Protocol, Sequence

import cv2
import numpy as np
from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError


class DetectionLike(Protocol):
    """描画時に必要な属性だけを持つプロトコル。"""

    label: str
    confidence: float
    box: Sequence[float]


COLORS = (
    (255, 99, 71),
    (65, 105, 225),
    (60, 179, 113),
    (238, 130, 238),
    (255, 215, 0),
    (0, 191, 255),
)


def load_image_from_bytes(data: bytes) -> Image.Image:
    """アップロードバイト列を PIL Image (RGB) に変換。"""

    try:
        return Image.open(io.BytesIO(data)).convert("RGB")
    except UnidentifiedImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File is not a valid image",
        ) from exc


def encode_image_to_data_uri(image: np.ndarray) -> str:
    """OpenCV (BGR) 画像を JPEG Base64 の Data URI にする。"""

    success, buffer = cv2.imencode(".jpg", image)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to encode result image")
    payload = base64.b64encode(buffer).decode("utf-8")
    return f"data:image/jpeg;base64,{payload}"


def draw_detections(image_bgr: np.ndarray, detections: Sequence[DetectionLike]) -> np.ndarray:
    """YOLO 検出結果をもとにバウンディングボックスを描画。"""

    annotated = image_bgr.copy()
    for idx, det in enumerate(detections):
        x1, y1, x2, y2 = map(int, det.box)
        color = COLORS[idx % len(COLORS)]
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        label = f"{det.label} {det.confidence:.2f}"
        cv2.putText(
            annotated,
            label,
            (x1, max(y1 - 10, 0)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
            lineType=cv2.LINE_AA,
        )
    return annotated


__all__ = ["load_image_from_bytes", "encode_image_to_data_uri", "draw_detections", "DetectionLike"]
