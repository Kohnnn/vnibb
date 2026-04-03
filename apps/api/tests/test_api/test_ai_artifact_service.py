from __future__ import annotations

from vnibb.services.ai_artifact_service import build_table_artifacts


def test_build_table_artifacts_returns_comparison_snapshot_for_compare_prompt():
    artifacts = build_table_artifacts(
        "Compare VNM and FPT on valuation and growth",
        {
            "market_context": [
                {
                    "symbol": "VNM",
                    "company": {"short_name": "Vinamilk"},
                    "price_context": {
                        "latest": {"close": 72.4},
                        "summary": {"change_20d_pct": 4.1},
                    },
                    "ratios": {
                        "pe_ratio": 14.2,
                        "pb_ratio": 3.1,
                        "roe": 18.6,
                        "revenue_growth": 7.4,
                    },
                    "available_source_ids": ["VNM-PROFILE", "VNM-PRICES", "VNM-RATIOS"],
                },
                {
                    "symbol": "FPT",
                    "company": {"short_name": "FPT"},
                    "price_context": {
                        "latest": {"close": 128.9},
                        "summary": {"change_20d_pct": 6.8},
                    },
                    "ratios": {
                        "pe_ratio": 22.5,
                        "pb_ratio": 4.4,
                        "roe": 21.2,
                        "revenue_growth": 16.9,
                    },
                    "available_source_ids": ["FPT-PROFILE", "FPT-PRICES", "FPT-RATIOS"],
                },
            ]
        },
    )

    assert len(artifacts) == 1
    artifact = artifacts[0]
    assert artifact["id"] == "comparison_snapshot"
    assert artifact["type"] == "table"
    assert artifact["columns"][0]["key"] == "symbol"
    assert [row["symbol"] for row in artifact["rows"]] == ["VNM", "FPT"]
    assert artifact["sourceIds"] == [
        "VNM-PROFILE",
        "VNM-PRICES",
        "VNM-RATIOS",
        "FPT-PROFILE",
        "FPT-PRICES",
        "FPT-RATIOS",
    ]


def test_build_table_artifacts_returns_sector_and_foreign_flow_tables_when_requested():
    artifacts = build_table_artifacts(
        "Show sector breadth and foreign flow ranking",
        {
            "broad_market_context": {
                "sectors": {
                    "sector_leaders": [
                        {
                            "sector_code": "TECH",
                            "sector_name": "Technology",
                            "change_pct": 3.2,
                            "advance_count": 11,
                            "decline_count": 2,
                            "top_gainer_symbol": "FPT",
                            "top_loser_symbol": "CMG",
                        }
                    ],
                    "sector_laggards": [
                        {
                            "sector_code": "UTIL",
                            "sector_name": "Utilities",
                            "change_pct": -1.4,
                            "advance_count": 1,
                            "decline_count": 9,
                            "top_gainer_symbol": "POW",
                            "top_loser_symbol": "NT2",
                        }
                    ],
                }
            },
            "market_context": [
                {
                    "symbol": "VNM",
                    "foreign_trading": {
                        "latest_session": {"net_value": 32.5, "room_pct": 11.2},
                        "summary": {"net_value_5d": 120.0, "net_value_20d": 340.0},
                    },
                    "available_source_ids": ["VNM-FOREIGN"],
                },
                {
                    "symbol": "FPT",
                    "foreign_trading": {
                        "latest_session": {"net_value": 19.0, "room_pct": 7.5},
                        "summary": {"net_value_5d": 88.0, "net_value_20d": 210.0},
                    },
                    "available_source_ids": ["FPT-FOREIGN"],
                },
            ],
        },
    )

    artifact_ids = [artifact["id"] for artifact in artifacts]
    assert "sector_breadth_snapshot" in artifact_ids
    assert "foreign_flow_leaderboard" in artifact_ids

    sector_artifact = next(artifact for artifact in artifacts if artifact["id"] == "sector_breadth_snapshot")
    foreign_flow_artifact = next(artifact for artifact in artifacts if artifact["id"] == "foreign_flow_leaderboard")

    assert sector_artifact["sourceIds"] == ["MKT-SECTORS"]
    assert [row["symbol"] for row in foreign_flow_artifact["rows"]] == ["VNM", "FPT"]
    assert foreign_flow_artifact["sourceIds"] == ["VNM-FOREIGN", "FPT-FOREIGN"]
