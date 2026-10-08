#!/usr/bin/env bash
# Deletes Firebase Hosting preview channels that belong to closed PRs.
#
# Every same-repo PR gets a preview channel on both sites in firebase.json (named
# `pr<number>-<branch>` by FirebaseExtended/action-hosting-deploy). Channels otherwise only go away
# when they expire (7 days), and a site can only hold a limited number of them - once a busy week
# of PRs fills that up, every new PR's preview fails with "channel quota reached".
#
# Usage: cleanup-preview-channels.sh [PR_NUMBER]
#   with a PR number - delete that PR's channels (run when the PR closes)
#   without one      - delete the channels of every PR that is no longer open (manual cleanup)
# Env: GOOGLE_APPLICATION_CREDENTIALS - service account allowed to manage the project's Hosting
#      GH_TOKEN - to look up whether a PR is still open (manual cleanup only)
set -euo pipefail

PROJECT="hitu-mabusi"
SITES=$(node -p "require('./firebase.json').hosting.map((h) => h.site).join(' ')")
ONLY_PR="${1:-}"

for site in $SITES; do
  channels=$(npx --yes firebase-tools@15 hosting:channel:list --site "$site" --project "$PROJECT" --json \
    | node -e '
        let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
          const r = JSON.parse(s);
          const list = Array.isArray(r.result) ? r.result : (r.result?.channels ?? []);
          for (const c of list) {
            const id = c.name.split("/").pop();
            if (/^pr\d+-/.test(id)) console.log(id);
          }
        });')
  for channel in $channels; do
    pr="${channel#pr}"; pr="${pr%%-*}"
    if [ -n "$ONLY_PR" ]; then
      [ "$pr" = "$ONLY_PR" ] || continue
    elif [ "$(gh pr view "$pr" --json state -q .state 2>/dev/null || echo UNKNOWN)" = "OPEN" ]; then
      continue
    fi
    echo "Deleting ${site}:${channel} (PR #${pr})"
    npx --yes firebase-tools@15 hosting:channel:delete "$channel" --site "$site" --project "$PROJECT" --force
  done
done
