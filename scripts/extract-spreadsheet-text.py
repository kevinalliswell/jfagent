#!/usr/bin/env python3
import argparse
import csv
import re
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path


MAX_ROWS_PER_SHEET = 300
MAX_COLUMNS = 36

CANONICAL_HEADERS = {
    "item_name": ["设备名称", "材料名称", "项目名称", "产品名称", "货物名称", "品名", "名称", "设备/材料名称"],
    "brand": ["品牌", "厂家", "制造商", "供应商"],
    "model": ["型号", "规格型号", "规格", "产品型号", "参数"],
    "quantity": ["数量", "工程量", "用量"],
    "unit": ["单位", "计量单位"],
    "unit_price": ["单价", "含税单价", "未税单价", "综合单价", "报价"],
    "total_price": ["合价", "总价", "金额", "小计", "合计"],
    "remark": ["备注", "说明", "描述", "配置说明"],
    "system": ["系统", "类别", "专业", "分项", "子系统"],
}

CATEGORY_PATTERNS = [
    ("Battery", re.compile(r"电池|蓄电池|电瓶|电池柜")),
    ("UPS", re.compile(r"ups|不间断|后备电源", re.I)),
    ("Precision AC", re.compile(r"精密空调|恒温恒湿|列间空调|空调|冷机")),
    ("Power Distribution", re.compile(r"配电|pdu|强电柜|配电柜|开关柜", re.I)),
    ("Environmental Monitoring", re.compile(r"动环|环控|环境监控|监控主机")),
    ("Fire Suppression", re.compile(r"消防|七氟丙烷|灭火|气体消防")),
    ("Rack", re.compile(r"机柜|服务器柜|网络柜|rack", re.I)),
    ("Cabling", re.compile(r"综合布线|网线|光纤|跳线|桥架")),
    ("Raised Floor", re.compile(r"防静电地板|静电地板|活动地板")),
    ("Grounding", re.compile(r"接地|防雷|等电位|铜排")),
    ("Fitout", re.compile(r"装修|封堵|墙面|吊顶|照明")),
]


def normalize_cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return f"{value:.4f}".rstrip("0").rstrip(".")
    return " ".join(str(value).replace("\r", "\n").replace("\n", " ").split()).strip()


def read_csv_text(file_path: Path) -> str:
    raw = file_path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def read_csv_rows(file_path: Path):
    text = read_csv_text(file_path)
    sample = text[:4096]
    if file_path.suffix.lower() == ".tsv":
        dialect = csv.excel_tab
    else:
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;，")
        except csv.Error:
            dialect = csv.excel
    reader = csv.reader(text.splitlines(), dialect)
    rows = [[normalize_cell(cell) for cell in row[:MAX_COLUMNS]] for row in reader]
    return [{"name": file_path.stem, "rows": rows}]


def read_xlsx_rows(file_path: Path):
    try:
        import openpyxl  # type: ignore
    except Exception as exc:
        raise RuntimeError("openpyxl is required for .xlsx extraction") from exc

    workbook = openpyxl.load_workbook(str(file_path), read_only=True, data_only=True)
    sheets = []
    for sheet in workbook.worksheets:
        rows = []
        for row in sheet.iter_rows(values_only=True):
            rows.append([normalize_cell(cell) for cell in row[:MAX_COLUMNS]])
            if len(rows) >= MAX_ROWS_PER_SHEET:
                break
        sheets.append({"name": sheet.title, "rows": rows})
    return sheets


def compact_rows(rows):
    compacted = []
    for row in rows:
        trimmed = list(row)
        while trimmed and not trimmed[-1]:
            trimmed.pop()
        if any(trimmed):
            compacted.append(trimmed)
    return compacted


def header_score(row):
    score = 0
    non_empty = [cell for cell in row if cell]
    score += min(len(non_empty), 8) * 0.15
    for cell in non_empty:
        lowered = cell.lower()
        for aliases in CANONICAL_HEADERS.values():
            if any(alias.lower() in lowered for alias in aliases):
                score += 2
    numeric_like = sum(1 for cell in non_empty if re.fullmatch(r"[\d,.]+", cell))
    if non_empty and numeric_like / len(non_empty) > 0.6:
        score -= 2
    return score


def detect_header(rows):
    best_index = 0
    best_score = -1
    for index, row in enumerate(rows[:20]):
        score = header_score(row)
        if score > best_score:
            best_index = index
            best_score = score
    if best_score < 2:
        for index, row in enumerate(rows):
            if sum(1 for cell in row if cell) >= 2:
                return index
    return best_index


def make_headers(row):
    headers = []
    seen = {}
    for index, cell in enumerate(row):
        header = cell or f"列{index + 1}"
        count = seen.get(header, 0)
        seen[header] = count + 1
        if count:
            header = f"{header}_{count + 1}"
        headers.append(header)
    return headers


def canonical_key(header):
    lowered = header.lower()
    for key, aliases in CANONICAL_HEADERS.items():
        if any(alias.lower() in lowered for alias in aliases):
            return key
    return ""


def infer_category(text):
    for category, pattern in CATEGORY_PATTERNS:
        if pattern.search(text):
            return category
    return ""


def infer_sheet_kind(file_path: Path, sheet_name: str, headers):
    haystack = f"{file_path.name} {sheet_name} {' '.join(headers)}".lower()
    if re.search(r"boq|工程量|设备清单|材料清单|bill of quantities", haystack, re.I):
        return "boq"
    if re.search(r"报价|价格|单价|合价|总价|金额|quotation|quote", haystack, re.I):
        return "quotation"
    return "spreadsheet"


def mapped_row(headers, row):
    values = {}
    raw_pairs = []
    for index, header in enumerate(headers):
        value = row[index] if index < len(row) else ""
        if not value:
            continue
        raw_pairs.append((header, value))
        key = canonical_key(header)
        if key and key not in values:
            values[key] = value
    return values, raw_pairs


def is_meaningful_item(values, raw_pairs):
    if values.get("item_name"):
        return True
    meaningful = sum(1 for _, value in raw_pairs if value)
    price_signal = values.get("unit_price") or values.get("total_price") or values.get("quantity")
    return meaningful >= 3 and bool(price_signal)


def summarize_sheet(file_path: Path, sheet_name: str, rows):
    rows = compact_rows(rows)
    if not rows:
        return ""

    header_index = detect_header(rows)
    headers = make_headers(rows[header_index])
    data_rows = rows[header_index + 1 :]
    sheet_kind = infer_sheet_kind(file_path, sheet_name, headers)
    title_prefix = "报价清单" if sheet_kind == "quotation" else "BOQ清单" if sheet_kind == "boq" else "表格资料"

    item_lines = []
    category_counts = {}
    valid_count = 0

    for row_number, row in enumerate(data_rows, start=header_index + 2):
        values, raw_pairs = mapped_row(headers, row)
        if not is_meaningful_item(values, raw_pairs):
            continue

        text_for_category = " ".join(values.values()) + " " + " ".join(value for _, value in raw_pairs)
        category = infer_category(text_for_category)
        if category:
            category_counts[category] = category_counts.get(category, 0) + 1

        item_name = values.get("item_name") or raw_pairs[0][1]
        parts = [
            f"行号: {row_number}",
            f"报价项: {item_name}",
        ]
        if category:
            parts.append(f"类别: {category}")
        for key, label in (
            ("system", "系统"),
            ("brand", "品牌"),
            ("model", "型号/规格"),
            ("quantity", "数量"),
            ("unit", "单位"),
            ("unit_price", "单价"),
            ("total_price", "合价/金额"),
            ("remark", "备注"),
        ):
            if values.get(key):
                parts.append(f"{label}: {values[key]}")

        raw_preview = "；".join(f"{header}: {value}" for header, value in raw_pairs[:10])
        parts.append(f"原始列: {raw_preview}")
        item_lines.append((item_name, "；".join(parts)))
        valid_count += 1

    if not item_lines:
        return ""

    category_summary = "，".join(f"{category} {count}项" for category, count in sorted(category_counts.items()))
    if not category_summary:
        category_summary = "未识别明确设备类别"

    output = [
        f"# {title_prefix}: {file_path.stem}",
        "",
        f"## Sheet: {sheet_name}",
        "",
        f"来源文件: {file_path.name}",
        f"表格类型: {sheet_kind}",
        f"识别表头: {' | '.join(headers)}",
        f"有效报价/BOQ行数: {valid_count}",
        f"设备类别统计: {category_summary}",
        "",
        "### 报价/BOQ摘要",
        f"{file_path.name} / {sheet_name} 共识别 {valid_count} 条有效报价或BOQ行，可用于历史价格、设备范围和报价项检索。类别统计：{category_summary}。",
        "",
    ]

    for item_name, line in item_lines:
        safe_name = item_name[:60] if item_name else "未命名报价项"
        output.extend([f"### 报价项: {safe_name}", line, ""])

    return "\n".join(output).strip()


def extract_spreadsheet(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    if suffix in (".csv", ".tsv"):
        sheets = read_csv_rows(file_path)
    elif suffix == ".xlsx":
        sheets = read_xlsx_rows(file_path)
    else:
        raise ValueError(f"Unsupported extension: {suffix}")

    sections = []
    for sheet in sheets:
        text = summarize_sheet(file_path, sheet["name"], sheet["rows"])
        if text:
            sections.append(text)
    return "\n\n".join(sections).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract BOQ and quotation text from XLSX/CSV/TSV files.")
    parser.add_argument("file", type=Path)
    args = parser.parse_args()

    try:
        text = extract_spreadsheet(args.file)
    except Exception as exc:
        print(f"Failed to extract {args.file}: {exc}", file=sys.stderr)
        return 2

    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
