# Optional activity per project

This feature is **off for every existing and newly discovered project**. It adds explicitly configured application checks after a successful normal heartbeat. It is separate from the normal Management API / HEAD strategy and never changes another project's configuration.

## Choose a mode

| Mode                                         | Requests per execution                                                                 | Credentials                                                             | Local data retention                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Off (default)                                | None beyond the normal heartbeat                                                       | None                                                                    | No additional data                                                               |
| Public read                                  | 1–3 GET requests, each selecting one safe column with `limit=1`                        | An existing publishable key fetched using authorized Management OAuth   | Row count/status/timing only; selected values discarded                          |
| Test-account sign-in → read → local sign-out | One password sign-in, 1–3 bounded GET reads using that session, one local-scope logout | The publishable key plus an existing dedicated test account you provide | Test account credentials encrypted; no Auth tokens or returned row values stored |

These are real requests, not fabricated success records or disguised user traffic. No website is opened in a hidden browser, no User-Agent camouflage is added, and traffic does not escalate automatically. Neither mode proves that Supabase's automatic project pausing will be prevented. Read [the pausing evidence](project-pausing.md).

## 1. Enable the optional capability

In **Settings → Supabase integration**, opt into Data API access. The registered OAuth application needs **Secrets Read** (`secrets:read`) in addition to Projects Read and Database Read. Disconnect before changing registration configuration, save your own client credentials with the opt-in enabled, and reconnect to grant the updated permissions.

This provider scope is broad. SupaBeacon lists key metadata with `reveal=false`, retrieves only a key explicitly typed publishable by its ID, and never fetches service-role/secret key values. If no existing publishable key exists, the check fails. Enabling this capability alone does not activate extra traffic on any project.

## 2. Configure one project

1. Open **Projects → your project → Optional project activity**.
2. Choose **Read one safe column** or **Test-account sign-in → read → local sign-out**.
3. Enter an **existing safe table** in the exposed default schema and a **small, nonsensitive column**, such as an ID. Wildcards, arbitrary SQL, RPCs and arbitrary URLs are not supported.
4. Select **1–3 additional reads per execution**.
5. Enable **additional activity for this project**, then save.
6. Run **Run heartbeat / test connection** and wait for the final result. Execution details distinguish the normal heartbeat, each additional read, sign-in and sign-out.

Existing RLS and column/table grants remain in effect. An empty result may be legitimate under RLS or for an empty table. SupaBeacon does not create a table, expose a private table, alter RLS or modify rows. Result validation requires at most one row containing only the selected column, and caps the JSON response at 64 KiB. Values are not written to SQLite or logs; they are discarded after validation. This is not a claim of cryptographic memory erasure.

## 3. Test-account sign-in, if selected

Use an **existing dedicated test account** in that project's Supabase Auth service, with minimal privileges/RLS access and a unique password. Do not use your personal, administrator or a production customer's account. SupaBeacon does not register or delete users. You explicitly confirm that newly entered credentials belong to a test account you control.

Enter its email and password in the project form. Both are write-only and encrypted using the instance's AES-GCM vault. Leave both blank when saving other settings to retain them. **Remove test credentials** clears the saved account credentials and disables optional activity; it does not delete the remote user.

The server uses the documented [password sign-in flow](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), passes the new access JWT to the bounded table reads, and requests [sign-out with scope=local](https://supabase.com/docs/reference/javascript/auth-signout). This targets only the new session, never the account's other sessions. Refresh tokens are discarded and never used. Access JWTs remain valid until their normal expiry even after logout; SupaBeacon does not persist them.

MFA, CAPTCHA, OTP, SSO and social login challenges are not automated or bypassed. A detected verified MFA factor stops the read and attempts cleanup of the issued low-assurance session. Password sign-in can fail if the account/project requires an unsupported flow. Login errors are recorded once, not repeatedly retried. Auth requests create real audit/login events, may invoke provider/application login hooks and can affect quotas or billing. The test account must be suitable for this use.

## Cleanup failures and restarts

Before attempting a sign-in, SupaBeacon durably marks that a new session may exist. A confirmed local logout clears the mark. Cleanup is attempted even if a table request fails, monitoring is paused or a rate-limit cooldown was recorded. A failed logout, lost sign-in response or process crash leaves a visible **session review required** condition, which blocks further test sign-ins for that project.

Review/revoke the dedicated account's uncertain session through your normal Supabase Auth administration or test client before checking **I have reviewed/revoked…** in SupaBeacon and saving. Consult the official session/sign-out documentation; if using your own test client to revoke all sessions, do so explicitly for that dedicated test account only. Clearing the local review block does not itself revoke anything remotely. The app never silently performs global logout or user deletion.

There is no promise of successful cleanup after network/power loss. A pending review is deliberately preserved across application restarts. After restoring an older backup, review the dedicated account’s remote sessions too: restoring local history cannot roll back remote Auth state. You can disable the extra activity while investigating, and the normal heartbeat remains independently configured.

## Counts and budgets

If the project runs twice daily and you select two additional reads:

- Public mode adds four database GET requests daily.
- Test-account mode adds those four reads plus two sign-ins and two sign-outs daily.
- Existing normal heartbeat requests, status checks, key lookups, manual runs and normal heartbeat retries remain separate.

Optional activity runs once after a complete successful heartbeat, not once per heartbeat request. Failed primary heartbeats skip the optional flow. Additional activity requests are not retried automatically; error details are visible. History records request kind, HTTP status, duration, row count and sanitized error codes. A sign-in alone never counts as a successful database read. A failed extra step makes the overall execution failed while preserving confirmed primary database success.

## Verification boundary

Both modes, credential encryption/redaction, per-project isolation, cleanup on errors/pause/rate limits, bounded response validation and session-review blocking are exercised with controlled provider responses. Real Auth test credentials and a safe Data API table have not been supplied for live verification. The user's existing projects remain on their previous configuration with extra activity disabled.

Rejected credentials and detected MFA requirements block future test sign-ins until new test-account credentials are explicitly saved. This block is distinct from uncertain session cleanup. Session-review acknowledgement cannot be saved while that project is executing.
