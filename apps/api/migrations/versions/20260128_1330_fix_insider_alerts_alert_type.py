"""fix_insider_alerts_alert_type

Revision ID: 9c4a12b8f2ab
Revises: 5b2c7d8f3a10
Create Date: 2026-01-28 13:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9c4a12b8f2ab"
down_revision: Union[str, None] = "5b2c7d8f3a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            DO $$ BEGIN
                CREATE TYPE alerttype AS ENUM (
                    'INSIDER_BUY',
                    'INSIDER_SELL',
                    'BLOCK_TRADE',
                    'OWNERSHIP_CHANGE'
                );
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
            """
        )
        op.execute(
            "ALTER TABLE insider_alerts ADD COLUMN IF NOT EXISTS alert_type alerttype"
        )
        op.execute(
            "UPDATE insider_alerts SET alert_type = 'INSIDER_BUY' WHERE alert_type IS NULL"
        )
        op.alter_column("insider_alerts", "alert_type", nullable=False)
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_insider_alerts_alert_type ON insider_alerts (alert_type)"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_alert_type_time ON insider_alerts (alert_type, timestamp)"
        )
    else:
        inspector = sa.inspect(bind)
        existing = {col["name"] for col in inspector.get_columns("insider_alerts")}
        if "alert_type" not in existing:
            op.add_column(
                "insider_alerts",
                sa.Column("alert_type", sa.String(length=50), nullable=True),
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_alert_type_time")
        op.execute("DROP INDEX IF EXISTS ix_insider_alerts_alert_type")
        op.execute("ALTER TABLE insider_alerts DROP COLUMN IF EXISTS alert_type")
    else:
        op.drop_column("insider_alerts", "alert_type")
