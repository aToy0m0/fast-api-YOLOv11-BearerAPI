"""FastAPI application exposing YOLO11m detections with API key auth."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, List

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

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

# FastAPI インスタンスを初期化（OpenAPI 情報はここで定義）
app = FastAPI(
    title="YOLO11m FastAPI Detection API",
    description="Upload an image, authenticate via API key, and receive YOLO detections plus an annotated image.",
    version="0.1.0",
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
    file: UploadFile = File(..., description="Image file (JPEG/PNG)"),
    _: str = Depends(require_api_key),
) -> DetectionResponse:
    """画像を受け取り、YOLO11m 推論結果と可視化画像を返すメイン処理。"""

    # 1. ファイルを読み込み、空アップロードを弾く
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file uploaded")

    # 2. PIL へ変換してから YOLO11m で推論
    image = load_image_from_bytes(contents)
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
