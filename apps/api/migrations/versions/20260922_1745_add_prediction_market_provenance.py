"""Add `prediction_markets.is_synthetic` so fixture data is distinguishable.

`populate_prediction_markets` falls back to checked-in JSON fixtures whenever a
live provider fetch fails or returns nothing:

    try:
        count = await ingest_predictit_markets_with_default_client(session)
    except Exception:
        logger.warning("... using offline seed", exc)
    if count == 0:
        count = await seed_predictit_from_fixture(session)

The fallback is deliberate and the code is resilient, but the resulting rows
were indistinguishable from live rows. A provider outage therefore produced a
plausible, populated dashboard with no way to tell that the data was
synthetic -- the fail-open shape the reliability review flagged.

This migration adds the provenance column. It backfills the rows that came
from a fixture using the one signal that is actually reliable: a synthetic
row's `source_id` derives from a static fixture file, whereas a live row's is
the provider's own identifier. Rows whose `extra` payload carries a provider
marker are left as live; the remainder are assumed synthetic, which is the
conservative direction (a wrongly-synthetic label prompts an operator to
check, a wrongly-live label does not).

Adding the column is safe on a large table because it is a constant default:
Postgres 11+ stores it in the catalog and does not rewrite the table.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4f8b2e17d30"
down_revision: str | None = "b7e1c4a90f21"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "prediction_markets",
        sa.Column(
            "is_synthetic",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_prediction_markets_is_synthetic",
        "prediction_markets",
        ["is_synthetic"],
    )
    # The health endpoint probes per-source presence. Without a leading
    # `source` index the planner falls back to a seq scan for a source that
    # has no rows, which is the wrong shape for a health check.
    op.create_index(
        "ix_prediction_markets_source_only",
        "prediction_markets",
        ["source"],
    )

    # Backfill only the sources that actually have a fixture fallback, and
    # only rows with no provider marker in `extra`. The scoping is not an
    # optimisation nit: `prediction_markets` holds ~13.3M live rows, so an
    # unscoped predicate seq-scans the whole table to touch a few dozen rows
    # (measured 168s, with the parallel scan reading 4.25M rows per worker).
    # The fixture sources are the three with an offline seed path; the others
    # have none, so their rows are live by construction and are never touched.
    op.execute(
        sa.text(
            """
            UPDATE prediction_markets
            SET is_synthetic = true
            WHERE source IN ('predictit', 'limitless', 'manifold')
              AND is_synthetic = false
              AND (extra IS NULL OR extra::jsonb = '{}'::jsonb)
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_prediction_markets_source_only", table_name="prediction_markets")
    op.drop_index("ix_prediction_markets_is_synthetic", table_name="prediction_markets")
    op.drop_column("prediction_markets", "is_synthetic")
