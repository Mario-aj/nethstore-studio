// Package fonts embeds the stamp font (Work Sans Medium, SIL OFL 1.1, see OFL.txt).
package fonts

import _ "embed"

// WorkSansMedium is the TTF used to draw the stamp.
//
//go:embed WorkSans-Medium.ttf
var WorkSansMedium []byte
