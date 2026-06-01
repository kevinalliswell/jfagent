# Seed Knowledge Checklist (T-032)

What to collect for the first real knowledge corpus, and how to shape each file
so the RAG index and citations work well. Target: **10–20 files**. Quality over
quantity. Everything here gets uploaded via `https://DOMAIN/?admin=1`.

## Hard rules (read first)

- **Supported formats only**: `.md` `.txt` `.docx` `.pdf` `.xlsx` `.csv` `.tsv`.
  NOT supported: `.doc`, `.xls`, images, scanned/image-only PDFs (must have
  selectable text). Convert old formats first.
- **Desensitize before upload.** These files live on the seed server and are
  retrievable in citations. Remove real customer names, contacts, addresses, and
  any price you are not comfortable hosting. Replace with generic labels
  ("某医院", "某政府数据中心") where needed.
- **One topic per file, give it a descriptive filename.** The filename becomes
  part of the citation, so `三甲医院机房改造案例_2023.md` is far better than
  `doc1.md`.
- **Text must be real text, not a picture of text.** A PDF exported from Word is
  fine; a phone photo saved as PDF is not.

---

## The shopping list — 4 categories, ~3-5 files each

Use the 4 files already in `knowledge/` as worked examples of tone/shape.

### Category A — 报价单 / BOQ (3-5 files) → `.xlsx` or `.csv`

Past project quotations or bills of quantities. These power historical-price and
equipment-scope retrieval. **Most valuable category.**

Use this header row so the system auto-classifies it as a quotation
(matches `示例机房报价清单.csv`):

```
系统,设备名称,品牌,型号,数量,单位,单价,合价,备注
```

- 3-5 separate sheets from different project sizes (small / medium, hospital /
  gov / education if you have them).
- Keep the rows real (real equipment, real-ish quantities) but scrub prices you
  don't want hosted, or round them.
- One row per line item; don't merge cells.

### Category B — 历史项目案例 (3-5 files) → `.md` / `.docx` / `.pdf`

Write-ups of projects you've actually delivered. These give the agent concrete
precedent to cite. Model on `医院老机房改造案例.md`.

Each file should cover, in prose (a few short paragraphs is enough):

- 项目背景 / 客户行业 / 机房规模(面积、楼层、机柜数)
- 建设范围(UPS、电池、配电、精密空调、动环、消防、接地、装修…)
- 遇到的关键风险或难点 + 如何处理(楼板承重、搬运、电梯、工期…)
- 交付口径 / 经验教训

Pick projects across industries (医院 / 政府 / 教育 / 企业) so retrieval has range.

### Category C — 需求表 / 方案模板 (2-4 files) → `.docx` / `.md`

The actual requirement sheets and proposal templates your team uses today. Model
on `机房预售需求表模板.md`. This teaches the agent your real output format.

- your standard 需求表 (the fields you always collect)
- a proposal / 方案 template skeleton if you have one
- any standard "待确认事项" / "报价前置条件" checklist

### Category D — 配置规则 / 设备规格 (2-4 files) → `.md` / `.txt` / `.docx`

Selection rules, sizing heuristics, device specs, brand/model shortlists. Model
on `中小型机房配置规则.md`. This is your engineering know-how the agent reasons with.

- 选型 / 估算规则(面积↔机柜数、IT负载↔UPS容量、后备时间↔电池柜…)
- 常用设备品牌/型号清单与适用场景
- 风险判定规则(几层以上要复核承重、长延时电池注意事项…)

---

## Fill-in tracker (copy this, tick as you go)

```
A 报价/BOQ      [ ] __________  [ ] __________  [ ] __________  [ ] __________  [ ] __________
B 项目案例      [ ] __________  [ ] __________  [ ] __________  [ ] __________  [ ] __________
C 需求表/模板   [ ] __________  [ ] __________  [ ] __________  [ ] __________
D 配置/规格     [ ] __________  [ ] __________  [ ] __________  [ ] __________
```

Aim for at least: 3 in A, 3 in B, 2 in C, 2 in D = 10 minimum.

## After you upload

For each file, confirm it landed:

```bash
curl -u admin:ADMIN_PASS https://DOMAIN/api/admin/knowledge/status
```

Then run a chat turn whose answer should rely on that file and check it appears
in the knowledge citations. If a file never shows up in any citation, tell me the
filename — it usually means the text didn't extract (scanned PDF, empty cells, or
an unusual layout) and I'll help debug the ingestion.

## What I (Claude/Codex) can do once you've uploaded

- verify each file extracted and is retrievable (ingestion check),
- spot files that produced no usable chunks and explain why,
- tune retrieval/citation wording if real docs surface gaps.
