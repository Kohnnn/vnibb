from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

from vnibb.api.deps import DatabaseDep
from vnibb.core.auth import User, require_active_user
from vnibb.schemas.research_sharing import (
    ResearchShareCreate,
    ResearchShareRead,
    ResearchShareSummary,
)
from vnibb.services import research_sharing_service


class PrivateShareRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request: Request):
            try:
                response = await handler(request)
            except HTTPException as exc:
                response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
            except RequestValidationError:
                response = JSONResponse({"detail": "Invalid research sharing request"}, status_code=422)
            except SQLAlchemyError:
                response = JSONResponse({"detail": "Research sharing storage is unavailable"}, status_code=503)
            response.headers["Cache-Control"] = "no-store"
            response.headers["Vary"] = "Authorization"
            return response

        return private_handler


router = APIRouter(route_class=PrivateShareRoute)
ActiveUser = Annotated[User, Depends(require_active_user)]


@router.post("", response_model=ResearchShareSummary, status_code=201)
async def create(request: ResearchShareCreate, db: DatabaseDep, user: ActiveUser):
    return await research_sharing_service.create_share(db, user.id, request.model_dump(mode="json", exclude_none=True))


@router.get("", response_model=list[ResearchShareSummary])
async def history(db: DatabaseDep, user: ActiveUser):
    return await research_sharing_service.list_shares(db, user.id)


@router.get("/{share_id}", response_model=ResearchShareRead)
async def read(share_id: str, db: DatabaseDep, user: ActiveUser):
    return await research_sharing_service.read_share(db, user.id, share_id)


@router.delete("/{share_id}", response_model=dict[str, bool])
async def revoke(share_id: str, db: DatabaseDep, user: ActiveUser):
    return await research_sharing_service.revoke_share(db, user.id, share_id)
