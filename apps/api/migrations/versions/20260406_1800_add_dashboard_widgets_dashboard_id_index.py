"""add_dashboard_widgets_dashboard_id_index

Revision ID: 2d7a4c9b8e31
Revises: 7c5a9e4b2d11
Create Date: 2026-04-06 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2d7a4c9b8e31"
down_revision: str | None = "7c5a9e4b2d11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INDEX_NAME = "ix_dashboard_widgets_dashboard_id"
TABLE_NAME = "dashboard_widgets"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if TABLE_NAME not in inspector.get_table_names():
        return

    index_names = {index["name"] for index in inspector.get_indexes(TABLE_NAME)}
    if INDEX_NAME in index_names:
        return

    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.create_index(INDEX_NAME, ["dashboard_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if TABLE_NAME not in inspector.get_table_names():
        return

    index_names = {index["name"] for index in inspector.get_indexes(TABLE_NAME)}
    if INDEX_NAME not in index_names:
        return

    with op.batch_alter_table(TABLE_NAME, schema=None) as batch_op:
        batch_op.drop_index(INDEX_NAME)
