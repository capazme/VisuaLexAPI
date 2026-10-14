"""
A person's data, for the VisuaLex server only
=============================================

The VisuaLex server (the BFF) calls these when a user downloads or erases their
MERL-T data, and when an account is deleted. They take the admin key
(``require_role("admin")``): ``verify_api_key`` alone is open in this app.

Endpoints:
- GET /user-data/{user_id}: every row that names the person (``merlt.privacy.user_data``)
- DELETE /user-data/{user_id}: erase it; 200 when every store is done, 503 with
  the same body when one failed (the caller retries: every step is idempotent)
"""

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import JSONResponse

from merlt.api.auth import require_role
from merlt.experts.models import ApiKey
from merlt.privacy.user_data import erase_user_data, export_user_data

router = APIRouter(prefix="/user-data", tags=["user-data"])

# A VisuaLex user id: the columns that hold it are varchar(100) at most (qa_* 50).
_UserId = Path(..., min_length=1, max_length=100)


def _check(user_id: str) -> str:
    if "\x00" in user_id:
        raise HTTPException(status_code=400, detail="invalid user id")
    return user_id


@router.get("/{user_id}")
async def export_user(user_id: str = _UserId, api_key: ApiKey = Depends(require_role("admin"))):
    return await export_user_data(_check(user_id))


@router.delete("/{user_id}")
async def erase_user(user_id: str = _UserId, api_key: ApiKey = Depends(require_role("admin"))):
    result = await erase_user_data(_check(user_id))
    return JSONResponse(status_code=200 if result["complete"] else 503, content=result)


__all__ = ["router"]
