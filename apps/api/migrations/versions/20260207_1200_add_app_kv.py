"""
Add app_kv table for persistent metadata.

Revision ID: 8b7f0c1e9d12
Revises: c4e9a2d1f7b3
Create Date: 2026-02-07 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8b7f0c1e9d12"
down_revision: Union[str, None] = "c4e9a2d1f7b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_kv",
        sa.Column("key", sa.String(length=200), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


def downgrade() -> None:
    op.drop_table("app_kv")
