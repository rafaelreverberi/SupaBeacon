# SupaBeacon einrichten: Erste Schritte

Diese Anleitung führt von der Installation bis zur ersten überprüften Datenbankabfrage. Jede Installation benötigt **einmal** eine eigene Supabase-OAuth-Anwendung. Einzelne Projekte musst du danach nicht manuell hinzufügen.

## 1. SupaBeacon starten

Im heruntergeladenen Projektordner:

```bash
chmod +x setup.sh
./setup.sh
```

Wähle einen freien Port, Netzwerkzugriff und Zeitzone. Öffne anschließend die angezeigte Adresse. Standard ist `http://localhost:8080`.

Bei einem NUC bedeutet `localhost` immer den Rechner, auf dem dein Browser läuft. Für Zugriff vom PC auf den NUC nutze einen SSH-Tunnel oder eine HTTPS-Adresse mit vertrauenswürdigem Zertifikat. Eine unverschlüsselte HTTP-LAN-Adresse ist für den OAuth-Callback ungeeignet. Beispiele stehen in der [Installationsanleitung](installation.md#canonical-origin-and-reverse-proxy).

## 2. Lokalen Administrator erstellen

Öffne die private `.env` auf dem Server und lies `SETUP_TOKEN`. Gib diesen einmaligen Einrichtungscode im Dashboard ein und lege Benutzername sowie ein eigenes Passwort mit mindestens zwölf Zeichen fest. Dieser Administrator gehört zu SupaBeacon, nicht zu Supabase.

Teile `.env` und Passwörter nicht öffentlich. Die Datei enthält auch den Schlüssel zum Entschlüsseln deiner gespeicherten OAuth-Verbindung.

## 3. Callback kopieren

Öffne **Settings → Supabase integration** und kopiere die angezeigte **Callback URL** vollständig, beispielsweise:

```text
http://localhost:8080/api/oauth/callback
```

Verwende genau diesen Wert, einschließlich Port und Pfad. Die Startseite ohne `/api/oauth/callback` reicht nicht aus.

## 4. OAuth-Anwendung bei Supabase registrieren

Im [Supabase Dashboard](https://supabase.com/dashboard): Organisation auswählen → **Settings → OAuth Apps → Add application**. Gemeint sind die Einstellungen der Organisation, nicht „Authentication“ in einem einzelnen Projekt.

| Formularfeld                | Eintrag                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Application name            | `SupaBeacon` oder beispielsweise `SupaBeacon — Mein NUC`                                                                                                                                                                 |
| Website URL                 | Die Homepage deiner Installation. Für einen lokalen Test `http://localhost:8080`; falls das Website-Feld eine öffentliche HTTPS-Adresse verlangt, eine tatsächliche Projekt-/Dokumentationsseite unter deiner Kontrolle. |
| Authorization callback URLs | Die in Schritt 3 kopierte Callback-URL                                                                                                                                                                                   |
| Database                    | **Read** / **Read-only**                                                                                                                                                                                                 |
| Projects                    | **Read** / **Read-only**                                                                                                                                                                                                 |
| Alle anderen Berechtigungen | **No access**                                                                                                                                                                                                            |
| Upload logo                 | Optional: die unten verlinkte PNG auswählen                                                                                                                                                                              |

Das mitgelieferte Logo findest du hier: [SupaBeacon_Logo.png](../apps/web/public/branding/SupaBeacon_Logo.png). Im laufenden Dashboard gibt es unter **Settings → Supabase integration** ebenfalls einen Download-Link. Das Original wird unverändert mitgeliefert.

Bestätige das Formular bei Supabase. Kopiere anschließend **Client ID** und **Client Secret** aus der neu angelegten Anwendung. Falls das Secret nur einmal angezeigt wird, sichere es privat.

## 5. Verbindung herstellen

1. Zurück zu **SupaBeacon → Settings → Supabase integration**.
2. Client-ID und Client-Secret einfügen.
3. **Enable optional Data API strategy** zunächst ausgeschaltet lassen.
4. **Save OAuth configuration**, danach **Connect Supabase** wählen.
5. Bei Supabase anmelden, die gewünschte Organisation auswählen und die angezeigten Leseberechtigungen genehmigen.
6. Nach der Rückkehr sollte SupaBeacon **Connected** anzeigen und die freigegebenen Projekte automatisch laden.

Hier gehören keine Datenbankpasswörter, Projekt-API-Keys oder Service-Role-Keys hinein. Die gesamte Formulareinrichtung ist zusätzlich mit Beispielen und Fehlerbehebung in der [ausführlichen OAuth-Anleitung](oauth-setup.md) beschrieben.

## 6. Einen Heartbeat überprüfen

Öffne unter **Projects** ein aktives Projekt und wähle **Run heartbeat / test connection**. Warte auf das endgültige Ergebnis:

- **Running**: Die Ausführung läuft noch.
- **Success / Database operation succeeded**: Die erwartete Datenbankantwort wurde geprüft.
- **Failed**: Fehlercode und Einzelversuche in der Historie bzw. unter Logs ansehen.

Ein „Success“ bedeutet **nicht**, dass Supabase das Projekt garantiert nicht pausieren wird. [Was wir wissen, was unbestätigt ist und welche Alternativen es gibt](project-pausing.md).

## 7. Port später ändern

Für direkten HTTP-Zugriff genügt im Standardmodus beispielsweise:

```dotenv
DASHBOARD_PORT=84
```

Danach im Projektordner:

```bash
docker compose up -d --force-recreate --wait
```

Die HTTP-Zugriffsadresse und die Callback-URL in SupaBeacon folgen dem neuen Port automatisch. Aktualisiere danach die Callback-URL auch in deiner registrierten **Supabase OAuth App**. SupaBeacon kann diese Registrierung nicht für dich ändern.

HTTPS-Adressen hinter einem Reverse Proxy bleiben unverändert. Für einen SSH-Tunnel mit einem anderen lokalen Port verwende `APP_URL_MODE=explicit`. Port 84 muss auf dem Server frei und durch Docker nutzbar sein; bei Rootless Docker können niedrige Ports eingeschränkt sein. [Alle Port-Beispiele](installation.md#changing-the-dashboard-port-later).

Projektkonfiguration, Verbindung und Historie bleiben im Docker-Volume erhalten. Zum Ändern des Ports niemals den Datenschlüssel neu erzeugen oder das Volume löschen.
