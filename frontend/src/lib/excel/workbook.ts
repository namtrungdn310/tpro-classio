import type { Cell, SheetData } from "write-excel-file/browser";

export type ExcelValue = string | number | boolean | Date | null | undefined;
export type ExcelRecord = Record<string, ExcelValue>;

export type ExcelSheetDefinition = {
  name: string;
  title: string;
  description?: string;
  rows: ExcelRecord[];
};

const COLORS = {
  primary: "#07338F",
  primarySoft: "#EAF0FC",
  header: "#F1F5F9",
  text: "#172033",
  muted: "#526079",
  line: "#DCE3EC",
  stripe: "#F8FAFC",
  white: "#FFFFFF",
};

export async function exportExcelWorkbook(
  sheets: ExcelSheetDefinition[],
  fileName: string,
) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const exportedAt = new Date();
  const workbookSheets = sheets.map((sheet) => {
    const headers = Object.keys(sheet.rows[0] ?? {});
    return {
      sheet: sanitizeSheetName(sheet.name),
      data: buildSheetData(sheet, headers, exportedAt),
      columns: getAutoFitColumns(sheet.rows, headers),
      stickyRowsCount: 4,
      // Do not freeze the first column. Excel renders a visible divider for a
      // frozen column, which looks like an accidental border in exported files
      // and is not useful for these short management lists.
      showGridLines: false,
      orientation: headers.length > 7 ? "landscape" as const : undefined,
    };
  });

  await writeExcelFile(workbookSheets).toFile(ensureXlsxExtension(fileName));
}

function buildSheetData(
  sheet: ExcelSheetDefinition,
  headers: string[],
  exportedAt: Date,
): SheetData {
  const columnSpan = Math.max(headers.length, 1);
  const description = sheet.description?.trim() || `Tổng số: ${sheet.rows.length} dòng`;
  const data: SheetData = [
    [styledCell(sheet.title, {
      backgroundColor: COLORS.primary,
      textColor: COLORS.white,
      fontSize: 16,
      fontWeight: "bold",
      height: 34,
      columnSpan,
      alignVertical: "center",
    })],
    [styledCell(description, {
      backgroundColor: COLORS.primarySoft,
      textColor: COLORS.text,
      fontSize: 11,
      height: 26,
      columnSpan,
      wrap: true,
      alignVertical: "center",
    })],
    [styledCell(
      `Xuất lúc ${new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(exportedAt)}`,
      {
        textColor: COLORS.muted,
        fontSize: 10,
        height: 22,
        columnSpan,
        alignVertical: "center",
      },
    )],
    headers.map((header) => styledCell(header, {
      backgroundColor: COLORS.header,
      textColor: COLORS.primary,
      fontWeight: "bold",
      height: 28,
      wrap: true,
      alignVertical: "center",
      bottomBorderColor: COLORS.primary,
      bottomBorderStyle: "medium",
    })),
  ];

  sheet.rows.forEach((row, index) => {
    data.push(headers.map((header) => valueCell(row[header], index)));
  });
  return data;
}

function valueCell(value: ExcelValue, rowIndex: number): Cell {
  const backgroundColor = rowIndex % 2 === 1 ? COLORS.stripe : COLORS.white;
  const base = {
    backgroundColor,
    textColor: COLORS.text,
    fontSize: 10,
    height: 24,
    wrap: true,
    alignVertical: "center" as const,
    bottomBorderColor: COLORS.line,
    bottomBorderStyle: "thin" as const,
  };
  if (typeof value === "number") {
    return styledCell(value, { ...base, type: Number, format: "#,##0", align: "right" });
  }
  if (value instanceof Date) {
    return styledCell(value, { ...base, type: Date, format: "dd/mm/yyyy", align: "center" });
  }
  if (typeof value === "boolean") {
    return styledCell(value ? "Có" : "Không", base);
  }
  return styledCell(value ?? "", base);
}

function styledCell(value: Exclude<ExcelValue, null | undefined>, style: Omit<NonNullable<Extract<Cell, object>>, "value">): Cell {
  return { value, ...style } as Cell;
}

function getAutoFitColumns(rows: ExcelRecord[], headers: string[]) {
  return headers.map((header) => {
    const longest = rows.reduce((max, row) => {
      const content = row[header] == null ? "" : String(row[header]);
      return Math.max(max, content.length);
    }, header.length);
    return { width: Math.min(Math.max(longest + 3, 12), 42) };
  });
}

export function sanitizeExcelFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_");
}

function ensureXlsxExtension(value: string) {
  const safe = sanitizeExcelFileName(value.replace(/\.xlsx$/i, ""));
  return `${safe || "TPRO_Export"}.xlsx`;
}

function sanitizeSheetName(value: string) {
  return value.replace(/[\\/?*:[\]]/g, "-").slice(0, 31) || "Danh sach";
}
