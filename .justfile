# modelgen — task runner. Run `just` to list recipes.
# Install just: `brew install just`

set shell := ["bash", "-uc"]

# Show available recipes (default).
default:
    @just --list

# --- Develop -------------------------------------------------------------

# Run the test suite.
test *ARGS:
    bun test {{ARGS}}

# Type-check sources, tests and scripts.
typecheck:
    bun run typecheck

# Run the CLI from source: just run describe shapes
run *ARGS:
    bun run src/cli/bin.ts {{ARGS}}

# Build the npm package into dist/ (runs under Node).
build-npm:
    bun run build:npm

# Build standalone binaries into dist/release (all targets, or some: just build-bin darwin-arm64).
build-bin *TARGETS:
    bun run scripts/build-binaries.ts {{TARGETS}}

# --- Release -------------------------------------------------------------

# Lint the Homebrew formula CI will publish (style checks).
lint:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v brew >/dev/null || { echo "✗ install Homebrew to lint the formula: https://brew.sh" >&2; exit 1; }
    # Render under a Formula/ dir so `brew style` applies the formula cops.
    # Version/checksums are placeholders; neither affects style.
    tmp="$(mktemp -d)"
    trap 'rm -rf -- "$tmp"' EXIT
    mkdir -p "$tmp/Formula"
    for t in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
        printf '%064d  modelgen-0.0.0-%s.tar.gz\n' 0 "$t"
    done > "$tmp/SHA256SUMS"
    ./scripts/render-formula.sh 0.0.0 "$tmp/SHA256SUMS" > "$tmp/Formula/modelgen.rb"
    brew style "$tmp/Formula/modelgen.rb"
    echo "✓ formula lint clean"

# Bump the version, commit, tag, and push — triggers the Release workflow.
# Optional notes (Markdown) go into the annotated tag and appear at the top of
# the GitHub Release, above the auto-generated changelog.
# Usage: just tag 0.3.0
#        just tag 0.3.0 "Adds the creature kit."
#        just tag 0.3.0 "$(cat notes.md)"
tag version $notes="":
    #!/usr/bin/env bash
    set -euo pipefail
    ver="{{version}}"
    if ! [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "✗ version must look like 0.3.0 (got '$ver')" >&2; exit 1
    fi
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "✗ working tree not clean — commit or stash first." >&2; exit 1
    fi
    if git rev-parse "v$ver" >/dev/null 2>&1; then
        echo "✗ tag v$ver already exists." >&2; exit 1
    fi
    # Pre-flight: lint the formula CI will publish, so style problems are
    # caught here — before anything is tagged or pushed.
    just lint
    # package.json and src/version.ts must agree (a test and the release
    # workflow both check it).
    node -e 'const fs=require("fs"),f="package.json";fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/"version": "[^"]*"/,`"version": "${process.argv[1]}"`))' "$ver"
    printf 'export const VERSION = "%s";\n' "$ver" > src/version.ts
    bun test test/cli.test.ts >/dev/null
    git add package.json src/version.ts
    git commit -m "Release v$ver"
    # `notes` arrives as an environment variable (the `$` on the parameter), so
    # quotes, backticks, and newlines in it pass through untouched.
    if [[ -n "${notes//[[:space:]]/}" ]]; then
        git tag -a "v$ver" --cleanup=verbatim -m "$notes"
    else
        git tag "v$ver"
    fi
    git push origin HEAD
    git push origin "v$ver"
    echo "✓ Pushed v$ver — CI will build, test, release, publish to npm and update the tap."

# One-time: create a write-scoped deploy key for the tap and store its private
# half as a secret in this repo, so CI can push the formula. Needs gh (authed).
# Usage: just setup-tap-key
setup-tap-key:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v gh >/dev/null || { echo "✗ install gh first: brew install gh" >&2; exit 1; }
    umask 077
    tmp="$(mktemp -d)"
    trap 'rm -rf -- "$tmp"' EXIT
    ssh-keygen -t ed25519 -N "" -C "modelgen release CI" -f "$tmp/key" >/dev/null
    gh repo deploy-key add "$tmp/key.pub" \
        -R Guilospanck/homebrew-tap \
        --title "modelgen release CI" \
        --allow-write
    if ! gh secret set HOMEBREW_TAP_DEPLOY_KEY \
        -R Guilospanck/modelgen < "$tmp/key"; then
        echo "✗ Failed to store the private key; removing the deploy key from homebrew-tap." >&2
        public_key="$(awk '{print $1 " " $2}' "$tmp/key.pub")"
        key_id="$(gh repo deploy-key list \
            -R Guilospanck/homebrew-tap \
            --json id,key \
            --jq ".[] | select(.key == \"$public_key\") | .id" || true)"
        if [[ -n "$key_id" ]] && gh repo deploy-key delete "$key_id" -R Guilospanck/homebrew-tap; then
            echo "✓ Removed the deploy key." >&2
        else
            echo "⚠ Could not remove the deploy key automatically; remove it from homebrew-tap manually." >&2
        fi
        exit 1
    fi
    echo "✓ Deploy key added to homebrew-tap (write) and stored as HOMEBREW_TAP_DEPLOY_KEY."

# --- Housekeeping --------------------------------------------------------

# Remove build output.
clean:
    rm -rf dist out examples/out examples/previews
    @echo "✓ Cleaned dist/ and example outputs"
