# Design rationale — Temporal evaluation

**Status:** Motivating example. Not a feature. Not a schema change.
**Date:** 2026-08-18

This is why Chronicle treats a later judgment as a new historical
act, keeps `evaluatedAt` in evaluation identity, and refuses to
mutate an earlier interpretation into “what we always believed.”

It is **not** a request to implement author-belief tracking,
biography, or podcast import.

## The question a conventional store asks

> Which version is correct?

## The question Chronicle asks

> What did this person think, when did they think it, what caused
> us to believe they thought it, and how did their evaluation of
> their own thinking change over time?

```text
T1 IS NOT WRONG HISTORY.

T1 is accurate history
of an understanding that later changed.
```

“I believed / wrote X then” and “I now evaluate X differently” can
both be true at once. The later judgment does not overwrite the
historical artifact.

## Motivating analogue — a book, a later podcast, a recollection

An operator recalled hearing an author describe disagreeing with an
earlier book and writing follow-ups that would change what that
book said. The author's name and publisher, as remembered in that
conversation, are **not** recorded here as bibliographic fact.
The recollection is the evidence we actually have.

Conceptually:

```text
T1
AUTHOR WRITES BOOK
"This is how I understand X."

        ↓ time

T2
AUTHOR ON PODCAST
"I don't agree with parts of that anymore."
"I would write this differently today."

        ↓ time

T3
AUTHOR WRITES FOLLOW-UP
"Here's how I understand X now."
```

The book remains evidence of what was written at T1. The podcast is
a later event at T2 in which the author evaluates that earlier
interpretation. A revised book at T3 is another artifact.

A later mind can ask “as of T1, what was the apparent
understanding?” and “as of T3?” and get different answers **without
changing or deleting either record.** That is the temporal part
current understanding, if implemented, would project. It is not a
reason to rewrite T1.

## First-person evidence is not a recollection of it

Those paths are not equivalent sources:

```text
BOOK
  ↓
author's historical statement

PODCAST
  ↓
author's later first-person evaluation

AN OPERATOR HEARING THE PODCAST
  ↓
that operator's recollection / interpretation
  ↓
"the author says his thinking changed"
```

If Chronicle possessed the episode, that would be relatively
direct evidence of the author's later statement.

If Chronicle only possesses **someone's recollection of hearing
it**, the honest lineage is:

```text
author allegedly said X
        ↑
operator recalls hearing X
```

Chronicle must not promote that into:

```text
AUTHOR SAID X
```

That is why provenance sits under interpretation, and why a
secondhand motivating example must not be stored as if it were the
author's act.

## Doorway explanation

A later self can understand what an earlier, more intense self was
getting at and still reject part of it. A conventional phone or
model is tempted to keep only the latest version. Chronicle's job
is to remember the path: what was said, what it was taken to mean
then, what someone later thought about that meaning, and what
changed — without secretly rewriting the old version so the new
one looks like what they always believed.

The High Russ origin is the same shape. An earlier thought about
memory and identity was not only worth saving. It was worth asking
whether it was any good. That later evaluation was itself worth
remembering. The evaluation can change again. None of those moments
is the permanent truth.

> If you change your mind, which version of you was the real you?

Rosetta's emerging answer: **that is the wrong question. They were
all you. Preserve the path.**

## What this justifies in the engine (already decided)

| Decision | Why this example supports it |
| --- | --- |
| Append-only `DerivedEvaluation` | T2 does not edit T1 |
| Machine `reviewState` stays a creation fact | The book is not restamped when the author later disagrees |
| `evaluatedAt` in evaluation identity | 2018 and 2024 are different acts |
| `recordedAt` is not identity | Reconstructing a past judgment later must not collapse it into “now” |
| Evidence support ≠ personal recognition | “The earlier text said that” is not “I stand behind it now” |
| Provenance under interpretation | Recollection is not the author |
| Current understanding, if built, is a view | As-of 2018 and as-of 2024 differ; history does not |

Do not implement a new author, podcast, or biography surface from
this note.

The path is the data.
