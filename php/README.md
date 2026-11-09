# PHP / MySQL deployment

This is a separate backend for PHP 8.3 with PDO MySQL and an InnoDB MySQL-compatible database. It shares the frontend and checklist template with the Node version, but starts with a **new database**. It does not import the local SQLite data.

## Before touching the existing site

1. Rotate any credentials that have been shared in chat. Use xneelo File Manager or another encrypted transfer method; do not use plain FTP.
2. Obtain and verify a restorable backup of **both** the existing WordPress files and its database. Confirm the backup covers uploads and configuration, and test restoration separately. Do not remove WordPress until the backup is verified and you are ready for the cutover.
3. Confirm the domain has a valid HTTPS certificate, Apache rewrite support, PHP 8.3 with `pdo_mysql`, a directory outside the web root, and a separate empty MySQL database. Confirm your host's document root and backup/restore procedure; these vary by account.
4. Put the site behind a team-only access gateway, VPN, or equivalent protection before exposing it. The app login is not a substitute for a hardened public deployment. Test the gateway and HTTPS before entering real data. Make sure gateway authentication is compatible with browser API requests.

## Prepare the database and files

The following paths are examples. Replace `public_html` with the actual domain document root. `grogu-private` **must be a sibling of the document root**, not inside it; if your host cannot support this layout, do not deploy until the private directory is safely arranged and `public/api.php` is adjusted.

1. Create a separate empty database and database user. Give the app user only the privileges needed on that database: `SELECT`, `INSERT`, `UPDATE`, and `DELETE`. Import [schema.sql](schema.sql) into that database using the hosting database tool. The import needs a user with table-creation privileges. Do not import it into the WordPress database.
2. Create `grogu-private` outside the document root. Copy `php/grogu-private/api.php` and the repository's `template.json` into it. Copy `php/config.example.php` to `grogu-private/config.php`.
3. Edit the private `config.php` through the host's secure file manager. Set the database host, port, name, username and password. Set `base_url` to the exact HTTPS origin, with no trailing slash or path, for example `https://grogu.example.com`.
4. Set `setup_key` to **64 random lowercase hexadecimal characters**. Generate it locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and keep it private. Do not use the example placeholder. Leave `allow_insecure_local` set to `false`.
5. After the WordPress backup has been verified and the cutover is approved, put `public/index.html`, `public/app.js`, `public/styles.css`, `php/public/api.php`, and `php/public/.htaccess` into the domain's document root. Ensure the old WordPress `.htaccess` and entry points do not intercept requests; preserve the verified backup rather than overwriting it. Do not upload the database configuration, schema, repository, spreadsheet, or backups into the public directory.
6. Confirm `https://your-domain/api/session` returns JSON and that attempts to access the private directory, configuration, SQL files and backups through the web return 404 or 403. If any private file is downloadable, remove public access immediately. Check that the host actually applies `.htaccess` rewrite and security-header rules. Enable HTTPS redirects at the hosting layer; the API refuses HTTP outside explicit localhost testing.
7. Behind the access gateway, open the site and create the initial administrator using the private setup key. The key is required to initialize the workspace, and setup is disabled once an account exists. Store or remove the key securely after setup; keep a valid 64-character key in configuration because the application validates it on startup.
8. Add team members, share temporary passwords securely and have them change their passwords. Test creating, editing and deleting a disposable project and verify persistence after signing out and in. Set up and test regular database backups and a recovery procedure before storing real data.

Only administrators can add or remove team accounts. All signed-in users can edit/delete projects and all role sign-offs; they are not identity-verified approvals. Login attempts are limited per source address in MySQL. A reverse proxy must not be used to fake client addresses; if all requests appear to originate from one proxy, the rate limit is shared. Password recovery and invitation email are not implemented.

## Local integration test

`npm test` runs the Node tests and skips the PHP test unless `GROGU_MYSQL_TEST_PORT` is set. The PHP test connects as root with a blank password to a **fresh disposable** database called `grogu_test` on `127.0.0.1`. It creates users and projects there. Never point it at real data. Load `schema.sql` into the empty database first.

For a Windows PHP installation where `pdo_mysql` is not enabled by default, set `GROGU_PHP_EXTENSION_DIR` to the PHP extension directory; the test enables that extension for its PHP server. Then set `GROGU_MYSQL_TEST_PORT` to the disposable server's port and run `npm test`.
