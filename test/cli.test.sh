#!/usr/bin/env bash
# CLI-level checks for glowmaid. Strips ANSI so assertions are readable.
# Exercises the working copy next to this script, not $PATH.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GLOWMAID="$ROOT/glowmaid"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
cd "$DIR"

pass=0; fail=0
run() { node "$GLOWMAID" "$@" 2>&1 | sed $'s/\x1b\\[[0-9;]*m//g'; }

check() { # name, haystack, needle
  if printf '%s' "$2" | grep -qF -- "$3"; then
    printf '  ok   %s\n' "$1"
  else
    fail=$((fail+1)); printf '  FAIL %s\n       wanted: %s\n' "$1" "$3"
    printf '%s\n' "$2" | head -12 | sed 's/^/       | /'
  fi
}
refute() {
  if printf '%s' "$2" | grep -qF -- "$3"; then
    fail=$((fail+1)); printf '  FAIL %s\n       should not contain: %s\n' "$1" "$3"
  else
    printf '  ok   %s\n' "$1"
  fi
}

# ---------------------------------------------------------------- fixtures
cat > simple.md <<'EOF'
# Title

```mermaid
graph LR
  A[Alpha] --> B[Beta]
```
EOF

cat > nomermaid.md <<'EOF'
# Plain

```bash
echo hello
```

Text with **bold**.
EOF

cat > tilde.md <<'EOF'
# Tilde

~~~mermaid
graph LR
  X --> Y
~~~
EOF

cat > fourtick.md <<'EOF'
# Four

````mermaid
graph LR
  P --> Q
````
EOF

cat > indented.md <<'EOF'
# List

- step one

  ```mermaid
  graph LR
    M --> N
  ```

- step two
EOF

cat > unterminated.md <<'EOF'
# Unterminated

```mermaid
graph LR
  U --> V
EOF

cat > unsupported.md <<'EOF'
# Unsupported

```mermaid
xychart-beta
    title "Sales"
```

after text
EOF

cat > empty.md <<'EOF'
# Empty

```mermaid
```

done
EOF

cat > two.md <<'EOF'
# Two

```mermaid
sequenceDiagram
    A->>B: ping
```

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Running: go
```
EOF

printf '# No trailing newline\n\n```mermaid\ngraph LR\n  Z --> W\n```' > nonl.md

printf '# CRLF\r\n\r\n```mermaid\r\ngraph LR\r\n  C --> D\r\n```\r\n' > crlf.md

# Cylinder shape: renderers tear on it, so glowmaid degrades it by default.
cat > shapes.md <<'EOF'
# Shapes

```mermaid
graph TD
  A[Source] --> E[(Database)]
```
EOF

echo "=== input modes ==="
out=$(run -w 0 -s light simple.md)
check "file arg renders" "$out" "┌───────┐"
check "file arg keeps markdown" "$out" "Title"
refute "mermaid fence consumed" "$out" '```mermaid'

out=$(cat simple.md | run -w 0 -s light)
check "stdin renders" "$out" "┌───────┐"

out=$(cat simple.md | run -w 0 -s light -)
check "stdin with dash renders" "$out" "┌───────┐"

echo "=== passthrough (no mermaid) ==="
out=$(run -w 0 -s light nomermaid.md)
check "no-mermaid file via glow" "$out" "echo hello"
out=$(cat nomermaid.md | run -w 0 -s light)
check "no-mermaid stdin via glow" "$out" "echo hello"

echo "=== fence dialects ==="
check "tilde fence" "$(run -w 0 -s light tilde.md)" "┌───┐"
check "four-backtick fence" "$(run -w 0 -s light fourtick.md)" "┌───┐"
out=$(run -w 0 -s light indented.md)
check "indented fence renders" "$out" "┌───┐"
check "list item preserved" "$out" "step two"
check "unterminated fence renders" "$(run -w 0 -s light unterminated.md)" "┌───┐"

echo "=== fallback note ==="
out=$(run -w 0 -s light unsupported.md)
check "unsupported shows source" "$out" "xychart-beta"
check "unsupported shows note" "$out" "shown as source"
check "unsupported note names type" "$out" "mermaid (xychart-beta)"
check "text after block survives" "$out" "after text"
out=$(run -w 0 -s light empty.md)
check "empty block noted" "$out" "shown as source"
check "text after empty survives" "$out" "done"

echo "=== multiple diagrams ==="
out=$(run -w 0 -s light two.md)
check "sequence rendered" "$out" "ping"
check "state rendered" "$out" "Idle"
check "state completed" "$out" "Running"

echo "=== misc input ==="
check "no trailing newline" "$(run -w 0 -s light nonl.md)" "┌───┐"
out=$(run -w 0 -s light crlf.md)
check "crlf renders" "$out" "┌───┐"
refute "crlf no stray CR" "$out" $'\r'

echo "=== flags ==="
out=$(run -s dark -w 60 simple.md)
check "value flag -s dark" "$out" "┌"
out=$(run --style=dark --width=60 simple.md)
check "equals-form flags" "$out" "┌"
out=$(run -w 0 -s light -- nonexistent.md)
check "dashdash passthrough" "$out" "nonexistent"
out=$(run -w 0 -s light /tmp)
check "directory passthrough" "$out" "tui"
out=$(run --version)
check "--version passthrough" "$out" "glow"
out=$(run --help)
check "--help passthrough" "$out" "Render markdown"

echo "=== env vars ==="
out=$(export GLOWMAID_BACKEND=merman GLOWMAID_NO_CACHE=1; run -w 0 -s light simple.md)
check "GLOWMAID_* forces merman" "$out" "╭"
out=$(export GLOWM_BACKEND=merman GLOWM_NO_CACHE=1; run -w 0 -s light simple.md)
check "legacy GLOWM_* still honoured" "$out" "╭"
out=$(export GLOWMAID_SHAPES=native GLOWMAID_NO_CACHE=1; run -w 0 -s light shapes.md)
check "GLOWMAID_SHAPES=native opt-out" "$out" "╰─Database─╯"
out=$(run -w 0 -s light shapes.md)
refute "default degrades cylinder" "$out" "╰─Database─╯"
check "default renders cylinder cleanly" "$out" "│ Database │"

out=$(run --clear-cache)
check "clear-cache" "$out" "glowmaid: cache cleared"

echo
printf "%s failed\n" "$fail"
[ "$fail" -eq 0 ]
