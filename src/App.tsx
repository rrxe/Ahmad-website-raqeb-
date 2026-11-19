import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowRight, Bell, BookOpen, CalendarDays, Check,
  CheckCheck, ChevronDown, ClipboardCheck, Clock3, Download, FileText, GraduationCap,
  LayoutDashboard, LogOut, Menu, QrCode, Search, Settings, ShieldCheck, Users, X,
  Plus, Pencil, Trash2, RefreshCw, Camera, UserRound, School, BookMarked, ClipboardList,
  Megaphone, ChartNoAxesCombined, History, UserCheck, CalendarClock, Smartphone,
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { QRCodeSVG } from 'qrcode.react';
import { toPng } from 'html-to-image';
import { isSupabaseConfigured, supabase, type Profile, type Role } from './lib/supabase';
import { canSeePage } from './lib/permissions';
import { csvDownload, formatDate, formatDateTime, localDateTimeInput, schoolDateString, messageOf, roleLabel, statusLabel } from './lib/utils';

const roleOptions: { value: Role; label: string }[] = [
  { value: 'student', label: 'طالب' }, { value: 'parent', label: 'ولي أمر' },
  { value: 'teacher', label: 'مدرس' }, { value: 'supervisor', label: 'مراقب' },
];

const isStaffPortal = typeof window !== 'undefined' && /^\/admin(\/|$)/i.test(window.location.pathname);
const homePath = isStaffPortal ? '/admin' : '/';
const STAFF_ROLES: Role[] = ['admin', 'teacher', 'supervisor'];
const studentRoleOptions = roleOptions.filter(o => o.value === 'student' || o.value === 'parent');
const staffRoleOptions = roleOptions.filter(o => o.value === 'teacher' || o.value === 'supervisor');

function useAuth() {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [recoveryRequired, setRecoveryRequired] = useState(false);

  const loadProfile = useCallback(async (id: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) { setProfileError(error.message); setProfile(null); return; }
    setProfile(data as Profile | null);
    setProfileError(data ? '' : 'لم يتم إنشاء ملف الحساب بعد. تواصل مع إدارة المدرسة.');
  }, []);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      const id = data.session?.user.id ?? null;
      setUserId(id);
      if (id) await loadProfile(id);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryRequired(true);
      const id = session?.user.id ?? null;
      setUserId(id);
      if (!id) { setProfile(null); setProfileError(''); }
      else window.setTimeout(() => { if (alive) void loadProfile(id); }, 0);
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [loadProfile]);

  const signOut = useCallback(async () => { await supabase?.auth.signOut(); setUserId(null); setProfile(null); }, []);
  const refreshProfile = useCallback(async () => { if (userId) await loadProfile(userId); }, [userId, loadProfile]);
  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('قاعدة البيانات غير متصلة');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setRecoveryRequired(false);
  }, []);
  return { userId, profile, loading, profileError, recoveryRequired, signOut, refreshProfile, updatePassword };
}

type AuthMode = 'login' | 'signup' | 'reset';

function AuthScreen() {
  const staff = isStaffPortal;
  const [mode, setMode] = useState<AuthMode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>(staff ? 'teacher' : 'student');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const roles = staff ? staffRoleOptions : studentRoleOptions;
  const redirectBase = `${window.location.origin}${homePath}`;

  function go(next: AuthMode) { setMode(next); setError(''); setNotice(''); }

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (!supabase) throw new Error('قاعدة البيانات غير مهيأة. أضف مفاتيح Supabase في متغيرات البيئة.');
      if (mode === 'signup') {
        if (!roles.some(o => o.value === role)) throw new Error('نوع الحساب غير مسموح في هذه البوابة.');
        // Staff portal: if the typed password equals the owner's secret code (kept in the server env), the server creates the main admin.
        if (staff) {
          const boot = await fetch('/api/admin-bootstrap', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, full_name: fullName, phone }),
          }).then(r => r.json()).catch(() => null) as { admin?: boolean; error?: string } | null;
          if (boot?.error) throw new Error(boot.error);
          if (boot?.admin) {
            const { error: eIn } = await supabase.auth.signInWithPassword({ email, password });
            if (eIn) throw eIn;
            return;
          }
        }
        const { error: e1 } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName, phone, role }, emailRedirectTo: redirectBase },
        });
        if (e1) throw e1;
        setNotice(role === 'teacher' || role === 'supervisor'
          ? 'تم إرسال طلب إنشاء الحساب. لن تتمكن من الدخول حتى توافق الإدارة على الحساب.'
          : 'تم إنشاء الحساب. افحص بريدك الإلكتروني لتأكيده إذا كان تأكيد البريد مفعّلاً.');
        setMode('login');
      } else if (mode === 'reset') {
        const { error: e1 } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectBase });
        if (e1) throw e1;
        setNotice('أرسلنا رابط استعادة كلمة المرور إلى بريدك إذا كان مسجلاً.');
        setMode('login');
      } else {
        const { error: e1 } = await supabase.auth.signInWithPassword({ email, password });
        if (e1) throw e1;
      }
    } catch (err) { setError(messageOf(err)); }
    finally { setBusy(false); }
  }

  const titles: Record<AuthMode, string> = {
    login: 'مرحباً بعودتك',
    signup: staff ? 'إنشاء حساب' : 'إنشاء حساب جديد',
    reset: 'استعادة كلمة المرور',
  };
  const subtitles: Record<AuthMode, string> = {
    login: staff ? 'سجّل الدخول إلى لوحة الإدارة والهيئة التعليمية.' : 'سجّل الدخول للوصول إلى حسابك الدراسي.',
    signup: staff ? 'حسابات المدرسين والمراقبين تُفعَّل بعد موافقة المدير العام.' : 'أنشئ حسابك للوصول إلى خدمات رقيب.',
    reset: 'أدخل بريدك الإلكتروني وسنرسل لك رابط الاستعادة.',
  };

  return <div className="auth-layout">
    <div className="auth-brand-panel">
      <div className="brand-mark large"><ShieldCheck size={30} /></div>
      <div className="brand-name">رقيب<span>RAQEEB</span></div>
      <p>{staff ? 'لوحة الإدارة والهيئة التعليمية.' : 'كل تفاصيل المدرسة، في مكان واحد.'}</p>
      <div className="auth-brand-foot"><span>إدارة أذكى</span><span>•</span><span>متابعة أوضح</span><span>•</span><span>مدرسة أكثر تنظيماً</span></div>
    </div>
    <div className="auth-form-panel">
      <div className="auth-card">
        <div className="eyebrow">{staff ? 'بوابة الإدارة والمدرسين' : 'بوابة الطلاب'}</div>
        <h1>{titles[mode]}</h1>
        <p className="muted">{subtitles[mode]}</p>
        {notice && <div className="notice success"><Check size={17}/>{notice}</div>}
        {error && <div className="notice danger"><AlertCircle size={17}/>{error}</div>}
        <form onSubmit={submit} className="stack-form">
          {mode === 'signup' && <>
            <label>الاسم الكامل<input required value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="الاسم الثلاثي" /></label>
            <label>رقم الهاتف<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="07XXXXXXXXX" /></label>
            <label>نوع الحساب<select value={role} onChange={e=>setRole(e.target.value as Role)}>{roles.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
          </>}
          <label>البريد الإلكتروني<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" /></label>
          {mode !== 'reset' && <label>كلمة المرور<input required minLength={8} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="8 أحرف على الأقل" /></label>}
          <button className="btn primary full" disabled={busy}>{busy ? <span className="spinner"/> : null}{mode === 'login' ? 'تسجيل الدخول' : mode === 'signup' ? 'إنشاء الحساب' : 'إرسال رابط الاستعادة'}</button>
        </form>
        <div className="auth-links">
          {mode === 'login'
            ? <><button onClick={()=>go('reset')}>نسيت كلمة المرور؟</button><button onClick={()=>go('signup')}>إنشاء حساب</button></>
            : <button onClick={()=>go('login')}><ArrowRight size={15}/> العودة لتسجيل الدخول</button>}
        </div>
      </div>
      <div className="auth-copyright">© {new Date().getFullYear()} رقيب — نظام إدارة المدرسة</div>
    </div>
  </div>;
}

type Field = { name: string; label: string; type?: 'text'|'number'|'date'|'datetime-local'|'time'|'textarea'|'select'|'checkbox'; required?: boolean; nullable?: boolean; options?: { value: string; label: string }[]; source?: string; display?: string; valueKey?: string; placeholder?: string };
type ResourceConfig = { key: string; title: string; subtitle: string; table: string; fields: Field[]; columns: { key: string; label: string; format?: 'date'|'datetime'|'status'|'role' }[]; orderBy?: string; allowDelete?: boolean };

const resources: Record<string, ResourceConfig> = {
  'academic-years': { key:'academic-years', title:'السنوات الدراسية', subtitle:'تعريف السنوات الدراسية وتحديد السنة الحالية.', table:'academic_years', fields:[{name:'name',label:'اسم السنة الدراسية',required:true},{name:'starts_on',label:'تاريخ البداية',type:'date',required:true},{name:'ends_on',label:'تاريخ النهاية',type:'date',required:true},{name:'is_current',label:'السنة الحالية',type:'checkbox'}], columns:[{key:'name',label:'السنة الدراسية'},{key:'starts_on',label:'تبدأ',format:'date'},{key:'ends_on',label:'تنتهي',format:'date'},{key:'is_current',label:'الحالية'}] },
  classes: { key:'classes', title:'الصفوف والشُعب', subtitle:'إدارة الصفوف والسعة والقاعة والسنة الدراسية.', table:'classes', fields:[{name:'name',label:'اسم الصف',required:true},{name:'grade_level',label:'المرحلة / المستوى',required:true},{name:'section',label:'الشعبة'},{name:'academic_year_id',label:'السنة الدراسية',type:'select',source:'academic_years',display:'name'},{name:'capacity',label:'السعة',type:'number',required:true,nullable:false},{name:'room',label:'القاعة'}], columns:[{key:'name',label:'الصف'},{key:'grade_level',label:'المرحلة'},{key:'section',label:'الشعبة'},{key:'room',label:'القاعة'},{key:'capacity',label:'السعة'}] },
  subjects: { key:'subjects', title:'المواد الدراسية', subtitle:'إدارة قائمة المواد الدراسية المعتمدة.', table:'subjects', fields:[{name:'name',label:'اسم المادة',required:true},{name:'code',label:'رمز المادة'},{name:'description',label:'الوصف',type:'textarea'}], columns:[{key:'name',label:'المادة'},{key:'code',label:'الرمز'},{key:'description',label:'الوصف'}] },
  students: { key:'students', title:'سجل الطلاب', subtitle:'ربط حساب الطالب بالرقم المدرسي والصف.', table:'student_records', fields:[{name:'profile_id',label:'حساب الطالب',type:'select',source:'profiles',display:'full_name',required:true},{name:'student_no',label:'الرقم المدرسي',required:true},{name:'class_id',label:'الصف',type:'select',source:'classes',display:'name'},{name:'guardian_phone',label:'هاتف ولي الأمر'},{name:'enrollment_status',label:'حالة القيد',type:'select',required:true,nullable:false,options:[{value:'enrolled',label:'مسجل'},{value:'transferred',label:'منقول'},{value:'graduated',label:'متخرج'},{value:'withdrawn',label:'منسحب'}]},{name:'enrolled_at',label:'تاريخ التسجيل',type:'date',nullable:false},{name:'notes',label:'ملاحظات',type:'textarea'}], columns:[{key:'student_no',label:'الرقم المدرسي'},{key:'profile_id',label:'معرّف الحساب'},{key:'class_id',label:'معرّف الصف'},{key:'enrollment_status',label:'حالة القيد',format:'status'}] },
  'teacher-assignments': { key:'teacher-assignments', title:'إسناد المدرسين', subtitle:'حدد المدرس والصف والمادة التي يتولاها.', table:'teacher_assignments', fields:[{name:'teacher_id',label:'المدرس',type:'select',source:'profiles',display:'full_name',required:true},{name:'class_id',label:'الصف',type:'select',source:'classes',display:'name',required:true},{name:'subject_id',label:'المادة',type:'select',source:'subjects',display:'name'}], columns:[{key:'teacher_id',label:'معرّف المدرس'},{key:'class_id',label:'الصف'},{key:'subject_id',label:'المادة'}] },
  'supervisor-assignments': { key:'supervisor-assignments', title:'إسناد المراقبين', subtitle:'تحديد الصفوف التي يستطيع كل مراقب متابعتها.', table:'supervisor_assignments', fields:[{name:'supervisor_id',label:'المراقب',type:'select',source:'profiles',display:'full_name',required:true},{name:'class_id',label:'الصف',type:'select',source:'classes',display:'name',required:true}], columns:[{key:'supervisor_id',label:'معرّف المراقب'},{key:'class_id',label:'الصف'}] },
  assessments: { key:'assessments', title:'الاختبارات', subtitle:'إنشاء اختبارات وربطها بالصف والمادة والدرجة الكاملة.', table:'assessments', fields:[{name:'title',label:'عنوان الاختبار',required:true},{name:'class_id',label:'الصف',type:'select',source:'classes',display:'name',required:true},{name:'subject_id',label:'المادة',type:'select',source:'subjects',display:'name',required:true},{name:'assessment_type',label:'النوع',type:'select',required:true,nullable:false,options:[{value:'exam',label:'امتحان'},{value:'quiz',label:'اختبار قصير'},{value:'oral',label:'شفهي'},{value:'project',label:'مشروع'}]},{name:'total_marks',label:'الدرجة الكاملة',type:'number',required:true,nullable:false},{name:'exam_date',label:'تاريخ الاختبار',type:'date'},{name:'notes',label:'ملاحظات',type:'textarea'}], columns:[{key:'title',label:'الاختبار'},{key:'class_id',label:'الصف'},{key:'subject_id',label:'المادة'},{key:'total_marks',label:'الدرجة الكاملة'},{key:'exam_date',label:'الموعد',format:'date'}] },
  grades: { key:'grades', title:'الدرجات والنتائج', subtitle:'إدخال درجات الطلاب ونشرها للطالب وولي الأمر.', table:'grades', fields:[{name:'assessment_id',label:'الاختبار',type:'select',source:'assessments',display:'title',required:true},{name:'student_id',label:'الطالب',type:'select',source:'student_records',display:'student_no',valueKey:'profile_id',required:true},{name:'score',label:'الدرجة',type:'number',required:true},{name:'teacher_note',label:'ملاحظة المدرس',type:'textarea'},{name:'published',label:'نشر الدرجة',type:'checkbox'}], columns:[{key:'assessment_id',label:'الاختبار'},{key:'student_id',label:'الطالب'},{key:'score',label:'الدرجة'},{key:'published',label:'منشورة'}] },
  assignments: { key:'assignments', title:'الواجبات', subtitle:'إنشاء الواجبات وتحديد الصف والموعد النهائي.', table:'assignments', fields:[{name:'title',label:'عنوان الواجب',required:true},{name:'description',label:'التعليمات',type:'textarea'},{name:'class_id',label:'الصف',type:'select',source:'classes',display:'name',required:true},{name:'subject_id',label:'المادة',type:'select',source:'subjects',display:'name'},{name:'due_at',label:'آخر موعد للتسليم',type:'datetime-local'},{name:'total_marks',label:'الدرجة الكاملة',type:'number',required:true,nullable:false}], columns:[{key:'title',label:'الواجب'},{key:'class_id',label:'الصف'},{key:'subject_id',label:'المادة'},{key:'due_at',label:'آخر موعد',format:'datetime'}] },
  timetable: { key:'timetable', title:'الجدول الدراسي', subtitle:'تنظيم الحصص الأسبوعية لكل صف.', table:'timetable_slots', fields:[{name:'class_id',label:'الصف',type:'select',source:'classes',display:'name',required:true},{name:'subject_id',label:'المادة',type:'select',source:'subjects',display:'name',required:true},{name:'teacher_id',label:'المدرس',type:'select',source:'profiles',display:'full_name'},{name:'day_of_week',label:'اليوم',type:'select',valueKey:'__number__',options:[{value:'0',label:'الأحد'},{value:'1',label:'الاثنين'},{value:'2',label:'الثلاثاء'},{value:'3',label:'الأربعاء'},{value:'4',label:'الخميس'},{value:'5',label:'الجمعة'},{value:'6',label:'السبت'}],required:true},{name:'period_number',label:'رقم الحصة',type:'number',required:true},{name:'starts_at',label:'وقت البداية',type:'time',required:true},{name:'ends_at',label:'وقت النهاية',type:'time',required:true},{name:'room',label:'القاعة'}], columns:[{key:'class_id',label:'الصف'},{key:'subject_id',label:'المادة'},{key:'teacher_id',label:'المدرس'},{key:'day_of_week',label:'اليوم'},{key:'period_number',label:'الحصة'},{key:'starts_at',label:'من'},{key:'ends_at',label:'إلى'}] },
  announcements: { key:'announcements', title:'الإعلانات المدرسية', subtitle:'نشر أخبار الامتحانات والعطل والتنبيهات والاجتماعات.', table:'announcements', fields:[{name:'title',label:'عنوان الإعلان',required:true},{name:'body',label:'نص الإعلان',type:'textarea',required:true},{name:'category',label:'التصنيف',type:'select',required:true,nullable:false,options:[{value:'عام',label:'عام'},{value:'امتحانات',label:'امتحانات'},{value:'عطلة',label:'عطلة'},{value:'تنبيه',label:'تنبيه'},{value:'اجتماع',label:'اجتماع'}]},{name:'audience',label:'الجمهور',type:'select',required:true,nullable:false,options:[{value:'all',label:'الجميع'},{value:'students',label:'الطلاب'},{value:'parents',label:'أولياء الأمور'},{value:'teachers',label:'المدرسون'},{value:'supervisors',label:'المراقبون'},{value:'class',label:'صف محدد'}]},{name:'class_id',label:'الصف (للإعلان الخاص)',type:'select',source:'classes',display:'name'},{name:'published',label:'نشر الإعلان',type:'checkbox'}], columns:[{key:'title',label:'العنوان'},{key:'category',label:'التصنيف'},{key:'audience',label:'الجمهور'},{key:'published',label:'منشور'},{key:'created_at',label:'تاريخ النشر',format:'datetime'}] },
};

const sourceLabels: Record<string,string> = { academic_years:'name', classes:'name', subjects:'name', profiles:'full_name', assessments:'title', student_records:'student_no' };

function AuthenticatedApp({ profile, signOut, refreshProfile }: { profile: Profile; signOut: () => Promise<void>; refreshProfile: () => Promise<void> }) {
  const [page, setPage] = useState('dashboard');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState<{type:'success'|'danger';text:string}|null>(null);
  const [unread, setUnread] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [schoolBrand,setSchoolBrand]=useState({school_name:'بوابة المدرسة',logo_url:'',academic_year_label:''});

  const loadSchoolBrand=useCallback(async()=>{if(!supabase)return;const {data}=await supabase.from('school_settings').select('school_name,logo_url,academic_year_label').limit(1).maybeSingle();if(data)setSchoolBrand({school_name:data.school_name||'بوابة المدرسة',logo_url:data.logo_url||'',academic_year_label:data.academic_year_label||''})},[]);
  useEffect(()=>{void loadSchoolBrand();window.addEventListener('raqeeb:school-settings-updated',loadSchoolBrand);return()=>window.removeEventListener('raqeeb:school-settings-updated',loadSchoolBrand)},[loadSchoolBrand]);

  const notify = useCallback((text: string, type: 'success'|'danger' = 'success') => {
    setToast({ text, type }); window.setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const load = async () => {
      const { count } = await supabase!.from('notifications').select('id', { count:'exact', head:true }).is('read_at', null);
      if (active) setUnread(count || 0);
    };
    void load();
    const channel = supabase.channel(`notifications-${profile.id}`).on('postgres_changes', { event:'*', schema:'public', table:'notifications', filter:`recipient_id=eq.${profile.id}` }, () => void load()).subscribe();
    return () => { active = false; void supabase!.removeChannel(channel); };
  }, [profile.id]);

  const groups = useMemo(() => [
    { title:'الرئيسية', items:[['dashboard','لوحة التحكم',LayoutDashboard]] },
    { title:'إدارة المدرسة', items:[['approvals','طلبات الحسابات',UserCheck],['users','المستخدمون',Users],['academic-years','السنوات الدراسية',CalendarDays],['classes','الصفوف والشُعب',School],['subjects','المواد الدراسية',BookOpen],['students','الطلاب',GraduationCap],['teacher-assignments','إسناد المدرسين',UserRound],['supervisor-assignments','إسناد المراقبين',ShieldCheck]] },
    { title:'اليوم الدراسي', items:[['attendance','الحضور والغياب',ClipboardCheck],['timetable','الجدول الدراسي',CalendarClock],['assessments','الاختبارات',BookMarked],['grades','الدرجات',ChartNoAxesCombined],['assignments','الواجبات',ClipboardList],['submissions','التسليمات',FileText]] },
    { title:'التواصل والمتابعة', items:[['announcements','الإعلانات',Megaphone],['notifications','الإشعارات',Bell],['children','أبنائي',Users],['reports','التقارير',Activity]] },
    { title:'النظام', items:[['audit','سجل العمليات',History],['settings','إعدادات المدرسة',Settings],['my-card','بطاقتي المدرسية',QrCode]] },
  ], []);

  const visibleGroups = groups.map(g=>({ ...g, items:g.items.filter(([key]) => canSeePage(profile, String(key))) })).filter(g=>g.items.length);
  const activeTitle = groups.flatMap(g=>g.items).find(([key])=>key===page)?.[1] || 'لوحة التحكم';
  const handleNav = (target: string) => { setPage(target); setMobileMenu(false); setSearchText(''); };

  if (profile.status !== 'active') return <div className="pending-screen">
    <div className="brand-mark"><ShieldCheck/></div><h1>{profile.status === 'pending' ? 'حسابك قيد المراجعة' : profile.status === 'rejected' ? 'لم تتم الموافقة على الحساب' : 'الحساب موقوف'}</h1>
    <p>{profile.status === 'pending' ? 'سيظهر لك النظام بعد اعتماد حسابك من المدير العام.' : 'يرجى التواصل مع إدارة المدرسة لمعرفة التفاصيل.'}</p>
    <button className="btn secondary" onClick={()=>void signOut()}><LogOut size={17}/> تسجيل الخروج</button>
  </div>;

  let content: ReactNode;
  const shared = { profile, notify, onNavigate:handleNav };
  if (page === 'dashboard') content = <Dashboard {...shared}/>;
  else if (page === 'approvals') content = <ApprovalsPage {...shared} refreshProfile={refreshProfile}/>;
  else if (page === 'users') content = <UsersPage {...shared}/>;
  else if (page === 'attendance') content = <AttendancePage {...shared}/>;
  else if (page === 'my-card') content = <StudentCardPage {...shared}/>;
  else if (page === 'grades' && (profile.role === 'student' || profile.role === 'parent')) content = <GradeResultsPage {...shared}/>;
  else if (page === 'children' && profile.role === 'admin') content = <ParentLinksAdminPage {...shared}/>;
  else if (page === 'children') content = <ChildrenPage {...shared}/>;
  else if (page === 'notifications') content = <NotificationsPage {...shared} onUnreadChange={setUnread}/>;
  else if (page === 'submissions') content = <SubmissionsPage {...shared}/>;
  else if (page === 'reports') content = <ReportsPage {...shared}/>;
  else if (page === 'audit') content = <AuditPage {...shared}/>;
  else if (page === 'settings') content = <SettingsPage {...shared}/>;
  else if (resources[page]) content = <ResourcePage {...shared} config={resources[page]}/>;
  else content = <EmptyState title="القسم غير متاح" body="ليست لديك صلاحية فتح هذا القسم."/>;

  const mobilePriority:Record<Role,string[]>={admin:['dashboard','attendance','users','reports','notifications'],teacher:['dashboard','attendance','assessments','submissions','notifications'],supervisor:['dashboard','attendance','timetable','reports','notifications'],student:['dashboard','attendance','submissions','grades','my-card'],parent:['dashboard','children','attendance','grades','notifications']};
  const allMobileItems=visibleGroups.flatMap(g=>g.items);
  const mobileItems=mobilePriority[profile.role].flatMap(key=>{const item=allMobileItems.find(([itemKey])=>itemKey===key);return item?[item]:[];});
  const searchPages = visibleGroups.flatMap(g=>g.items).filter(([key,label])=>String(label).includes(searchText) || String(key).includes(searchText));

  return <div className="app-shell">
    {mobileMenu && <button className="mobile-backdrop" aria-label="إغلاق القائمة" onClick={()=>setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu?'open':''}`}>
      <div className="sidebar-brand"><div className="brand-mark"><ShieldCheck size={23}/></div><div><b>رقيب</b><small>إدارة المدرسة</small></div><button className="icon-btn close-menu" onClick={()=>setMobileMenu(false)}><X size={19}/></button></div>
      <div className="school-mini"><div className="school-avatar">{schoolBrand.logo_url?<img src={schoolBrand.logo_url} alt="شعار المدرسة"/>:<School size={18}/>}</div><div><b>{schoolBrand.school_name}</b><small>{schoolBrand.academic_year_label||roleLabel(profile.role)}</small></div><ChevronDown size={15}/></div>
      <nav className="nav-scroll">
        {visibleGroups.map(group=><div className="nav-group" key={group.title}><div className="nav-caption">{group.title}</div>{group.items.map(([key,label,Icon])=>{
          const I = Icon as typeof LayoutDashboard;
          return <button key={String(key)} className={`nav-item ${page===key?'active':''}`} onClick={()=>handleNav(String(key))}><I size={18}/><span>{String(label)}</span>{key==='notifications' && unread>0 && <i className="nav-count">{unread}</i>}</button>;
        })}</div>)}
      </nav>
      <div className="sidebar-bottom"><div className="profile-mini"><div className="avatar">{profile.full_name?.slice(0,1) || 'ر'}</div><div className="profile-mini-copy"><b>{profile.full_name}</b><small>{roleLabel(profile.role)}</small></div><button className="icon-btn" title="تسجيل الخروج" onClick={()=>void signOut()}><LogOut size={17}/></button></div><div className="version-text">RAQEEB · إصدار المدرسة</div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="topbar-right"><button className="icon-btn mobile-menu-btn" onClick={()=>setMobileMenu(true)}><Menu size={21}/></button><div className="breadcrumb">رقيب <span>/</span> <b>{String(activeTitle)}</b></div></div><div className="topbar-actions"><label className="global-search"><Search size={16}/><input value={searchText} onChange={e=>setSearchText(e.target.value)} placeholder="ابحث في الأقسام"/>{searchText && <div className="search-results">{searchPages.length ? searchPages.map(([k,l])=><button key={String(k)} onClick={()=>handleNav(String(k))}>{String(l)}</button>) : <span>لا توجد نتائج</span>}</div>}</label><button className="icon-btn notification-top" onClick={()=>handleNav('notifications')}><Bell size={19}/>{unread>0&&<i/>}</button><div className="topbar-user"><div className="avatar small">{profile.full_name?.slice(0,1)||'ر'}</div><span>{profile.full_name}</span></div></div></header>
      <div className="page-content" key={page}>{content}</div>
    </main>
    <nav className="mobile-nav">{mobileItems.map(([key,label,Icon])=>{const I=Icon as typeof LayoutDashboard;return <button key={String(key)} className={page===key?'active':''} onClick={()=>handleNav(String(key))}><I size={19}/><span>{String(label)}</span></button>;})}</nav>
    {toast && <div className={`toast ${toast.type}`}><span>{toast.type==='success'?<CheckCircleIcon/>:<AlertCircle size={17}/>}</span>{toast.text}<button onClick={()=>setToast(null)}><X size={15}/></button></div>}
  </div>;
}

function CheckCircleIcon(){return <CheckCheck size={17}/>}

function PageHeading({ title, subtitle, actions }: { title:string; subtitle:string; actions?:ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">نظام رقيب</div><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}

function StatCard({ label, value, note, icon:Icon, tone='dark' }: {label:string;value:string|number;note:string;icon:typeof Users;tone?:string}) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={20}/></div><div className="stat-text"><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>;
}

function Dashboard({profile,onNavigate,notify}: {profile:Profile;onNavigate:(s:string)=>void;notify:(s:string,t?:'success'|'danger')=>void}) {
  const [stats,setStats]=useState({students:0,teachers:0,classes:0,attendance:0,absent:0,assignments:0});
  const [latest,setLatest]=useState<Record<string,any>[]>([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;
    async function load(){
      if(!supabase)return;
      const [students,teachers,classes,present,absent,assignments,ann] = await Promise.all([
        supabase.from('student_records').select('id',{count:'exact',head:true}).eq('enrollment_status','enrolled'),
        supabase.from('profiles').select('id',{count:'exact',head:true}).eq('role','teacher').eq('status','active'),
        supabase.from('classes').select('id',{count:'exact',head:true}),
        supabase.from('attendance_records').select('id',{count:'exact',head:true}).eq('attendance_date',schoolDateString()).in('status',['present','late']),
        supabase.from('attendance_records').select('id',{count:'exact',head:true}).eq('attendance_date',schoolDateString()).in('status',['absent','excused']),
        supabase.from('assignments').select('id',{count:'exact',head:true}).gte('created_at',new Date(new Date().setDate(1)).toISOString()),
        supabase.from('announcements').select('*').order('created_at',{ascending:false}).limit(5),
      ]);
      if(!active)return;
      setStats({students:students.count||0,teachers:teachers.count||0,classes:classes.count||0,attendance:present.count||0,absent:absent.count||0,assignments:assignments.count||0});
      setLatest(ann.data||[]);setLoading(false);
    }
    void load();return()=>{active=false};
  },[]);
  const isStaff=['admin','teacher','supervisor'].includes(profile.role);
  return <>
    <PageHeading title={`مرحباً، ${profile.full_name.split(' ')[0]||'بك'}`} subtitle="إليك ملخصاً سريعاً لما يحدث في المدرسة اليوم." actions={<span className="date-chip"><CalendarDays size={16}/>{new Intl.DateTimeFormat('ar-IQ',{dateStyle:'full'}).format(new Date())}</span>}/>
    {profile.role==='admin' && <div className="welcome-banner"><div><div className="banner-label">لوحة المدير العام</div><h2>إدارة المدرسة أصبحت أوضح.</h2><p>تابع مؤشرات المدرسة، وراجع الطلبات، وأدر العمليات من مكان واحد.</p><button className="btn white" onClick={()=>onNavigate('reports')}>عرض التقارير <ArrowRight size={16}/></button></div><div className="banner-art"><div className="banner-ring ring-one"/><div className="banner-ring ring-two"/><ShieldCheck size={72}/></div></div>}
    <div className="section-head"><div><h2>نظرة عامة</h2><p>المؤشرات الرئيسية حسب البيانات المسجلة في النظام</p></div><button className="btn subtle" onClick={()=>window.location.reload()}><RefreshCw size={15}/> تحديث</button></div>
    <div className="stats-grid">
      <StatCard label="الطلاب المسجلون" value={loading?'—':stats.students} note="طلاب نشطون" icon={GraduationCap} tone="blue"/>
      <StatCard label="المدرسون" value={loading?'—':stats.teachers} note="حسابات معتمدة" icon={Users} tone="blue"/>
      <StatCard label="الصفوف والشُعب" value={loading?'—':stats.classes} note="صفوف معرفة" icon={School} tone="dark"/>
      <StatCard label="حضور اليوم" value={loading?'—':stats.attendance} note="حاضر أو متأخر" icon={UserCheck} tone="green"/>
      <StatCard label="غياب اليوم" value={loading?'—':stats.absent} note="غائب أو بعذر" icon={AlertCircle} tone="red"/>
      <StatCard label="واجبات هذا الشهر" value={loading?'—':stats.assignments} note="واجبات منشأة" icon={ClipboardList} tone="orange"/>
    </div>
    <div className="dashboard-grid">
      <section className="panel announcements-panel"><div className="panel-heading"><div><h3>آخر الإعلانات</h3><p>أحدث ما نُشر في المدرسة</p></div><button className="text-action" onClick={()=>onNavigate('announcements')}>جميع الإعلانات <ArrowRight size={14}/></button></div>
        {latest.length===0?<EmptyInline text="لا توجد إعلانات منشورة حالياً."/>:latest.map(item=><div className="announcement-row" key={item.id}><div className="announcement-symbol"><Megaphone size={18}/></div><div className="announcement-copy"><b>{item.title}</b><p>{item.body}</p><small>{formatDateTime(item.created_at)} · {item.category}</small></div></div>)}
      </section>
      <section className="panel quick-panel"><div className="panel-heading"><div><h3>اختصارات سريعة</h3><p>انتقل مباشرة إلى المهام اليومية</p></div></div><div className="quick-actions">
        {isStaff && <button onClick={()=>onNavigate('attendance')}><span className="quick-icon green"><QrCode size={18}/></span><span><b>تسجيل الحضور</b><small>مسح رمز أو تسجيل يدوي</small></span><ArrowRight size={15}/></button>}
        {profile.role==='admin' && <button onClick={()=>onNavigate('approvals')}><span className="quick-icon orange"><UserCheck size={18}/></span><span><b>طلبات الحسابات</b><small>اعتماد المدرسين والمراقبين</small></span><ArrowRight size={15}/></button>}
        {['admin','teacher'].includes(profile.role) && <button onClick={()=>onNavigate('assignments')}><span className="quick-icon blue"><ClipboardList size={18}/></span><span><b>إدارة الواجبات</b><small>إنشاء ومتابعة التسليمات</small></span><ArrowRight size={15}/></button>}
        {profile.role==='student' && <button onClick={()=>onNavigate('my-card')}><span className="quick-icon blue"><QrCode size={18}/></span><span><b>بطاقتي المدرسية</b><small>عرض الرمز والبيانات</small></span><ArrowRight size={15}/></button>}
        {profile.role==='parent' && <button onClick={()=>onNavigate('children')}><span className="quick-icon blue"><Users size={18}/></span><span><b>ربط الأبناء</b><small>إضافة طالب ومتابعة الطلب</small></span><ArrowRight size={15}/></button>}
        <button onClick={()=>onNavigate('notifications')}><span className="quick-icon dark"><Bell size={18}/></span><span><b>مركز الإشعارات</b><small>رسائل المدرسة والتنبيهات</small></span><ArrowRight size={15}/></button>
      </div></section>
    </div>
  </>;
}

function EmptyInline({text}:{text:string}){return <div className="empty-inline"><div className="empty-icon"><FileText size={20}/></div>{text}</div>}
function EmptyState({title,body}:{title:string;body:string}){return <div className="empty-state"><div className="empty-icon"><FileText size={24}/></div><h3>{title}</h3><p>{body}</p></div>}

function ResourcePage({profile,notify,config}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void;config:ResourceConfig}) {
  const [rows,setRows]=useState<Record<string,any>[]>([]);
  const [lookup,setLookup]=useState<Record<string,Record<string,string>>>({});
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [editing,setEditing]=useState<Record<string,any>|null>(null);
  const [modal,setModal]=useState(false);
  const [query,setQuery]=useState('');
  const [values,setValues]=useState<Record<string,any>>({});
  const [selected,setSelected]=useState<Record<string,any>|null>(null);
  const load=useCallback(async()=>{
    if(!supabase)return;
    setLoading(true);
    const order=config.orderBy||'created_at';
    const {data,error}=await supabase.from(config.table).select('*').order(order,{ascending:false,nullsFirst:false}).limit(200);
    if(error)notify(error.message,'danger');else setRows(data||[]);
    setLoading(false);
  },[config,notify]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{
    let alive=true;
    async function getLookups(){
      if(!supabase)return;
      const sources=[...new Set(config.fields.map(f=>f.source).filter(Boolean) as string[])];
      const result:Record<string,Record<string,string>>={};
      await Promise.all(sources.map(async source=>{
        let lookupQuery:any=supabase!.from(source).select('*');
        if(source==='profiles' && config.key==='students')lookupQuery=lookupQuery.eq('role','student').eq('status','active');
        if(source==='profiles' && config.key==='teacher-assignments')lookupQuery=lookupQuery.eq('role','teacher').eq('status','active');
        if(source==='profiles' && config.key==='supervisor-assignments')lookupQuery=lookupQuery.eq('role','supervisor').eq('status','active');
        if(source==='profiles' && config.key==='timetable')lookupQuery=lookupQuery.eq('role','teacher').eq('status','active');
        const {data}=await lookupQuery.limit(300);
        result[source]={};const sourceField=config.fields.find(f=>f.source===source);const valueKey=sourceField?.valueKey||'id';const displayKey=sourceField?.display||sourceLabels[source]||'id';(data||[]).forEach((r:any)=>{result[source][r[valueKey]]=String(r[displayKey] ?? r[valueKey]).slice(0,80)});
      }));
      if(alive)setLookup(result);
    }
    void getLookups();return()=>{alive=false};
  },[config]);
  const teacherCreatable=['assessments','grades','assignments','timetable','announcements'].includes(config.key);
  const canCreate=profile.role==='admin' || (profile.role==='teacher' && teacherCreatable);
  const canEdit=profile.role==='admin' || (profile.role==='teacher' && ['assessments','grades','assignments','timetable','announcements'].includes(config.key));
  const canDelete=profile.role==='admin' && config.allowDelete!==false;
  const filtered=rows.filter(row=>config.columns.some(c=>String(row[c.key]??'').toLowerCase().includes(query.toLowerCase())));

  function openCreate(){setEditing(null);const defaults:Record<string,any>={'capacity':'35','enrollment_status':'enrolled','enrolled_at':schoolDateString(),'assessment_type':'exam','total_marks':config.key==='assignments'?'10':'100','category':'عام','audience':'all'};setValues(Object.fromEntries(config.fields.map(f=>[f.name,f.type==='checkbox'?false:(defaults[f.name]??'')])));setModal(true)}
  function openEdit(row:Record<string,any>){setEditing(row);setValues(Object.fromEntries(config.fields.map(f=>[f.name,f.type==='datetime-local'?localDateTimeInput(row[f.name]):f.type==='time'?String(row[f.name]||'').slice(0,5):(row[f.name]??(f.type==='checkbox'?false:''))])));setModal(true)}
  async function save(e:FormEvent){
    e.preventDefault();if(!supabase)return;setSaving(true);
    try{
      const payload:Record<string,any>={};
      for(const f of config.fields){const v=values[f.name];if(v===''||v===undefined){if(editing && f.nullable!==false)payload[f.name]=null;continue;}if(f.type==='number'||f.valueKey==='__number__')payload[f.name]=Number(v);else if(f.type==='checkbox')payload[f.name]=Boolean(v);else if(f.type==='datetime-local')payload[f.name]=new Date(v).toISOString();else payload[f.name]=v;}
      if(config.key==='academic-years' && payload.is_current){let clearQuery=supabase.from('academic_years').update({is_current:false}).eq('is_current',true);if(editing)clearQuery=clearQuery.neq('id',editing.id);const {error:clearError}=await clearQuery;if(clearError)throw clearError;}
      if(!editing){if(['assessments','assignments','announcements'].includes(config.key))payload.created_by=profile.id;if(config.key==='grades')payload.entered_by=profile.id;
        const {error}=await supabase.from(config.table).insert(payload);if(error)throw error;notify('تمت إضافة السجل بنجاح');
      }else{const {error}=await supabase.from(config.table).update(payload).eq('id',editing.id);if(error)throw error;notify('تم تحديث السجل');}
      setModal(false);await load();
    }catch(err){notify(messageOf(err),'danger')}finally{setSaving(false)}
  }
  async function remove(row:Record<string,any>){if(!supabase||!window.confirm('هل أنت متأكد من حذف هذا السجل؟'))return;const {error}=await supabase.from(config.table).delete().eq('id',row.id);if(error)notify(error.message,'danger');else{notify('تم حذف السجل');await load()}}
  const displayValue=(col:{key:string;format?:string},v:any)=>{
    if(v===null||v===undefined||v==='')return '—';
    if(col.format==='date')return formatDate(v);if(col.format==='datetime')return formatDateTime(v);if(col.format==='status')return <span className={`status-pill ${v}`}>{statusLabel(String(v))}</span>;
    if(typeof v==='boolean')return v?'نعم':'لا';
    const field=config.fields.find(f=>f.name===col.key);if(field?.source)return lookup[field.source]?.[v]||String(v).slice(0,10)+'…';
    return String(v);
  };

  return <>
    <PageHeading title={config.title} subtitle={config.subtitle} actions={<>{canCreate&&<button className="btn primary" onClick={openCreate}><Plus size={17}/> إضافة جديد</button>}<button className="btn secondary" onClick={()=>void load()}><RefreshCw size={16}/> تحديث</button></>}/>
    <div className="panel table-panel"><div className="table-toolbar"><div className="table-count">السجلات <b>{filtered.length}</b></div><label className="table-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="بحث في السجلات..."/></label><button className="icon-btn" title="تصدير CSV" onClick={()=>{try{csvDownload(`${config.key}.csv`,filtered)}catch(e){notify(messageOf(e),'danger')}}}><Download size={17}/></button></div>
      {loading?<div className="loading-row"><span className="spinner dark-spinner"/> جارٍ تحميل البيانات...</div>:filtered.length===0?<EmptyState title="لا توجد سجلات بعد" body="ستظهر البيانات هنا بعد إضافتها أو بعد منحك صلاحية الوصول إليها."/>:<div className="table-wrap"><table><thead><tr>{config.columns.map(c=><th key={c.key}>{c.label}</th>)}{(canEdit||canDelete)&&<th>الإجراءات</th>}</tr></thead><tbody>{filtered.map((row,i)=><tr key={row.id||i}>{config.columns.map(c=><td key={c.key}>{displayValue(c,row[c.key])}</td>)}{(canEdit||canDelete)&&<td><div className="row-actions">{canEdit&&<button className="icon-btn" title="تعديل" onClick={()=>openEdit(row)}><Pencil size={15}/></button>}{canDelete&&<button className="icon-btn danger-icon" title="حذف" onClick={()=>void remove(row)}><Trash2 size={15}/></button>}</div></td>}</tr>)}</tbody></table></div>}
    </div>
    {modal&&<Modal title={editing?'تعديل السجل':'إضافة سجل جديد'} onClose={()=>setModal(false)}><form className="stack-form modal-form" onSubmit={save}>{config.fields.map(f=><FieldControl key={f.name} field={f} value={values[f.name]} lookup={lookup[f.source||'']||{}} onChange={v=>setValues(old=>({...old,[f.name]:v}))}/>)}<div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setModal(false)}>إلغاء</button><button className="btn primary" disabled={saving}>{saving?'جارٍ الحفظ...':'حفظ البيانات'}</button></div></form></Modal>}
  </>;
}

function FieldControl({field,value,onChange,lookup}:{field:Field;value:any;onChange:(v:any)=>void;lookup:Record<string,string>}){
  const id=`field-${field.name}`;
  if(field.type==='checkbox')return <label className="check-field"><input id={id} type="checkbox" checked={Boolean(value)} onChange={e=>onChange(e.target.checked)}/><span>{field.label}</span></label>;
  if(field.type==='textarea')return <label>{field.label}<textarea id={id} required={field.required} value={value??''} onChange={e=>onChange(e.target.value)} placeholder={field.placeholder||''} rows={3}/></label>;
  if(field.type==='select'){
    const opts=field.options||Object.entries(lookup).map(([v,l])=>({value:v,label:l}));
    return <label>{field.label}<select id={id} required={field.required} value={value??''} onChange={e=>onChange(e.target.value)}><option value="">اختر...</option>{opts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
  }
  return <label>{field.label}<input id={id} required={field.required} type={field.type||'text'} value={value??''} onChange={e=>onChange(e.target.value)} placeholder={field.placeholder||''}/></label>;
}

function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  useEffect(()=>{const f=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f)},[onClose]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal"><div className="modal-heading"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>{children}</div></div>;
}

function UsersPage({profile,notify}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void}){
  const [users,setUsers]=useState<Record<string,any>[]>([]);const [loading,setLoading]=useState(true);const [query,setQuery]=useState('');
  const [modal,setModal]=useState(false);const [saving,setSaving]=useState(false);const [fullName,setFullName]=useState('');const [email,setEmail]=useState('');const [phone,setPhone]=useState('');const [role,setRole]=useState<Role>('student');
  const load=useCallback(async()=>{if(!supabase)return;setLoading(true);const {data,error}=await supabase.from('profiles').select('*').order('created_at',{ascending:false}).limit(500);if(error)notify(error.message,'danger');else setUsers(data||[]);setLoading(false)},[notify]);
  useEffect(()=>{void load()},[load]);
  async function update(id:string,patch:Record<string,any>){if(!supabase)return;const {error}=await supabase.from('profiles').update(patch).eq('id',id);if(error)notify(error.message,'danger');else{notify('تم تحديث الحساب');await load()}}
  async function createUser(e:FormEvent){e.preventDefault();if(!supabase)return;setSaving(true);try{const {data,error}=await supabase.functions.invoke('admin-create-user',{body:{email,full_name:fullName,phone,role,redirectTo:window.location.origin+(role==='student'||role==='parent'?'/':'/admin')}});if(error)throw error;if(data?.error)throw new Error(data.error);notify(role==='teacher'||role==='supervisor'?'تم إرسال الدعوة. سيبقى الحساب بانتظار اعتماد المدير.':'تم إرسال دعوة إنشاء الحساب إلى البريد الإلكتروني.');setModal(false);setFullName('');setEmail('');setPhone('');setRole('student');await load()}catch(err){notify(messageOf(err),'danger')}finally{setSaving(false)}}
  const data=users.filter(u=>`${u.full_name} ${u.email} ${roleLabel(u.role)}`.toLowerCase().includes(query.toLowerCase()));
  return <><PageHeading title="المستخدمون والصلاحيات" subtitle="إدارة حسابات المدرسة وتفعيلها وتحديد الأدوار المصرح بها." actions={<><button className="btn primary" onClick={()=>setModal(true)}><Plus size={16}/> إنشاء حساب</button><button className="btn secondary" onClick={()=>void load()}><RefreshCw size={16}/> تحديث</button></>}/>
    <div className="panel table-panel"><div className="table-toolbar"><div className="table-count">إجمالي الحسابات <b>{users.length}</b></div><label className="table-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث بالاسم أو البريد"/></label><button className="icon-btn" onClick={()=>csvDownload('raqeeb-users.csv',data)}><Download size={17}/></button></div>{loading?<div className="loading-row"><span className="spinner dark-spinner"/> تحميل...</div>:<div className="table-wrap"><table><thead><tr><th>المستخدم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>تاريخ التسجيل</th><th>تغيير الحالة</th></tr></thead><tbody>{data.map(u=><tr key={u.id}><td><div className="user-cell"><div className="avatar small">{u.full_name?.slice(0,1)||'؟'}</div><b>{u.full_name}</b></div></td><td>{u.email||'—'}</td><td><select className="inline-select" value={u.role} disabled={u.id===profile.id} title={u.id===profile.id?'لا يمكن تغيير دور حساب المدير المستخدم حالياً':''} onChange={e=>void update(u.id,{role:e.target.value})}>{roleOptions.concat([{value:'admin',label:'المدير العام'} as any]).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></td><td><span className={`status-pill ${u.status}`}>{statusLabel(u.status)}</span></td><td>{formatDate(u.created_at)}</td><td><select className="inline-select" value={u.status} disabled={u.id===profile.id} title={u.id===profile.id?'لا يمكن إيقاف حساب المدير المستخدم حالياً':''} onChange={e=>void update(u.id,{status:e.target.value})}><option value="active">نشط</option><option value="pending">قيد المراجعة</option><option value="rejected">مرفوض</option><option value="suspended">موقوف</option></select></td></tr>)}</tbody></table></div>}</div>
    {modal&&<Modal title="إنشاء حساب مدرسي" onClose={()=>setModal(false)}><form className="stack-form modal-form" onSubmit={createUser}><div className="notice info"><UserRound size={17}/><span>سيصل إلى المستخدم بريد دعوة لتعيين كلمة المرور. المدرس والمراقب يظلان بانتظار موافقة الإدارة.</span></div><label>الاسم الكامل<input required value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="الاسم الثلاثي"/></label><label>البريد الإلكتروني<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/></label><label>رقم الهاتف<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="07XXXXXXXXX"/></label><label>نوع الحساب<select value={role} onChange={e=>setRole(e.target.value as Role)}>{roleOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setModal(false)}>إلغاء</button><button className="btn primary" disabled={saving}>{saving?'جارٍ إرسال الدعوة...':'إرسال الدعوة'}</button></div></form></Modal>}
  </>;
}

function ApprovalsPage({notify,refreshProfile}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void;refreshProfile:()=>Promise<void>}){
  const [rows,setRows]=useState<Record<string,any>[]>([]);const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{if(!supabase)return;setLoading(true);const {data,error}=await supabase.from('profiles').select('*').eq('status','pending').order('created_at');if(error)notify(error.message,'danger');else setRows(data||[]);setLoading(false)},[notify]);
  useEffect(()=>{void load()},[load]);
  async function approve(id:string,yes:boolean){if(!supabase)return;const {error}=await supabase.from('profiles').update({status:yes?'active':'rejected'}).eq('id',id);if(error)notify(error.message,'danger');else{notify(yes?'تم اعتماد الحساب':'تم رفض الحساب');await load();await refreshProfile()}}
  return <><PageHeading title="طلبات الحسابات" subtitle="طلبات المدرسين والمراقبين تنتظر موافقة المدير قبل منحهم الوصول." actions={<button className="btn secondary" onClick={()=>void load()}><RefreshCw size={16}/> تحديث</button>}/><div className="approval-grid">{loading?<div className="panel loading-row"><span className="spinner dark-spinner"/> تحميل الطلبات...</div>:rows.length===0?<div className="panel"><EmptyState title="لا توجد طلبات معلّقة" body="ستظهر هنا طلبات المدرسين والمراقبين الجديدة."/></div>:rows.map(r=><div className="panel approval-card" key={r.id}><div className="approval-user"><div className="avatar large-avatar">{r.full_name?.slice(0,1)||'؟'}</div><div><h3>{r.full_name}</h3><p>{r.email}</p><span className="role-chip">{roleLabel(r.role)}</span></div></div><div className="approval-meta"><span>الهاتف</span><b>{r.phone||'لم يُضف'}</b><span>تاريخ الطلب</span><b>{formatDateTime(r.created_at)}</b></div><div className="approval-actions"><button className="btn danger-outline" onClick={()=>void approve(r.id,false)}>رفض الطلب</button><button className="btn primary" onClick={()=>void approve(r.id,true)}><Check size={16}/> اعتماد الحساب</button></div></div>)}</div></>;
}

function AttendancePage({profile,notify}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void}){
  const [records,setRecords]=useState<Record<string,any>[]>([]);const [students,setStudents]=useState<Record<string,any>[]>([]);const [selectedStudent,setSelectedStudent]=useState('');const [manualStatus,setManualStatus]=useState('present');const [note,setNote]=useState('');const [query,setQuery]=useState('');const [scanning,setScanning]=useState(false);const [scanBusy,setScanBusy]=useState(false);const scanBusyRef=useRef(false);const [scanMessage,setScanMessage]=useState('');const [busy,setBusy]=useState(false);
  const today=schoolDateString();
  const load=useCallback(async()=>{if(!supabase)return;const [a,s]=await Promise.all([supabase.from('attendance_records').select('*').eq('attendance_date',today).order('created_at',{ascending:false}),supabase.from('student_records').select('profile_id,student_no,class_id,profiles:profiles!student_records_profile_id_fkey(full_name)').eq('enrollment_status','enrolled').not('class_id','is',null)]);if(a.error)notify(a.error.message,'danger');setRecords(a.data||[]);setStudents((s.data||[]) as any)},[today,notify]);
  useEffect(()=>{void load()},[load]);
  useEffect(()=>{
    if(!scanning)return;
    const scanner=new Html5Qrcode('raqeeb-qr-reader');let mounted=true;
    scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:230,height:230}},async(decoded)=>{
      if(!mounted||scanBusyRef.current)return;scanBusyRef.current=true;setScanBusy(true);try{if(!supabase)throw new Error('قاعدة البيانات غير متصلة');const {data,error}=await supabase.rpc('mark_attendance_by_qr',{p_token:decoded.trim()});if(error)throw error;const d=data as any;setScanMessage(d.status==='duplicate'?`تم تسجيل ${d.student_name} مسبقاً اليوم`:d.status==='late'?`تم تسجيل تأخير ${d.student_name}`:`تم تسجيل حضور ${d.student_name}`);if(d.status==='present'||d.status==='late')notify(d.status==='late'?`تم تسجيل تأخير ${d.student_name}`:`تم تسجيل حضور ${d.student_name}`);await load();}catch(err){setScanMessage(messageOf(err));}finally{window.setTimeout(()=>{scanBusyRef.current=false;setScanBusy(false)},1200)}
    },()=>undefined).catch(err=>{setScanMessage(`تعذّر فتح الكاميرا: ${messageOf(err)}`);setScanning(false)});
    return()=>{mounted=false;void scanner.stop().catch(()=>undefined).finally(()=>{void scanner.clear()})};
  },[scanning,load,notify]);
  async function addManual(e:FormEvent){e.preventDefault();if(!supabase||!selectedStudent)return;setBusy(true);const student=students.find(s=>s.profile_id===selectedStudent);if(!student){setBusy(false);return}const {error}=await supabase.from('attendance_records').upsert({student_id:selectedStudent,class_id:student.class_id,attendance_date:today,status:manualStatus,check_in_at:manualStatus==='present'||manualStatus==='late'?new Date().toISOString():null,note,source:'manual',recorded_by:profile.id},{onConflict:'student_id,attendance_date'});if(error)notify(error.message,'danger');else{notify('تم حفظ حالة الحضور');setNote('');await load()}setBusy(false)}
  const byId=useMemo(()=>Object.fromEntries(students.map(s=>[s.profile_id,s])),[students]);
  const filtered=records.filter(r=>{const s=byId[r.student_id];return !query||`${s?.student_no||''} ${s?.profiles?.full_name||''} ${r.student_id}`.toLowerCase().includes(query.toLowerCase())});
  const isStaff=['admin','teacher','supervisor'].includes(profile.role);
  return <><PageHeading title="الحضور والغياب" subtitle="تسجيل حضور الطلاب بالـ QR أو يدوياً ومراجعة سجل اليوم." actions={<button className="btn secondary" onClick={()=>void load()}><RefreshCw size={16}/> تحديث السجل</button>}/>
    {isStaff?<div className="attendance-layout"><section className="panel scanner-panel"><div className="panel-heading"><div><h3><QrCode size={19}/> ماسح QR</h3><p>وجّه كاميرا الهاتف إلى رمز البطاقة المدرسية.</p></div><span className={`live-dot ${scanning?'on':''}`}>{scanning?'الكاميرا مفعلة':'متوقف'}</span></div><div id="raqeeb-qr-reader" className={`qr-reader ${scanning?'active':''}`}>{!scanning&&<div className="scanner-placeholder"><Camera size={38}/><b>جاهز للمسح</b><span>سيتم تسجيل الحضور تلقائياً بعد التحقق من الرمز والصف.</span></div>}</div>{scanMessage&&<div className="scan-result"><CheckCheck size={16}/>{scanMessage}</div>}<button className={`btn ${scanning?'danger-outline':'primary'} full`} onClick={()=>{setScanMessage('');setScanning(v=>!v)}}>{scanning?<><X size={17}/> إيقاف الكاميرا</>:<><Camera size={17}/> تشغيل كاميرا الهاتف</>}</button><p className="help-text">يتطلب المسح إذن استخدام الكاميرا واتصالاً آمناً عبر HTTPS.</p></section>
      <section className="panel manual-panel"><div className="panel-heading"><div><h3><UserCheck size={19}/> تسجيل يدوي</h3><p>استخدم هذا الخيار عند تعذر مسح البطاقة.</p></div></div><form onSubmit={addManual} className="stack-form"><label>الطالب<select required value={selectedStudent} onChange={e=>setSelectedStudent(e.target.value)}><option value="">اختر الطالب...</option>{students.map(s=><option key={s.profile_id} value={s.profile_id}>{s.profiles?.full_name||s.student_no} — {s.student_no}</option>)}</select></label><label>حالة الحضور<select value={manualStatus} onChange={e=>setManualStatus(e.target.value)}><option value="present">حاضر</option><option value="late">متأخر</option><option value="absent">غائب</option><option value="excused">غياب بعذر</option></select></label><label>ملاحظة (اختياري)<textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="سبب الغياب أو ملاحظة للمتابعة"/></label><button className="btn primary full" disabled={busy||!selectedStudent}>{busy?'جارٍ الحفظ...':'حفظ سجل الحضور'}</button></form></section></div>:<div className="panel"><EmptyState title="سجل الحضور الخاص بك" body="يمكنك مراجعة سجلات حضورك هنا."/></div>}
    <section className="panel table-panel attendance-table"><div className="panel-heading"><div><h3>سجل اليوم</h3><p>{formatDate(today)} · {records.length} سجل</p></div><div className="heading-actions"><span className="summary-pill green">حاضر {records.filter(r=>r.status==='present').length}</span><span className="summary-pill orange">متأخر {records.filter(r=>r.status==='late').length}</span><span className="summary-pill red">غائب {records.filter(r=>r.status==='absent').length}</span></div></div><div className="table-toolbar"><label className="table-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="بحث بالرقم المدرسي"/></label><button className="icon-btn" onClick={()=>csvDownload('attendance-today.csv',filtered)}><Download size={17}/></button></div>{records.length===0?<EmptyInline text="لم يتم تسجيل حضور اليوم حتى الآن."/>:<div className="table-wrap"><table><thead><tr><th>الطالب</th><th>الرقم المدرسي</th><th>الحالة</th><th>وقت التسجيل</th><th>المصدر</th><th>ملاحظة</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id}><td>{r.student_id===profile.id?'أنا':students.find(s=>s.profile_id===r.student_id)?.profiles?.full_name||r.student_id.slice(0,8)}</td><td>{byId[r.student_id]?.student_no||'—'}</td><td><span className={`status-pill ${r.status}`}>{statusLabel(r.status)}</span></td><td>{formatDateTime(r.check_in_at||r.created_at)}</td><td>{r.source==='qr'?'QR':'يدوي'}</td><td>{r.note||'—'}</td></tr>)}</tbody></table></div>}</section>
  </>;
}

function StudentCardPage({profile,notify}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void}){
  const [record,setRecord]=useState<Record<string,any>|null>(null);const [className,setClassName]=useState('—');const [token,setToken]=useState(()=>{try{return window.localStorage.getItem(`raqeeb:qr:${profile.id}`)||''}catch{return ''}});const [loading,setLoading]=useState(true);
  useEffect(()=>{let alive=true;async function load(){if(!supabase)return;const {data,error}=await supabase.from('student_records').select('*').eq('profile_id',profile.id).maybeSingle();if(error)notify(error.message,'danger');if(alive){setRecord(data);if(data?.class_id){const c=await supabase!.from('classes').select('name').eq('id',data.class_id).maybeSingle();setClassName(c.data?.name||'—')}setLoading(false)}}void load();return()=>{alive=false}},[profile.id,notify]);
  async function issue(){if(!supabase)return;const {data,error}=await supabase.rpc('rotate_student_qr',{p_student_id:profile.id});if(error)notify(error.message,'danger');else{const raw=String(data);setToken(raw);try{window.localStorage.setItem(`raqeeb:qr:${profile.id}`,raw)}catch{}notify('تم إصدار رمز QR جديد وإلغاء الرمز السابق.')}}
  async function revoke(){if(!supabase||!window.confirm('سيتم إلغاء الرمز الحالي ولن يقبله ماسح الحضور. هل تريد المتابعة؟'))return;const {error}=await supabase.rpc('revoke_student_qr',{p_student_id:profile.id});if(error)notify(error.message,'danger');else{setToken('');try{window.localStorage.removeItem(`raqeeb:qr:${profile.id}`)}catch{}notify('تم إلغاء رمز QR الحالي.')}}
  async function downloadCard(){const node=document.getElementById('student-card');if(!node){notify('تعذر العثور على البطاقة','danger');return}if(!token){notify('أصدر رمز QR قبل تنزيل البطاقة','danger');return}try{const dataUrl=await toPng(node,{pixelRatio:2,cacheBust:true});const link=document.createElement('a');link.download=`raqeeb-card-${record?.student_no||'student'}.png`;link.href=dataUrl;link.click()}catch(err){notify(messageOf(err),'danger')}}
  if(loading)return <div className="panel loading-row"><span className="spinner dark-spinner"/> تحميل البطاقة...</div>;
  if(!record)return <EmptyState title="لم يتم ربط حسابك بسجل طالب" body="تواصل مع إدارة المدرسة لإضافة الرقم المدرسي وتعيين الصف."/>;
  return <><PageHeading title="بطاقتي المدرسية" subtitle="بطاقة رقمية تحتوي على بياناتك ورمز QR آمن للحضور." actions={<><button className="btn secondary" onClick={()=>void downloadCard()}><Download size={16}/> تنزيل PNG</button><button className="btn secondary" onClick={()=>window.print()}><FileText size={16}/> طباعة</button></>}/><div className="student-card-wrap"><div className="student-card" id="student-card"><div className="student-card-head"><div className="card-logo"><ShieldCheck size={25}/></div><div><b>رقيب</b><small>البطاقة المدرسية</small></div><span>STUDENT ID</span></div><div className="card-student-info"><div className="card-avatar"><UserRound size={34}/></div><div><h2>{profile.full_name}</h2><p>{className}</p><small>الرقم المدرسي: {record.student_no}</small></div></div><div className="card-qr-area">{token?<QRCodeSVG value={token} size={156} level="H" includeMargin/>:<div className="qr-empty"><QrCode size={44}/><span>أصدر الرمز لعرضه هنا</span></div>}<div><b>رمز تحقق الحضور</b><small>رمز فريد قابل للإلغاء والتجديد</small></div></div><div className="student-card-footer"><span>RAQEEB SCHOOL SYSTEM</span><span>{new Date().getFullYear()}</span></div></div><div className="card-actions"><div className="notice info"><ShieldCheck size={18}/><span>لا نخزن الرمز المقروء داخل قاعدة البيانات؛ يتم حفظ بصمته فقط. تجديد الرمز يلغي أي بطاقة سابقة.</span></div><button className="btn primary full" onClick={()=>void issue()}><RefreshCw size={17}/> {token?'إصدار رمز جديد وإلغاء السابق':'إصدار رمز QR للبطاقة'}</button>{token&&<button className="btn danger-outline full" onClick={()=>void revoke()}>إلغاء الرمز الحالي</button>}<p className="help-text">يُحفظ الرمز على هذا الجهاز فقط لتستطيع عرض البطاقة لاحقاً. بعد تغييره أو إلغائه، أتلف أي نسخة مطبوعة قديمة.</p></div></div></>;
}

function ChildrenPage({notify}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void}){
  const [studentNo,setStudentNo]=useState('');const [relation,setRelation]=useState('ولي أمر');const [links,setLinks]=useState<Record<string,any>[]>([]);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{if(!supabase)return;setLoading(true);const {data,error}=await supabase.from('parent_student_links').select('*').order('requested_at',{ascending:false});if(error)notify(error.message,'danger');const enriched=await Promise.all((data||[]).map(async link=>{const p=await supabase!.from('profiles').select('full_name').eq('id',link.student_id).maybeSingle();const s=await supabase!.from('student_records').select('student_no,class_id').eq('profile_id',link.student_id).maybeSingle();return {...link,student_name:p.data?.full_name,student_no:s.data?.student_no,class_id:s.data?.class_id}}));setLinks(enriched);setLoading(false)},[notify]);
  useEffect(()=>{void load()},[load]);
  async function request(e:FormEvent){e.preventDefault();if(!supabase)return;setBusy(true);const {error}=await supabase.rpc('request_parent_link',{p_student_no:studentNo,p_relationship:relation});if(error)notify(error.message,'danger');else{notify('تم إرسال طلب ربط الطالب وينتظر موافقة الإدارة');setStudentNo('');await load()}setBusy(false)}
  return <><PageHeading title="أبنائي" subtitle="اربط حسابك بأكثر من طالب، ولا تظهر بياناته إلا بعد موافقة الإدارة."/><div className="children-layout"><section className="panel link-request"><div className="panel-heading"><div><h3>طلب ربط طالب</h3><p>أدخل الرقم المدرسي الصحيح كما هو في بطاقة الطالب.</p></div><div className="quick-icon blue"><UserRound size={19}/></div></div><form onSubmit={request} className="stack-form"><label>الرقم المدرسي<input required value={studentNo} onChange={e=>setStudentNo(e.target.value)} placeholder="مثال: 2026-001"/></label><label>صلة القرابة<input value={relation} onChange={e=>setRelation(e.target.value)} placeholder="ولي أمر / أب / أم"/></label><button className="btn primary full" disabled={busy}>{busy?'جارٍ إرسال الطلب...':'إرسال طلب الربط'}</button></form></section><section className="panel linked-students"><div className="panel-heading"><div><h3>الطلاب المرتبطون</h3><p>حالة كل طلب ربط</p></div><button className="icon-btn" onClick={()=>void load()}><RefreshCw size={16}/></button></div>{loading?<div className="loading-row"><span className="spinner dark-spinner"/> تحميل...</div>:links.length===0?<EmptyInline text="لم ترسل أي طلب ربط بعد."/>:links.map(l=><div className="linked-student" key={l.id}><div className="avatar">{l.student_name?.slice(0,1)||'ط'}</div><div className="linked-copy"><b>{l.student_name||'طالب'}</b><small>الرقم المدرسي: {l.student_no||'—'}</small></div><span className={`status-pill ${l.status}`}>{l.status==='approved'?'تمت الموافقة':l.status==='pending'?'قيد المراجعة':'مرفوض'}</span></div>)}</section></div></>;
}

function ParentLinksAdminPage({profile,notify}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void}){
  const [links,setLinks]=useState<Record<string,any>[]>([]);const [loading,setLoading]=useState(true);const [filter,setFilter]=useState('pending');
  const load=useCallback(async()=>{if(!supabase)return;setLoading(true);let query=supabase.from('parent_student_links').select('*').order('requested_at',{ascending:false});if(filter!=='all')query=query.eq('status',filter);const {data,error}=await query;if(error)notify(error.message,'danger');const raw=data||[];const ids=[...new Set(raw.flatMap((r:any)=>[r.parent_id,r.student_id]))];const [p,st]=await Promise.all([ids.length?supabase.from('profiles').select('id,full_name,email').in('id',ids):Promise.resolve({data:[] as any[]}),ids.length?supabase.from('student_records').select('profile_id,student_no,class_id').in('profile_id',ids):Promise.resolve({data:[] as any[]})]);const people=Object.fromEntries((p.data||[]).map((x:any)=>[x.id,x]));const records=Object.fromEntries((st.data||[]).map((x:any)=>[x.profile_id,x]));setLinks(raw.map((r:any)=>({...r,parent:people[r.parent_id],student:people[r.student_id],record:records[r.student_id]})));setLoading(false)},[filter,notify]);
  useEffect(()=>{void load()},[load]);
  async function review(id:string,approved:boolean){if(!supabase)return;const {error}=await supabase.from('parent_student_links').update({status:approved?'approved':'rejected',reviewed_at:new Date().toISOString(),reviewed_by:profile.id}).eq('id',id);if(error)notify(error.message,'danger');else{notify(approved?'تم اعتماد ربط ولي الأمر بالطالب':'تم رفض طلب الربط');await load()}}
  return <><PageHeading title="طلبات ربط أولياء الأمور" subtitle="لا تظهر بيانات الطالب لولي الأمر قبل اعتماد هذا الطلب." actions={<button className="btn secondary" onClick={()=>void load()}><RefreshCw size={16}/> تحديث</button>}/><div className="panel table-panel"><div className="table-toolbar"><div className="table-count">طلبات الربط <b>{links.length}</b></div><select className="inline-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="pending">بانتظار الموافقة</option><option value="approved">موافق عليها</option><option value="rejected">مرفوضة</option><option value="all">كل الطلبات</option></select></div>{loading?<div className="loading-row"><span className="spinner dark-spinner"/> تحميل الطلبات...</div>:links.length===0?<EmptyState title="لا توجد طلبات في هذا العرض" body="ستظهر هنا طلبات ربط ولي الأمر عند تقديمها."/>:<div className="table-wrap"><table><thead><tr><th>ولي الأمر</th><th>بريد ولي الأمر</th><th>الطالب</th><th>الرقم المدرسي</th><th>صلة القرابة</th><th>تاريخ الطلب</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{links.map(l=><tr key={l.id}><td>{l.parent?.full_name||l.parent_id.slice(0,8)}</td><td>{l.parent?.email||'—'}</td><td>{l.student?.full_name||'طالب'}</td><td>{l.record?.student_no||'—'}</td><td>{l.relationship||'ولي أمر'}</td><td>{formatDateTime(l.requested_at)}</td><td><span className={`status-pill ${l.status}`}>{l.status==='approved'?'موافق عليه':l.status==='pending'?'قيد المراجعة':'مرفوض'}</span></td><td>{l.status==='pending'?<div className="row-actions"><button className="icon-btn" title="اعتماد" onClick={()=>void review(l.id,true)}><Check size={16}/></button><button className="icon-btn danger-icon" title="رفض" onClick={()=>void review(l.id,false)}><X size={16}/></button></div>:'—'}</td></tr>)}</tbody></table></div>}</div></>;
}

function NotificationsPage({profile,notify,onUnreadChange}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void;onUnreadChange:(n:number)=>void}){
  const [rows,setRows]=useState<Record<string,any>[]>([]);const [loading,setLoading]=useState(true);const [pushBusy,setPushBusy]=useState(false);
  const load=useCallback(async()=>{if(!supabase)return;setLoading(true);const {data,error}=await supabase.from('notifications').select('*').order('created_at',{ascending:false}).limit(100);if(error)notify(error.message,'danger');const list=data||[];setRows(list);onUnreadChange(list.filter(n=>!n.read_at).length);setLoading(false)},[notify,onUnreadChange]);
  useEffect(()=>{void load()},[load]);
  async function markRead(id:string){if(!supabase)return;const {error}=await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);if(error)notify(error.message,'danger');else await load()}
  async function markAll(){if(!supabase)return;const {error}=await supabase.from('notifications').update({read_at:new Date().toISOString()}).is('read_at',null);if(error)notify(error.message,'danger');else{notify('تم تعليم الإشعارات كمقروءة');await load()}}
  async function enablePush(){if(!supabase)return;setPushBusy(true);try{if(!('serviceWorker'in navigator)||!('PushManager'in window))throw new Error('هذا المتصفح لا يدعم إشعارات Push');const {data:settings}=await supabase.from('school_settings').select('push_enabled').limit(1).maybeSingle();if(settings?.push_enabled===false)throw new Error('إشعارات Push متوقفة من إعدادات المدرسة');const {data:fn,error:fnError}=await supabase.functions.invoke('get-vapid-public-key');if(fnError)throw fnError;const publicKey=fn?.publicKey||import.meta.env.VITE_VAPID_PUBLIC_KEY;if(!publicKey)throw new Error('مفتاح VAPID العام غير مضبوط في المشروع');const registration=await navigator.serviceWorker.register('/sw.js');const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('لم يتم منح إذن الإشعارات');const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey) as unknown as BufferSource});const {error}=await supabase.from('push_subscriptions').upsert({user_id:profile.id,endpoint:subscription.endpoint,subscription:subscription.toJSON()},{onConflict:'user_id,endpoint'});if(error)throw error;notify('تم تفعيل إشعارات هذا الجهاز');}catch(err){notify(messageOf(err),'danger')}finally{setPushBusy(false)}}
  return <><PageHeading title="مركز الإشعارات" subtitle="رسائل الغياب والدرجات والواجبات وإعلانات المدرسة." actions={<><button className="btn secondary" onClick={()=>void enablePush()} disabled={pushBusy}><Smartphone size={16}/>{pushBusy?'جارٍ التفعيل...':'تفعيل إشعارات الجهاز'}</button><button className="btn subtle" onClick={()=>void markAll()}><CheckCheck size={16}/> تعليم الكل كمقروء</button></>}/><div className="panel notification-list">{loading?<div className="loading-row"><span className="spinner dark-spinner"/> تحميل الإشعارات...</div>:rows.length===0?<EmptyState title="لا توجد إشعارات" body="ستصل إليك التنبيهات الجديدة هنا."/>:rows.map(n=><div className={`notification-row ${!n.read_at?'unread':''}`} key={n.id}><div className={`notification-symbol ${n.category}`}><Bell size={18}/></div><div className="notification-content"><b>{n.title}</b><p>{n.body}</p><small>{formatDateTime(n.created_at)}</small></div><div className="notification-actions">{!n.read_at&&<button className="text-action" onClick={()=>void markRead(n.id)}>تعليم كمقروء</button>}{n.target_url&&<button className="icon-btn" onClick={()=>window.location.assign(n.target_url)}><ArrowRight size={16}/></button>}</div></div>)}</div></>;
}

function urlBase64ToUint8Array(base64String:string){const padding='='.repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');const raw=window.atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}

function SubmissionsPage({profile,notify}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void}){
  const [assignments,setAssignments]=useState<Record<string,any>[]>([]);
  const [submissions,setSubmissions]=useState<Record<string,any>[]>([]);
  const [studentNames,setStudentNames]=useState<Record<string,string>>({});
  const [assignmentId,setAssignmentId]=useState('');
  const [answer,setAnswer]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [reviewing,setReviewing]=useState<Record<string,any>|null>(null);
  const [feedback,setFeedback]=useState('');
  const [score,setScore]=useState('');
  const isStudent=profile.role==='student';
  const isReviewer=profile.role==='admin'||profile.role==='teacher';
  const load=useCallback(async()=>{
    if(!supabase)return;
    const [a,s]=await Promise.all([
      supabase.from('assignments').select('*').order('due_at',{ascending:true}),
      supabase.from('assignment_submissions').select('*').order('submitted_at',{ascending:false}).limit(300),
    ]);
    if(a.error)notify(a.error.message,'danger');
    if(s.error)notify(s.error.message,'danger');
    const list=s.data||[];
    setAssignments(a.data||[]);setSubmissions(list);
    const ids=[...new Set(list.map((x:any)=>x.student_id))];
    if(ids.length){const p=await supabase.from('profiles').select('id,full_name').in('id',ids);setStudentNames(Object.fromEntries((p.data||[]).map((x:any)=>[x.id,x.full_name])))}
    else setStudentNames({});
  },[notify]);
  useEffect(()=>{void load()},[load]);
  async function submit(e:FormEvent){
    e.preventDefault();if(!supabase||!assignmentId)return;setBusy(true);
    try{
      const previous=await supabase.from('assignment_submissions').select('file_path').eq('assignment_id',assignmentId).eq('student_id',profile.id).maybeSingle();
      if(previous.error)throw previous.error;
      let filePath:string|null=previous.data?.file_path||null;
      let uploadedPath:string|null=null;
      if(file){
        if(file.size>10*1024*1024)throw new Error('حجم الملف يتجاوز 10 ميغابايت');
        const ext=file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g,'')||'';
        const mime:Record<string,string>={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
        const contentType=mime[ext];if(!contentType)throw new Error('نوع الملف غير مدعوم');
        uploadedPath=`${profile.id}/${crypto.randomUUID()}.${ext}`;
        const up=await supabase.storage.from('student-submissions').upload(uploadedPath,file,{upsert:false,contentType});
        if(up.error)throw up.error;
        filePath=uploadedPath;
      }
      const assignment=assignments.find(a=>a.id===assignmentId);
      const submissionStatus=assignment?.due_at&&new Date(assignment.due_at)<new Date()?'late':'submitted';
      const {error}=await supabase.from('assignment_submissions').upsert({assignment_id:assignmentId,student_id:profile.id,file_path:filePath,answer_text:answer,status:submissionStatus,submitted_at:new Date().toISOString()},{onConflict:'assignment_id,student_id'});
      if(error){if(uploadedPath)await supabase.storage.from('student-submissions').remove([uploadedPath]);throw error;}
      if(uploadedPath&&previous.data?.file_path)await supabase.storage.from('student-submissions').remove([previous.data.file_path]);
      notify(submissionStatus==='late'?'تم تسليم الواجب بعد الموعد':'تم إرسال الواجب بنجاح');setAnswer('');setFile(null);await load();
    }catch(err){notify(messageOf(err),'danger')}finally{setBusy(false)}
  }
  function openReview(row:Record<string,any>){setReviewing(row);setFeedback(row.teacher_feedback||'');setScore(row.score===null||row.score===undefined?'':String(row.score))}
  async function saveReview(e:FormEvent){
    e.preventDefault();if(!supabase||!reviewing)return;const max=Number(assignments.find(a=>a.id===reviewing.assignment_id)?.total_marks||10);if(score!==''&&(!Number.isFinite(Number(score))||Number(score)<0||Number(score)>max)){notify(`الدرجة يجب أن تكون بين 0 و ${max}`,'danger');return}setBusy(true);
    const patch={teacher_feedback:feedback,score:score===''?null:Number(score),status:'reviewed',reviewed_by:profile.id,reviewed_at:new Date().toISOString()};
    const {error}=await supabase.from('assignment_submissions').update(patch).eq('id',reviewing.id);
    if(error)notify(error.message,'danger');else{notify('تم حفظ مراجعة الواجب');setReviewing(null);await load()}
    setBusy(false);
  }
  return <>
    <PageHeading title={isStudent?'تسليم الواجبات':isReviewer?'تسليمات الطلاب':'متابعة تسليمات الأبناء'} subtitle={isStudent?'اختر الواجب وأرسل إجابتك أو الملف المطلوب.':'راجع الأعمال والتعليقات والدرجات وفق صلاحيات حسابك.'} actions={<button className="btn secondary" onClick={()=>void load()}><RefreshCw size={16}/> تحديث</button>}/>
    {isStudent?<div className="submission-layout">
      <section className="panel"><div className="panel-heading"><div><h3>إرسال واجب</h3><p>يمكن إرسال نص وملف واحد لكل واجب.</p></div></div>
        <form onSubmit={submit} className="stack-form">
          <label>الواجب<select required value={assignmentId} onChange={e=>setAssignmentId(e.target.value)}><option value="">اختر الواجب...</option>{assignments.map(a=><option value={a.id} key={a.id}>{a.title} · آخر موعد {formatDateTime(a.due_at)}</option>)}</select></label>
          <label>الإجابة أو الملاحظات<textarea rows={4} value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="اكتب إجابتك هنا..."/></label>
          <label className="file-picker"><ArrowDownToLine size={18}/><span>{file?file.name:'إرفاق ملف (PDF أو صورة أو Word، حتى 10MB)'}</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
          <button className="btn primary full" disabled={busy||!assignmentId}>{busy?'جارٍ الإرسال...':'إرسال الواجب'}</button>
        </form>
      </section>
      <section className="panel"><div className="panel-heading"><div><h3>تسليماتي</h3><p>حالة المراجعة والدرجات والتعليقات.</p></div></div>
        {submissions.filter(s=>s.student_id===profile.id).length===0?<EmptyInline text="لم ترسل أي واجبات حتى الآن."/>:submissions.filter(s=>s.student_id===profile.id).map(s=><div className="submission-row" key={s.id}><div className="quick-icon blue"><FileText size={18}/></div><div><b>{assignments.find(a=>a.id===s.assignment_id)?.title||'واجب'}</b><small>{formatDateTime(s.submitted_at)}</small><p>{s.teacher_feedback||'بانتظار مراجعة المدرس'} {s.score!==null&&s.score!==undefined?` · الدرجة ${s.score}`:''}</p></div><span className={`status-pill ${s.status}`}>{statusLabel(s.status)}</span></div>)}
      </section>
    </div>:<div className="panel table-panel">
      <div className="table-wrap"><table><thead><tr><th>الواجب</th><th>الطالب</th><th>تاريخ التسليم</th><th>الملف</th><th>الإجابة</th><th>الحالة</th><th>الدرجة</th>{isReviewer&&<th>مراجعة</th>}</tr></thead>
      <tbody>{submissions.map(s=><tr key={s.id}>
        <td>{assignments.find(a=>a.id===s.assignment_id)?.title||s.assignment_id.slice(0,8)}</td><td>{studentNames[s.student_id]||s.student_id.slice(0,8)}</td><td>{formatDateTime(s.submitted_at)}</td>
        <td>{s.file_path?<button className="text-action" onClick={async()=>{const {data,error}=await supabase!.storage.from('student-submissions').createSignedUrl(s.file_path,60);if(error)notify(error.message,'danger');else window.open(data.signedUrl,'_blank','noopener')}}>فتح الملف</button>:'—'}</td>
        <td>{s.answer_text||'—'}</td><td><span className={`status-pill ${s.status}`}>{statusLabel(s.status)}</span></td><td>{s.score??'—'}</td>
        {isReviewer&&<td><button className="text-action" onClick={()=>openReview(s)}>{s.status==='reviewed'?'تعديل المراجعة':'مراجعة الواجب'}</button></td>}
      </tr>)}</tbody></table></div>
      {submissions.length===0&&<EmptyInline text="لا توجد تسليمات متاحة."/>}
    </div>}
    {reviewing&&<Modal title="مراجعة تسليم الطالب" onClose={()=>setReviewing(null)}><form className="stack-form modal-form" onSubmit={saveReview}><div className="notice info"><FileText size={17}/><span>{assignments.find(a=>a.id===reviewing.assignment_id)?.title||'واجب'} · {studentNames[reviewing.student_id]||'طالب'}</span></div><label>الدرجة<input type="number" min="0" max={assignments.find(a=>a.id===reviewing.assignment_id)?.total_marks||10} step="0.25" value={score} onChange={e=>setScore(e.target.value)} placeholder="اتركها فارغة إذا لم تكن مطلوبة"/></label><label>ملاحظات المدرس<textarea rows={4} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="اكتب ملاحظاتك للطالب..."/></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setReviewing(null)}>إلغاء</button><button className="btn primary" disabled={busy}>{busy?'جارٍ الحفظ...':'حفظ المراجعة'}</button></div></form></Modal>}
  </>;
}

function GradeResultsPage({profile,notify}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void}){
  const [grades,setGrades]=useState<Record<string,any>[]>([]);const [averages,setAverages]=useState<Record<string,any>[]>([]);const [assessments,setAssessments]=useState<Record<string,any>>({});const [subjects,setSubjects]=useState<Record<string,any>>({});const [students,setStudents]=useState<Record<string,any>>({});const [loading,setLoading]=useState(true);
  useEffect(()=>{let alive=true;async function load(){if(!supabase)return;const [g,a]=await Promise.all([supabase.from('grades').select('*').eq('published',true).order('updated_at',{ascending:false}),supabase.from('student_grade_summary').select('*')]);if(g.error)notify(g.error.message,'danger');if(a.error)notify(a.error.message,'danger');const rows=g.data||[];const summaries=a.data||[];const profileIds=[...new Set([...rows.map((r:any)=>r.student_id),...summaries.map((r:any)=>r.student_id)])];const [ex,sub,profiles]=await Promise.all([supabase.from('assessments').select('id,title,total_marks,subject_id,class_id'),supabase.from('subjects').select('id,name'),profileIds.length?supabase.from('profiles').select('id,full_name').in('id',profileIds):Promise.resolve({data:[] as any[]})]);if(alive){setGrades(rows);setAverages(summaries);setAssessments(Object.fromEntries((ex.data||[]).map((x:any)=>[x.id,x])));setSubjects(Object.fromEntries((sub.data||[]).map((x:any)=>[x.id,x])));setStudents(Object.fromEntries((profiles.data||[]).map((x:any)=>[x.id,x])));setLoading(false)}}void load();return()=>{alive=false}},[notify]);
  return <><PageHeading title="الدرجات والمتوسطات" subtitle="نتائج الاختبارات المنشورة ومتوسط الأداء حسب المادة." actions={<button className="btn secondary" onClick={()=>csvDownload('raqeeb-published-grades.csv',grades)} disabled={!grades.length}><Download size={16}/> تصدير النتائج</button>}/>
    <div className="panel"><div className="panel-heading"><div><h3>متوسط الدرجات حسب المادة</h3><p>المتوسط محسوب كنسبة مئوية من الدرجة الكاملة للاختبارات المنشورة.</p></div></div>{loading?<div className="loading-row"><span className="spinner dark-spinner"/> تحميل النتائج...</div>:averages.length===0?<EmptyInline text="لا توجد نتائج منشورة حتى الآن."/>:<div className="table-wrap"><table><thead><tr>{profile.role==='parent'&&<th>الطالب</th>}<th>المادة</th><th>عدد النتائج</th><th>المتوسط</th></tr></thead><tbody>{averages.map((r,i)=><tr key={`${r.student_id}-${r.subject_id}-${i}`}>{profile.role==='parent'&&<td>{students[r.student_id]?.full_name||'طالب'}</td>}<td>{subjects[r.subject_id]?.name||'مادة'}</td><td>{r.assessment_count}</td><td><b>{Number(r.average_percent||0).toFixed(1)}%</b></td></tr>)}</tbody></table></div>}</div>
    <div className="panel table-panel" style={{marginTop:14}}><div className="panel-heading"><div><h3>تفاصيل الدرجات</h3><p>الاختبارات التي اعتمدها المدرس ونشر نتائجها.</p></div></div>{grades.length===0?<EmptyInline text="لا توجد درجات منشورة."/>:<div className="table-wrap"><table><thead><tr>{profile.role==='parent'&&<th>الطالب</th>}<th>الاختبار</th><th>المادة</th><th>الدرجة</th><th>النسبة</th><th>ملاحظة المدرس</th></tr></thead><tbody>{grades.map(r=>{const a=assessments[r.assessment_id];const percent=a?.total_marks?Number(r.score)/Number(a.total_marks)*100:null;return <tr key={r.id}>{profile.role==='parent'&&<td>{students[r.student_id]?.full_name||'طالب'}</td>}<td>{a?.title||'اختبار'}</td><td>{subjects[a?.subject_id]?.name||'—'}</td><td>{r.score} / {a?.total_marks??'—'}</td><td>{percent===null?'—':`${percent.toFixed(1)}%`}</td><td>{r.teacher_note||'—'}</td></tr>})}</tbody></table></div>}</div>
  </>;
}

function ReportsPage({profile,notify}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void}){
  const [dateFrom,setDateFrom]=useState(schoolDateString('Asia/Baghdad',new Date(new Date().getFullYear(),new Date().getMonth(),1)));const [dateTo,setDateTo]=useState(schoolDateString());const [report,setReport]=useState('attendance');const [rows,setRows]=useState<Record<string,any>[]>([]);const [busy,setBusy]=useState(false);
  async function generate(){if(!supabase)return;setBusy(true);try{let result:any;if(report==='attendance')result=await supabase.from('attendance_records').select('*').gte('attendance_date',dateFrom).lte('attendance_date',dateTo).order('attendance_date',{ascending:false});else if(report==='grades')result=await supabase.from('grades').select('*').gte('updated_at',`${dateFrom}T00:00:00`).lte('updated_at',`${dateTo}T23:59:59`).order('updated_at',{ascending:false});else if(report==='assignments')result=await supabase.from('assignment_submissions').select('*').gte('submitted_at',`${dateFrom}T00:00:00`).lte('submitted_at',`${dateTo}T23:59:59`).order('submitted_at',{ascending:false});else result=await supabase.from('student_records').select('*').order('student_no');if(result.error)throw result.error;setRows(result.data||[]);notify(`تم جلب ${result.data?.length||0} سجل`)}catch(err){notify(messageOf(err),'danger')}finally{setBusy(false)}}
  const availableReports=profile.role==='supervisor'?['attendance','students']:['attendance','grades','assignments','students'];
  useEffect(()=>{if(!availableReports.includes(report))setReport('attendance')},[profile.role,report]);
  return <><PageHeading title="التقارير والتصدير" subtitle="استخرج تقارير المدرسة المتاحة وفق صلاحيات حسابك."/><div className="panel report-controls"><div className="report-controls-grid"><label>نوع التقرير<select value={report} onChange={e=>setReport(e.target.value)}>{availableReports.includes('attendance')&&<option value="attendance">الحضور والغياب</option>}{availableReports.includes('grades')&&<option value="grades">الدرجات</option>}{availableReports.includes('assignments')&&<option value="assignments">تسليمات الواجبات</option>}{availableReports.includes('students')&&<option value="students">سجل الطلاب</option>}</select></label><label>من تاريخ<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label><label>إلى تاريخ<input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label><button className="btn primary" onClick={()=>void generate()} disabled={busy}>{busy?'جارٍ إعداد التقرير...':'إنشاء التقرير'}</button></div><div className="report-result-head"><div><b>نتائج التقرير</b><small>{rows.length} سجل مسترجع</small></div><button className="btn secondary" disabled={!rows.length} onClick={()=>csvDownload(`raqeeb-${report}-${dateFrom}-${dateTo}.csv`,rows)}><Download size={16}/> تحميل CSV</button></div>{rows.length===0?<EmptyInline text="اختر التقرير والفترة ثم اضغط إنشاء التقرير."/>:<div className="table-wrap"><table><thead><tr>{Object.keys(rows[0]).slice(0,8).map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={row.id||i}>{Object.keys(rows[0]).slice(0,8).map(k=><td key={k}>{typeof row[k]==='object'?JSON.stringify(row[k]):String(row[k]??'—')}</td>)}</tr>)}</tbody></table></div>}</div></>;
}

function AuditPage({notify}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void}){
  const [rows,setRows]=useState<Record<string,any>[]>([]);const [loading,setLoading]=useState(true);
  useEffect(()=>{let alive=true;async function load(){if(!supabase)return;const {data,error}=await supabase.from('audit_logs').select('*').order('occurred_at',{ascending:false}).limit(200);if(error)notify(error.message,'danger');if(alive){setRows(data||[]);setLoading(false)}}void load();return()=>{alive=false}},[notify]);
  return <><PageHeading title="سجل العمليات" subtitle="سجل تدقيقي للتغييرات على الحسابات والصفوف والدرجات والحضور والبيانات الحساسة." actions={<button className="btn secondary" onClick={()=>csvDownload('raqeeb-audit-log.csv',rows)} disabled={!rows.length}><Download size={16}/> تصدير السجل</button>}/><div className="panel table-panel">{loading?<div className="loading-row"><span className="spinner dark-spinner"/> تحميل السجل...</div>:rows.length===0?<EmptyInline text="لا توجد عمليات مسجلة بعد."/>:<div className="table-wrap"><table><thead><tr><th>الوقت</th><th>الجدول</th><th>العملية</th><th>معرّف السجل</th><th>المستخدم</th><th>التفاصيل</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{formatDateTime(r.occurred_at)}</td><td>{r.table_name}</td><td><span className={`status-pill ${r.operation==='DELETE'?'absent':r.operation==='INSERT'?'present':'late'}`}>{r.operation}</span></td><td>{r.row_id?.slice(0,14)}…</td><td>{r.actor_id?.slice(0,8)||'النظام'}</td><td><button className="text-action" onClick={()=>window.alert(JSON.stringify({old:r.old_data,new:r.new_data},null,2))}>عرض التفاصيل</button></td></tr>)}</tbody></table></div>}</div></>;
}

function SettingsPage({notify}: {profile:Profile;notify:(s:string,t?:'success'|'danger')=>void}){
  const [settings,setSettings]=useState<Record<string,any>|null>(null);const [busy,setBusy]=useState(false);
  useEffect(()=>{let alive=true;async function load(){if(!supabase)return;const {data,error}=await supabase.from('school_settings').select('*').limit(1).maybeSingle();if(error)notify(error.message,'danger');if(alive)setSettings(data)}void load();return()=>{alive=false}},[notify]);
  async function save(e:FormEvent){e.preventDefault();if(!supabase||!settings)return;setBusy(true);const {error}=await supabase.from('school_settings').update({school_name:settings.school_name,logo_url:settings.logo_url,academic_year_label:settings.academic_year_label,timezone:settings.timezone||'Asia/Baghdad',working_days:settings.working_days||[0,1,2,3,4],school_start:settings.school_start,school_end:settings.school_end,late_after:settings.late_after,mark_absent_after:settings.mark_absent_after,attendance_enabled:settings.attendance_enabled,push_enabled:settings.push_enabled,updated_by:(await supabase.auth.getUser()).data.user?.id}).eq('id',settings.id);if(error)notify(error.message,'danger');else{notify('تم حفظ إعدادات المدرسة');window.dispatchEvent(new Event('raqeeb:school-settings-updated'))}setBusy(false)}
  if(!settings)return <><PageHeading title="إعدادات المدرسة" subtitle="بيانات المدرسة وأوقات الدوام وسياسات الحضور والإشعارات."/><div className="panel loading-row"><span className="spinner dark-spinner"/> تحميل الإعدادات...</div></>;
  const update=(key:string,value:any)=>setSettings(s=>s?({...s,[key]:value}):s);
  const schoolDays=[{value:0,label:'الأحد'},{value:1,label:'الاثنين'},{value:2,label:'الثلاثاء'},{value:3,label:'الأربعاء'},{value:4,label:'الخميس'},{value:5,label:'الجمعة'},{value:6,label:'السبت'}];
  return <><PageHeading title="إعدادات المدرسة" subtitle="بيانات المدرسة وأوقات الدوام وسياسات الحضور والإشعارات."/><form onSubmit={save} className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><h3><School size={18}/> بيانات المدرسة</h3><p>المعلومات التي تظهر داخل النظام.</p></div></div><div className="stack-form"><label>اسم المدرسة<input required value={settings.school_name||''} onChange={e=>update('school_name',e.target.value)}/></label><label>رابط شعار المدرسة<input value={settings.logo_url||''} onChange={e=>update('logo_url',e.target.value)} placeholder="https://..."/></label><label>السنة الدراسية الحالية<input value={settings.academic_year_label||''} onChange={e=>update('academic_year_label',e.target.value)} placeholder="2026 / 2027"/></label><label>المنطقة الزمنية<input value={settings.timezone||'Asia/Baghdad'} onChange={e=>update('timezone',e.target.value)} placeholder="Asia/Baghdad"/></label></div></section><section className="panel settings-panel"><div className="panel-heading"><div><h3><Clock3 size={18}/> أوقات الدوام والحضور</h3><p>استخدم التوقيت المحلي للمدرسة.</p></div></div><div className="settings-time-grid"><label>بداية الدوام<input type="time" value={String(settings.school_start).slice(0,5)} onChange={e=>update('school_start',e.target.value)}/></label><label>نهاية الدوام<input type="time" value={String(settings.school_end).slice(0,5)} onChange={e=>update('school_end',e.target.value)}/></label><label>يبدأ التأخير بعد<input type="time" value={String(settings.late_after).slice(0,5)} onChange={e=>update('late_after',e.target.value)}/></label><label>يبدأ احتساب الغياب بعد<input type="time" value={String(settings.mark_absent_after).slice(0,5)} onChange={e=>update('mark_absent_after',e.target.value)}/></label></div><div className="working-days"><b>أيام الدوام المدرسي</b><div>{schoolDays.map(day=><label key={day.value}><input type="checkbox" checked={(settings.working_days||[0,1,2,3,4]).includes(day.value)} onChange={e=>update('working_days',e.target.checked?[...new Set([...(settings.working_days||[0,1,2,3,4]),day.value])].sort():(settings.working_days||[0,1,2,3,4]).filter((v:number)=>v!==day.value))}/><span>{day.label}</span></label>)}</div></div><div className="setting-toggle"><div><b>تفعيل نظام الحضور</b><small>السماح باستخدام ماسح QR والتسجيل اليدوي.</small></div><input type="checkbox" checked={settings.attendance_enabled} onChange={e=>update('attendance_enabled',e.target.checked)}/></div><div className="setting-toggle"><div><b>إشعارات Push</b><small>السماح بإرسال الإشعارات للأجهزة المشتركة.</small></div><input type="checkbox" checked={settings.push_enabled} onChange={e=>update('push_enabled',e.target.checked)}/></div></section><div className="settings-save"><span className="help-text">تُحفظ الإعدادات مباشرة في قاعدة البيانات.</span><button className="btn primary" disabled={busy}>{busy?'جارٍ الحفظ...':'حفظ الإعدادات'}</button></div></form></>;
}

function UpdatePasswordScreen({onSave}:{onSave:(password:string)=>Promise<void>}){
  const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [done,setDone]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setError('');if(password.length<8){setError('كلمة المرور يجب أن تتكون من 8 أحرف على الأقل.');return}if(password!==confirm){setError('كلمتا المرور غير متطابقتين.');return}setBusy(true);try{await onSave(password);setDone(true)}catch(err){setError(messageOf(err))}finally{setBusy(false)}}
  return <div className="auth-layout"><div className="auth-brand-panel"><div className="brand-mark large"><ShieldCheck size={30}/></div><div className="brand-name">رقيب<span>RAQEEB</span></div><p>حسابك المدرسي بأمان.</p></div><div className="auth-form-panel"><div className="auth-card"><div className="eyebrow">أمان الحساب</div><h1>تعيين كلمة مرور جديدة</h1><p className="muted">اختر كلمة مرور قوية لا تستخدمها في مواقع أخرى.</p>{error&&<div className="notice danger"><AlertCircle size={17}/>{error}</div>}{done?<div className="notice success"><Check size={17}/>تم تحديث كلمة المرور. يمكنك متابعة استخدام رقيب.</div>:<form onSubmit={submit} className="stack-form"><label>كلمة المرور الجديدة<input required minLength={8} type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>تأكيد كلمة المرور<input required minLength={8} type="password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button className="btn primary full" disabled={busy}>{busy?'جارٍ التحديث...':'حفظ كلمة المرور'}</button></form>}</div></div></div>;
}

function App(){
  const auth=useAuth();
  const mismatch=auth.profile?(isStaffPortal?!STAFF_ROLES.includes(auth.profile.role):STAFF_ROLES.includes(auth.profile.role)):false;
  useEffect(()=>{document.title=isStaffPortal?'رقيب | بوابة الإدارة':'رقيب | إدارة المدرسة'},[]);
  useEffect(()=>{if(mismatch)window.location.replace(isStaffPortal?'/':'/admin')},[mismatch]);
  if(!isSupabaseConfigured)return <div className="setup-screen"><div className="setup-card"><div className="brand-mark"><ShieldCheck size={25}/></div><div className="eyebrow">RAQEEB · إعداد أول مرة</div><h1>اربط رقيب بقاعدة بيانات المدرسة</h1><p>التطبيق جاهز للاتصال بـ Supabase، لكن بيانات المشروع غير موجودة في بيئة التشغيل بعد.</p><ol><li>أنشئ مشروع Supabase جديداً.</li><li>نفّذ ملف <code>raqeeb-full.sql</code> في SQL Editor.</li><li>انسخ <code>.env.example</code> إلى <code>.env.local</code> وأضف رابط المشروع وAnon Key.</li><li>نفّذ <code>npm install</code> ثم <code>npm run dev</code>.</li></ol><div className="notice info"><ShieldCheck size={18}/> لا تضع Service Role Key داخل الواجهة أو ملف البيئة ذي بادئة VITE.</div></div></div>;
  if(auth.loading)return <div className="boot-screen"><div className="brand-mark"><ShieldCheck size={25}/></div><span className="spinner dark-spinner"/><p>جارٍ فتح رقيب...</p></div>;
  if(!auth.userId)return <AuthScreen/>;
  if(auth.recoveryRequired)return <UpdatePasswordScreen onSave={auth.updatePassword}/>;
  if(!auth.profile)return <div className="boot-screen"><div className="brand-mark"><ShieldCheck size={25}/></div>{auth.profileError?<><h2>تعذر تحميل الحساب</h2><p>{auth.profileError}</p><button className="btn secondary" onClick={()=>void auth.refreshProfile()}>إعادة المحاولة</button><button className="text-action" onClick={()=>void auth.signOut()}>تسجيل الخروج</button></>:<span className="spinner dark-spinner"/>}</div>;
  if(mismatch)return <div className="boot-screen"><div className="brand-mark"><ShieldCheck size={25}/></div><span className="spinner dark-spinner"/><p>جارٍ تحويلك إلى البوابة المناسبة...</p></div>;
  return <AuthenticatedApp profile={auth.profile} signOut={auth.signOut} refreshProfile={auth.refreshProfile}/>;
}

export default App;
