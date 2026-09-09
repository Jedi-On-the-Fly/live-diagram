# Releasing

Two commands on a clean `main`, and a tag does the rest.

## First time only

```bash
node scripts/set-repo.js <owner>/<repo>   # stamps repository, homepage, bugs and doc links
```

Then, in the GitHub repository settings:

- **Settings → Pages → Source: GitHub Actions** — the `Demos` workflow deploys `demo/` and `dist/`
  on every push to `main`, which is what the README's demo links point at.
- **Settings → Secrets → Actions → `NPM_TOKEN`** — an npm automation token. Publishing runs with
  `--provenance`, so the package page will show it was built from this repo by this workflow.

## Every release

```bash
npm run release:patch     # or release:minor / release:major
```

That runs the build, both test suites and `npm version`, which writes the tag and pushes it. The
`Publish` workflow picks the tag up, re-runs the whole matrix on a clean checkout, and publishes.

## The checklist behind those commands

- `dist/` is rebuilt and committed — CI fails if it drifts from `src/`.
- `CHANGELOG.md` has an entry for the version, written before the tag exists.
- On a minor or major bump: every `skills/*/SKILL.md` "Written against live-diagram X.Y.x"
  line is updated in the same commit as the version — `test/skills.test.js` fails the release
  otherwise, which is the designed prompt to re-read each skill against the new API.
- `README.md` examples still run. They are the most-read code in the project.
- The demo pages work against the new `dist/` (`npm run demo`).
- `npm pack --dry-run` lists `src/`, `dist/`, `react/`, `skills/`, `README.md`, `LICENSE`,
  `CHANGELOG.md` — and nothing else. The `files` whitelist in `package.json` is what includes;
  `.npmignore` is the belt to its braces.

## Undoing a mistake

An npm version cannot be replaced, only deprecated, and unpublishing is blocked after 72 hours.
If a bad version ships, publish the fix as a new patch and run
`npm deprecate live-diagram@<bad> "use <good> instead"`.
