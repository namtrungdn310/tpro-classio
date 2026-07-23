interface ClassGroupColor {
  background: string;
  border: string;
  text: string;
}

export interface ClassGroupInfo {
  key: string;
  label: string;
  sort: number;
  color: ClassGroupColor;
}

type ClassProgramKind =
  | "ielts"
  | "gifted"
  | "specialized"
  | "entrance-10"
  | "graduation"
  | "school-grade"
  | "primary"
  | "secondary"
  | "high-school"
  | "custom";

type ClassClassification = {
  kind: ClassProgramKind;
  grade: number | null;
  group: ClassGroupInfo;
};

const GRADE_GROUP_COLORS: Record<number, ClassGroupColor> = {
  1: { background: "#FFF1F2", border: "#FDA4AF", text: "#BE123C" },
  2: { background: "#FFF7ED", border: "#FDBA74", text: "#C2410C" },
  3: { background: "#FFFBEB", border: "#FCD34D", text: "#B45309" },
  4: { background: "#F7FEE7", border: "#BEF264", text: "#4D7C0F" },
  5: { background: "#ECFDF5", border: "#6EE7B7", text: "#047857" },
  6: { background: "#EFF6FF", border: "#93C5FD", text: "#1D4ED8" },
  7: { background: "#ECFEFF", border: "#67E8F9", text: "#0E7490" },
  8: { background: "#F0FDF4", border: "#86EFAC", text: "#15803D" },
  9: { background: "#FEFCE8", border: "#FDE047", text: "#A16207" },
  10: { background: "#FFF7ED", border: "#FDBA74", text: "#C2410C" },
  11: { background: "#F5F3FF", border: "#C4B5FD", text: "#6D28D9" },
  12: { background: "#FDF2F8", border: "#F9A8D4", text: "#BE185D" },
};

const PROGRAM_GROUPS = {
  ielts: buildGroup("ielts", "IELTS", 9000, {
    background: "#F8FAFC",
    border: "#CBD5E1",
    text: "#334155",
  }),
  gifted: buildGroup("gifted", "Học sinh giỏi", 8200, {
    background: "#FFF1F2",
    border: "#FDA4AF",
    text: "#BE123C",
  }),
  specialized: buildGroup("specialized", "Thi chuyên", 8100, {
    background: "#F5F3FF",
    border: "#C4B5FD",
    text: "#6D28D9",
  }),
  entrance10: buildGroup("entrance-10", "Ôn thi lớp 10", 8000, {
    background: "#FFF7ED",
    border: "#FDBA74",
    text: "#C2410C",
  }),
  graduation: buildGroup("graduation", "Ôn thi THPT/ĐH", 8300, {
    background: "#EEF2FF",
    border: "#A5B4FC",
    text: "#4338CA",
  }),
  primary: buildGroup("primary", "Tiểu học", 100, {
    background: "#F0F9FF",
    border: "#7DD3FC",
    text: "#0369A1",
  }),
  secondary: buildGroup("secondary", "THCS", 200, {
    background: "#F0FDFA",
    border: "#5EEAD4",
    text: "#0F766E",
  }),
  highSchool: buildGroup("high-school", "THPT", 300, {
    background: "#EEF2FF",
    border: "#A5B4FC",
    text: "#4338CA",
  }),
};

const FALLBACK_GROUP_COLORS: ClassGroupColor[] = [
  { background: "#EEF2FF", border: "#A5B4FC", text: "#4338CA" },
  { background: "#F0FDFA", border: "#5EEAD4", text: "#0F766E" },
  { background: "#F7FEE7", border: "#BEF264", text: "#4D7C0F" },
  { background: "#FFF1F2", border: "#FDA4AF", text: "#BE123C" },
];

const EDUCATION_PROGRAM_GRADE_PATTERNS = [
  { label: "Global", pattern: /\bglobal(?:\s+success)?\s*(\d{1,2})(?=\s*[a-z]|$|\b)/ },
  { label: "TA", pattern: /\b(?:tieng\s*anh|english)\s*(\d{1,2})(?=\s*[a-z]|$|\b)/ },
  { label: "Smart", pattern: /\b(?:i\s*learn\s*)?smart\s*world\s*(\d{1,2})(?=\s*[a-z]|$|\b)/ },
  { label: "Friends", pattern: /\bfriends(?:\s+plus)?\s*(\d{1,2})(?=\s*[a-z]|$|\b)/ },
];

export function getClassGroupInfo(className: string): ClassGroupInfo {
  return classifyClassName(className).group;
}

export function getClassSortKey(className: string): [number, string] {
  const group = getClassGroupInfo(className);
  return [group.sort, className];
}

export function abbreviateClassName(className: string, maxLength = 14): string {
  const fullName = collapseWhitespace(className);
  if (!fullName) {
    return fullName;
  }

  const normalizedName = normalizeClassName(fullName);
  const classification = classifyClassName(fullName);
  if (
    fullName.length <= maxLength &&
    (classification.kind === "school-grade" || classification.kind === "custom")
  ) {
    return fullName;
  }
  let shortName: string;

  switch (classification.kind) {
    case "ielts":
      shortName = abbreviateIeltsName(fullName, normalizedName);
      break;
    case "gifted":
      shortName = abbreviateGiftedName(normalizedName, classification.grade);
      break;
    case "specialized":
      shortName = abbreviateSpecializedName(normalizedName, classification.grade);
      break;
    case "entrance-10":
      shortName = "Ôn thi 10";
      break;
    case "graduation":
      shortName = abbreviateGraduationName(normalizedName, classification.grade);
      break;
    case "school-grade":
      shortName = abbreviateSchoolName(fullName, normalizedName, classification.grade);
      break;
    case "primary":
      shortName = "TA Tiểu học";
      break;
    case "secondary":
      shortName = "TA THCS";
      break;
    case "high-school":
      shortName = "TA THPT";
      break;
    default:
      shortName = abbreviateUnknownName(fullName);
  }

  return fitShortName(shortName, maxLength);
}

function classifyClassName(className: string): ClassClassification {
  const normalizedName = normalizeClassName(className);
  const grade = getSchoolGrade(normalizedName);

  if (/\bielts\b/.test(normalizedName)) {
    return { kind: "ielts", grade: null, group: PROGRAM_GROUPS.ielts };
  }

  if (/\b(?:hsg|hoc\s+sinh\s+gioi|boi\s+duong\s+(?:hoc\s+sinh\s+gioi|hsg)|doi\s+tuyen)\b/.test(normalizedName)) {
    const scope = /\b(?:quoc\s+gia|qg)\b/.test(normalizedName)
      ? "national"
      : /\b(?:thanh\s+pho|tp|tinh)\b/.test(normalizedName)
        ? "local"
        : "general";
    const label = scope === "national" ? "HSG quốc gia" : scope === "local" ? "HSG tỉnh/thành phố" : "Học sinh giỏi";
    return {
      kind: "gifted",
      grade,
      group: { ...PROGRAM_GROUPS.gifted, key: `gifted-${scope}`, label },
    };
  }

  if (/\b(?:le\s+quy\s+don|lqd|thi\s+chuyen|chuyen\s+anh|lop\s+chuyen)\b/.test(normalizedName)) {
    return { kind: "specialized", grade, group: PROGRAM_GROUPS.specialized };
  }

  if (
    /\b(?:on|luyen|thi)\s+(?:thi\s+)?(?:tuyen\s+sinh\s+)?(?:vao\s+)?(?:lop\s+)?10\b/.test(normalizedName) ||
    /\b(?:tuyen\s+sinh|vao)\s+(?:lop\s+)?10\b/.test(normalizedName) ||
    /\b9\s+len\s+10\b/.test(normalizedName)
  ) {
    return { kind: "entrance-10", grade: 10, group: PROGRAM_GROUPS.entrance10 };
  }

  if (
    /\b(?:dai\s+hoc|thptqg|thpt\s+qg|thi\s+thpt\s+quoc\s+gia|tot\s+nghiep\s+thpt)\b/.test(normalizedName) ||
    /\b(?:on|luyen)\s+thi\s+(?:lop\s+)?12\b/.test(normalizedName)
  ) {
    return { kind: "graduation", grade: grade ?? 12, group: PROGRAM_GROUPS.graduation };
  }

  if (grade !== null) {
    return {
      kind: "school-grade",
      grade,
      group: buildGroup(`grade-${grade}`, `Lớp ${grade}`, grade, GRADE_GROUP_COLORS[grade]),
    };
  }

  if (/\b(?:tieu\s+hoc|cap\s+1|primary)\b/.test(normalizedName)) {
    return { kind: "primary", grade: null, group: PROGRAM_GROUPS.primary };
  }

  if (/\b(?:thcs|cap\s+2|secondary)\b/.test(normalizedName)) {
    return { kind: "secondary", grade: null, group: PROGRAM_GROUPS.secondary };
  }

  if (/\b(?:thpt|cap\s+3|high\s+school)\b/.test(normalizedName)) {
    return { kind: "high-school", grade: null, group: PROGRAM_GROUPS.highSchool };
  }

  const firstToken = normalizedName.match(/[a-z0-9]+/)?.[0];
  const key = firstToken ? `custom-${firstToken}` : "other";
  return {
    kind: "custom",
    grade: null,
    group: buildGroup(key, firstToken ? toTitleLabel(firstToken) : "Khác", 9999),
  };
}

function abbreviateIeltsName(fullName: string, normalizedName: string): string {
  const codes: string[] = [];
  addCode(codes, /\bchuyen\s+sau\b/.test(normalizedName), "CS");
  addCode(codes, /\btong\s+hop\b/.test(normalizedName), "TH");
  addCode(codes, /\b(?:foundation|nen\s+tang)\b/.test(normalizedName), "FDN");
  addCode(codes, /\bpre\s*ielts\b/.test(normalizedName), "PRE");
  addCode(codes, /\b(?:intensive|cap\s+toc)\b/.test(normalizedName), "INT");
  addCode(codes, /\b(?:advanced|advance|nang\s+cao)\b/.test(normalizedName), "ADV");
  addCode(codes, /\bcore\b/.test(normalizedName), "CORE");
  addCode(codes, /\bdevelop\b/.test(normalizedName), "DEV");
  addCode(codes, /\b(?:beginner|co\s+ban|mat\s+goc)\b/.test(normalizedName), "CB");
  addCode(codes, /\b(?:luyen\s+de|mock\s+test)\b/.test(normalizedName), "LĐ");
  addCode(codes, /\bwriting\b/.test(normalizedName), "W");
  addCode(codes, /\bspeaking\b/.test(normalizedName), "S");
  addCode(codes, /\blistening\b/.test(normalizedName), "L");
  addCode(codes, /\breading\b/.test(normalizedName), "R");

  const score = fullName.match(/\b\d{1,2}(?:[.,]\d)?\+?\b/)?.[0]?.replace(",", ".");
  if (codes.length === 0 && !score) {
    const tail = fullName.replace(/\bIELTS\b/iu, "").trim();
    return tail ? `IELTS ${toInitials(tail)}` : "IELTS";
  }

  return ["IELTS", ...codes, score].filter(Boolean).join(" ");
}

function abbreviateGiftedName(normalizedName: string, grade: number | null): string {
  const scope = /\b(?:quoc\s+gia|qg)\b/.test(normalizedName)
    ? "QG"
    : /\b(?:thanh\s+pho|tp)\b/.test(normalizedName)
      ? "TP"
      : /\btinh\b/.test(normalizedName)
        ? "Tỉnh"
        : "";
  return ["HSG", scope, grade].filter((value) => value !== "" && value !== null).join(" ");
}

function abbreviateSpecializedName(normalizedName: string, grade: number | null): string {
  const school = /\b(?:le\s+quy\s+don|lqd)\b/.test(normalizedName) ? "LQĐ" : "Anh";
  return ["Chuyên", school, grade].filter((value) => value !== null).join(" ");
}

function abbreviateGraduationName(normalizedName: string, grade: number | null): string {
  const prefix = /\b(?:tot\s+nghiep\s+thpt|thptqg|thpt\s+qg|thi\s+thpt\s+quoc\s+gia)\b/.test(normalizedName)
    ? "TN THPT"
    : "Ôn thi ĐH";
  return [prefix, grade].filter((value) => value !== null).join(" ");
}

function abbreviateSchoolName(fullName: string, normalizedName: string, grade: number | null): string {
  const modifiers = [
    /\bnang\s+cao\b/.test(normalizedName) ? "NC" : "",
    /\bco\s+ban\b/.test(normalizedName) ? "CB" : "",
    /\btang\s+cuong\b/.test(normalizedName) ? "TC" : "",
    /\bchat\s+luong\s+cao\b/.test(normalizedName) ? "CLC" : "",
  ].filter(Boolean);
  const educationProgramLabel = getEducationProgramLabel(normalizedName);
  if (educationProgramLabel && grade !== null) {
    return [`${educationProgramLabel}${grade}`, ...modifiers].join(" ");
  }
  const isEnglishProgram = /\b(?:tieng\s+anh|english)\b/.test(normalizedName);

  if (isEnglishProgram) {
    return [`TA${grade ?? ""}`, ...modifiers].join(" ");
  }

  const compactCode = fullName.match(/^\s*(?:lớp|l|khối|grade)?\s*(\d{1,2}\s*[a-z]\d*)\b/iu)?.[1]?.replace(/\s+/g, "");
  return [compactCode ?? `L${grade ?? ""}`, ...modifiers].join(" ");
}

function abbreviateUnknownName(fullName: string): string {
  const [firstWord, ...rest] = fullName.split(/\s+/);
  const initials = toInitials(rest.join(" "));
  return initials ? `${firstWord} ${initials}` : firstWord;
}

function fitShortName(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const tokens = value.split(/\s+/).filter(Boolean);
  const lastToken = tokens.at(-1) ?? "";
  const keepLast = /^\d+(?:[.,]\d+)?\+?$/.test(lastToken);
  const result = [tokens[0]];

  for (const token of tokens.slice(1, keepLast ? -1 : undefined)) {
    if ([...result, token].join(" ").length > maxLength) {
      break;
    }
    result.push(token);
  }

  if (keepLast && [...result, lastToken].join(" ").length <= maxLength) {
    result.push(lastToken);
  }

  const compact = result.join(" ");
  return compact.length <= maxLength ? compact : Array.from(compact).slice(0, maxLength).join("");
}

function addCode(codes: string[], condition: boolean, code: string) {
  if (condition && !codes.includes(code)) {
    codes.push(code);
  }
}

function getSchoolGrade(normalizedName: string): number | null {
  const leadingGrade = normalizedName.match(/^(?:(?:lop|l|khoi|grade)\s*)?(1[0-2]|[1-9])(?=$|\s|[a-z]\d*)/);
  if (leadingGrade) {
    return toValidGrade(leadingGrade[1]);
  }

  const keywordGrade = normalizedName.match(/\b(?:lop|khoi|kem|grade)\s*(1[0-2]|[1-9])(?=$|\s|[a-z]\d*)/);
  if (keywordGrade) {
    return toValidGrade(keywordGrade[1]);
  }

  const contextualTrailingGrade = normalizedName.match(
    /\b(?:hsg|hoc\s+sinh\s+gioi|doi\s+tuyen|chuyen|le\s+quy\s+don|lqd|dai\s+hoc|thpt|tieng\s+anh|english|global|smart|friends)\b.*\b(1[0-2]|[1-9])$/,
  );
  if (contextualTrailingGrade) {
    return toValidGrade(contextualTrailingGrade[1]);
  }

  return getEducationProgramGrade(normalizedName)?.grade ?? null;
}

function getEducationProgramLabel(normalizedName: string): string | null {
  if (/\bglobal(?:\s+success)?\b/.test(normalizedName)) return "Global";
  if (/\b(?:tieng\s*anh|english)\b/.test(normalizedName)) return "TA";
  if (/\b(?:i\s*learn\s*)?smart\s*world\b/.test(normalizedName)) return "Smart";
  if (/\bfriends(?:\s+plus)?\b/.test(normalizedName)) return "Friends";
  return null;
}

function getEducationProgramGrade(normalizedName: string): { label: string; grade: number } | null {
  for (const { label, pattern } of EDUCATION_PROGRAM_GRADE_PATTERNS) {
    const match = normalizedName.match(pattern);
    const grade = match ? toValidGrade(match[1]) : null;
    if (grade !== null) {
      return { label, grade };
    }
  }

  return null;
}

function toValidGrade(value: string): number | null {
  const grade = Number(value);
  return Number.isInteger(grade) && grade >= 1 && grade <= 12 ? grade : null;
}

function buildGroup(
  key: string,
  label: string,
  sort: number,
  color?: ClassGroupColor,
): ClassGroupInfo {
  return {
    key,
    label,
    sort,
    color: color ?? FALLBACK_GROUP_COLORS[stableHash(key) % FALLBACK_GROUP_COLORS.length],
  };
}

function normalizeClassName(value: string) {
  return collapseWhitespace(value)
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function stableHash(value: string) {
  return Array.from(value).reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
}

function toTitleLabel(value: string) {
  return value.charAt(0).toLocaleUpperCase("vi-VN") + value.slice(1);
}

function toInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toLocaleUpperCase("vi-VN"))
    .filter(Boolean)
    .join("");
}
