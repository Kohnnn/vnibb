# Web

The frontend domain. A dashboard of widgets through which users compose and read screens. It holds no market data of its own.

## Language

**Investor**:
A long-term Vietnamese retail investor who uses evidence to make and revisit investment decisions. The primary user for whom the workspace is optimized.
_Avoid_: trader, analyst, user

**Investment Thesis**:
An evidence-backed, reviewable case for or against owning a Vietnamese equity, including catalysts, risks, invalidation conditions, and a review date. The primary outcome of the workspace.
_Avoid_: note, report, stock opinion

**Local Workspace**:
A personal research environment whose dashboards, holdings, and Investment Theses remain on one browser unless explicitly exported. The supported product mode until cross-device persistence is deliberately introduced.
_Avoid_: account, cloud workspace, tenant

**Investor Home**:
The daily starting workspace that brings together market context, monitored holdings, Investment Theses due for review, upcoming events, and alert activity.
_Avoid_: dashboard, homepage, overview

**Holdings Tracker**:
A current-position monitor for quantities, average costs, and unrealized value. It is not transaction accounting and does not claim realized returns, fees, dividends, deposits, withdrawals, or cash-flow-aware performance.
_Avoid_: portfolio manager, portfolio accounting, ledger

**Thesis Completion**:
The first saved Investment Thesis containing evidence, risks, invalidation conditions, and a review date. The product's activation event.
_Avoid_: signup, first visit, first ticker

**Saved Screen**:
A named, prebuilt set of filter criteria and columns a user selects in one click, such as FCF Margin Expansion or Low Debt Compounder.
_Avoid_: preset, template, saved search

**Quick Filter**:
A single-click criterion on the screener widget, as opposed to one assembled in the advanced filter builder. Both kinds leave the browser as the same serialized criteria — where the user set it does not change what the api receives.
_Avoid_: simple filter, basic filter

**Widget**:
An independently-mounted dashboard panel owning its own data fetching and refresh.
_Avoid_: card, tile, module

**Matrix**:
A comparison of an explicit company shortlist through curated research questions, with typed results and inspectable evidence, basis and limitations. It supports follow-up investigation rather than replacing an Investment Thesis.
_Avoid_: screener, spreadsheet, chat

**Research Playbook**:
A curated set of research questions, typed outputs and eligibility rules applied to a Matrix shortlist. Different business sectors may require different playbooks for meaningful comparison.
_Avoid_: column preset, prompt collection

**Anchor Company**:
The company from which a Matrix comparison starts and whose suggested peers prepopulate the editable shortlist. Its peer suggestions do not establish whole-market coverage or prove comparability.
_Avoid_: market universe, automatic peer universe
