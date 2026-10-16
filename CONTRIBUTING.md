# Contributing

Use Node.js 22.12+ and npm. Run `npm ci`, `npm run init`, `npm run check`, then `npx playwright install chromium` and `npm run test:e2e`. Tests inject Supabase responses; never commit real credentials. Run only one process per SQLite volume.

Keep changes focused and document user-visible behavior. Add meaningful tests for scheduler/security/provider changes, particularly retry, cancellation and restart behavior. Preserve the distinction between request success, confirmed database operations, provider project status and unverified pausing effectiveness. Do not add arbitrary SQL, arbitrary URL execution, service-role keys, RLS changes, fake traffic escalation, hidden telemetry or auto-publication.

SQLite schema changes require a new transactional migration version in storage.ts; do not rewrite a released migration. Shared settings validation belongs in packages/shared. Changes to provider APIs should cite current official documentation in the PR and retain least privilege.

Use test fixtures only in tests. No production demo seeding. UI controls must perform real persisted operations and remain keyboard accessible, responsive and usable with reduced motion. Review screenshots after visual changes.

Before submitting, run lint/typecheck/unit+integration/browser tests and the Docker smoke procedure in docs/verification.md. List live credentials/hardware that were not tested honestly. No production OAuth credentials should be required in CI. Follow SECURITY.md for private vulnerability reporting.
