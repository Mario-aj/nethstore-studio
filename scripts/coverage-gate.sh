#!/usr/bin/env bash
# Falha se algum dos pacotes indicados tiver cobertura abaixo de MIN (80%).
# Uso: scripts/coverage-gate.sh <coverage.out> pkg1 pkg2 ...
set -euo pipefail
profile=$1
shift
MIN=${MIN:-80}
fail=0
for pkg in "$@"; do
	pct=$(awk -v p="/internal/$pkg/" '
		NR > 1 && index($1, p) {
			split($0, a, " "); stmts = a[2]; count = a[3]
			key = $1
			if (!(key in seen)) { seen[key] = 1; total += stmts; if (count > 0) covered += stmts }
			else if (count > 0 && !(key in hit)) { covered += stmts }
			if (count > 0) hit[key] = 1
		}
		END { if (total == 0) print "0"; else printf "%.1f", 100 * covered / total }' "$profile")
	if awk -v a="$pct" -v m="$MIN" 'BEGIN { exit !(a < m) }'; then
		echo "cobertura $pkg: $pct% (mínimo $MIN%) FALHOU"
		fail=1
	else
		echo "cobertura $pkg: $pct%"
	fi
done
exit $fail
