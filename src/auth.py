"""認証周りの共通処理。"""
from __future__ import annotations

import secrets
from typing import Callable, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# FastAPI の Security スキームを単一箇所で管理
bearer_scheme = HTTPBearer(auto_error=False)


def build_api_key_dependency(expected_api_key: str) -> Callable[[Optional[HTTPAuthorizationCredentials]], str]:
    """`.env` などで定義したキーと Bearer ヘッダーを照合する依存関数を生成。"""

    async def require_api_key(
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    ) -> str:
        if credentials is None or credentials.scheme.lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing bearer token",
            )

        provided_key = credentials.credentials
        if not secrets.compare_digest(provided_key, expected_api_key):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid API key",
            )
        return provided_key

    return require_api_key


__all__ = ["build_api_key_dependency", "bearer_scheme"]
