-- =====================================================================
-- Visionary AI — Row Level Security: deny-by-default
-- =====================================================================
--
-- WHAT THIS DOES
--   Locks the `anon` and `authenticated` Postgres roles out of every table
--   in the `public` schema, and out of the four storage buckets.
--
-- WHAT THIS DOES **NOT** DO
--   It does not change one thing about how the app behaves today.
--   backend/db.py builds its single global client with
--   SUPABASE_SERVICE_ROLE_KEY. The `service_role` role has BYPASSRLS, so it
--   ignores every policy below. That is deliberate and is the whole point:
--   the backend keeps working untouched.
--
--   It also does NOT fix authentication. `assert_admin()` in
--   backend/admin.py:13 trusts a client-supplied `requester_role` string, so
--   `GET /admin/patients?role=admin` still returns every patient record to an
--   unauthenticated caller. That is a FastAPI authorisation gap; RLS cannot
--   reach it. See "Security limitations (not implemented)" in CLAUDE.md.
--
-- WHY IT IS WORTH RUNNING ANYWAY
--   The anon key is not secret by design. Supabase's default privileges grant
--   anon full DML on the public schema, so with RLS off, anyone holding that
--   key reads every patient IC number, every staff_users.password_hash, and
--   every password_reset_otps.otp_code — the last of which is a complete
--   staff-account takeover (read the OTP, then call /auth/reset-password).
--   The key is not in this repo and the React app never talks to Supabase
--   directly, so this is a latent hole, not an open door. This migration is
--   the wall behind that door.
--
-- HOW TO RUN
--   Paste into the Supabase SQL editor and run. Idempotent — safe to re-run.
--   Read section 6 first; it is commented out on purpose.
--
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. PRE-FLIGHT (read-only — run these first and read the output)
-- ---------------------------------------------------------------------

-- 0a. Which tables currently have RLS on? Expect all `false` before this runs.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- 0b. Are the RAG RPCs SECURITY DEFINER?
--
--     This matters in one direction only. RAG retrieval is safe either way,
--     because backend/agents/tools/guideline_retrieval.py calls the RPC as
--     service_role, which bypasses RLS regardless of INVOKER/DEFINER.
--
--     The risk is the reverse: if match_documents IS security definer, then
--     enabling RLS on `documents` will NOT stop anon reading your guideline
--     chunks through the function, because it runs as its owner. Section 4
--     revokes EXECUTE, which closes that whichever way this comes back.
--
--     NOTE: `match_ai_results` is exposed by PostgREST but is referenced
--     nowhere in this repo. It is undocumented in CLAUDE.md. Dead, but
--     callable — so it gets revoked too.
select p.proname,
       p.prosecdef                                    as is_security_definer,
       pg_get_function_identity_arguments(p.oid)      as args,
       pg_get_userbyid(p.proowner)                    as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('match_documents', 'match_ai_results');

-- 0c. Any pre-existing storage policies that section 5 should know about?
select policyname, permissive, roles, cmd, qual
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- 0d. Current public/private state of the buckets. Expect all `true` for now.
select id, name, public from storage.buckets order by id;


-- ---------------------------------------------------------------------
-- 1. TABLES — enable RLS + revoke grants + restrictive deny policy
-- ---------------------------------------------------------------------
--
-- Three deliberate choices, so a reviewer knows they were not accidents:
--
--   * `as restrictive`, not permissive. Permissive policies are OR'd
--     together, so a stray `create policy ... using (true)` added later
--     would silently reopen the table. Restrictive policies are AND'd and
--     cannot be overridden by adding a permissive one.
--
--   * `revoke all` in addition to RLS. PostgREST then refuses at the grant
--     layer, before RLS is even consulted. Does not affect service_role.
--
--   * No `force row level security`. That only subjects the table *owner*
--     to RLS, which is not the threat here, and adds surprising behaviour.
--
-- There are no exceptions. Every table denies anon and authenticated
-- outright. Nothing below is softened to make any app feature pass.

-- staff_users — email, bcrypt password_hash, role, staff_id, name
alter table public.staff_users enable row level security;
revoke all on public.staff_users from anon, authenticated;
drop policy if exists "staff_users_deny_anon" on public.staff_users;
create policy "staff_users_deny_anon" on public.staff_users
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- employee_registry — controls who is allowed to register at all
alter table public.employee_registry enable row level security;
revoke all on public.employee_registry from anon, authenticated;
drop policy if exists "employee_registry_deny_anon" on public.employee_registry;
create policy "employee_registry_deny_anon" on public.employee_registry
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- patients — name, ic_passport, contact, full clinical history
alter table public.patients enable row level security;
revoke all on public.patients from anon, authenticated;
drop policy if exists "patients_deny_anon" on public.patients;
create policy "patients_deny_anon" on public.patients
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- screening_sessions
alter table public.screening_sessions enable row level security;
revoke all on public.screening_sessions from anon, authenticated;
drop policy if exists "screening_sessions_deny_anon" on public.screening_sessions;
create policy "screening_sessions_deny_anon" on public.screening_sessions
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- retinal_images — storage paths to patient retinal scans
alter table public.retinal_images enable row level security;
revoke all on public.retinal_images from anon, authenticated;
drop policy if exists "retinal_images_deny_anon" on public.retinal_images;
create policy "retinal_images_deny_anon" on public.retinal_images
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- ai_results — diagnoses, heatmap URLs, generated clinical reports
alter table public.ai_results enable row level security;
revoke all on public.ai_results from anon, authenticated;
drop policy if exists "ai_results_deny_anon" on public.ai_results;
create policy "ai_results_deny_anon" on public.ai_results
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- doctor_reviews — signed decisions, report URLs, clinical assessment
alter table public.doctor_reviews enable row level security;
revoke all on public.doctor_reviews from anon, authenticated;
drop policy if exists "doctor_reviews_deny_anon" on public.doctor_reviews;
create policy "doctor_reviews_deny_anon" on public.doctor_reviews
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- mc_certificates — issued medical certificates (serial mc_number)
alter table public.mc_certificates enable row level security;
revoke all on public.mc_certificates from anon, authenticated;
drop policy if exists "mc_certificates_deny_anon" on public.mc_certificates;
create policy "mc_certificates_deny_anon" on public.mc_certificates
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- appointments
alter table public.appointments enable row level security;
revoke all on public.appointments from anon, authenticated;
drop policy if exists "appointments_deny_anon" on public.appointments;
create policy "appointments_deny_anon" on public.appointments
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- password_reset_otps — highest-value table in the database.
-- Readable OTP codes are a direct path to taking over a staff account.
alter table public.password_reset_otps enable row level security;
revoke all on public.password_reset_otps from anon, authenticated;
drop policy if exists "password_reset_otps_deny_anon" on public.password_reset_otps;
create policy "password_reset_otps_deny_anon" on public.password_reset_otps
  as restrictive for all to anon, authenticated
  using (false) with check (false);

-- documents — LangChain vector store (ingested Malaysian CPG guidelines).
-- See section 4: the policy alone is not enough if match_documents is
-- SECURITY DEFINER.
alter table public.documents enable row level security;
revoke all on public.documents from anon, authenticated;
drop policy if exists "documents_deny_anon" on public.documents;
create policy "documents_deny_anon" on public.documents
  as restrictive for all to anon, authenticated
  using (false) with check (false);


-- ---------------------------------------------------------------------
-- 2. SEQUENCES — revoke (mc_certificates.mc_number is a serial)
-- ---------------------------------------------------------------------
-- Supabase's default privileges also grant sequence usage to anon.
-- Harmless once inserts are blocked, but left granted it leaks row counts.
do $$
declare seq record;
begin
  for seq in
    select schemaname, sequencename
    from pg_sequences
    where schemaname = 'public'
  loop
    execute format(
      'revoke all on sequence %I.%I from anon, authenticated',
      seq.schemaname, seq.sequencename
    );
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 3. FUTURE TABLES — stop new tables being granted to anon automatically
-- ---------------------------------------------------------------------
-- Without this, the next table created in the dashboard is once again
-- world-readable to anyone holding the anon key, and this whole migration
-- silently stops covering the schema.
--
-- Applies to objects created by the role running this statement (postgres,
-- which is also what the dashboard uses). service_role is untouched.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. RPC LOCKDOWN — match_documents / match_ai_results
-- ---------------------------------------------------------------------
-- Written as a loop over pg_proc rather than a literal signature, so it
-- works regardless of the exact argument types and covers overloads.
--
-- This is the statement that closes the SECURITY DEFINER hole flagged in
-- section 0b. The backend is unaffected: it calls these as service_role.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('match_documents', 'match_ai_results')
  loop
    execute format('revoke all on function %s from anon, authenticated', fn.sig);
    raise notice 'revoked execute on %', fn.sig;
  end loop;
end $$;

-- Future functions, same reasoning as section 3.
alter default privileges in schema public
  revoke all on functions from anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. STORAGE — restrictive deny on the four buckets
-- ---------------------------------------------------------------------
--
-- ⚠️  READ THIS. This policy does NOTHING while a bucket is public.
--
--     A public bucket serves files from /storage/v1/object/public/... which
--     bypasses RLS entirely, by design. So this policy is the backstop, and
--     section 6 (flipping the buckets private) is what actually closes the
--     exposure. Running section 5 without section 6 changes nothing.
--
-- The policy is scoped by bucket_id so it cannot affect any other bucket you
-- add later: for these four it evaluates false (denied); for anything else it
-- evaluates true and falls through to whatever policies you have.
--
-- RLS is already enabled on storage.objects in a default Supabase project;
-- the statement is here for completeness and is a no-op if so.
alter table storage.objects enable row level security;

drop policy if exists "deny_anon_clinical_buckets" on storage.objects;
create policy "deny_anon_clinical_buckets" on storage.objects
  as restrictive for all to anon, authenticated
  using (
    bucket_id not in ('retinal-scans', 'reports', 'medical-certificates', 'guidelines')
  )
  with check (
    bucket_id not in ('retinal-scans', 'reports', 'medical-certificates', 'guidelines')
  );


-- ---------------------------------------------------------------------
-- 6. MAKING THE BUCKETS PRIVATE — COMMENTED OUT ON PURPOSE
-- ---------------------------------------------------------------------
--
-- DO NOT UNCOMMENT THIS YET.
--
-- The backend currently fetches these files by opening the public link over
-- plain HTTP. Flip the buckets before the Part 2 code changes are deployed
-- and you will break, immediately:
--
--   backend/ai.py:158          AI analysis cannot download the retinal image
--   backend/screenings.py:690  re-emailing a saved report
--   backend/screenings.py:738  "Export as PDF"
--   backend/screenings.py:800  "Export MC as PDF"
--   retinal images + heatmaps go blank on the doctor and nurse screens
--
-- Correct order:
--   1. Deploy the Part 2 backend changes, restart uvicorn, and confirm the
--      app still works WHILE THE BUCKETS ARE STILL PUBLIC. Signed URLs work
--      on public buckets too, so this isolates code risk from toggle risk.
--   2. Then run these statements one at a time, verifying after each.
--
-- Equivalent to the dashboard's Storage -> <bucket> -> "Public bucket" toggle.
-- Rollback at any point: set public = true again. Instant, no data loss.

-- Step 1 — zero risk. ai.py:626,640 already reads this bucket with the
--          service-role client, so nothing breaks.
-- update storage.buckets set public = false where id = 'guidelines';

-- Step 2 — verify after: nurse uploads L/R images and they display, /ai/analyze
--          runs, and the heatmap toggle works on both eyes in doctor review.
-- update storage.buckets set public = false where id = 'retinal-scans';

-- Step 3 — verify after: "Export as PDF", "Export MC as PDF", and
--          "Send Report to Patient" on an already-finalized session.
-- update storage.buckets set public = false where id in ('reports', 'medical-certificates');


-- ---------------------------------------------------------------------
-- 7. VERIFICATION (read-only — run after the sections above)
-- ---------------------------------------------------------------------

-- 7a. RLS on for all 11 tables. Every row must read `true`.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'staff_users', 'employee_registry', 'patients', 'screening_sessions',
    'retinal_images', 'ai_results', 'doctor_reviews', 'mc_certificates',
    'appointments', 'password_reset_otps', 'documents'
  )
order by tablename;

-- 7b. A deny policy is attached to each. Expect 11 rows, all permissive = 'RESTRICTIVE',
--     roles = {anon,authenticated}, cmd = 'ALL'.
select tablename, policyname, permissive, roles, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename;

-- 7c. No table grants remain for anon/authenticated. Expect ZERO rows.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee;

-- 7d. No EXECUTE on the RAG RPCs. Expect ZERO rows.
select p.proname, a.rolname as granted_to
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select unnest(array['anon', 'authenticated']) as rolname) a
where n.nspname = 'public'
  and p.proname in ('match_documents', 'match_ai_results')
  and has_function_privilege(a.rolname, p.oid, 'EXECUTE');

-- 7e. Storage deny policy is attached.
select policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- 7f. Bucket state. All four should read `false` once section 6 has been run.
select id, public from storage.buckets order by id;


-- =====================================================================
-- PROVING IT WORKS — two tests, both outside this file
-- =====================================================================
--
-- TEST 1: the backend is unaffected.
--   This migration is a no-op for the app, so the test is simply the full
--   clinical path, unchanged:
--     nurse: log in -> create session -> upload both eyes -> run AI
--            -> assign to doctor
--     doctor: log in -> generate RAG report -> approve with signature
--            -> confirm the PDF emails and "Export as PDF" downloads
--   If all of that still passes, RLS changed nothing. That is the point.
--
-- TEST 2: anon is actually blocked. This is the only step that demonstrates
--   the wall exists. Take the anon key from Settings -> API, then:
--
--     curl "$SUPABASE_URL/rest/v1/patients?select=*"            -H "apikey: $ANON_KEY"
--     curl "$SUPABASE_URL/rest/v1/staff_users?select=*"         -H "apikey: $ANON_KEY"
--     curl "$SUPABASE_URL/rest/v1/password_reset_otps?select=*" -H "apikey: $ANON_KEY"
--
--   BEFORE this migration those return real rows — patient records, bcrypt
--   hashes, live OTP codes. AFTER, each must return a permission error.
--   Run it before and after if you want the contrast for your FYP write-up.
--
-- =====================================================================
