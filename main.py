"""FastAPI application exposing YOLO11m detections with API key auth."""
from __future__ import annotations

import base64
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from PIL import Image

from src.auth import build_api_key_dependency
from src.image_utils import draw_detections, encode_image_to_data_uri, load_image_from_bytes
from src.model import get_or_load_model, load_model

# `.env` を最優先で読み取ってからシステム環境変数を参照する
load_dotenv()

# プロジェクトルートとモデルパスを決定（Docker / ローカル両対応）
APP_DIR = Path(__file__).resolve().parent
MODEL_PATH = APP_DIR / "models" / "yolo11m.pt"

# 認証キーや推論パラメータは `.env` → OS 環境変数の順に読み取る
DEFAULT_API_KEY = os.getenv("DETECTION_API_KEY", "change-me")
CONF_THRESHOLD = float(os.getenv("YOLO_CONF_THRESHOLD", "0.25"))
IOU_THRESHOLD = float(os.getenv("YOLO_IOU_THRESHOLD", "0.45"))
MAX_IMAGE_EDGE = int(os.getenv("YOLO_MAX_IMAGE_EDGE", "2048"))
MAX_IMAGE_PIXELS = int(os.getenv("YOLO_MAX_IMAGE_PIXELS", "4000000"))

LOG_DIR = APP_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "server.log"


def configure_logger() -> logging.Logger:
    """Stream logs to console and rotate a local file."""

    logger = logging.getLogger("yolo-fastapi")
    if logger.handlers:
        return logger

    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    logger.setLevel(log_level)

    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=int(os.getenv("LOG_MAX_BYTES", 5 * 1024 * 1024)),
        backupCount=int(os.getenv("LOG_BACKUP_COUNT", 5)),
    )
    file_handler.setFormatter(formatter)

    logger.addHandler(stream_handler)
    logger.addHandler(file_handler)
    logger.propagate = False
    return logger


# ベースとなる logger を確保
logger = configure_logger()


def _choose_resample() -> int:
    return Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS


def prepare_image_for_inference(image: Image.Image) -> Tuple[Image.Image, Dict[str, Any]]:
    """Resize the image if it is too large for inference."""

    width, height = image.size
    scale = 1.0
    trigger = None
    max_edge = max(width, height)

    if MAX_IMAGE_EDGE > 0 and max_edge > MAX_IMAGE_EDGE:
        scale = min(scale, MAX_IMAGE_EDGE / max_edge)
        trigger = "edge"

    total_pixels = width * height
    if MAX_IMAGE_PIXELS > 0 and total_pixels > MAX_IMAGE_PIXELS:
        pixel_scale = (MAX_IMAGE_PIXELS / total_pixels) ** 0.5
        if pixel_scale < scale:
            trigger = "pixels"
        scale = min(scale, pixel_scale)

    if scale < 1.0:
        new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        resized = image.resize(new_size, resample=_choose_resample())
        return resized, {
            "scaled": True,
            "scale": scale,
            "trigger": trigger,
            "original_size": (width, height),
            "final_size": new_size,
        }

    return image, {
        "scaled": False,
        "scale": 1.0,
        "trigger": None,
        "original_size": (width, height),
        "final_size": (width, height),
    }

# FastAPI インスタンスを初期化（OpenAPI 情報はここで定義）
app = FastAPI(
    title="YOLO11m FastAPI Detection API",
    description="Upload an image, authenticate via API key, and receive YOLO detections plus an annotated image.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 必要に応じて特定オリジンへ絞り込む
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# APIキー認証の依存関数をここで組み立てて再利用
require_api_key = build_api_key_dependency(DEFAULT_API_KEY)


class Detection(BaseModel):
    """単一検出の構造（APIレスポンス用）。"""

    label: str = Field(..., description="Class label from the YOLO model")
    confidence: float = Field(..., ge=0, le=1, description="Confidence score (0-1)")
    box: List[float] = Field(..., min_length=4, max_length=4, description="Bounding box in xyxy format")


class DetectionResponse(BaseModel):
    """/detect エンドポイントで返すレスポンス全体。"""

    detections: List[Detection]
    counts: Dict[str, int]
    image_with_boxes: str = Field(..., description="Annotated image as Base64 data URI")


class ImagePayload(BaseModel):
    fileName: str
    base64: str


class DetectionRequest(BaseModel):
    images: List[ImagePayload]


@app.on_event("startup")
def _startup() -> None:
    """FastAPI 起動時に一度だけモデルをロードし、app.state にキャッシュする。"""

    app.state.model = load_model(MODEL_PATH)


@app.get("/healthz", include_in_schema=False)
def healthcheck() -> JSONResponse:
    """ヘルスチェック用の軽量エンドポイント。"""

    return JSONResponse({"status": "ok"})


@app.post("/detect", response_model=DetectionResponse)
async def detect_objects(
    request: Request,
    file: Optional[UploadFile] = File(None, description="Image file (JPEG/PNG)"),
    _: str = Depends(require_api_key),
) -> DetectionResponse:
    """画像（multipart もしくは JSON）を受け取り、YOLO11m 推論結果と可視化画像を返す。"""

    # 1. 入力から画像バイトを取得
    contents: Optional[bytes] = None
    original_source: str = "file"
    if file is not None:
        original_source = file.filename or "upload"
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file uploaded")
    else:
        content_type = request.headers.get("content-type", "")
        if content_type.startswith("application/json"):
            try:
                raw_payload = await request.json()
                payload = DetectionRequest(**raw_payload)
            except Exception as exc:  # broad: validation or JSON error
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload") from exc

            if not payload.images:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="images array is required")

            first_image = payload.images[0]
            original_source = first_image.fileName or "json"
            base64_data = first_image.base64.split(",", 1)[-1]
            try:
                contents = base64.b64decode(base64_data)
            except (base64.binascii.Error, ValueError) as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid base64 payload") from exc
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="file or images payload required")

    # 2. PIL へ変換してから YOLO11m で推論
    assert contents is not None  # appease type checker; validated above
    image = load_image_from_bytes(contents)
    width, height = image.size
    byte_length = len(contents)
    logger.info(
        "Received image source=%s size=%d bytes (~%.1f KB) resolution=%dx%d px",
        original_source,
        byte_length,
        byte_length / 1024,
        width,
        height,
    )
    image, resize_info = prepare_image_for_inference(image)
    final_width, final_height = resize_info["final_size"]
    if resize_info["scaled"]:
        logger.info(
            "Prepared image for YOLO source=%s resolution=%dx%d px (original=%dx%d px, scale=%.3f, trigger=%s)",
            original_source,
            final_width,
            final_height,
            resize_info["original_size"][0],
            resize_info["original_size"][1],
            resize_info["scale"],
            resize_info["trigger"],
        )
    else:
        logger.info(
            "Prepared image for YOLO source=%s resolution=%dx%d px (no resize)",
            original_source,
            final_width,
            final_height,
        )
    model = get_or_load_model(app.state, MODEL_PATH)
    results = model.predict(
        source=image,
        conf=CONF_THRESHOLD,
        iou=IOU_THRESHOLD,
        verbose=False,
    )

    # 3. YOLO の出力（Boxes）を API 用のスキーマへマッピング
    result = results[0]
    detections: List[Detection] = []
    counts: Dict[str, int] = {}

    for box in result.boxes:
        cls_id = int(box.cls)
        label = result.names.get(cls_id, str(cls_id))
        conf = float(box.conf)
        xyxy = [float(v) for v in box.xyxy[0].tolist()]
        detections.append(Detection(label=label, confidence=conf, box=xyxy))
        counts[label] = counts.get(label, 0) + 1

    # 4. OpenCV で枠線を描画し、Base64 へエンコード
    image_np = np.array(image)
    image_bgr = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)
    annotated = draw_detections(image_bgr, detections)

    # 5. JSON レスポンスを構築して返却
    response = DetectionResponse(
        detections=detections,
        counts=counts,
        image_with_boxes=encode_image_to_data_uri(annotated),
    )
    return response
