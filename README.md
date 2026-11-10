# Data Atlas

Part of AUGUR, which is proprietary; see `LICENSE`.

The things your organisation knows about, and what is known of them. Data Atlas reads AUGUR's knowledge
graph as the person, through the gateway, and keeps none of it: every thing's page is read fresh and filled
in the kit's one shape (App patterns, "A thing's page") by the rules in `service/src/shape.ts`.

| Path | What it is |
| --- | --- |
| `manifest.json` | What the shell draws for the app (places, About sections), the scopes it asks for and the floors it works on (manifest 3). `$schema` points at the schema in `@augur/app-tools`, so your editor checks it; `pnpm check:app` checks it as the registry will |
| `score/` | One Score file per part: `web` (the inbound service, with its sign-in, database and scratch folder) and `migrate` (a job that runs the migrations before each install switches over). Each says what the part asks for and its limits; `image: .` is pinned by digest in the release |
| `catalog-info.yaml` | The app's entry in Backstage's catalog, written from the manifest and the package.json files by `augur-app catalog`. Don't edit it: CI checks it's current (`pnpm check:catalog`) and Version packages rewrites it |
| `service/` | The image both parts run (`@apps/atlas`): `src/app.ts` its routes (`/v1/things/:id` and its `everything`, `wrong` and `disputes`, `/v1/follows/:id`, `/v1/find`) and `/healthz`, `src/everything.ts` everything known of a thing, `src/follows.ts` what people keep an eye on (Atlas's own table), `src/shape.ts` the slot rules that turn what the graph says into a thing's page, `src/knowledge.ts` the reads through the gateway as the person, `src/events.ts` the events pushed to it, `src/migrations.ts` its schema, `src/index.ts` and `src/migrate.ts` what each part starts, each reaching the app's database with the service kit's `appDatabaseFromEnv` (none under `pnpm dev:app`) |
| `service/src/api-types.ts` | The wire types, written once: the service answers with them, its OpenAPI document describes them and the frontend reads them |
| `frontend/` | What the shell runs in the app's worker (`@apps/atlas-frontend`): `src/entry.ts` its `start(ctx)` and routes (`/` finds a thing, `/things/<id>` is its page, `/things/<id>/all` everything known of it), `src/screen.ts` what it draws |
| `run/index.ts` | Its scenarios for AUGUR's run suite (augur-run): give each a RUN id there when the app joins the proving run |

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm check:app` run everything; set
`NODE_AUTH_TOKEN` first, and for `check:app` also `GITHUB_REPOSITORY` (`owner/repo`, which names the image; CI sets it).

## Releases

| Workflow | When | What |
| --- | --- | --- |
| CI | Every pull request | Lint, typecheck, test and build, and the manifest, the Score files and the release file they make checked against contract 3 |
| App previews | A pull request that changes the app | A signed preview its developers can run beside the app |
| App dev builds | Every merge into main | A signed dev build for preview servers |
| Release | Merging Version packages | The beta release `app/atlas@<version>`, then AUGUR's feed lists it |

Every pull request carries a changeset (`pnpm changeset`). An empty changeset (`pnpm changeset --empty`)
never holds back a release.
