begin;

create table if not exists public.golf_course_holes (
  slate_id bigint not null
    references public.slates(id)
    on delete cascade,

  course_id text not null,
  course_name text,
  is_host boolean not null default false,

  hole_number integer not null,
  par integer not null,
  yards integer,

  updated_at timestamptz not null default now(),

  constraint golf_course_holes_pkey
    primary key (slate_id, course_id, hole_number),

  constraint golf_course_holes_hole_number_check
    check (hole_number between 1 and 18),

  constraint golf_course_holes_par_check
    check (par between 2 and 7),

  constraint golf_course_holes_yards_check
    check (yards is null or yards > 0)
);

create index if not exists golf_course_holes_slate_idx
  on public.golf_course_holes (slate_id);

create index if not exists golf_course_holes_host_idx
  on public.golf_course_holes (slate_id, is_host);

alter table public.golf_course_holes
  enable row level security;

commit;
