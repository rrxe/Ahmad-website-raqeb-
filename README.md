# RAQEEB — رقيب لإدارة المدرسة

تطبيق ويب عربي باتجاه RTL لإدارة مدرسة واحدة، مبني على React + TypeScript + Vite وSupabase (Auth + PostgreSQL + RLS + Storage + Edge Functions). الواجهة قابلة للاستخدام على الهاتف والحاسوب، ويمكن تثبيتها كتطبيق PWA.

> **مهم:** هذا مستودع تطبيق قابل للربط والتشغيل، وليس نظاماً منشوراً على قاعدة بيانات مدرستك. لا يمكن تفعيل حسابات المدرسة أو التحقق من عملها على بيانات حقيقية قبل ربط مشروع Supabase الخاص بك وتنفيذ خطوات الإعداد أدناه. لا تعتبره جاهزاً للإنتاج قبل إكمال قائمة الفحص في الأسفل.

## حالة التحقق لهذه الحزمة

- تم فحص التحليل النحوي لملفات TypeScript/TSX الثمانية دون أخطاء نحوية.
- لم يكتمل `npm run build` في بيئة إعداد هذه الحزمة لأن حزم React وSupabase وVite غير مثبتة ولم تتوفر إمكانية تنزيلها من سجل npm أثناء الجلسة؛ لذلك لا أصف البناء بأنه ناجح.
- لم تُنفذ ملفات SQL على مشروع Supabase حقيقي، ولم تُختبر سياسات RLS أو الكاميرا أو Push على أجهزة فعلية.
- لا توجد بيانات تجريبية أو حسابات افتراضية في قاعدة البيانات؛ ابدأ ببيانات المدرسة الحقيقية بعد تنفيذ التهيئة والاختبارات.

هذه نقاط معلنة حتى لا يُفهم تسليم المصدر على أنه نشر أو اعتماد أمني وتشغيلي مكتمل.

## المتطلبات

- Node.js 20 أو أحدث.
- مشروع Supabase جديد للمدرسة.
- HTTPS في بيئة الإنتاج حتى تعمل كاميرا QR وإشعارات Push.

## تشغيل محلي

```bash
npm install
cp .env.example .env.local
```

أضف إلى `.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
```

ثم نفّذ:

```bash
npm run dev
```

## إعداد قاعدة البيانات

1. افتح Supabase → SQL Editor.
2. نفّذ `supabase/migrations/0001_raqeeb_schema.sql`.
3. نفّذ `supabase/migrations/0002_automation_and_push.sql` (ويضيف تفعيل Realtime لمركز الإشعارات).
4. انشر وظيفة إنشاء الدعوات: `supabase functions deploy admin-create-user`، واضبط SMTP/قوالب الدعوات في Supabase Auth حتى تصل رسائل الدعوة فعلياً.
5. من Authentication → URL Configuration، اضبط Site URL وRedirect URLs على رابط تطبيقك المحلي ورابط الإنتاج.
6. لا تستخدم `service_role` أو مفاتيح الإدارة داخل الواجهة الأمامية.

### إنشاء المدير العام الأول
1. نفّذ `raqeeb-full.sql` في Supabase SQL Editor.
2. في Dokploy → Environment أضف `ADMIN_SETUP_CODE` (10 أحرف على الأقل) و`SUPABASE_SERVICE_ROLE_KEY` (سري، لا تضعه في Build Args ولا في متغير يبدأ بـ VITE) مع `SUPABASE_URL` و`SUPABASE_ANON_KEY` (والأخيران يوضعان أيضاً في Build Args).
3. افتح `https://موقعك/admin` ← إنشاء حساب ← بريدك، وفي كلمة المرور اكتب الرمز نفسه ← يصبح الحساب المدير العام فوراً.
4. بعدها احذف `ADMIN_SETUP_CODE` من Environment وغيّر كلمة مرورك.
