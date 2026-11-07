# Standardized YOLO & Google Justfile
# Toolchain: Pure Bun v1.4.4+ & Rust 2024 (Zero Node.js)

set shell := [ pwsh, -NoProfile, -Command]
set windows-shell := [pwsh, -NoProfile, -Command]

default:
    @just --list

# Typecheck workspace
check:
    @bun check

# Lint workspace
lint:
    @bun lint

# Run test suites
test:
    @bun test

# Format code
fmt:
    @bun fmt

# Purge caches and build artifacts
clean:
    @Remove-Item -Path ./dist, ./.tmp, ./.cache -Recurse -Force -ErrorAction SilentlyContinue
    @git worktree prune
