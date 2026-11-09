# GitHub Pages and Supabase

This deployment is separate from the local Node/SQLite and PHP/MySQL versions. It starts with a fresh Supabase database and does not migrate local users or projects.

## Required configuration

Use a **dedicated** Supabase project. Do not apply these changes to a project used by another app: the team function creates and deletes Supabase Auth users, and auth settings affect the whole project. Back up the project before applying a migration.

1. Apply `supabase/migrations/20261109100000_grogu.sql` to the dedicated project. It creates Grogu tables, row-level policies and an atomic project-creation function. Only accounts explicitly listed in `grogu_members` can access data, even if an unapproved account exists in Supabase Auth.
2. In Authentication settings, disable public sign-ups and anonymous sign-ins. Enable email/password authentication and set up custom SMTP for invitations. Confirm Supabase supports admin invitations with your sign-up settings in the hosted project; test a real invitation before launch.
3. Configure the Supabase Site URL and permitted redirect URL as `https://jonathandevoypcd.github.io/Grogu/` (use the actual Pages URL and exact casing). Deploy `supabase/functions/team` with JWT verification enabled, and set its `GROGU_SITE_URL` secret to that exact URL. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never put the service-role key in the browser, repository, or GitHub variables.
4. Bootstrap the first administrator manually in the Supabase dashboard: create an Auth user with a strong password, copy that user's UUID, then insert a matching row in `public.grogu_members` through the SQL editor with that UUID, name, email and `role = 'admin'`. Handle the initial password securely. There is deliberately no public administrator setup endpoint.
5. In GitHub repository variables, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the project's URL and **publishable** (or legacy anon) key. These values are public and embedded in the frontend. Never use a secret or service-role key. Configure GitHub Pages to deploy using GitHub Actions. The workflow builds with the repository base path `/Grogu/`.
6. Confirm login, invitation and password setup, project operations, and removal. Test anonymous and non-member access to every Grogu table and RPC; test that members cannot elevate their own roles or invoke the admin team function. Test that removing a user blocks their database access even before their access token expires. Verify redirects and email delivery. Do not use real data until those checks pass.

All approved team members can view and edit all projects and sign-offs. Admins can invite or remove members, including other admins. The app does not provide ownership-based permissions or identity-verified sign-offs. Supabase enforces access through database policies; GitHub repository visibility does not protect the website or database.

For local builds, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then run `npm run build:cloud`. The bundle contains those public values. The cloud app is not served by `npm start`.
