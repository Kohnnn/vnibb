# V36 Visual QA Evidence (2026-02-13)

## Captured VNIBB Screens

- `overview_dashboard.png`
- `financials_dashboard.png`
- `comparison_dashboard.png`

## Reference Screens (OpenBB Baseline)

- `C:\Users\Admin\Desktop\PersonalWebsite\stockscreen\VNIBB\screenshots\openbb_financials.png`
- `C:\Users\Admin\Desktop\PersonalWebsite\stockscreen\VNIBB\screenshots\openbb_comparison_analysis.png`

## What Improved vs baseline issue list

- Financial ratios table renders year headers and metric rows (no numeric index headers).
- Comparison Analysis widget supports ticker chips, add-ticker CTA, and FY/Q1/Q2/Q3/Q4/TTM toggles.
- Widget header controls are consistent and include maximize/settings actions.
- Dashboard top tabs and keyboard hint chips are visible and aligned with parity goals.

## Remaining Visual/Product Gaps for V37

1. Financial statements still show empty states for VNM in this production capture (income statement, balance sheet, cash flow).
2. Comparison Analysis showed a connection error during this capture despite backend health being generally green.
3. Browser console showed mixed-content warnings during comparison data fetch on production.
4. OpenBB still has denser table affordances (sorting controls and tighter in-cell tools) than VNIBB.

## Notes

- Capture URL: `https://vnibb-web.vercel.app/dashboard`
- Capture used browser automation for deterministic artifacts.
- This pass is evidence-only and does not replace manual design sign-off.
