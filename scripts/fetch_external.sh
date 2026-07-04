#!/usr/bin/env bash
# fetch_external.sh — download all external data sources into EXTERNAL/.
# Idempotent: skips files that already exist. ~900MB total.
#
# Sources:
#   Voteview     — members (all congresses, ICPSR + bioguide + NOMINATE),
#                  House roll-call votes + rollcall metadata, congs 103-116
#   ProPublica   — bulk bill JSON (unitedstates/congress scraper output),
#                  includes sponsor + cosponsors per bill, congs 103-116
#   congress-legislators — thomas_id / bioguide_id / icpsr_id crosswalk
set -euo pipefail
cd "$(dirname "$0")/.."

CONGS=(103 104 105 106 107 108 109 110 111 112 113 114 115 116)

get() { # get <url> <dest>
  if [ -s "$2" ]; then echo "skip $2"; else
    echo "GET  $2"
    curl -sL --retry 3 --fail -o "$2" "$1"
  fi
}

mkdir -p EXTERNAL/voteview EXTERNAL/propublica_bills EXTERNAL/legislators

get https://voteview.com/static/data/out/members/HSall_members.csv EXTERNAL/voteview/HSall_members.csv
for c in "${CONGS[@]}"; do
  get "https://voteview.com/static/data/out/votes/H${c}_votes.csv" "EXTERNAL/voteview/H${c}_votes.csv"
  get "https://voteview.com/static/data/out/rollcalls/H${c}_rollcalls.csv" "EXTERNAL/voteview/H${c}_rollcalls.csv"
done

for c in "${CONGS[@]}"; do
  get "https://s3.amazonaws.com/pp-projects-static/congress/bills/${c}.zip" "EXTERNAL/propublica_bills/${c}.zip"
done

get https://unitedstates.github.io/congress-legislators/legislators-historical.csv EXTERNAL/legislators/legislators-historical.csv
get https://unitedstates.github.io/congress-legislators/legislators-current.csv EXTERNAL/legislators/legislators-current.csv

echo "done."
