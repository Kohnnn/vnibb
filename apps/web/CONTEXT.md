# Web

The frontend domain. A dashboard of widgets through which users compose and read screens. It holds no market data of its own.

## Language

**Saved Screen**:
A named, prebuilt set of filter criteria and columns a user selects in one click, such as FCF Margin Expansion or Low Debt Compounder.
_Avoid_: preset, template, saved search

**Quick Filter**:
A single-click criterion on the screener widget, as opposed to one assembled in the advanced filter builder. Both kinds leave the browser as the same serialized criteria — where the user set it does not change what the api receives.
_Avoid_: simple filter, basic filter

**Widget**:
An independently-mounted dashboard panel owning its own data fetching and refresh.
_Avoid_: card, tile, module
