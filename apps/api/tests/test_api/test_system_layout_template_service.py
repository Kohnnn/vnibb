from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from vnibb.services.system_layout_template_service import SystemLayoutTemplateService


@pytest.mark.asyncio
async def test_system_layout_templates_fall_back_to_sql_storage(test_engine, monkeypatch):
    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    monkeypatch.setattr(
        "vnibb.services.system_layout_template_service.async_session_maker",
        session_factory,
    )

    service = SystemLayoutTemplateService()

    bundle = await service.save_dashboard_template(
        dashboard_key="default-fundamental",
        dashboard={"id": "default-fundamental", "name": "Fundamental"},
        notes="Saved during maintenance window",
        updated_by="tester",
        publish=True,
    )

    assert bundle.draft is not None
    assert bundle.published is not None
    assert bundle.draft.dashboard["name"] == "Fundamental"
    assert bundle.published.notes == "Saved during maintenance window"

    listed = await service.list_published_templates()

    assert len(listed) == 1
    assert listed[0].dashboard_key == "default-fundamental"
