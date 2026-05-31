# RAG Knowledge Base Ingestion and Taxonomy Specification

> **STATUS: FUTURE / ASPIRATIONAL — NOT current behavior.** The real RAG is
> local hashed vectors (`local-hash-v1`, 96-dim) + naive keyword + hybrid sort.
> No BM25, no embedding model, no vector DB, no live upload→embed pipeline.
> See `docs/specs-future/README.md` and `GOAL.md`.

## Purpose

This document defines the Retrieval-Augmented Generation (RAG) knowledge base architecture for the Data Center Pre-sales AI Agent. Its purpose is to prevent hallucination, preserve verified corporate wisdom, and ensure that generated technical proposals, BOM suggestions, risk notes, and industry language are grounded in trusted source material.

The RAG backend must ingest, normalize, chunk, tag, verify, retrieve, and audit corporate and technical knowledge. The LLM may synthesize retrieved knowledge, but it must not invent standards, vendor specifications, product capacities, winning-bid claims, or corporate experience that is not supported by retrieved evidence.

---

## Knowledge Authority

### Precedence Order

```text
P0 verified corporate history
> P0 national room construction standards
> P0 vendor catalog specification tables
> P1 high-quality internal proposal library
> P1 verified implementation notes
> LLM semantic inference
```

### Anti-Hallucination Rules

1. The agent must cite or internally reference retrieved chunks before making vendor-specific or standards-specific claims.
2. The agent must not fabricate project cases, winning bids, model numbers, electrical parameters, fire requirements, grounding values, or lightning protection specifications.
3. The agent must not mix unverified spreadsheet rows into verified vendor catalog facts.
4. The agent must prefer recent verified catalog chunks when multiple versions conflict.
5. The agent must label outdated or unverified content as reference-only.
6. Retrieval results must include source metadata and verification status.
7. The final `.docx` proposal may use retrieved language, but hard calculations still come from `rules.md`.

---

## Section 1: Input Source Categorization

Sources are categorized by trust priority, business value, and retrieval usage. P0 sources are authoritative for generated content. P1 sources are valuable reference material but require stronger metadata and verification before being used as factual claims.

---

## Priority P0 Sources

P0 sources are high-trust, high-impact documents that may be used as authoritative grounding evidence.

### P0-A: Corporate History

#### Source Definition

Corporate history includes the top 20 winning bids and past high-quality technical proposals selected by management or senior pre-sales engineers.

Examples:

- Top 20 winning bid documents.
- Accepted technical proposal Word files.
- Final submitted construction integration proposals.
- Successful data center room renovation packages.
- Accepted hospital, government, school, enterprise, and industrial park machine room solutions.

#### Business Use

These documents provide reusable corporate wisdom:

- Proven chapter language.
- Winning project structure.
- Accepted technical scope descriptions.
- Practical construction notes.
- Typical risk statements.
- Industry-specific pitch patterns.
- BOM packaging style.
- Acceptance and delivery language.

#### Required Metadata

```json
{
  "Category": "Corporate_History",
  "Priority": "P0",
  "Source_Type": "Winning_Bid | Technical_Proposal | Final_Submission",
  "Customer_Industry": "medical | government | education | enterprise | industrial | carrier | unknown",
  "Project_Type": "new_build | renovation | expansion | migration | maintenance | unknown",
  "Component_Type": "overview | power | ups | cooling | fire | grounding | lightning | monitoring | cabling | civil | commercial | acceptance",
  "Verified_Status": "Verified",
  "Update_Time": "ISO-8601",
  "Confidentiality_Level": "internal | restricted | highly_restricted",
  "Reusable_Level": "style_only | technical_reusable | case_reference_allowed",
  "Source_File_ID": "string",
  "Chunk_ID": "string"
}
```

#### Ingestion Rules

```pseudo
FOR document IN corporate_history_sources:
  REQUIRE document.approved_by IN ["management", "senior_presales", "technical_director"]
  REQUIRE document.project_result == "won" OR document.quality_rating >= 4
  REQUIRE confidentiality_level IS SET
  EXTRACT chapter_structure
  EXTRACT technical_scope_blocks
  EXTRACT reusable_sentence_patterns
  REMOVE customer-private price values unless approved
  TAG chunks by industry, project type, and component type
  MARK Verified_Status = "Verified"
```

#### Retrieval Rules

Corporate history can support:

- Proposal tone and structure.
- Industry pitch language.
- Construction scope phrasing.
- Acceptance wording.
- Risk explanation style.

Corporate history cannot override:

- Current vendor catalog specifications.
- National standards.
- Backend calculation engines.
- Project-specific confirmed dashboard data.

---

### P0-B: Vendor Catalogs

#### Source Definition

Vendor catalogs include manufacturer specification sheets, product selection manuals, official parameter tables, and authorized distributor datasheets.

Required vendor families:

- UPS: Huawei, Vertiv.
- Cooling: Galletti, Envicool.

#### Business Use

Vendor catalogs ground factual claims about:

- UPS capacity ranges.
- UPS module size.
- Battery compatibility notes.
- Input/output voltage.
- Efficiency.
- Dimensions and weight.
- Precision AC cooling capacity.
- Airflow.
- Refrigerant or chilled-water type.
- Indoor/outdoor unit matching.
- Noise levels.
- Installation clearance.

#### Required Metadata

```json
{
  "Category": "Vendor_Catalog",
  "Priority": "P0",
  "Brand": "Huawei | Vertiv | Galletti | Envicool | Other",
  "Component_Type": "UPS | UPS_Battery_Bank | Precision_AC | Fresh_Air | PDU | Monitoring",
  "Product_Family": "string",
  "Model": "string",
  "Capacity_Rating": "string",
  "Specification_Field": "string",
  "Specification_Value": "string",
  "Unit": "string",
  "Verified_Status": "Verified | Vendor_Published | Distributor_Provided | Deprecated",
  "Update_Time": "ISO-8601",
  "Catalog_Version": "string",
  "Source_File_ID": "string",
  "Page_Number": "number | null",
  "Table_ID": "string | null",
  "Chunk_ID": "string"
}
```

#### Vendor Taxonomy

| Brand | Component Type | Typical Retrieval Need |
| --- | --- | --- |
| Huawei | UPS | Modular UPS capacity, module size, electrical specs |
| Vertiv | UPS | UPS models, power modules, runtime compatibility |
| Galletti | Precision_AC | Cooling capacity, chilled-water/direct-expansion options |
| Envicool | Precision_AC | Data center precision cooling specs and installation requirements |

#### Ingestion Rules

```pseudo
FOR catalog IN vendor_catalog_sources:
  REQUIRE source_origin IN ["official_vendor", "authorized_distributor", "internal_verified_archive"]
  EXTRACT all specification tables with page references
  NORMALIZE units into canonical values
  PRESERVE original specification text
  SPLIT one table row into one structured spec record when possible
  TAG Brand, Component_Type, Product_Family, Model
  MARK Verified_Status based on source_origin
  IF catalog_version older than active version:
    MARK Verified_Status = "Deprecated"
```

#### Conflict Resolution

```pseudo
FUNCTION resolve_vendor_spec_conflict(chunks):
  SORT chunks BY:
    Verified_Status priority: Verified > Vendor_Published > Distributor_Provided > Deprecated
    Update_Time DESC
    Catalog_Version DESC

  RETURN first_chunk
```

When conflicting specs exist, the retrieval layer must return the conflict metadata to the agent:

```json
{
  "conflict_detected": true,
  "preferred_chunk_id": "string",
  "conflicting_chunk_ids": [],
  "required_agent_behavior": "State that catalog versions differ and use the latest verified version."
}
```

---

### P0-C: National Room Construction Standards

#### Source Definition

National room construction standards include current, authoritative standards and code highlights relevant to data center room construction.

Required standards coverage:

- Fire safety.
- Grounding.
- Lightning protection.
- Electrical installation safety.
- Machine room environmental requirements.
- Cabling and weak-current installation requirements.

#### Business Use

Standards ground compliance-sensitive content:

- Fire suppression scope notes.
- Fire partition and sealing requirements.
- Grounding grid and equipotential bonding notes.
- Lightning protection and surge protection requirements.
- Cable routing separation.
- Safety acceptance checks.

#### Required Metadata

```json
{
  "Category": "National_Standard",
  "Priority": "P0",
  "Standard_Code": "string",
  "Standard_Name": "string",
  "Clause_Number": "string",
  "Component_Type": "Fire_Safety | Grounding | Lightning_Protection | Electrical | Cabling | Environment | Civil",
  "Jurisdiction": "China | Local | Industry",
  "Effective_Date": "ISO-8601 | null",
  "Verified_Status": "Verified | Superseded | Draft | Unknown",
  "Update_Time": "ISO-8601",
  "Source_File_ID": "string",
  "Page_Number": "number | null",
  "Chunk_ID": "string"
}
```

#### Standards Highlight Extraction

The ingestion process should extract highlights, not whole-law paraphrases without clause linkage.

```pseudo
FOR standard_document IN national_standards:
  EXTRACT clause_number
  EXTRACT clause_title
  EXTRACT short_requirement_summary
  EXTRACT applicable_component_type
  PRESERVE exact source citation metadata
  TAG Verified_Status = "Verified" ONLY after human review
```

#### Retrieval Rules

Standards chunks can support:

- Compliance notes.
- Construction requirements.
- Risk warning explanations.
- Acceptance checklist items.

Standards chunks cannot be used to:

- Replace a qualified engineer's final design.
- Invent exact legal obligations without clause-level evidence.
- Override local authority requirements when project jurisdiction differs.

---

## Priority P1 Sources

P1 sources are useful but require more caution. They may support phrasing, examples, or optional recommendations, but they cannot be treated as final authority unless upgraded to P0 through verification.

### P1-A: Internal Technical Notes

Examples:

- Engineer field notes.
- Construction issue summaries.
- Lessons learned.
- After-sales maintenance reports.
- Common acceptance failure lists.

Required handling:

```pseudo
MARK Category = "Internal_Technical_Note"
MARK Priority = "P1"
MARK Verified_Status = "Internal_Unverified" unless reviewed
DO NOT use as standards claim
DO NOT use as vendor specification claim
```

### P1-B: Supplier Quotations and Informal Spreadsheets

Examples:

- Supplier Excel quotations.
- Price comparison sheets.
- Product option spreadsheets.
- Regional channel notes.

Required handling:

```pseudo
MARK Category = "Supplier_Commercial"
MARK Priority = "P1"
MARK Verified_Status = "Commercial_Unverified"
EXTRACT price fields into restricted commercial index
DO NOT expose price values to final proposal unless approved pricing mode is active
```

### P1-C: Draft Proposals and Rejected Bids

Examples:

- Draft Word proposals.
- Rejected tender submissions.
- Incomplete technical plans.

Required handling:

```pseudo
MARK Category = "Draft_Proposal"
MARK Priority = "P1"
MARK Verified_Status = "Unverified"
ALLOW style retrieval only
DISALLOW factual reuse unless human reviewed
```

---

## Section 2: Chunking and Tagging Strategy

The ingestion system must create retrieval chunks that are semantically meaningful, traceable to source, and clean enough for embedding. Bad chunks cause hallucination, poor retrieval, and misleading proposal output.

---

## Canonical Chunk Metadata Schema

Every text chunk must include the required metadata requested by product:

```json
{
  "Category": "Corporate_History | Vendor_Catalog | National_Standard | Internal_Technical_Note | Supplier_Commercial | Draft_Proposal",
  "Brand": "Huawei | Vertiv | Galletti | Envicool | Other | Not_Applicable",
  "Component_Type": "UPS | UPS_Battery_Bank | Precision_AC | Fresh_Air | Fire_Safety | Grounding | Lightning_Protection | PDU | Monitoring | Cabling | Civil | Commercial | Overview | Acceptance | Other",
  "Verified_Status": "Verified | Vendor_Published | Distributor_Provided | Internal_Unverified | Commercial_Unverified | Deprecated | Superseded | Draft | Unknown",
  "Update_Time": "ISO-8601"
}
```

### Extended Metadata Schema

The production metadata schema should include additional fields for traceability and filtering:

```json
{
  "Chunk_ID": "string",
  "Source_File_ID": "string",
  "Source_File_Name": "string",
  "Source_Type": "PDF | DOCX | XLSX | CSV | Markdown | HTML | Image_OCR",
  "Priority": "P0 | P1",
  "Category": "string",
  "Brand": "string",
  "Component_Type": "string",
  "Customer_Industry": "medical | government | education | enterprise | industrial | carrier | unknown | not_applicable",
  "Project_Type": "new_build | renovation | expansion | migration | maintenance | unknown | not_applicable",
  "Product_Family": "string | null",
  "Model": "string | null",
  "Standard_Code": "string | null",
  "Clause_Number": "string | null",
  "Page_Number": "number | null",
  "Table_ID": "string | null",
  "Row_ID": "string | null",
  "Verified_Status": "string",
  "Update_Time": "ISO-8601",
  "Effective_Date": "ISO-8601 | null",
  "Expiration_Date": "ISO-8601 | null",
  "Language": "zh-CN | en | mixed",
  "Confidentiality_Level": "public | internal | restricted | highly_restricted",
  "Embedding_Text": "string",
  "Raw_Text": "string",
  "Normalized_Text": "string",
  "Checksum": "string",
  "Ingestion_Run_ID": "string"
}
```

### Tagging Rules

```pseudo
FUNCTION tag_chunk(chunk):
  chunk.Category = classify_category(chunk.source)
  chunk.Priority = assign_priority(chunk.Category, chunk.source_approval)
  chunk.Brand = detect_brand(chunk.text, chunk.source_metadata)
  chunk.Component_Type = detect_component_type(chunk.text, chunk.table_headers)
  chunk.Verified_Status = assign_verified_status(chunk.source_origin, chunk.review_state)
  chunk.Update_Time = source.last_modified_at OR ingestion.timestamp

  IF chunk.Category == "Vendor_Catalog":
    REQUIRE chunk.Brand != "Not_Applicable"
    REQUIRE chunk.Component_Type IN ["UPS", "UPS_Battery_Bank", "Precision_AC", "Fresh_Air", "PDU", "Monitoring"]

  IF chunk.Category == "National_Standard":
    REQUIRE chunk.Standard_Code IS NOT NULL
    REQUIRE chunk.Clause_Number IS NOT NULL OR chunk.Verified_Status != "Verified"

  RETURN chunk
```

---

## Chunk Sizing Rules

### Text Prose Chunks

Use semantic section chunks for proposal prose and standards explanations.

```pseudo
MAX_CHUNK_TOKENS = 700
TARGET_CHUNK_TOKENS = 350
OVERLAP_TOKENS = 60

FUNCTION chunk_prose(document):
  SPLIT by heading hierarchy
  FOR section IN sections:
    IF section.tokens <= MAX_CHUNK_TOKENS:
      emit(section)
    ELSE:
      split_by_paragraph(section, TARGET_CHUNK_TOKENS, OVERLAP_TOKENS)
```

### Vendor Table Chunks

Vendor specification tables must be row-normalized before embedding. One model/spec row should become one structured chunk whenever possible.

```pseudo
FUNCTION chunk_vendor_table(table):
  normalized_table = normalize_table(table)

  FOR row IN normalized_table.rows:
    IF row_has_model_identifier(row):
      emit_chunk(
        embedding_text = build_spec_sentence(row),
        raw_text = serialize_row(row),
        metadata = {
          "Brand": detect_brand(row),
          "Component_Type": detect_component_type(row),
          "Model": row.model,
          "Table_ID": table.id,
          "Row_ID": row.id
        }
      )
    ELSE:
      route_to_quarantine(row, reason="ORPHAN_ROW_NO_MODEL_IDENTIFIER")
```

### Standards Chunks

Standards should be chunked at clause or sub-clause level.

```pseudo
FUNCTION chunk_standard(standard):
  FOR clause IN standard.clauses:
    emit_chunk(
      embedding_text = clause.code + " " + clause.title + " " + clause.summary,
      raw_text = clause.original_text,
      metadata = {
        "Standard_Code": standard.code,
        "Clause_Number": clause.number,
        "Component_Type": map_clause_to_component(clause)
      }
    )
```

### Corporate Proposal Chunks

Corporate proposals should be chunked by chapter and reusable block type.

```pseudo
FUNCTION chunk_corporate_proposal(proposal):
  FOR block IN proposal.blocks:
    block_type = classify_block_type(block)

    IF block_type == "price_table":
      route_to_commercial_restricted_index(block)
      CONTINUE

    IF block_type == "customer_private_info":
      redact_sensitive_data(block)

    emit_chunk(
      embedding_text = normalize_proposal_language(block.text),
      metadata = {
        "Category": "Corporate_History",
        "Component_Type": block_type,
        "Customer_Industry": proposal.customer_industry,
        "Project_Type": proposal.project_type
      }
    )
```

---

## Preprocessing Pipeline

The ingestion pipeline must clean raw PDFs, chaotic Word tables, and non-structural spreadsheets before embedding. The goal is to prevent merged cells, orphan headers, broken table rows, and dangling values from poisoning the embedding model.

---

## Pipeline Overview

```pseudo
FUNCTION ingest_source_file(file):
  source_record = register_source(file)
  extracted = extract_content(file)
  normalized = normalize_content(extracted)
  validated = validate_structure(normalized)

  IF validated.has_blocking_errors:
    quarantine_source(file, validated.errors)
    RETURN

  chunks = chunk_content(validated.content)
  tagged_chunks = tag_chunks(chunks)
  reviewed_chunks = apply_verification_workflow(tagged_chunks)
  embed_chunks(reviewed_chunks)
  index_chunks(reviewed_chunks)
  write_ingestion_audit_log(source_record, reviewed_chunks)
```

---

## Raw PDF Preprocessing

PDFs may contain true text, scanned pages, broken table extraction, repeated headers/footers, and multi-page tables.

### Extraction Steps

```pseudo
FUNCTION preprocess_pdf(pdf):
  classify_pdf_type(pdf)

  IF pdf.type == "scanned":
    run_ocr(pdf, language=["zh-CN", "en"])
    attach_ocr_confidence()

  extract_text_blocks_with_coordinates(pdf)
  extract_tables_with_coordinates(pdf)
  remove_repeated_headers_and_footers()
  reconstruct_reading_order()
  detect_multi_page_tables()
  merge_multi_page_tables_by_header_signature()
  normalize_units()
  validate_pdf_extraction_quality()
```

### PDF Quality Gates

```pseudo
IF ocr_confidence < 0.85:
  route_to_human_review("LOW_OCR_CONFIDENCE")

IF table_cell_alignment_confidence < 0.80:
  route_table_to_quarantine("LOW_TABLE_ALIGNMENT_CONFIDENCE")

IF page_has_unassigned_numeric_vectors:
  route_page_to_quarantine("ORPHAN_NUMERIC_VECTOR")
```

### Header/Footer Removal

```pseudo
FUNCTION remove_repeated_headers_and_footers(pages):
  repeated_blocks = detect_blocks_repeated_on_more_than(60% pages)
  FOR block IN repeated_blocks:
    IF block.position IN ["top_margin", "bottom_margin"]:
      remove(block)
```

---

## Chaotic Word Table Preprocessing

Word files often contain merged cells, nested tables, manual line breaks, hidden rows, copied images of tables, and inconsistent heading styles.

### Extraction Steps

```pseudo
FUNCTION preprocess_docx(docx):
  extract_document_xml()
  extract_paragraphs_with_style_names()
  extract_tables_as_grid()
  expand_merged_cells()
  flatten_nested_tables()
  preserve_heading_hierarchy()
  detect_image_only_tables()
  run_ocr_on_image_only_tables()
  normalize_manual_line_breaks()
  remove_empty_rows_and_columns()
  validate_table_rectangularity()
```

### Merged Cell Expansion

Merged cells must be expanded before chunking. The value is copied into every covered cell with a metadata marker.

```pseudo
FUNCTION expand_merged_cells(table):
  FOR merged_region IN table.merged_regions:
    anchor_value = merged_region.top_left_cell.value

    FOR cell IN merged_region.cells:
      cell.value = anchor_value
      cell.metadata.inherited_from_merged_cell = true

  RETURN table
```

### Chaotic Table Repair

```pseudo
FUNCTION repair_docx_table(table):
  table = expand_merged_cells(table)
  table = remove_blank_header_rows(table)
  table = infer_header_rows(table)
  table = fill_down_group_labels(table)
  table = normalize_column_names(table)
  table = validate_no_orphan_cells(table)

  IF table.validation_status != "valid":
    route_to_quarantine(table, table.validation_errors)

  RETURN table
```

### Word Table Quality Gates

```pseudo
IF table.has_merged_cells_after_expansion:
  fail("MERGED_CELL_REMAINING")

IF table.column_count_changes_mid_table:
  route_to_quarantine("NON_RECTANGULAR_TABLE")

IF table.header_confidence < 0.75:
  route_to_human_review("LOW_HEADER_CONFIDENCE")

IF table.contains_orphan_data_vectors:
  route_to_quarantine("ORPHAN_DATA_VECTOR")
```

---

## Non-Structural Spreadsheet Preprocessing

Spreadsheets are often used as semi-visual canvases rather than clean databases. The pipeline must convert messy sheets into rectangular records or quarantine them.

### Spreadsheet Risks

Common spreadsheet problems:

- Merged header cells.
- Multiple unrelated tables on one sheet.
- Notes mixed with data rows.
- Hidden rows or columns.
- Formula-only values without cached results.
- Unit labels embedded in cell text.
- Orphan numbers without row/column context.
- Price columns mixed with technical columns.

### Extraction Steps

```pseudo
FUNCTION preprocess_spreadsheet(workbook):
  FOR sheet IN workbook.sheets:
    unhide_rows_and_columns(sheet)
    detect_used_ranges(sheet)
    split_multiple_tables(sheet)
    expand_merged_cells(sheet)
    detect_header_rows(sheet)
    classify_columns(sheet)
    normalize_units(sheet)
    separate_price_columns(sheet)
    evaluate_formulas(sheet)
    validate_rectangular_tables(sheet)
```

### Multi-Table Detection

```pseudo
FUNCTION split_multiple_tables(sheet):
  used_regions = detect_connected_cell_regions(sheet)

  FOR region IN used_regions:
    IF region.size < MIN_TABLE_SIZE:
      route_to_notes_index(region)
    ELSE:
      emit_candidate_table(region)
```

### Orphan Data Vector Detection

An orphan data vector is a row or column containing values without reliable headers, model identifiers, or surrounding context.

```pseudo
FUNCTION detect_orphan_data_vectors(table):
  FOR row IN table.rows:
    IF row.has_numeric_values
    AND row.header_context IS NULL
    AND row.model_identifier IS NULL:
      row.status = "orphan_data_vector"

  FOR column IN table.columns:
    IF column.has_numeric_values
    AND column.header IS NULL:
      column.status = "orphan_data_vector"
```

### Spreadsheet Quality Gates

```pseudo
IF table.has_merged_cells_after_expansion:
  fail("MERGED_CELL_REMAINING")

IF table.header_confidence < 0.75:
  route_to_human_review("LOW_HEADER_CONFIDENCE")

IF table.orphan_data_vector_count > 0:
  route_to_quarantine("ORPHAN_DATA_VECTOR")

IF table.price_columns_detected:
  route_price_columns_to_restricted_commercial_index()
```

---

## No-Poison Embedding Rules

The embedding model must receive clean, self-contained text. It must not receive raw table fragments, orphan numbers, repeated headers, or private pricing noise.

### Allowed Embedding Text

```text
Brand: Huawei. Component: UPS. Model: [model]. Specification: Rated capacity is [value] [unit]. Source: [catalog version], page [page].
```

```text
Standard: [code], Clause [number]. Component: Grounding. Requirement summary: [verified summary]. Source page: [page].
```

```text
Corporate proposal pattern. Industry: medical. Component: project overview. Reusable wording: [redacted and normalized paragraph].
```

### Disallowed Embedding Text

```text
40 | 60 | 80 | 100
```

```text
价格 10000 20000 30000
```

```text
上同 上同 上同
```

```text
第 1 页 / 共 38 页
```

### Poison Prevention Pseudo-code

```pseudo
FUNCTION validate_embedding_text(chunk):
  IF chunk.Embedding_Text IS NULL OR length < 40:
    reject_chunk("EMBEDDING_TEXT_TOO_SHORT")

  IF contains_only_numbers_or_units(chunk.Embedding_Text):
    reject_chunk("NUMERIC_VECTOR_ONLY")

  IF contains_repeated_header_footer(chunk.Embedding_Text):
    reject_chunk("HEADER_FOOTER_NOISE")

  IF chunk.Category == "Vendor_Catalog" AND chunk.Model IS NULL:
    reject_or_review_chunk("VENDOR_CHUNK_WITHOUT_MODEL")

  IF chunk.Category == "National_Standard"
  AND chunk.Standard_Code IS NULL:
    reject_or_review_chunk("STANDARD_WITHOUT_CODE")

  IF contains_unapproved_price_values(chunk):
    route_to_restricted_commercial_index(chunk)
```

---

## Verification Workflow

Verification status controls whether a chunk can be used as authoritative evidence.

### Verified Status Matrix

| Status | Meaning | Retrieval Usage |
| --- | --- | --- |
| `Verified` | Human-reviewed and approved | Authoritative |
| `Vendor_Published` | Extracted from official vendor material | Authoritative for vendor facts unless superseded |
| `Distributor_Provided` | From authorized distributor | Usable with caution |
| `Internal_Unverified` | Internal note not reviewed | Style/context only |
| `Commercial_Unverified` | Supplier or price sheet | Restricted commercial use only |
| `Deprecated` | Superseded catalog | Do not use unless explicitly comparing versions |
| `Superseded` | Replaced standard or old clause | Do not use for current compliance |
| `Draft` | Draft or incomplete source | Not authoritative |
| `Unknown` | Source quality unknown | Do not use in final proposal |

### Human Review Queue

```pseudo
FUNCTION apply_verification_workflow(chunks):
  FOR chunk IN chunks:
    IF chunk.Priority == "P0" AND chunk.Verified_Status IN ["Unknown", "Draft"]:
      route_to_human_review(chunk)

    IF chunk.Category == "National_Standard" AND missing_clause_metadata(chunk):
      route_to_human_review(chunk)

    IF chunk.Category == "Vendor_Catalog" AND missing_model_or_brand(chunk):
      route_to_human_review(chunk)

    IF chunk.has_quarantine_flags:
      do_not_embed(chunk)

  RETURN chunks WHERE chunk.approved_for_embedding == true
```

---

## Retrieval Policy

### Query Routing

```pseudo
FUNCTION route_retrieval_query(query, session_context):
  intent = classify_query_intent(query)

  IF intent == "vendor_spec":
    RETURN search(
      filters = {
        "Category": "Vendor_Catalog",
        "Brand": query.brand OR session_context.preferred_brand,
        "Component_Type": query.component_type,
        "Verified_Status": ["Verified", "Vendor_Published"]
      }
    )

  IF intent == "standard_requirement":
    RETURN search(
      filters = {
        "Category": "National_Standard",
        "Component_Type": query.component_type,
        "Verified_Status": ["Verified"]
      }
    )

  IF intent == "proposal_language":
    RETURN search(
      filters = {
        "Category": "Corporate_History",
        "Customer_Industry": session_context.customer_industry,
        "Project_Type": session_context.project_type,
        "Verified_Status": ["Verified"]
      }
    )
```

### Retrieval Score Formula

```pseudo
final_score =
  semantic_similarity * 0.45
  + metadata_match_score * 0.30
  + verified_status_score * 0.15
  + freshness_score * 0.10
```

### Metadata Match Boosts

```pseudo
IF chunk.Brand == requested_brand:
  metadata_match_score += 0.20

IF chunk.Component_Type == requested_component_type:
  metadata_match_score += 0.25

IF chunk.Customer_Industry == session.customer_industry:
  metadata_match_score += 0.10

IF chunk.Project_Type == session.project_type:
  metadata_match_score += 0.10
```

### Retrieval Output Contract

```json
{
  "query_id": "string",
  "intent": "vendor_spec | standard_requirement | proposal_language | risk_support | commercial_reference",
  "results": [
    {
      "Chunk_ID": "string",
      "Source_File_ID": "string",
      "Category": "string",
      "Brand": "string",
      "Component_Type": "string",
      "Verified_Status": "string",
      "Update_Time": "ISO-8601",
      "score": 0.0,
      "citation": {
        "file_name": "string",
        "page_number": "number | null",
        "table_id": "string | null",
        "row_id": "string | null",
        "standard_code": "string | null",
        "clause_number": "string | null"
      },
      "text": "string"
    }
  ],
  "conflicts": [],
  "no_answer_reason": "string | null"
}
```

---

## Integration With Agent, Rules, and Templates

### Agent Integration

The conversational agent uses RAG to:

- Reuse proven industry pitch language.
- Retrieve vendor specifications before mentioning model details.
- Retrieve standards highlights before generating compliance text.
- Retrieve previous proposal phrasing for similar industries and project types.

The agent must not use RAG to:

- Override dashboard-confirmed user inputs.
- Override `rules.md` calculation outputs.
- Invent price values in `templates.md`.
- Hide risk flags.

### Rules Integration

`rules.md` remains the authority for calculations and risk triggers. RAG may provide supporting explanation, not rule outcomes.

```pseudo
IF rules_engine.triggered("RULE_FLOOR_LOADING"):
  retrieve(
    Category = "National_Standard",
    Component_Type IN ["Civil", "Electrical", "UPS_Battery_Bank"],
    Verified_Status = "Verified"
  )
  use_results_to_explain_verification_need()
```

### Template Integration

`templates.md` consumes retrieved chunks only in allowed LLM blocks.

Allowed:

- Chapter 1 industry background.
- Chapter 3 short UPS engineering notes.
- Chapter 4 precision AC selection notes.
- Risk register explanation.
- Acceptance checklist wording.

Not allowed:

- Price fields.
- Mandatory risk chapter inclusion logic.
- Backend calculated capacities.
- Yellow placeholder policy.

---

## Index Design

### Recommended Indexes

```json
{
  "technical_vector_index": {
    "contains": ["Vendor_Catalog", "National_Standard", "Corporate_History"],
    "filters": ["Category", "Brand", "Component_Type", "Verified_Status", "Update_Time"]
  },
  "corporate_style_index": {
    "contains": ["Corporate_History", "Draft_Proposal"],
    "filters": ["Customer_Industry", "Project_Type", "Reusable_Level", "Verified_Status"]
  },
  "commercial_restricted_index": {
    "contains": ["Supplier_Commercial"],
    "filters": ["Brand", "Component_Type", "Region", "Approved_Pricing_Status"],
    "access": "restricted"
  },
  "quarantine_index": {
    "contains": ["failed_chunks", "low_confidence_tables", "orphan_data_vectors"],
    "embedding_enabled": false
  }
}
```

### Access Control

```pseudo
IF chunk.Confidentiality_Level == "highly_restricted":
  REQUIRE user_role IN ["admin", "technical_director", "authorized_presales"]

IF query.intent == "commercial_reference":
  REQUIRE pricing_permission == true

IF chunk.Category == "Supplier_Commercial":
  DO NOT return to general proposal generation context
```

---

## Audit and Lineage

Every chunk must be traceable from generated answer back to source.

### Ingestion Audit Event

```json
{
  "event_type": "INGESTION",
  "ingestion_run_id": "string",
  "source_file_id": "string",
  "source_file_name": "string",
  "source_checksum": "string",
  "chunks_created": 0,
  "chunks_embedded": 0,
  "chunks_quarantined": 0,
  "review_required": 0,
  "timestamp": "ISO-8601"
}
```

### Retrieval Audit Event

```json
{
  "event_type": "RETRIEVAL",
  "query_id": "string",
  "session_id": "string",
  "intent": "string",
  "filters": {},
  "returned_chunk_ids": [],
  "conflict_detected": false,
  "timestamp": "ISO-8601"
}
```

### Generation Grounding Event

```json
{
  "event_type": "GENERATION_GROUNDING",
  "session_id": "string",
  "generated_block_id": "string",
  "used_chunk_ids": [],
  "unsupported_claims_detected": [],
  "timestamp": "ISO-8601"
}
```

---

## Acceptance Test Matrix

### Test 1: Vendor Catalog Row Normalization

Input:

```text
Huawei UPS catalog table with merged product family cell and multiple model rows.
```

Expected:

```json
{
  "merged_cells_remaining": false,
  "chunks_created_per_model_row": true,
  "Brand": "Huawei",
  "Component_Type": "UPS",
  "Verified_Status": "Vendor_Published"
}
```

### Test 2: Chaotic Word Proposal Table

Input:

```text
Past winning bid Word file with merged cells and nested BOM table.
```

Expected:

```json
{
  "expanded_merged_cells": true,
  "nested_tables_flattened": true,
  "price_values_removed_or_restricted": true,
  "Category": "Corporate_History",
  "Priority": "P0"
}
```

### Test 3: Orphan Spreadsheet Data Vector

Input:

```text
Spreadsheet column containing values 25, 40, 60, 80, 100 with no header or model context.
```

Expected:

```json
{
  "embedded": false,
  "quarantine_reason": "ORPHAN_DATA_VECTOR"
}
```

### Test 4: National Standard Clause

Input:

```text
Grounding standard excerpt with standard code and clause number.
```

Expected:

```json
{
  "Category": "National_Standard",
  "Component_Type": "Grounding",
  "Standard_Code": "present",
  "Clause_Number": "present",
  "Verified_Status": "Verified"
}
```

### Test 5: Retrieval for Medical Project Overview

Input:

```json
{
  "intent": "proposal_language",
  "customer_industry": "medical",
  "project_type": "renovation"
}
```

Expected:

```json
{
  "preferred_category": "Corporate_History",
  "filters_applied": ["Customer_Industry", "Project_Type", "Verified_Status"],
  "no_vendor_specs_mixed_into_overview_pitch": true
}
```

---

## Operational Checklist

Before enabling a source for production retrieval:

- `[ ]` Source category and priority are assigned.
- `[ ]` Required metadata fields are populated.
- `[ ]` Merged cells are expanded.
- `[ ]` Tables are rectangular and header-validated.
- `[ ]` Orphan data vectors are quarantined.
- `[ ]` Price fields are removed or placed in restricted commercial index.
- `[ ]` Vendor catalog rows include brand, component type, model, and version.
- `[ ]` Standards chunks include standard code and clause metadata.
- `[ ]` Corporate history documents are approved as top winning bids or high-quality proposals.
- `[ ]` Verified status is assigned.
- `[ ]` Embedding text is self-contained and not raw table debris.
- `[ ]` Ingestion audit log is written.

