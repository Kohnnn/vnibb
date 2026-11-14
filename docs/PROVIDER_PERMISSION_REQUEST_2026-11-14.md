# Provider permission requests — FHSC and DNSE (unsent draft)

Status: **not sent**. #232 requires a written answer; this file is the letter, not
the answer. Nothing here is an authorization, and no source may be enabled while
it remains unsent.

Send only by explicit operator action from an account the operator owns. No
credential value belongs in a request, an issue, this file or any reply.

## Software capability is not data permission

Keep these two columns apart in every answer:

| Question | FHSC | DNSE |
|---|---|---|
| Is the API technically reachable and documented? | Yes — tier-1 market endpoints use `X-FH-APIKEY` only | Yes — HMAC-SHA256 per request, no OTP for data |
| Does VNIBB hold a grant to **store** the data? | **Unknown** — no terms page exists | **Unknown** — only registration docs resolve |
| Does VNIBB hold a grant to **publicly redisplay**, including derived values? | **Unknown** | **Unknown** |

Reachability, an API key and a working client establish only the first row.
Written permission #232 asks for, which is the only thing that closes #168:

1. Exchanges covered: HOSE, HNX, UPCoM, and whether indices and derivatives are included.
2. Instrument types: stocks, funds, ETFs, warrants, bonds.
3. Segments: regular lot, odd lot and put-through.
4. Session finality: when a session's data is complete and how corrections/restatements are published.
5. Dated suspension and no-trade coverage — enough to tell a genuine no-trade day from a missing observation.
6. **Storage**: may VNIBB persist the data beyond a request?
7. **Public redisplay**, explicitly including derived values such as ratios, screens and rankings.

## Request to FHSC (Finhay)

> We operate VNIBB, a Vietnamese market-analytics application. We would like to
> use the FHSC market and fundamental endpoints as a data source.
>
> Please confirm in writing whether our use is permitted for: (a) storing
> retrieved data in our own database, and (b) publicly redisplaying it to our
> users, including derived values such as computed ratios and screening results.
>
> We also need the coverage contract for exchanges and instrument types, the
> regular/odd-lot/put-through segments, session finality and correction handling,
> and a dated suspension and no-trade authority so we can distinguish a genuine
> non-trading day from a missing observation.
>
> If any part of this use is not permitted, please say which part, so we can
> exclude that dataset rather than assume.

## Request to DNSE

> We operate VNIBB, a Vietnamese market-analytics application. We would like to
> use the LightSpeed market-data endpoints.
>
> Please confirm in writing whether our use is permitted for: (a) storing
> retrieved data in our own database, and (b) publicly redisplaying it to our
> users, including derived values.
>
> We also need the coverage contract for exchanges and instrument types, the
> regular/odd-lot/put-through segments, session finality and correction
> handling, and whether your published trading calendar is the authority for
> dated suspension and no-trade days.
>
> If any part of this use is not permitted, please say which part.

## What each outcome changes

| Answer | Effect |
|---|---|
| Grant covering storage and public redisplay | #232 can be accepted for that source; #168 still needs the coverage contract |
| Grant for storage only | Data may be stored but not shown; consumer features stay off |
| Refusal, or no answer | No acquisition, no enablement; fixtures remain the only use |
| SSI | Not pursued — its terms §3 exclude third-party and processed redisplay |

Credentials are gathered separately and are not permission. A key that exists
while this file is unsent changes nothing: `providers/credential_policy.py`
refuses acquisition for FHSC and DNSE in every environment.
