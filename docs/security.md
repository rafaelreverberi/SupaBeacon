# Security

The maintained threat model and implementation controls are in [SECURITY.md](../SECURITY.md). Read that document before exposing an instance over a network. The installation and OAuth guides describe canonical origins, TLS, proxy trust and SSH tunnels.

Diagnostic reports and log exports contain project metadata and operational history. They intentionally exclude provider tokens, credentials, session cookies and SQL results, but review metadata before sharing publicly.
