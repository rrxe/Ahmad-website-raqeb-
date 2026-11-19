import type { Profile, Role } from './supabase';

export const roleHome: Record<Role, string> = {
  admin: 'dashboard', teacher: 'dashboard', supervisor: 'dashboard', student: 'dashboard', parent: 'dashboard',
};

export function canSeePage(profile: Profile, page: string) {
  const permissions: Record<Role, string[]> = {
    admin: ['dashboard','approvals','users','academic-years','classes','subjects','students','teacher-assignments','supervisor-assignments','attendance','assessments','grades','assignments','submissions','timetable','announcements','notifications','children','reports','audit','settings'],
    teacher: ['dashboard','classes','students','attendance','assessments','grades','assignments','submissions','timetable','announcements','notifications','reports'],
    supervisor: ['dashboard','classes','students','attendance','timetable','announcements','notifications','reports'],
    student: ['dashboard','my-card','attendance','assessments','grades','assignments','submissions','timetable','announcements','notifications'],
    parent: ['dashboard','children','attendance','assessments','grades','assignments','submissions','timetable','announcements','notifications'],
  };
  return permissions[profile.role]?.includes(page) ?? false;
}
