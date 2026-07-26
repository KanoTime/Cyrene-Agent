# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `Liyang0701/Cyrene-Agent`. Use the `gh` CLI for all operations and explicitly target this fork with `--repo Liyang0701/Cyrene-Agent`, because this clone also has an upstream remote.

The `gh` CLI must be installed and authenticated before a skill performs issue operations.

## Conventions

- **Create an issue**: `gh issue create --repo Liyang0701/Cyrene-Agent --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --repo Liyang0701/Cyrene-Agent --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --repo Liyang0701/Cyrene-Agent --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --repo Liyang0701/Cyrene-Agent --body "..."`
- **Apply or remove labels**: `gh issue edit <number> --repo Liyang0701/Cyrene-Agent --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --repo Liyang0701/Cyrene-Agent --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.**

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --repo Liyang0701/Cyrene-Agent --comments` and `gh pr diff <number> --repo Liyang0701/Cyrene-Agent`.
- **List external PRs for triage**: `gh pr list --repo Liyang0701/Cyrene-Agent --state open --json number,title,body,labels,author,authorAssociation,comments`, then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE`.
- **Comment, label, or close**: use `gh pr comment`, `gh pr edit`, or `gh pr close`, always with `--repo Liyang0701/Cyrene-Agent`.

GitHub shares one number space across issues and PRs. Resolve an ambiguous `#42` with `gh pr view 42 --repo Liyang0701/Cyrene-Agent`, then fall back to `gh issue view`.

## When a skill says “publish to the issue tracker”

Create an issue in `Liyang0701/Cyrene-Agent`.

## When a skill says “fetch the relevant ticket”

Run:

`gh issue view <number> --repo Liyang0701/Cyrene-Agent --comments`

## Wayfinding operations

Used by `/wayfinder`. The map is one issue with child issues as tickets.

- **Map**: an issue labelled `wayfinder:map`, holding Notes, Decisions-so-far, and Fog.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue. If sub-issues are unavailable, add it to a task list and include `Part of #<map>` in the child body.
- **Blocking**: use GitHub native issue dependencies. If unavailable, use a `Blocked by: #<n>` line.
- **Frontier query**: find the first open child without open blockers or an assignee.
- **Claim**: `gh issue edit <n> --repo Liyang0701/Cyrene-Agent --add-assignee @me`
- **Resolve**: comment with the decision, close the issue, and append a context pointer to the map’s Decisions-so-far.
