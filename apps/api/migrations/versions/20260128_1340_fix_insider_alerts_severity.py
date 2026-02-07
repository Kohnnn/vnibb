"""fix_insider_alerts_severity

Revision ID: 5d9f28a7e4c1
Revises: 9c4a12b8f2ab
Create Date: 2026-01-28 13:40:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5d9f28a7e4c1"
down_revision: Union[str, None] = "9c4a12b8f2ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            DO $$ BEGIN
                CREATE TYPE alertseverity AS ENUM ('LOW', 'MEDIUM', 'HIGH');
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
            """
        )
        op.execute(
            "ALTER TABLE insider_alerts ADD COLUMN IF NOT EXISTS severity alertseverity"
        )
        op.execute(
            "UPDATE insider_alerts SET severity = 'LOW' WHERE severity IS NULL"
        )
        op.alter_column("insider_alerts", "severity", nullable=False)
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_insider_alerts_severity ON insider_alerts (severity)"
        )
    else:
        inspector = sa.inspect(bind)
        existing = {col["name"] for col in inspector.get_columns("insider_alerts")}
        if "severity" not in existing:
            op.add_column(
                "insider_alerts",
                sa.Column("severity", sa.String(length=20), nullable=True),
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_insider_alerts_severity")
        op.execute("ALTER TABLE insider_alerts DROP COLUMN IF EXISTS severity")
    else:
        op.drop_column("insider_alerts", "severity")
