# live-diagram skills

Four skills for working with **live-diagram** — the MIT library that turns a Mermaid diagram
into a live control surface. This folder in the repository is their source of truth.

| Skill | Use it when |
|---|---|
| `live-diagram-embed` | Putting a diagram into a docs site, page, app or framework |
| `live-diagram-from-data` | The diagram should come from run data you already have |
| `live-diagram-troubleshoot` | It is wired up but behaving wrongly |
| `live-diagram-release` | Working **on** the library — building and shipping a version |

None of them mention any private or internal project.

## Installing them

A skill is a folder containing a `SKILL.md` whose frontmatter carries `name` and
`description`. Drop these folders wherever your tooling reads skills from — for Claude Code
and Cowork that is `~/.claude/skills/` (personal) or `.claude/skills/` inside a project:

```bash
cp -r skills/live-diagram-* ~/.claude/skills/
```

Copying files is enough for a project- or user-level skill directory. Skills held in a
Claude **account** are a separate store: a synced copy on disk is a read-only cache, and
editing it changes nothing — ask Claude to propose the skill instead, and save it from the
review card.

## Keeping them true

A skill that quietly goes stale is worse than no skill, because it is followed with
confidence. So staleness is not left to memory: `test/skills.test.js` checks the API facts
these files state — export names, the element's events and forwarded methods, the default
vocabulary, quoted error messages, stated defaults, and the version line each skill carries —
against the source, in the same suite that checks the README's claims. Change the library and
the skill that described the old behaviour fails in CI.

The version line (`Written against live-diagram X.Y.x`) is checked against `package.json`,
so a minor version bump deliberately fails every skill until someone has re-read each one and
moved its line forward. That is the point: a minor bump is new API, and new API is exactly
when a skill deserves a fresh pair of eyes.
