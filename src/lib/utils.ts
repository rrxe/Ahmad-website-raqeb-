export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function csvDownload(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) throw new Error('لا توجد بيانات لتصديرها');
  const headers = Object.keys(rows[0]);
  const quote = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const content = '\uFEFF' + [headers.map(quote).join(','), ...rows.map((row) => headers.map((h) => quote(row[h])).join(','))].join('\r\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) return String((error as { message: unknown }).message);
  return 'حدث خطأ غير متوقع';
}

export function roleLabel(role: string) {
  return ({ admin: 'المدير العام', teacher: 'مدرس', supervisor: 'مراقب', student: 'طالب', parent: 'ولي أمر' } as Record<string, string>)[role] || role;
}

export function statusLabel(status: string) {
  return ({ active: 'نشط', pending: 'بانتظار الموافقة', rejected: 'مرفوض', suspended: 'موقوف', present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'بعذر', submitted: 'تم التسليم', missing: 'لم يُسلّم' } as Record<string, string>)[status] || status;
}

export function localDateString(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localDateTimeInput(value: string | Date | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function schoolDateString(timeZone = 'Asia/Baghdad', date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
