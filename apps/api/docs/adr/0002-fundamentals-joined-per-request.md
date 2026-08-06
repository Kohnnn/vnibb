# Fundamentals are joined per request, not stored on the Screener Snapshot

Fundamental Fields are not persisted as columns on the Screener Snapshot; they are read from Mongo and joined onto the Candidate Set on each request that needs them. Storing them would be faster, and would let the ordinary filter machinery treat them as plain columns — removing the need to detect fundamental requests at all, and with it the whole class of bug this decision sits downstream of.

We do not, because the two sources refresh independently. The Screener Snapshot is rebuilt daily by a scheduled sync; Fundamental Snapshots are rebuilt by a separate manual process on its own cadence and carry their own as-of date. Copying a Fundamental Snapshot into a daily row would pin it to a date it does not belong to, and there is no reconciliation rule for the two as-of dates that is correct in general — only rules that are usually close enough, which is the kind of thing that silently misleads.

Revisit when the fundamental rebuild becomes a scheduled job with a known cadence. At that point a single as-of semantics becomes definable, the copy becomes safe, and this decision should be reversed rather than worked around.
