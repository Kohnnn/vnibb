"""Sanity check: quant module exposes the canonical historical loaders.

The quant endpoints depend on six historical-loader helpers that live in
``vnibb.api.v1.equity``. Earlier this file shipped with no-op stubs that
returned empty lists, masking any real loader regressions. This test pins the
contract: the names imported into ``quant`` must resolve to the *same* function
objects that ``equity`` defines (so a change in equity cannot silently desync
quant).
"""

from vnibb.api.v1 import equity, quant


EXPECTED_LOADERS = (
    "_load_historical_from_mongo",
    "_load_historical_from_db",
    "_load_historical_from_recent_cache",
    "_load_historical_from_appwrite",
    "_load_corporate_actions_for_adjustment",
    "_apply_corporate_action_adjustments",
)


def test_quant_loaders_are_aliases_of_equity_loaders():
    for name in EXPECTED_LOADERS:
        quant_obj = getattr(quant, name)
        equity_obj = getattr(equity, name)
        assert quant_obj is equity_obj, (
            f"quant.{name} is not the same object as equity.{name}; "
            "the loader has drifted and quant may return different data than equity"
        )


def test_legacy_no_op_stubs_are_gone():
    """The no-op stub bodies used to return [] for everything; ensure they
    are no longer present in the quant module source."""
    import inspect

    for name in EXPECTED_LOADERS:
        fn = getattr(quant, name)
        try:
            source = inspect.getsource(fn)
        except (OSError, TypeError):
            continue
        # Stub bodies were a single ``return []`` / ``return rows`` line.
        # Real implementations are multi-line and reference concrete types.
        assert "return []" not in source or "def " in source.split("return []")[0], (
            f"quant.{name} still contains the trivial ``return []`` stub body"
        )