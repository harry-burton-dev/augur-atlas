---
"@apps/atlas-frontend": minor
---

A thing's page offers "See how it connects": the map of what is around it, at `/things/<id>/map`. The thing sits in the middle with what it touches round it, grouped, each line read from its side ("Operated by"). Choosing one opens its page and counts towards use-ranking, as from the page; past twelve, the map opens the rest in everything we know. It is drawn from the page already read, so opening it costs no second call. Needs app-kit with `quill-thing-map`.
