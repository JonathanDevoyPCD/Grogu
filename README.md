# Grogu

A self-hosted, shared website go-live checklist portal. New projects start with the **Template** sheet from the supplied workbook; the workbook's completed projects are not imported.

The original Node.js/SQLite version remains available for local use. A separate PHP 8.3/MySQL backend is available for compatible shared hosting; see [PHP deployment instructions](php/README.md). The two backends use separate databases and accounts, and data is not automatically migrated between them.

A separate GitHub Pages/Supabase version is being prepared; see [cloud setup](cloud/README.md). It uses its own Supabase data and does not automatically import data from either local backend.

## Run locally

Install Node.js 22.13 or newer (Node's built-in SQLite module may display an experimental warning), then run:

```powershell
npm start
```

Open `http://127.0.0.1:3000` and create the first administrator account. Only the first visitor can complete setup, so do this before exposing the service to other people. Administrators can add members from **Team members**. Share temporary passwords securely; each user can change their password using **Password** in the top bar.

Data is stored in `data\launchboard.sqlite` by default, not in the browser. The original filename is retained so existing data remains available after the rename. Back up the SQLite database consistently, including any active WAL data (for example, use SQLite's online backup API or stop the service before copying the database). Keep backups and the data directory private.

## Team deployment

Run the app on a persistent server, behind an HTTPS reverse proxy. Restrict access to your team (for example, through a VPN or access gateway); this is a small self-hosted application, not a fully hardened public identity service. Configure the proxy to pass the original `Host` header and only accept trusted traffic. Set `SECURE_COOKIES=true` when serving over HTTPS. Store the database on persistent local storage, and protect the process and database with operating-system permissions.

Environment variables:

- `HOST`: listening address, default `127.0.0.1`. Keep loopback when a local reverse proxy is used.
- `PORT`: listening port, default `3000`.
- `DATABASE_PATH`: database file path, default `data\launchboard.sqlite` in the application directory.
- `SECURE_COOKIES`: set to `true` behind HTTPS.

The application has basic per-process sign-in throttling; use the proxy or access gateway for stronger rate limiting. There is no email invitation or password recovery service. An administrator creates accounts and shares credentials out of band. Members can change their own passwords; removing a user revokes their sessions and clears their project assignments. All signed-in users can create, edit and delete projects and update any sign-off; sign-offs are role columns, not identity-verified approvals.

## Checklist behavior

Each project gets its own copy of the workbook's template checks, with separate Designer, Developer, Content Admin, Extra Tester, and Account Executive sign-offs plus notes. A check counts as complete once all five columns are ticked or it is marked N/A. N/A keeps existing sign-offs and restores them if unchecked. The project is ready to launch when every check is complete or N/A. Details and checkboxes save to the shared database; notes save when the field loses focus.

The template includes organization-specific checks from the workbook. Edit `template.json` before creating new projects if your team's process changes; existing projects retain their own copies. On PHP deployments, update the private copy of that file too.

## Tests

Run `npm test` for the Node server integration checks. PHP/MySQL integration checks are skipped unless an isolated test database is configured; see [PHP deployment instructions](php/README.md).
