/**
 * Parser cron 5 field (menit jam tanggal bulan hari) dengan evaluasi WIB (UTC+7).
 *
 * Mendukung: bintang, bintang/N, a, a-b, a-b/N, a/N, daftar (a,b,c),
 * nama bulan/hari.
 * Tanggal & hari memakai semantik OR seperti cron standar bila keduanya dibatasi.
 */

export const CRON_WIB_OFFSET = 7 * 3600_000;
const MINUTE_MS = 60_000;
const MAX_YEARS = 8;

const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const DAY_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export interface CronSpec {
  expr: string;
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  domRestricted: boolean;
  dowRestricted: boolean;
}

export interface CronParseResult {
  spec?: CronSpec;
  error?: string;
}

interface FieldDef {
  label: string;
  min: number;
  max: number;
  names?: Record<string, number>;
  /** Hari menerima 7 sebagai Minggu. */
  sundaySeven?: boolean;
}

const FIELDS: FieldDef[] = [
  { label: "menit", min: 0, max: 59 },
  { label: "jam", min: 0, max: 23 },
  { label: "tanggal", min: 1, max: 31 },
  { label: "bulan", min: 1, max: 12, names: MONTH_NAMES },
  { label: "hari", min: 0, max: 7, names: DAY_NAMES, sundaySeven: true },
];

function parseValue(token: string, field: FieldDef): number | null {
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (field.names && field.names[upper] !== undefined) return field.names[upper];
  if (!/^\d+$/.test(upper)) return null;
  const value = Number(upper);
  if (!Number.isInteger(value)) return null;
  if (value < field.min || value > field.max) return null;
  return value;
}

function parseField(raw: string, field: FieldDef): { values?: number[]; error?: string } {
  const values = new Set<number>();
  const parts = raw.split(",");
  if (!parts.length || parts.some((part) => !part.trim())) {
    return { error: `Field ${field.label} kosong.` };
  }

  for (const partRaw of parts) {
    const part = partRaw.trim();
    const slash = part.split("/");
    if (slash.length > 2) return { error: `Field ${field.label} tidak valid: "${part}".` };

    const rangeRaw = slash[0].trim();
    let step = 1;
    if (slash.length === 2) {
      if (!/^\d+$/.test(slash[1])) return { error: `Step ${field.label} harus angka: "${part}".` };
      step = Number(slash[1]);
      if (step < 1) return { error: `Step ${field.label} harus minimal 1.` };
    }

    let start: number;
    let end: number;

    if (rangeRaw === "*") {
      start = field.min;
      end = field.max;
    } else if (rangeRaw.includes("-")) {
      const pieces = rangeRaw.split("-");
      if (pieces.length !== 2) return { error: `Range ${field.label} tidak valid: "${part}".` };
      const a = parseValue(pieces[0], field);
      const b = parseValue(pieces[1], field);
      if (a === null || b === null || a > b) {
        return { error: `Range ${field.label} tidak valid: "${part}".` };
      }
      start = a;
      end = b;
    } else {
      const single = parseValue(rangeRaw, field);
      if (single === null) return { error: `Nilai ${field.label} tidak valid: "${part}".` };
      start = single;
      end = slash.length === 2 ? field.max : single;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  if (!values.size) return { error: `Field ${field.label} tidak menghasilkan nilai.` };

  let list = [...values].sort((a, b) => a - b);
  if (field.sundaySeven) {
    list = [...new Set(list.map((value) => (value === 7 ? 0 : value)))].sort((a, b) => a - b);
  }
  return { values: list };
}

export function parseCron(input: string): CronParseResult {
  const cleaned = input.trim().replace(/\s+/g, " ");
  if (!cleaned) return { error: "Ekspresi cron kosong." };
  const fields = cleaned.split(" ");
  if (fields.length !== 5) {
    return {
      error: "Cron harus 5 field: menit jam tanggal bulan hari. Contoh: */5 * * * *",
    };
  }

  const parsed: number[][] = [];
  for (let i = 0; i < FIELDS.length; i++) {
    const result = parseField(fields[i], FIELDS[i]);
    if (result.error || !result.values) return { error: result.error ?? `Field ${FIELDS[i].label} tidak valid.` };
    parsed.push(result.values);
  }

  const spec: CronSpec = {
    expr: fields.map((field) => field.toUpperCase()).join(" "),
    minutes: parsed[0],
    hours: parsed[1],
    daysOfMonth: parsed[2],
    months: parsed[3],
    daysOfWeek: parsed[4],
    domRestricted: fields[2] !== "*",
    dowRestricted: fields[4] !== "*",
  };

  return { spec };
}

function nextValue(values: number[], current: number): number | null {
  for (const value of values) {
    if (value > current) return value;
  }
  return null;
}

function dayMatches(spec: CronSpec, day: number, weekday: number): boolean {
  const dom = spec.daysOfMonth.includes(day);
  const dow = spec.daysOfWeek.includes(weekday);
  if (spec.domRestricted && spec.dowRestricted) return dom || dow;
  if (spec.domRestricted) return dom;
  if (spec.dowRestricted) return dow;
  return true;
}

/**
 * Jadwal berikutnya setelah `fromMs`, dalam epoch ms UTC.
 * Waktu dievaluasi sebagai WIB. Mengembalikan null bila tidak ada dalam 8 tahun.
 */
export function nextCronRun(spec: CronSpec, fromMs: number): number | null {
  if (!spec.minutes.length || !spec.hours.length || !spec.months.length) return null;

  const minuteSet = new Set(spec.minutes);
  const hourSet = new Set(spec.hours);
  const monthSet = new Set(spec.months);

  // Pseudo-UTC: tambah offset WIB, lalu pakai getter UTC.
  let cursor = Math.floor((fromMs + CRON_WIB_OFFSET) / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const limit = cursor + MAX_YEARS * 366 * 24 * 60 * MINUTE_MS;

  for (let guard = 0; guard < 2_000_000 && cursor < limit; guard++) {
    const date = new Date(cursor);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();
    const weekday = date.getUTCDay();

    if (!monthSet.has(month)) {
      const nextMonth = spec.months.find((value) => value > month);
      cursor = nextMonth
        ? Date.UTC(year, nextMonth - 1, 1, 0, 0, 0, 0)
        : Date.UTC(year + 1, spec.months[0] - 1, 1, 0, 0, 0, 0);
      continue;
    }

    if (!dayMatches(spec, day, weekday)) {
      cursor = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0);
      continue;
    }

    if (!hourSet.has(hour)) {
      const nextHour = nextValue(spec.hours, hour);
      if (nextHour === null) {
        cursor = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0);
      } else {
        cursor = Date.UTC(year, month - 1, day, nextHour, spec.minutes[0], 0, 0);
      }
      continue;
    }

    if (!minuteSet.has(minute)) {
      const nextMinute = nextValue(spec.minutes, minute);
      if (nextMinute !== null) {
        cursor = Date.UTC(year, month - 1, day, hour, nextMinute, 0, 0);
        continue;
      }
      const nextHour = nextValue(spec.hours, hour);
      if (nextHour === null) {
        cursor = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0);
      } else {
        cursor = Date.UTC(year, month - 1, day, nextHour, spec.minutes[0], 0, 0);
      }
      continue;
    }

    return cursor - CRON_WIB_OFFSET;
  }

  return null;
}

export function nextCronRuns(spec: CronSpec, fromMs: number, count: number): number[] {
  const runs: number[] = [];
  let cursor = fromMs;
  for (let i = 0; i < count; i++) {
    const next = nextCronRun(spec, cursor);
    if (next === null) break;
    runs.push(next);
    cursor = next;
  }
  return runs;
}

/** Jarak antara dua jadwal pertama; dipakai untuk menolak jadwal yang terlalu rapat. */
export function cronGapMs(spec: CronSpec, fromMs: number): number | null {
  const first = nextCronRun(spec, fromMs);
  if (first === null) return null;
  const second = nextCronRun(spec, first);
  if (second === null) return null;
  return second - first;
}

export function cronExample(kind: "monitor" | "rss" | "alert"): string {
  if (kind === "monitor") return "*/5 * * * *";
  if (kind === "rss") return "*/15 * * * *";
  return "0 * * * *";
}
