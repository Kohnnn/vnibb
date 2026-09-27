from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from vnibb.api.deps import DatabaseDep
from vnibb.core.auth import User, get_current_user
from vnibb.schemas.matrix import (
    MatrixCreate,
    MatrixEvidence,
    MatrixPlaybook,
    MatrixPreparation,
    MatrixResearchRequest,
    MatrixReview,
    MatrixSelection,
    MatrixSnapshot,
)
from vnibb.services import matrix_service
from vnibb.services.matrix_observations import prepare_matrix
from vnibb.services.matrix_playbooks import PLAYBOOKS

router = APIRouter()
CurrentUser = Annotated[User, Depends(get_current_user)]


async def no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"


private = APIRouter(dependencies=[Depends(no_store)])


@router.get("/playbooks", response_model=list[MatrixPlaybook])
async def playbooks():
    return PLAYBOOKS


@router.get("/fixture", response_model=MatrixSnapshot)
async def fixture():
    return matrix_service.get_matrix_fixture()


@router.get("/fixture/evidence", response_model=list[MatrixEvidence])
async def fixture_evidence(result_id: Annotated[str, Query(min_length=1, max_length=128)]):
    return matrix_service.get_matrix_fixture_evidence(result_id)


@router.get("/prepare", response_model=MatrixPreparation)
async def prepare(db: DatabaseDep, anchor_symbol: Annotated[str, Query(pattern=r"^[A-Z0-9]{1,12}$")]):
    try:
        return await prepare_matrix(db, anchor_symbol)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@private.post("/snapshots", response_model=MatrixSnapshot, status_code=201)
async def create(request: MatrixCreate, db: DatabaseDep, user: CurrentUser):
    return await matrix_service.create_matrix_snapshot(db, user.id, request.model_dump())


@private.get("/snapshots", response_model=list[MatrixSnapshot])
async def history(db: DatabaseDep, user: CurrentUser, limit: Annotated[int, Query(ge=1, le=50)] = 20):
    return await matrix_service.list_matrix_snapshots(db, user.id, limit)


@private.get("/snapshots/{snapshot_id}", response_model=MatrixSnapshot)
async def snapshot(snapshot_id: str, db: DatabaseDep, user: CurrentUser):
    return await matrix_service.get_matrix_snapshot(db, user.id, snapshot_id)


@private.get("/snapshots/{snapshot_id}/evidence", response_model=list[MatrixEvidence])
async def evidence(snapshot_id: str, db: DatabaseDep, user: CurrentUser,
                   result_id: Annotated[str, Query(min_length=1, max_length=128)]):
    return await matrix_service.get_matrix_evidence(db, user.id, snapshot_id, result_id)


@private.post("/selection", response_model=MatrixResearchRequest)
async def selection(request: MatrixSelection, db: DatabaseDep, user: CurrentUser):
    return await matrix_service.resolve_matrix_selection(db, user.id, request.model_dump())


@private.post("/snapshots/{snapshot_id}/review", response_model=MatrixSnapshot)
async def review(snapshot_id: str, request: MatrixReview, db: DatabaseDep, user: CurrentUser):
    return await matrix_service.review_matrix_snapshot(db, user.id, snapshot_id, request.model_dump())


@private.post("/snapshots/{snapshot_id}/revoke", response_model=dict[str, bool])
async def revoke(snapshot_id: str, db: DatabaseDep, user: CurrentUser):
    return await matrix_service.revoke_matrix_snapshot(db, user.id, snapshot_id)


router.include_router(private)
