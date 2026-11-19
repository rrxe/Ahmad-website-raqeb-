-- RAQEEB — Single-school management system
-- Apply this migration in a new Supabase project. Run as database owner.
begin;
-- Makes this file safe to run again: drop old policies first (they are recreated below)
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects' and policyname like 'submission_files%')
  loop execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  role text not null default 'student' check (role in ('admin','teacher','supervisor','student','parent')),
  status text not null default 'active' check (status in ('active','pending','rejected','suspended')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create unique index if not exists academic_years_one_current on public.academic_years (is_current) where is_current;

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grade_level text not null,
  section text,
  academic_year_id uuid references public.academic_years(id) on delete set null,
  capacity integer not null default 35 check (capacity > 0),
  room text,
  created_at timestamptz not null default now(),
  unique (name, academic_year_id)
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.student_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  student_no text not null unique,
  class_id uuid references public.classes(id) on delete set null,
  guardian_phone text,
  enrollment_status text not null default 'enrolled' check (enrollment_status in ('enrolled','transferred','graduated','withdrawn')),
  enrolled_at date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (teacher_id, class_id, subject_id)
);
create table if not exists public.supervisor_assignments (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (supervisor_id, class_id)
);
create table if not exists public.class_subjects (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (class_id, subject_id)
);

create table if not exists public.parent_student_links (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  relationship text default 'ولي أمر',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  unique (parent_id, student_id),
  check (parent_id <> student_id)
);

create table if not exists public.student_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  token_hash bytea not null unique,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  issued_by uuid references public.profiles(id)
);
create index if not exists student_qr_tokens_student_active on public.student_qr_tokens(student_id) where revoked_at is null;

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  attendance_date date not null default current_date,
  status text not null check (status in ('present','absent','late','excused')),
  check_in_at timestamptz,
  note text,
  source text not null default 'manual' check (source in ('manual','qr','system')),
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (student_id, attendance_date)
);
create index if not exists attendance_date_class_idx on public.attendance_records(attendance_date, class_id);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  assessment_type text not null default 'exam',
  total_marks numeric(7,2) not null default 100 check (total_marks > 0),
  exam_date date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score numeric(7,2) not null check (score >= 0),
  teacher_note text,
  published boolean not null default false,
  entered_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  due_at timestamptz,
  attachment_path text,
  total_marks numeric(7,2) not null default 10 check (total_marks > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  file_path text,
  answer_text text,
  submitted_at timestamptz not null default now(),
  teacher_feedback text,
  score numeric(7,2),
  status text not null default 'submitted' check (status in ('submitted','reviewed','late')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  unique (assignment_id, student_id)
);

create table if not exists public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  teacher_id uuid references public.profiles(id) on delete set null,
  day_of_week integer not null check (day_of_week between 0 and 6),
  period_number integer not null check (period_number > 0),
  starts_at time not null,
  ends_at time not null,
  room text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (class_id, day_of_week, period_number)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'عام',
  audience text not null default 'all' check (audience in ('all','students','parents','teachers','supervisors','class')),
  class_id uuid references public.classes(id) on delete cascade,
  published boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((audience = 'class' and class_id is not null) or audience <> 'class')
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  category text not null default 'general',
  target_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id, created_at desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  operation text not null,
  row_id text,
  actor_id uuid references public.profiles(id) on delete set null,
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.school_settings (
  id uuid primary key default gen_random_uuid(),
  school_name text not null default 'مدرستي',
  logo_url text,
  academic_year_label text,
  school_start time not null default '08:00',
  school_end time not null default '14:00',
  late_after time not null default '08:15',
  mark_absent_after time not null default '14:15',
  attendance_enabled boolean not null default true,
  push_enabled boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.school_settings (school_name) select 'مدرستي' where not exists (select 1 from public.school_settings);

-- Authorization helpers are SECURITY DEFINER so RLS policies can safely inspect assignments.
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and status = 'active' $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active') $$;

create or replace function public.is_teacher_for_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.teacher_assignments ta where ta.teacher_id = auth.uid() and ta.class_id = p_class_id) $$;

create or replace function public.is_supervisor_for_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.supervisor_assignments sa where sa.supervisor_id = auth.uid() and sa.class_id = p_class_id) $$;

create or replace function public.can_access_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
 select public.is_admin()
 or public.is_teacher_for_class(p_class_id)
 or public.is_supervisor_for_class(p_class_id)
 or exists (select 1 from public.student_records sr where sr.profile_id = auth.uid() and sr.class_id = p_class_id)
 or exists (
   select 1 from public.parent_student_links psl
   join public.student_records sr on sr.profile_id = psl.student_id
   where psl.parent_id = auth.uid() and psl.status = 'approved' and sr.class_id = p_class_id
 );
$$;

create or replace function public.can_access_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
 select public.is_admin()
 or auth.uid() = p_student_id
 or exists (
   select 1 from public.student_records sr
   where sr.profile_id = p_student_id
     and (public.is_teacher_for_class(sr.class_id) or public.is_supervisor_for_class(sr.class_id))
 )
 or exists (
   select 1 from public.parent_student_links psl
   where psl.student_id = p_student_id and psl.parent_id = auth.uid() and psl.status = 'approved'
 );
$$;

create or replace function public.is_active_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p join public.student_records sr on sr.profile_id=p.id
    where p.id=p_student_id and p.role='student' and p.status='active' and sr.enrollment_status='enrolled'
  )
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() = old.id and not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  if old.role='admin' and old.status='active'
     and (new.role is distinct from 'admin' or new.status is distinct from 'active')
     and not exists (select 1 from public.profiles p where p.id<>old.id and p.role='admin' and p.status='active') then
    raise exception 'لا يمكن تعطيل أو تغيير دور آخر حساب مدير عام نشط';
  end if;
  return new;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare requested_role text;
begin
  requested_role := coalesce(new.raw_user_meta_data->>'role', 'student');
  if requested_role not in ('student','parent','teacher','supervisor') then requested_role := 'student'; end if;
  insert into public.profiles (id, full_name, email, phone, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1)),
    new.email,
    new.raw_user_meta_data->>'phone',
    requested_role,
    case when requested_role in ('teacher','supervisor') then 'pending' else 'active' end
  ) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

drop trigger if exists profile_privilege_guard on public.profiles;
create trigger profile_privilege_guard before update on public.profiles for each row execute procedure public.protect_profile_privileges();
drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute procedure public.touch_updated_at();

create or replace function public.write_audit_log()
returns trigger language plpgsql security definer set search_path = public
as $$
declare old_json jsonb; new_json jsonb; rid text;
begin
  if TG_OP = 'DELETE' then old_json := to_jsonb(old); rid := old.id::text;
  else new_json := to_jsonb(new); rid := new.id::text; end if;
  if TG_OP = 'UPDATE' then old_json := to_jsonb(old); end if;
  insert into public.audit_logs(table_name, operation, row_id, actor_id, old_data, new_data)
  values (TG_TABLE_NAME, TG_OP, rid, auth.uid(), old_json, new_json);
  if TG_OP = 'DELETE' then return old; else return new; end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','academic_years','classes','subjects','student_records','teacher_assignments','supervisor_assignments','parent_student_links','attendance_records','assessments','grades','assignments','assignment_submissions','timetable_slots','announcements','school_settings'] loop
    execute format('drop trigger if exists audit_%I on public.%I', t, t);
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute procedure public.write_audit_log()', t, t);
  end loop;
end $$;

-- QR credentials are random, stored only as SHA-256 hashes, and rotated atomically.
create or replace function public.rotate_student_qr(p_student_id uuid)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare raw_token text;
begin
  if not (public.is_admin() or auth.uid() = p_student_id) then raise exception 'غير مصرح بإصدار بطاقة هذا الطالب'; end if;
  if not exists (select 1 from public.student_records where profile_id = p_student_id and enrollment_status = 'enrolled') then
    raise exception 'لا يوجد سجل طالب نشط لهذا الحساب';
  end if;
  update public.student_qr_tokens set revoked_at = now() where student_id = p_student_id and revoked_at is null;
  raw_token := encode(gen_random_bytes(32), 'hex');
  insert into public.student_qr_tokens(student_id, token_hash, issued_by)
  values (p_student_id, digest(raw_token, 'sha256'), auth.uid());
  return raw_token;
end $$;

create or replace function public.mark_attendance_by_qr(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare s record; existing_id uuid;
begin
  if auth.uid() is null or public.current_user_role() not in ('admin','teacher','supervisor') then
    raise exception 'هذه العملية مخصصة للموظفين المصرح لهم';
  end if;
  select sr.profile_id, sr.class_id, sr.student_no, p.full_name
    into s
    from public.student_qr_tokens qt
    join public.student_records sr on sr.profile_id = qt.student_id
    join public.profiles p on p.id = sr.profile_id
   where qt.token_hash = digest(p_token, 'sha256') and qt.revoked_at is null
     and sr.enrollment_status = 'enrolled' and p.status = 'active'
   order by qt.issued_at desc limit 1;
  if s.profile_id is null then raise exception 'رمز QR غير صالح أو ملغى'; end if;
  if not public.can_access_class(s.class_id) then raise exception 'هذا الصف غير مسند إلى حسابك'; end if;
  insert into public.attendance_records(student_id, class_id, attendance_date, status, check_in_at, source, recorded_by)
  values (s.profile_id, s.class_id, current_date, 'present', now(), 'qr', auth.uid())
  on conflict (student_id, attendance_date) do nothing
  returning id into existing_id;
  if existing_id is null then
    return jsonb_build_object('status','duplicate','student_id',s.profile_id,'student_name',s.full_name,'student_no',s.student_no);
  end if;
  return jsonb_build_object('status','present','attendance_id',existing_id,'student_id',s.profile_id,'student_name',s.full_name,'student_no',s.student_no);
end $$;

create or replace function public.request_parent_link(p_student_no text, p_relationship text default 'ولي أمر')
returns uuid language plpgsql security definer set search_path = public
as $$
declare student_uuid uuid; link_uuid uuid;
begin
  if public.current_user_role() is distinct from 'parent' then raise exception 'هذه الخدمة مخصصة لحساب ولي الأمر'; end if;
  select profile_id into student_uuid from public.student_records where student_no = trim(p_student_no) and enrollment_status = 'enrolled';
  if student_uuid is null then raise exception 'رقم الطالب غير موجود أو غير نشط'; end if;
  insert into public.parent_student_links(parent_id, student_id, relationship)
  values(auth.uid(), student_uuid, coalesce(nullif(trim(p_relationship),''),'ولي أمر'))
  on conflict(parent_id, student_id) do update set status = 'pending', requested_at = now(), reviewed_at = null, reviewed_by = null
  returning id into link_uuid;
  return link_uuid;
end $$;

-- RLS: every table is protected; application navigation is not the security boundary.
alter table public.profiles enable row level security;
alter table public.academic_years enable row level security;
alter table public.classes enable row level security;
alter table public.subjects enable row level security;
alter table public.student_records enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.supervisor_assignments enable row level security;
alter table public.class_subjects enable row level security;
alter table public.parent_student_links enable row level security;
alter table public.student_qr_tokens enable row level security;
alter table public.attendance_records enable row level security;
alter table public.assessments enable row level security;
alter table public.grades enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.timetable_slots enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.school_settings enable row level security;

-- Profiles
create policy profiles_read_scoped on public.profiles for select using (
  id = auth.uid() or public.is_admin()
  or (role = 'student' and public.can_access_student(id))
  or exists (select 1 from public.parent_student_links p where p.parent_id = auth.uid() and p.student_id = id and p.status = 'approved')
);
create policy profiles_update_self_or_admin on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy profiles_admin_insert on public.profiles for insert with check (public.is_admin());

-- Academic structure
create policy years_read_active on public.academic_years for select using (public.current_user_role() is not null);
create policy years_admin_all on public.academic_years for all using (public.is_admin()) with check (public.is_admin());
create policy classes_read_scoped on public.classes for select using (public.can_access_class(id) or public.is_admin());
create policy classes_admin_all on public.classes for all using (public.is_admin()) with check (public.is_admin());
create policy subjects_read_active on public.subjects for select using (public.current_user_role() is not null);
create policy subjects_admin_all on public.subjects for all using (public.is_admin()) with check (public.is_admin());
create policy student_records_read_scoped on public.student_records for select using (public.can_access_student(profile_id));
create policy student_records_admin_all on public.student_records for all using (public.is_admin()) with check (public.is_admin());
create policy teacher_assignments_read on public.teacher_assignments for select using (public.is_admin() or teacher_id = auth.uid() or public.is_supervisor_for_class(class_id));
create policy teacher_assignments_admin_all on public.teacher_assignments for all using (public.is_admin()) with check (public.is_admin());
create policy supervisor_assignments_read on public.supervisor_assignments for select using (public.is_admin() or supervisor_id = auth.uid());
create policy supervisor_assignments_admin_all on public.supervisor_assignments for all using (public.is_admin()) with check (public.is_admin());
create policy class_subjects_read on public.class_subjects for select using (public.can_access_class(class_id));
create policy class_subjects_admin_all on public.class_subjects for all using (public.is_admin()) with check (public.is_admin());

-- Parent link approval flow
create policy parent_links_read on public.parent_student_links for select using (parent_id = auth.uid() or public.is_admin());
create policy parent_links_request on public.parent_student_links for insert with check (parent_id = auth.uid() and public.current_user_role() = 'parent' and status = 'pending' and public.is_active_student(student_id));
create policy parent_links_admin_update on public.parent_student_links for update using (public.is_admin()) with check (public.is_admin());

-- QR records: raw QR value is never stored in the database.
create policy qr_read_own_or_admin on public.student_qr_tokens for select using (student_id = auth.uid() or public.is_admin());

-- Attendance
create policy attendance_read_scoped on public.attendance_records for select using (public.can_access_student(student_id));
create policy attendance_insert_staff on public.attendance_records for insert with check (
  public.is_admin() or public.is_teacher_for_class(class_id) or public.is_supervisor_for_class(class_id)
);
create policy attendance_update_staff on public.attendance_records for update using (
  public.is_admin() or public.is_teacher_for_class(class_id) or public.is_supervisor_for_class(class_id)
) with check (public.is_admin() or public.is_teacher_for_class(class_id) or public.is_supervisor_for_class(class_id));
create policy attendance_delete_admin on public.attendance_records for delete using (public.is_admin());

-- Exams and grades
create policy assessments_read_class on public.assessments for select using (public.can_access_class(class_id));
create policy assessments_staff_insert on public.assessments for insert with check (public.is_admin() or public.is_teacher_for_class(class_id));
create policy assessments_staff_update on public.assessments for update using (public.is_admin() or public.is_teacher_for_class(class_id)) with check (public.is_admin() or public.is_teacher_for_class(class_id));
create policy assessments_admin_delete on public.assessments for delete using (public.is_admin());
create policy grades_read_scoped on public.grades for select using (public.can_access_student(student_id) and (published or public.is_admin() or public.current_user_role() in ('teacher','supervisor')));
create policy grades_staff_insert on public.grades for insert with check (
 public.is_admin() or exists (select 1 from public.assessments a where a.id = assessment_id and public.is_teacher_for_class(a.class_id))
);
create policy grades_staff_update on public.grades for update using (
 public.is_admin() or exists (select 1 from public.assessments a where a.id = assessment_id and public.is_teacher_for_class(a.class_id))
) with check (public.is_admin() or exists (select 1 from public.assessments a where a.id = assessment_id and public.is_teacher_for_class(a.class_id)));
create policy grades_admin_delete on public.grades for delete using (public.is_admin());

-- Assignments and student work
create policy assignments_read_class on public.assignments for select using (public.can_access_class(class_id));
create policy assignments_staff_insert on public.assignments for insert with check (public.is_admin() or public.is_teacher_for_class(class_id));
create policy assignments_staff_update on public.assignments for update using (public.is_admin() or public.is_teacher_for_class(class_id)) with check (public.is_admin() or public.is_teacher_for_class(class_id));
create policy assignments_admin_delete on public.assignments for delete using (public.is_admin());
create policy submissions_read_scoped on public.assignment_submissions for select using (
 student_id = auth.uid() or public.is_admin() or exists (
  select 1 from public.assignments a join public.student_records sr on sr.profile_id = assignment_submissions.student_id
  where a.id = assignment_id and (public.is_teacher_for_class(a.class_id) or public.is_supervisor_for_class(a.class_id))
 ) or exists (select 1 from public.parent_student_links p where p.student_id = assignment_submissions.student_id and p.parent_id = auth.uid() and p.status = 'approved')
);
create policy submissions_student_insert on public.assignment_submissions for insert with check (
 student_id = auth.uid() and public.current_user_role() = 'student' and exists (
  select 1 from public.assignments a join public.student_records sr on sr.class_id = a.class_id
  where a.id = assignment_id and sr.profile_id = auth.uid() and (a.due_at is null or a.due_at >= now())
 )
);
create policy submissions_student_update_before_deadline on public.assignment_submissions for update using (
 student_id = auth.uid() and exists (select 1 from public.assignments a where a.id = assignment_id and (a.due_at is null or a.due_at >= now()))
) with check (student_id = auth.uid());
create policy submissions_staff_review on public.assignment_submissions for update using (
 public.is_admin() or exists (select 1 from public.assignments a where a.id = assignment_id and public.is_teacher_for_class(a.class_id))
) with check (public.is_admin() or exists (select 1 from public.assignments a where a.id = assignment_id and public.is_teacher_for_class(a.class_id)));

-- Timetable, news and notifications
create policy timetable_read_scoped on public.timetable_slots for select using (public.can_access_class(class_id));
create policy timetable_staff_manage on public.timetable_slots for all using (public.is_admin() or public.is_teacher_for_class(class_id)) with check (public.is_admin() or public.is_teacher_for_class(class_id));
create policy announcements_read_published on public.announcements for select using (
 public.is_admin() or (published and starts_at <= now() and (ends_at is null or ends_at > now()) and (
  audience = 'all'
  or (audience = 'students' and public.current_user_role() = 'student')
  or (audience = 'parents' and public.current_user_role() = 'parent')
  or (audience = 'teachers' and public.current_user_role() = 'teacher')
  or (audience = 'supervisors' and public.current_user_role() = 'supervisor')
  or (audience = 'class' and public.can_access_class(class_id))
 ))
);
create policy announcements_staff_insert on public.announcements for insert with check (public.is_admin() or (public.current_user_role() = 'teacher' and (class_id is null or public.is_teacher_for_class(class_id))));
create policy announcements_staff_update on public.announcements for update using (public.is_admin() or created_by = auth.uid()) with check (public.is_admin() or created_by = auth.uid());
create policy announcements_admin_delete on public.announcements for delete using (public.is_admin());
create policy notifications_read_own on public.notifications for select using (recipient_id = auth.uid() or public.is_admin());
create policy notifications_update_own on public.notifications for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy notifications_insert_staff on public.notifications for insert with check (public.is_admin() or public.current_user_role() = 'teacher');
create policy push_subscriptions_own on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audit_admin_read on public.audit_logs for select using (public.is_admin());
create policy settings_read_active on public.school_settings for select using (public.current_user_role() is not null);
create policy settings_admin_update on public.school_settings for update using (public.is_admin()) with check (public.is_admin());

-- Private storage bucket for assignment submissions.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('student-submissions','student-submissions',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
create policy submission_files_read on storage.objects for select using (
 bucket_id = 'student-submissions' and (
  (storage.foldername(name))[1] = auth.uid()::text
  or public.is_admin()
  or exists (
   select 1 from public.assignment_submissions sub
   join public.assignments a on a.id = sub.assignment_id
   where sub.file_path = name and (public.is_teacher_for_class(a.class_id) or public.is_supervisor_for_class(a.class_id))
  )
 )
);
create policy submission_files_upload on storage.objects for insert with check (
 bucket_id = 'student-submissions' and (storage.foldername(name))[1] = auth.uid()::text and public.current_user_role() = 'student'
);
create policy submission_files_delete_own on storage.objects for delete using (
 bucket_id = 'student-submissions' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

-- Least-privilege RPC execution.
revoke all on function public.rotate_student_qr(uuid) from public;
grant execute on function public.rotate_student_qr(uuid) to authenticated;
revoke all on function public.mark_attendance_by_qr(text) from public;
grant execute on function public.mark_attendance_by_qr(text) to authenticated;
revoke all on function public.request_parent_link(text,text) from public;
grant execute on function public.request_parent_link(text,text) to authenticated;

commit;


-- ===== PART 2 =====

-- RAQEEB operational automation: school timezone, late/absence automation and event notifications.
begin;
revoke all on function public.is_active_student(uuid) from public, anon;
grant execute on function public.is_active_student(uuid) to authenticated;

-- Enable the real-time notification inbox when Supabase Realtime is available.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

alter table public.school_settings add column if not exists timezone text not null default 'Asia/Baghdad';
alter table public.school_settings add column if not exists working_days smallint[] not null default array[0,1,2,3,4]::smallint[];
alter table public.assignments add column if not exists total_marks numeric(7,2) not null default 10 check (total_marks > 0);
alter table public.school_settings alter column mark_absent_after set default '14:15';
update public.school_settings set mark_absent_after='14:15' where mark_absent_after='08:30';

create or replace function public.attendance_is_enabled()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select attendance_enabled from public.school_settings order by updated_at desc limit 1), true) $$;

create or replace function public.mark_attendance_by_qr(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare s record; existing_id uuid; school_tz text; late_cutoff time; local_now timestamp; attendance_state text; active_days smallint[];
begin
  if auth.uid() is null or public.current_user_role() not in ('admin','teacher','supervisor') then
    raise exception 'هذه العملية مخصصة للموظفين المصرح لهم';
  end if;
  if not public.attendance_is_enabled() then raise exception 'نظام الحضور متوقف من إعدادات المدرسة'; end if;
  select sr.profile_id, sr.class_id, sr.student_no, p.full_name
    into s
    from public.student_qr_tokens qt
    join public.student_records sr on sr.profile_id = qt.student_id
    join public.profiles p on p.id = sr.profile_id
   where qt.token_hash = digest(p_token, 'sha256') and qt.revoked_at is null
     and sr.enrollment_status = 'enrolled' and p.status = 'active'
   order by qt.issued_at desc limit 1;
  if s.profile_id is null then raise exception 'رمز QR غير صالح أو ملغى'; end if;
  if not public.can_access_class(s.class_id) then raise exception 'هذا الصف غير مسند إلى حسابك'; end if;
  select timezone, late_after, working_days into school_tz, late_cutoff, active_days from public.school_settings order by updated_at desc limit 1;
  local_now := now() at time zone coalesce(school_tz,'Asia/Baghdad');
  if not (extract(dow from local_now)::smallint = any(coalesce(active_days,array[0,1,2,3,4]::smallint[]))) then raise exception 'اليوم خارج أيام الدوام المدرسي'; end if;
  attendance_state := case when local_now::time > coalesce(late_cutoff,'08:15'::time) then 'late' else 'present' end;
  insert into public.attendance_records(student_id, class_id, attendance_date, status, check_in_at, source, recorded_by)
  values (s.profile_id, s.class_id, local_now::date, attendance_state, now(), 'qr', auth.uid())
  on conflict (student_id, attendance_date) do nothing
  returning id into existing_id;
  if existing_id is null then
    return jsonb_build_object('status','duplicate','student_id',s.profile_id,'student_name',s.full_name,'student_no',s.student_no);
  end if;
  return jsonb_build_object('status',attendance_state,'attendance_id',existing_id,'student_id',s.profile_id,'student_name',s.full_name,'student_no',s.student_no);
end $$;

-- Role and employment status are rechecked on every policy helper call. A suspended or demoted account loses access immediately.
create or replace function public.is_teacher_for_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
 select exists(select 1 from public.profiles p join public.teacher_assignments ta on ta.teacher_id=p.id
   where p.id=auth.uid() and p.role='teacher' and p.status='active' and ta.class_id=p_class_id)
$$;
create or replace function public.is_supervisor_for_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
 select exists(select 1 from public.profiles p join public.supervisor_assignments sa on sa.supervisor_id=p.id
   where p.id=auth.uid() and p.role='supervisor' and p.status='active' and sa.class_id=p_class_id)
$$;
create or replace function public.can_access_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
 select public.is_admin()
 or (public.current_user_role()='teacher' and public.is_teacher_for_class(p_class_id))
 or (public.current_user_role()='supervisor' and public.is_supervisor_for_class(p_class_id))
 or (public.current_user_role()='student' and exists(select 1 from public.student_records sr where sr.profile_id=auth.uid() and sr.class_id=p_class_id and sr.enrollment_status='enrolled'))
 or (public.current_user_role()='parent' and exists(
   select 1 from public.parent_student_links psl join public.student_records sr on sr.profile_id=psl.student_id
   where psl.parent_id=auth.uid() and psl.status='approved' and sr.class_id=p_class_id and sr.enrollment_status='enrolled'
 ));
$$;
create or replace function public.can_access_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
 select public.is_admin()
 or (auth.uid()=p_student_id and public.current_user_role()='student')
 or (public.current_user_role()='teacher' and exists(select 1 from public.student_records sr where sr.profile_id=p_student_id and sr.enrollment_status='enrolled' and public.is_teacher_for_class(sr.class_id)))
 or (public.current_user_role()='supervisor' and exists(select 1 from public.student_records sr where sr.profile_id=p_student_id and sr.enrollment_status='enrolled' and public.is_supervisor_for_class(sr.class_id)))
 or (public.current_user_role()='parent' and exists(select 1 from public.parent_student_links psl where psl.student_id=p_student_id and psl.parent_id=auth.uid() and psl.status='approved'));
$$;

-- Keep a profile's role consistent with its existing school records.
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid()=old.id and not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  if new.role is distinct from old.role then
    if old.role='student' and (exists(select 1 from public.student_records where profile_id=old.id) or exists(select 1 from public.parent_student_links where student_id=old.id)) then raise exception 'احذف سجل الطالب وطلبات ربطه قبل تغيير دوره'; end if;
    if old.role='teacher' and exists(select 1 from public.teacher_assignments where teacher_id=old.id) then raise exception 'أزل إسنادات المدرس قبل تغيير دوره'; end if;
    if old.role='supervisor' and exists(select 1 from public.supervisor_assignments where supervisor_id=old.id) then raise exception 'أزل إسنادات المراقب قبل تغيير دوره'; end if;
    if old.role='parent' and exists(select 1 from public.parent_student_links where parent_id=old.id) then raise exception 'أزل روابط الأبناء قبل تغيير دور ولي الأمر'; end if;
  end if;
  return new;
end $$;

-- Subject-level authorization: a teacher assigned to one subject cannot edit another subject's work.
create or replace function public.is_teacher_for_subject(p_class_id uuid, p_subject_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
 select exists (
   select 1 from public.teacher_assignments ta
   join public.profiles p on p.id=ta.teacher_id
   where ta.teacher_id = auth.uid() and p.role='teacher' and p.status='active' and ta.class_id = p_class_id
     and (ta.subject_id is null or ta.subject_id = p_subject_id)
 )
$$;

-- Replace the broader class-only teacher policies with subject-aware policies.
drop policy if exists assessments_read_class on public.assessments;
create policy assessments_read_scoped on public.assessments for select using (
 public.is_admin()
 or (public.current_user_role() = 'teacher' and public.is_teacher_for_subject(class_id, subject_id))
 or (public.current_user_role() in ('student','parent','supervisor') and public.can_access_class(class_id))
);
drop policy if exists assessments_staff_insert on public.assessments;
create policy assessments_subject_insert on public.assessments for insert with check (public.is_admin() or public.is_teacher_for_subject(class_id, subject_id));
drop policy if exists assessments_staff_update on public.assessments;
create policy assessments_subject_update on public.assessments for update using (public.is_admin() or public.is_teacher_for_subject(class_id, subject_id)) with check (public.is_admin() or public.is_teacher_for_subject(class_id, subject_id));

drop policy if exists grades_read_scoped on public.grades;
create policy grades_read_scoped on public.grades for select using (
 (published and public.can_access_student(student_id))
 or public.is_admin()
 or exists (select 1 from public.assessments a where a.id = assessment_id and (
   public.is_teacher_for_subject(a.class_id, a.subject_id)
 ))
);
drop policy if exists grades_staff_insert on public.grades;
create policy grades_subject_insert on public.grades for insert with check (
 public.is_admin() or exists (select 1 from public.assessments a where a.id = assessment_id and public.is_teacher_for_subject(a.class_id, a.subject_id))
);
drop policy if exists grades_staff_update on public.grades;
create policy grades_subject_update on public.grades for update using (
 public.is_admin() or exists (select 1 from public.assessments a where a.id = assessment_id and public.is_teacher_for_subject(a.class_id, a.subject_id))
) with check (public.is_admin() or exists (select 1 from public.assessments a where a.id = assessment_id and public.is_teacher_for_subject(a.class_id, a.subject_id)));

drop policy if exists assignments_read_class on public.assignments;
create policy assignments_read_scoped on public.assignments for select using (
 public.is_admin()
 or (public.current_user_role() = 'teacher' and public.is_teacher_for_subject(class_id, subject_id))
 or (public.current_user_role() in ('student','parent','supervisor') and public.can_access_class(class_id))
);
drop policy if exists assignments_staff_insert on public.assignments;
create policy assignments_subject_insert on public.assignments for insert with check (public.is_admin() or public.is_teacher_for_subject(class_id, subject_id));
drop policy if exists assignments_staff_update on public.assignments;
create policy assignments_subject_update on public.assignments for update using (public.is_admin() or public.is_teacher_for_subject(class_id, subject_id)) with check (public.is_admin() or public.is_teacher_for_subject(class_id, subject_id));

drop policy if exists submissions_read_scoped on public.assignment_submissions;
create policy submissions_read_scoped on public.assignment_submissions for select using (
 (student_id = auth.uid() and public.current_user_role()='student') or public.is_admin()
 or exists (select 1 from public.assignments a where a.id = assignment_id and public.is_teacher_for_subject(a.class_id, a.subject_id))
 or (public.current_user_role()='parent' and exists (select 1 from public.parent_student_links p where p.student_id = assignment_submissions.student_id and p.parent_id = auth.uid() and p.status = 'approved'))
);
-- Late work is accepted and labelled by the UI; class membership and student identity are still enforced.
drop policy if exists submissions_student_insert on public.assignment_submissions;
create policy submissions_student_insert on public.assignment_submissions for insert with check (
 student_id = auth.uid() and public.current_user_role() = 'student' and exists (
  select 1 from public.assignments a join public.student_records sr on sr.class_id = a.class_id
  where a.id = assignment_id and sr.profile_id = auth.uid() and sr.enrollment_status = 'enrolled'
 )
);
drop policy if exists submissions_student_update_before_deadline on public.assignment_submissions;
create policy submissions_student_update_before_deadline on public.assignment_submissions for update using (
 student_id = auth.uid() and public.current_user_role() = 'student' and exists (
  select 1 from public.assignments a join public.student_records sr on sr.class_id = a.class_id
  where a.id = assignment_id and sr.profile_id = auth.uid() and sr.enrollment_status = 'enrolled'
 )
) with check (
 student_id = auth.uid() and public.current_user_role() = 'student' and exists (
  select 1 from public.assignments a join public.student_records sr on sr.class_id = a.class_id
  where a.id = assignment_id and sr.profile_id = auth.uid() and sr.enrollment_status = 'enrolled'
 )
);

create or replace function public.guard_student_submission()
returns trigger language plpgsql security definer set search_path = public
as $$
declare due_time timestamptz; max_score numeric(7,2);
begin
 if new.score is not null and new.score < 0 then raise exception 'درجة الواجب لا يمكن أن تكون سالبة'; end if;
 select due_at,total_marks into due_time,max_score from public.assignments where id=new.assignment_id;
 if not found then raise exception 'الواجب المحدد غير موجود'; end if;
 if new.score is not null and new.score > max_score then raise exception 'درجة الواجب تتجاوز الدرجة الكاملة'; end if;
 if public.current_user_role()='student' then
   if new.student_id is distinct from auth.uid() then raise exception 'لا يمكن تعديل تسليم طالب آخر'; end if;
   if TG_OP='UPDATE' and old.reviewed_at is not null then raise exception 'لا يمكن تعديل تسليم بعد مراجعته من المدرس'; end if;
   new.score := null;
   new.teacher_feedback := null;
   new.reviewed_by := null;
   new.reviewed_at := null;
   new.status := case when due_time is not null and due_time < now() then 'late' else 'submitted' end;
 end if;
 return new;
end $$;
drop trigger if exists student_submission_guard on public.assignment_submissions;
create trigger student_submission_guard before insert or update on public.assignment_submissions for each row execute procedure public.guard_student_submission();
drop policy if exists submissions_staff_review on public.assignment_submissions;
create policy submissions_staff_review on public.assignment_submissions for update using (
 public.is_admin() or exists (select 1 from public.assignments a where a.id = assignment_id and public.is_teacher_for_subject(a.class_id, a.subject_id))
) with check (public.is_admin() or exists (select 1 from public.assignments a where a.id = assignment_id and public.is_teacher_for_subject(a.class_id, a.subject_id)));

-- Called by Supabase Cron. It is safe to run repeatedly; uniqueness prevents duplicate absences.
create or replace function public.finalize_daily_attendance()
returns integer language plpgsql security definer set search_path = public
as $$
declare school_tz text; absent_cutoff time; local_now timestamp; inserted_count integer; active_days smallint[];
begin
  select timezone, mark_absent_after, working_days into school_tz, absent_cutoff, active_days
  from public.school_settings order by updated_at desc limit 1;
  school_tz := coalesce(school_tz, 'Asia/Baghdad');
  if not public.attendance_is_enabled() then return 0; end if;
  local_now := now() at time zone school_tz;
  if not (extract(dow from local_now)::smallint = any(coalesce(active_days,array[0,1,2,3,4]::smallint[]))) then return 0; end if;
  if local_now::time < coalesce(absent_cutoff, '14:15'::time) then return 0; end if;
  insert into public.attendance_records(student_id, class_id, attendance_date, status, source, recorded_by, note)
  select sr.profile_id, sr.class_id, local_now::date, 'absent', 'system', null, 'غياب تلقائي بعد انتهاء مهلة تسجيل الحضور'
  from public.student_records sr
  join public.profiles p on p.id = sr.profile_id and p.status = 'active'
  where sr.enrollment_status = 'enrolled' and sr.class_id is not null
  on conflict (student_id, attendance_date) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end $$;

create or replace function public.notify_student_and_parents(p_student_id uuid, p_title text, p_body text, p_category text, p_target text default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications(recipient_id,title,body,category,target_url)
  values(p_student_id,p_title,p_body,p_category,p_target);
  insert into public.notifications(recipient_id,title,body,category,target_url)
  select p.parent_id,p_title,p_body,p_category,p_target
  from public.parent_student_links p
  where p.student_id=p_student_id and p.status='approved';
end $$;

create or replace function public.on_attendance_notification()
returns trigger language plpgsql security definer set search_path = public
as $$
declare student_name text; status_text text;
begin
  if new.status in ('absent','late') and (TG_OP='INSERT' or old.status is distinct from new.status) then
    select full_name into student_name from public.profiles where id=new.student_id;
    status_text := case when new.status='absent' then 'غائب' else 'متأخر' end;
    perform public.notify_student_and_parents(new.student_id,
      case when new.status='absent' then 'تم تسجيل غياب' else 'تم تسجيل تأخير' end,
      'تم تسجيل حالة الطالب '||coalesce(student_name,'')||' بتاريخ '||new.attendance_date::text||' كـ '||status_text,
      'attendance','/');
  end if;
  return new;
end $$;
drop trigger if exists attendance_notify on public.attendance_records;
create trigger attendance_notify after insert or update on public.attendance_records for each row execute procedure public.on_attendance_notification();

create or replace function public.validate_grade_score()
returns trigger language plpgsql set search_path = public
as $$
declare max_score numeric(7,2); assessment_class uuid; student_class uuid; student_role text; student_status text;
begin
  select total_marks, class_id into max_score, assessment_class from public.assessments where id=new.assessment_id;
  if max_score is null then raise exception 'الاختبار المحدد غير موجود'; end if;
  if new.score > max_score then raise exception 'الدرجة لا يمكن أن تتجاوز الدرجة الكاملة (%).', max_score; end if;
  select sr.class_id,p.role,p.status into student_class,student_role,student_status from public.student_records sr join public.profiles p on p.id=sr.profile_id where sr.profile_id=new.student_id and sr.enrollment_status='enrolled';
  if student_class is null or student_class is distinct from assessment_class or student_role is distinct from 'student' or student_status is distinct from 'active' then raise exception 'الطالب غير نشط أو غير مسجل في صف هذا الاختبار'; end if;
  return new;
end $$;
drop trigger if exists grades_score_guard on public.grades;
create trigger grades_score_guard before insert or update on public.grades for each row execute procedure public.validate_grade_score();

create or replace function public.on_grade_notification()
returns trigger language plpgsql security definer set search_path = public
as $$
declare assessment_title text;
begin
  if new.published and (TG_OP='INSERT' or old.published is distinct from new.published or old.score is distinct from new.score) then
    select title into assessment_title from public.assessments where id=new.assessment_id;
    perform public.notify_student_and_parents(new.student_id,'تم نشر درجة جديدة',
      'تم نشر درجتك في '||coalesce(assessment_title,'اختبار')||': '||new.score::text,'grade','/');
  end if;
  return new;
end $$;
drop trigger if exists grades_notify on public.grades;
create trigger grades_notify after insert or update on public.grades for each row execute procedure public.on_grade_notification();

create or replace function public.on_assignment_notification()
returns trigger language plpgsql security definer set search_path = public
as $$
declare student_uuid uuid;
begin
  for student_uuid in select profile_id from public.student_records where class_id=new.class_id and enrollment_status='enrolled' loop
    perform public.notify_student_and_parents(student_uuid,'واجب مدرسي جديد',
      'تم نشر واجب جديد: '||new.title,'assignment','/');
  end loop;
  return new;
end $$;
drop trigger if exists assignments_notify on public.assignments;
create trigger assignments_notify after insert on public.assignments for each row execute procedure public.on_assignment_notification();

create or replace function public.on_assessment_notification()
returns trigger language plpgsql security definer set search_path = public
as $$
declare student_uuid uuid;
begin
  for student_uuid in select profile_id from public.student_records where class_id=new.class_id and enrollment_status='enrolled' loop
    perform public.notify_student_and_parents(student_uuid,'موعد اختبار جديد',
      'تم تحديد اختبار جديد: '||new.title||case when new.exam_date is null then '' else ' بتاريخ '||new.exam_date::text end,
      'exam','/');
  end loop;
  return new;
end $$;
drop trigger if exists assessments_notify on public.assessments;
create trigger assessments_notify after insert on public.assessments for each row execute procedure public.on_assessment_notification();

create or replace function public.on_announcement_notification()
returns trigger language plpgsql security definer set search_path = public
as $$
declare recipient record;
begin
  if not new.published or (TG_OP='UPDATE' and old.published and old.title=new.title and old.body=new.body and old.audience=new.audience and old.class_id is not distinct from new.class_id) then return new; end if;
  for recipient in
    select distinct p.id
    from public.profiles p
    where p.status='active' and p.id is distinct from new.created_by
      and (
        new.audience='all'
        or (new.audience='students' and p.role='student')
        or (new.audience='parents' and p.role='parent')
        or (new.audience='teachers' and p.role='teacher')
        or (new.audience='supervisors' and p.role='supervisor')
        or (new.audience='class' and (
          exists(select 1 from public.student_records sr where sr.profile_id=p.id and sr.class_id=new.class_id)
          or exists(select 1 from public.parent_student_links psl join public.student_records sr on sr.profile_id=psl.student_id where psl.parent_id=p.id and psl.status='approved' and sr.class_id=new.class_id)
        ))
      )
  loop
    insert into public.notifications(recipient_id,title,body,category,target_url)
    values(recipient.id,new.title,new.body,'announcement','/');
  end loop;
  return new;
end $$;
drop trigger if exists announcements_notify on public.announcements;
create trigger announcements_notify after insert or update on public.announcements for each row execute procedure public.on_announcement_notification();

-- Respect the school-wide attendance switch and keep document access scoped to a student's class/subject.
drop policy if exists attendance_insert_staff on public.attendance_records;
create policy attendance_insert_staff on public.attendance_records for insert with check (
 public.attendance_is_enabled() and (public.is_admin() or public.is_teacher_for_class(class_id) or public.is_supervisor_for_class(class_id))
);
drop policy if exists attendance_update_staff on public.attendance_records;
create policy attendance_update_staff on public.attendance_records for update using (
 public.attendance_is_enabled() and (public.is_admin() or public.is_teacher_for_class(class_id) or public.is_supervisor_for_class(class_id))
) with check (public.attendance_is_enabled() and (public.is_admin() or public.is_teacher_for_class(class_id) or public.is_supervisor_for_class(class_id)));
drop policy if exists submission_files_read on storage.objects;
create policy submission_files_read on storage.objects for select using (
 bucket_id = 'student-submissions' and (
  ((storage.foldername(name))[1] = auth.uid()::text and public.current_user_role()='student') or public.is_admin()
  or exists (select 1 from public.assignment_submissions sub join public.assignments a on a.id = sub.assignment_id
    where sub.file_path = name and public.is_teacher_for_subject(a.class_id,a.subject_id))
  or exists (select 1 from public.assignment_submissions sub join public.parent_student_links psl on psl.student_id=sub.student_id
    where sub.file_path=name and psl.parent_id=auth.uid() and psl.status='approved' and public.current_user_role()='parent')
 )
);

-- Published grade averages, filtered by the underlying grade RLS policies.
create or replace view public.student_grade_summary with (security_invoker = true) as
select g.student_id, a.subject_id, count(*)::integer as assessment_count,
       round(avg((g.score / nullif(a.total_marks,0)) * 100), 2) as average_percent
from public.grades g
join public.assessments a on a.id = g.assessment_id
where g.published = true
group by g.student_id, a.subject_id;
grant select on public.student_grade_summary to authenticated;

-- Enforce correct account types and class membership at the database boundary.
create or replace function public.validate_school_relationships()
returns trigger language plpgsql security definer set search_path = public
as $$
declare actual_role text; actual_status text;
begin
  if TG_TABLE_NAME = 'student_records' then
    select role,status into actual_role,actual_status from public.profiles where id=new.profile_id;
    if actual_role is distinct from 'student' or actual_status is distinct from 'active' then raise exception 'يجب ربط سجل الطالب بحساب طالب نشط'; end if;
  elsif TG_TABLE_NAME = 'teacher_assignments' then
    select role,status into actual_role,actual_status from public.profiles where id=new.teacher_id;
    if actual_role is distinct from 'teacher' or actual_status is distinct from 'active' then raise exception 'يجب إسناد الصف إلى حساب مدرس نشط ومعتمد'; end if;
  elsif TG_TABLE_NAME = 'supervisor_assignments' then
    select role,status into actual_role,actual_status from public.profiles where id=new.supervisor_id;
    if actual_role is distinct from 'supervisor' or actual_status is distinct from 'active' then raise exception 'يجب إسناد الصف إلى حساب مراقب نشط ومعتمد'; end if;
  end if;
  return new;
end $$;
drop trigger if exists student_records_role_guard on public.student_records;
create trigger student_records_role_guard before insert or update of profile_id on public.student_records for each row execute procedure public.validate_school_relationships();
drop trigger if exists teacher_assignments_role_guard on public.teacher_assignments;
create trigger teacher_assignments_role_guard before insert or update of teacher_id on public.teacher_assignments for each row execute procedure public.validate_school_relationships();
drop trigger if exists supervisor_assignments_role_guard on public.supervisor_assignments;
create trigger supervisor_assignments_role_guard before insert or update of supervisor_id on public.supervisor_assignments for each row execute procedure public.validate_school_relationships();

create or replace function public.validate_attendance_student_class()
returns trigger language plpgsql security definer set search_path = public
as $$
declare student_class uuid; student_role text; student_status text;
begin
  select sr.class_id,p.role,p.status into student_class,student_role,student_status from public.student_records sr join public.profiles p on p.id=sr.profile_id where sr.profile_id=new.student_id and sr.enrollment_status='enrolled';
  if student_class is null or student_class is distinct from new.class_id or student_role is distinct from 'student' or student_status is distinct from 'active' then raise exception 'الطالب غير نشط أو غير مسجل في الصف المحدد لهذا الحضور'; end if;
  return new;
end $$;
drop trigger if exists attendance_student_class_guard on public.attendance_records;
create trigger attendance_student_class_guard before insert or update on public.attendance_records for each row execute procedure public.validate_attendance_student_class();

-- Teachers may publish only to a class they teach; school-wide notices are admin-only.
drop policy if exists profiles_read_scoped on public.profiles;
create policy profiles_read_scoped on public.profiles for select using (
 id=auth.uid() or public.is_admin()
 or (role='student' and public.can_access_student(id))
 or (public.current_user_role()='parent' and exists(select 1 from public.parent_student_links p where p.parent_id=auth.uid() and p.student_id=id and p.status='approved'))
);
drop policy if exists parent_links_read on public.parent_student_links;
create policy parent_links_read on public.parent_student_links for select using ((parent_id=auth.uid() and public.current_user_role()='parent') or public.is_admin());
drop policy if exists parent_links_request on public.parent_student_links;
create policy parent_links_request on public.parent_student_links for insert with check (
 parent_id=auth.uid() and public.current_user_role()='parent' and status='pending' and public.is_active_student(student_id)
);
drop policy if exists teacher_assignments_read on public.teacher_assignments;
create policy teacher_assignments_read on public.teacher_assignments for select using (public.is_admin() or (public.current_user_role()='teacher' and teacher_id=auth.uid()) or (public.current_user_role()='supervisor' and public.is_supervisor_for_class(class_id)));
drop policy if exists supervisor_assignments_read on public.supervisor_assignments;
create policy supervisor_assignments_read on public.supervisor_assignments for select using (public.is_admin() or (public.current_user_role()='supervisor' and supervisor_id=auth.uid()));
drop policy if exists timetable_staff_manage on public.timetable_slots;
create policy timetable_staff_manage on public.timetable_slots for all
using (
 public.is_admin() or (public.is_teacher_for_subject(class_id,subject_id) and (teacher_id is null or teacher_id=auth.uid()))
)
with check (
 public.is_admin() or (public.is_teacher_for_subject(class_id,subject_id) and (teacher_id is null or teacher_id=auth.uid()))
);

create or replace function public.validate_timetable_teacher()
returns trigger language plpgsql security definer set search_path = public
as $$
declare t_role text; t_status text;
begin
 if new.teacher_id is null then return new; end if;
 select role,status into t_role,t_status from public.profiles where id=new.teacher_id;
 if t_role is distinct from 'teacher' or t_status is distinct from 'active' then
   raise exception 'يجب تعيين مدرس نشط ومعتمد في الحصة';
 end if;
 if not exists (
   select 1 from public.teacher_assignments ta
   where ta.teacher_id=new.teacher_id and ta.class_id=new.class_id
     and (ta.subject_id is null or ta.subject_id=new.subject_id)
 ) then raise exception 'المدرس غير مسند لهذه المادة في هذا الصف'; end if;
 if public.current_user_role()='teacher' and new.teacher_id is distinct from auth.uid() then
   raise exception 'لا يمكن للمدرس تعيين مدرس آخر في جدوله';
 end if;
 return new;
end $$;
drop trigger if exists timetable_teacher_guard on public.timetable_slots;
create trigger timetable_teacher_guard before insert or update on public.timetable_slots for each row execute procedure public.validate_timetable_teacher();

drop policy if exists announcements_staff_insert on public.announcements;
create policy announcements_staff_insert on public.announcements for insert with check (
  public.is_admin() or (public.current_user_role()='teacher' and audience='class' and class_id is not null and created_by=auth.uid() and public.is_teacher_for_class(class_id))
);
drop policy if exists announcements_staff_update on public.announcements;
create policy announcements_staff_update on public.announcements for update using (
  public.is_admin() or (public.current_user_role()='teacher' and created_by=auth.uid() and audience='class' and class_id is not null and public.is_teacher_for_class(class_id))
) with check (
  public.is_admin() or (public.current_user_role()='teacher' and created_by=auth.uid() and audience='class' and class_id is not null and public.is_teacher_for_class(class_id))
);

-- Ordinary users cannot manufacture inbox messages for other accounts.
drop policy if exists notifications_insert_staff on public.notifications;
create policy notifications_insert_admin on public.notifications for insert with check (public.is_admin());

-- Students can rotate only their own credential while their account remains active.
create or replace function public.rotate_student_qr(p_student_id uuid)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare raw_token text;
begin
  if not (public.is_admin() or (auth.uid()=p_student_id and public.current_user_role()='student')) then raise exception 'غير مصرح بإصدار بطاقة هذا الطالب'; end if;
  if not exists (select 1 from public.student_records where profile_id=p_student_id and enrollment_status='enrolled') then raise exception 'لا يوجد سجل طالب نشط لهذا الحساب'; end if;
  update public.student_qr_tokens set revoked_at=now() where student_id=p_student_id and revoked_at is null;
  raw_token := encode(gen_random_bytes(32),'hex');
  insert into public.student_qr_tokens(student_id,token_hash,issued_by) values(p_student_id,digest(raw_token,'sha256'),auth.uid());
  return raw_token;
end $$;

create or replace function public.revoke_student_qr(p_student_id uuid)
returns integer language plpgsql security definer set search_path = public
as $$
declare revoked_count integer;
begin
 if not (public.is_admin() or (auth.uid()=p_student_id and public.current_user_role()='student')) then
   raise exception 'غير مصرح بإلغاء رمز هذا الطالب';
 end if;
 update public.student_qr_tokens set revoked_at=now()
 where student_id=p_student_id and revoked_at is null;
 get diagnostics revoked_count = row_count;
 return revoked_count;
end $$;
revoke all on function public.revoke_student_qr(uuid) from public, anon;
grant execute on function public.revoke_student_qr(uuid) to authenticated;

revoke all on function public.finalize_daily_attendance() from public, anon, authenticated;
grant execute on function public.finalize_daily_attendance() to service_role;
commit;


-- ===== PART 3 =====

-- RAQEEB — cleanup of earlier experimental admin-bootstrap objects (safe if they never existed)
begin;
drop function if exists public.check_admin_setup_code(text);
drop function if exists public.admin_setup_available();
drop function if exists public.set_admin_setup_code(text);
drop table if exists public.admin_setup;
drop table if exists public.admin_bootstrap_attempts;
commit;
