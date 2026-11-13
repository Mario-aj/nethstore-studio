// Package migrations embeds the SQL migrations applied at startup.
package migrations

import "embed"

// FS holds the numbered *.sql migration files.
//
//go:embed *.sql
var FS embed.FS
