# Publishing a release

The repository uses a tag-driven GitHub Actions workflow. Before tagging, update `package.json`/lockfile versions, the default image version in `setup.sh` and `.env.example`, installation examples and `docs/releases/vX.Y.Z.md`. Review the intended diff, run `npm run check`, `npm run format:check`, `npm run test:e2e`, shell syntax checks and `npm run security:check`. Commit and push main, then push a stable `vX.Y.Z` tag matching package.json.

The Release workflow calls CI, builds images on native AMD64/ARM64 runners, pushes architecture-specific tags, pulls/starts each image, creates the combined version and latest tags, and publishes the GitHub release archive/checksums. Actions are pinned to immutable commit SHAs. GHCR publishing uses the workflow GITHUB_TOKEN with packages:write; no registry password is stored in the repository.

After the first publication, verify the GHCR package visibility. If GitHub initially creates it private, change it to Public in the package settings. Verify that an unauthenticated client can pull the versioned image and that its manifest includes both architectures. Test the downloaded installer from a clean directory against disposable storage. Verify the release checksum, tag SHA, workflow outcome and release links before announcing availability. Do not retag an already released version to different source.

Local runtime configuration, database files, backups, logs and test output remain excluded from Git, Docker build context and the git-archive release bundle. Release archives intentionally contain the full tracked source and documentation; they never include `.env` or a preconfigured user account.
