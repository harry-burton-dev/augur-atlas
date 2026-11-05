# 0001. A merge places one entity under another and moves nothing

- **Status:** Proposed
- **Date:** 2026-11-05
- **Decided by:** Harry
- **Replaces:** none

## Context

Two entities often turn out to be the same thing: one ship recorded twice, one supplier under two names. Until
now the only tool was to retire one. Retiring keeps no record of which entity it was the same as, why, or on
what evidence, and it frees the retired entity's identity keys. So a merge could never be explained later, nor
undone exactly. What is never stored can't be recovered by a later migration either: the design lab's data run
(`augur` design-lab/runs/2026-11-05-the-type-specimen) tried four migrations, and every one lost the question
"why did we think these were one?".

## Options

1. **Retire the duplicate (today).** Simple, but loses who, why and the evidence, and can't be undone.
2. **Move statements onto the survivor** (Wikidata's merge). The survivor reads well, but undoing means sorting
   every moved statement back by hand, and a careless keeper loses the split for good.
3. **Place the junior under the senior, and move nothing.** The merge is its own record, with who, when, the
   floor, why and the observations it rests on, for and against. The junior keeps its id, facts,
   observations, links and keys. Undoing withdraws the merge and the junior is in use again, exactly as it was.
4. **`owl:sameAs` between the two.** It over-claims: every fact about one becomes a fact about the other, and it
   has no place for why.

## Decision

Option 3. In Data Atlas a merge (`atlas.merges`, `POST /entities/:id/merge`) places the junior under the senior
and never moves, copies or deletes anything of the junior's. A merge records who decided it, when, on which
floor, why, and the observations it cites for and against (`atlas.merge_cites`). A merge is never deleted.
Undoing one (`POST /merges/:id/undo`) records who and why, brings the junior back with the same id, and may mark
observations the merge was made on as **discredited**: kept where they are, saying who found them wrong and
why. Only things of the same kind merge. Deciding a merge is for whoever may retire the junior. Undoing it is
for the same people, or whoever made the merge. Other apps hear `atlas.entity.merged` and `atlas.entity.split`.

A merge is for *found the same* (always one thing). *Became one* (one company bought and folded into another on
a date) is an event in the world. It is recorded as a link between two entities that both stay, never as a
merge.

## Consequences

- Every merge can be explained and undone, and a record that misled it can't mislead the next keeper unseen.
- While merged, the junior's knowledge stays on the junior. The senior's page doesn't yet show it. Showing it
  (and sorting what was said while merged, fact by fact, before an undo) is follow-up work from the same run.
- A merged junior keeps its identity keys, so a new record with one of them is still refused, naming the
  junior. Turning that refusal into a Triage question ("same thing?") is follow-up work.
- The check: `service/src/merges.test.ts`, which runs against Postgres in CI.

## Links

- Linear PER-319.
- `augur` design-lab run 2026-11-05-the-type-specimen (shortlist item 2, concepts "found the same, or became
  one" and "name the wrong record").
