import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Building2,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  Edit3,
  FileText,
  FolderUp,
  Loader2,
  MessageCircle,
  Mic,
  Plus,
  RefreshCw,
  Send,
  ServerCog,
  ShieldAlert,
  X
} from "lucide-react";
import {
  completionForState,
  displayForField,
  getSessionExport,
  initialSession,
  postSessionChat,
  postSessionOverride,
  sourceLabel
} from "./sessionApi";
import type {
  ChatMessage,
  DashboardField,
  ExportAsset,
  KnowledgeHit,
  PaymentRequiredError,
  RiskFlag,
  SessionSnapshot
} from "./types";

const demoPrompt = "某学校老机房改造，30平，UPS、电池、精密空调和动环，柜子还没定";

function makeMessage(sender: ChatMessage["sender"], text: string): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    sender,
    text,
    timestamp: new Date().toISOString()
  };
}

function applyFieldPatch(
  fields: SessionSnapshot["dashboard_fields"],
  fieldCode: string,
  value: string | number | null,
  source: DashboardField["source"],
  confidence: number,
  needsConfirmation: boolean,
  riskLinked = false
) {
  const current = fields[fieldCode];
  if (!current) return fields;
  return {
    ...fields,
    [fieldCode]: {
      ...current,
      value,
      displayValue: displayForField(fieldCode, value),
      source,
      confidence,
      needs_confirmation: needsConfirmation,
      riskLinked
    }
  };
}

function uniqueRisks(risks: RiskFlag[]) {
  const map = new Map<string, RiskFlag>();
  risks.forEach((risk) => map.set(risk.id, risk));
  return Array.from(map.values());
}

interface CommercialLineItem {
  id: string;
  name: string;
  category: string | null;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  totalPrice: string | null;
  sourceFile: string | null;
}

function extractField(text: string, label: string) {
  const match = text.match(new RegExp(`${label}:\\s*([^；。\\n]+)`));
  return match?.[1]?.trim() ?? null;
}

function extractCategories(text: string) {
  const match = text.match(/设备类别统计[:：]\s*([^。；\n]+)/);
  if (!match) return [];
  return match[1]
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildCommercialSummary(hits: KnowledgeHit[]) {
  const commercialHits = hits.filter((hit) => hit.source_type === "quotation" || hit.source_type === "boq");
  const sourceFiles = Array.from(
    new Set(commercialHits.map((hit) => hit.source_file).filter(Boolean))
  ) as string[];
  const categories = Array.from(new Set(commercialHits.flatMap((hit) => extractCategories(hit.excerpt))));
  const rowCounts = commercialHits
    .map((hit) => hit.excerpt.match(/(?:有效报价\/BOQ行数|共识别)\D*(\d+)/)?.[1])
    .filter(Boolean)
    .map(Number);
  const lineItems: CommercialLineItem[] = commercialHits
    .filter((hit) => hit.title.startsWith("报价项:"))
    .slice(0, 5)
    .map((hit) => ({
      id: hit.id,
      name: hit.title.replace(/^报价项:\s*/, ""),
      category: extractField(hit.excerpt, "类别"),
      quantity: extractField(hit.excerpt, "数量"),
      unit: extractField(hit.excerpt, "单位"),
      unitPrice: extractField(hit.excerpt, "单价"),
      totalPrice: extractField(hit.excerpt, "合价/金额"),
      sourceFile: hit.source_file ?? null
    }));

  return {
    commercialHits,
    sourceFiles,
    categories,
    lineItems,
    itemCount: rowCounts[0] ?? lineItems.length,
    hasSummary: commercialHits.length > 0
  };
}

export default function App() {
  const [session, setSession] = useState<SessionSnapshot>(initialSession);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequiredError | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const latestSession = useRef(session);
  latestSession.current = session;

  const orderedFields = useMemo(
    () => [
      session.dashboard_fields.customer_name,
      session.dashboard_fields.customer_industry,
      session.dashboard_fields.project_type,
      session.dashboard_fields.room_area_m2,
      session.dashboard_fields.room_floor,
      session.dashboard_fields.rack_count,
      session.dashboard_fields.ups_backup_time_minutes,
      session.dashboard_fields.brand_preference,
      session.dashboard_fields.budget_range_high_rmb
    ],
    [session.dashboard_fields]
  );

  async function sendChat(content: string, source: "text" | "voice" | "file" = "text") {
    const trimmed = content.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    setInput("");
    setSession((current) => ({
      ...current,
      messages: [...current.messages, makeMessage("user", trimmed)]
    }));

    try {
      const result = await postSessionChat({
        session: latestSession.current,
        message_type: source,
        content: trimmed
      });

      setSession((current) => {
        let fields = { ...current.dashboard_fields };
        result.data.field_patches.forEach((item) => {
          const riskLinked = result.data.triggered_risks.some((risk) =>
            risk.trigger_fields.includes(item.field_code)
          );
          fields = applyFieldPatch(
            fields,
            item.field_code,
            item.new_value,
            item.source,
            item.confidence,
            item.needs_confirmation,
            riskLinked
          );
        });

        return {
          ...current,
          state_version: result.state_version,
          fsm_state: result.data.state.fsm_state,
          export_status: result.data.state.export_status,
          completion: completionForState(result.data.state.fsm_state, fields),
          messages: [...current.messages, makeMessage("ai", result.data.ai_response)],
          quick_replies: result.data.quick_replies,
          dashboard_fields: fields,
          triggered_risks: uniqueRisks([...current.triggered_risks, ...result.data.triggered_risks]),
          knowledge_hits: result.data.knowledge_hits.length
            ? result.data.knowledge_hits
            : current.knowledge_hits,
          suggestion: result.data.suggestion ?? current.suggestion
        };
      });
    } finally {
      setIsSending(false);
    }
  }

  async function commitOverride(field: DashboardField) {
    if (!editingField) return;
    const value = editingValue.trim();
    setEditingField(null);
    setSyncNotice("正在同步手动修正...");

    const result = await postSessionOverride({
      session: latestSession.current,
      field_code: field.code,
      value
    });

    setSession((current) => {
      const fields = applyFieldPatch(
        current.dashboard_fields,
        field.code,
        result.data.normalized_value,
        "dashboard_edit",
        1,
        false,
        result.data.triggered_risks.some((risk) => risk.trigger_fields.includes(field.code))
      );
      return {
        ...current,
        state_version: result.state_version,
        completion: completionForState(current.fsm_state, fields),
        dashboard_fields: fields,
        triggered_risks: uniqueRisks(result.data.triggered_risks),
        suggestion: result.data.suggestion,
        messages: [...current.messages, makeMessage("ai", result.data.ai_notice)]
      };
    });

    setSyncNotice("已同步到导出上下文");
    window.setTimeout(() => setSyncNotice(null), 2200);
  }

  async function startExport(
    approved = false,
    paymentMode: "simulate_99_rmb" | "free_preview" = "simulate_99_rmb"
  ) {
    setIsExporting(true);
    const result = await getSessionExport({
      session: latestSession.current,
      payment_mode: paymentMode,
      approved
    });
    setIsExporting(false);

    if (!result.ok) {
      setPaymentRequest(result);
      return;
    }

    setPaymentRequest(null);
    setSession((current) => ({
      ...current,
      state_version: result.state_version,
      export_status: "exported",
      export_asset: result.data.asset,
      messages: [
        ...current.messages,
        makeMessage(
          "ai",
          result.data.export_status === "preview_ready"
            ? "免费预览版已生成，正式版仍会保留99元支付意愿验证。"
            : "正式版Word技术方案已模拟生成，章节、风险提示和价格占位符都已通过导出校验。"
        )
      ]
    }));
  }

  function resetSession() {
    setSession({
      ...initialSession,
      messages: initialSession.messages.map((message) => ({
        ...message,
        timestamp: new Date().toISOString()
      }))
    });
    setPaymentRequest(null);
    setInput("");
    setSyncNotice(null);
  }

  return (
    <main className="app-shell">
      <Sidebar onReset={resetSession} />
      <section className="workbench">
        <ChatPanel
          session={session}
          input={input}
          isSending={isSending}
          onInput={setInput}
          onSend={() => sendChat(input)}
          onQuickReply={sendChat}
        />
        <DashboardPanel
          session={session}
          fields={orderedFields}
          editingField={editingField}
          editingValue={editingValue}
          syncNotice={syncNotice}
          isExporting={isExporting}
          onStartEdit={(field) => {
            setEditingField(field.code);
            setEditingValue(field.value === null ? "" : String(field.value));
          }}
          onEditValue={setEditingValue}
          onCommitEdit={commitOverride}
          onCancelEdit={() => setEditingField(null)}
          onExport={() => startExport(false)}
        />
      </section>
      {paymentRequest && (
        <ExportPaymentModal
          request={paymentRequest}
          isExporting={isExporting}
          onClose={() => setPaymentRequest(null)}
          onPay={() => startExport(true)}
          onPreview={() => startExport(true, "free_preview")}
        />
      )}
    </main>
  );
}

function Sidebar({ onReset }: { onReset: () => void }) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">
          <ServerCog size={24} />
        </div>
        <div>
          <h1>机房建设售前智能体</h1>
          <p>集成商内测工作台</p>
        </div>
      </div>

      <button className="primary-action" onClick={onReset}>
        <Plus size={18} />
        新建商机摸底
      </button>

      <button
        className="kb-action"
        title="把资料放入 knowledge/ 后运行 npm run kb:build"
        onClick={() => alert("把 .md/.txt 资料放进 knowledge/，运行 npm run kb:build 后刷新页面即可检索。")}
      >
        <FolderUp size={17} />
        导入本地知识库
      </button>

      <div className="sidebar-section">
        <span className="section-label">内测模拟商机</span>
        <button className="project-item active">
          <Building2 size={16} />
          <span>某市人民医院机房建设项目</span>
        </button>
        <button className="project-item">
          <Building2 size={16} />
          <span>区政务云中心扩容项目</span>
        </button>
        <button className="project-item">
          <Building2 size={16} />
          <span>某工厂利旧改造项目</span>
        </button>
      </div>

      <div className="sidebar-foot">
        <ShieldAlert size={16} />
        <span>规则引擎优先于LLM推断</span>
      </div>
    </aside>
  );
}

function ChatPanel({
  session,
  input,
  isSending,
  onInput,
  onSend,
  onQuickReply
}: {
  session: SessionSnapshot;
  input: string;
  isSending: boolean;
  onInput: (value: string) => void;
  onSend: () => void;
  onQuickReply: (value: string) => void;
}) {
  const projectTitle = session.dashboard_fields.customer_name.value
    ? session.dashboard_fields.customer_name.displayValue
    : "新机房商机";

  return (
    <section className="chat-panel">
      <header className="panel-header chat-titlebar">
        <div>
          <p>当前商机</p>
          <h2>{projectTitle}</h2>
        </div>
        <div className={`completion-pill completion-${session.completion >= 95 ? "ready" : "active"}`}>
          采集率 {session.completion}%
        </div>
      </header>

      <div className="message-list">
        {session.messages.map((message) => (
          <article key={message.id} className={`message-row ${message.sender}`}>
            <div className="avatar">
              {message.sender === "ai" ? <Bot size={17} /> : <MessageCircle size={17} />}
            </div>
            <div className="message-bubble">{message.text}</div>
          </article>
        ))}
        {session.quick_replies.length > 0 && (
          <div className="quick-replies">
            {session.quick_replies.map((reply) => (
              <button key={reply} onClick={() => onQuickReply(reply)}>
                {reply}
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="chat-input-bar">
        <button
          className="icon-button"
          title="语音输入占位"
          onClick={() => alert("语音输入入口已预留，当前MVP使用文字模拟。")}
        >
          <Mic size={19} />
        </button>
        <input
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSend();
          }}
          placeholder={demoPrompt}
        />
        <button className="send-button" onClick={onSend} disabled={isSending || !input.trim()}>
          {isSending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
          发送
        </button>
      </div>
    </section>
  );
}

function DashboardPanel({
  session,
  fields,
  editingField,
  editingValue,
  syncNotice,
  isExporting,
  onStartEdit,
  onEditValue,
  onCommitEdit,
  onCancelEdit,
  onExport
}: {
  session: SessionSnapshot;
  fields: DashboardField[];
  editingField: string | null;
  editingValue: string;
  syncNotice: string | null;
  isExporting: boolean;
  onStartEdit: (field: DashboardField) => void;
  onEditValue: (value: string) => void;
  onCommitEdit: (field: DashboardField) => void;
  onCancelEdit: () => void;
  onExport: () => void;
}) {
  return (
    <aside className="dashboard-panel">
      <div className="dashboard-scroll">
        <RiskCard risks={session.triggered_risks} />
        <KnowledgeCard hits={session.knowledge_hits} />
        <CommercialSummaryCard hits={session.knowledge_hits} />

        <section className="dash-card">
          <div className="card-heading">
            <div>
              <p>需求要素</p>
              <h3>自动提取的项目数据</h3>
            </div>
            {syncNotice && <span className="sync-chip">{syncNotice}</span>}
          </div>
          <div className="field-grid">
            {fields.map((field) => (
              <FieldEditor
                key={field.code}
                field={field}
                isEditing={editingField === field.code}
                editingValue={editingValue}
                onStartEdit={onStartEdit}
                onEditValue={onEditValue}
                onCommitEdit={onCommitEdit}
                onCancelEdit={onCancelEdit}
              />
            ))}
          </div>
        </section>

        <SuggestionCard suggestion={session.suggestion} />

        {session.export_asset && <ExportAssetCard asset={session.export_asset} />}
      </div>

      <div className="action-zone">
        <button className="export-button" onClick={onExport} disabled={isExporting}>
          {isExporting ? <Loader2 className="spin" size={20} /> : <Download size={20} />}
          生成 Word 需求表 ¥99
        </button>
        <button className="secondary-action" onClick={() => alert("反馈入口已保留，后续可接入用户反馈表。")}>
          <ClipboardList size={18} />
          提交内测反馈
        </button>
      </div>
    </aside>
  );
}

function FieldEditor({
  field,
  isEditing,
  editingValue,
  onStartEdit,
  onEditValue,
  onCommitEdit,
  onCancelEdit
}: {
  field: DashboardField;
  isEditing: boolean;
  editingValue: string;
  onStartEdit: (field: DashboardField) => void;
  onEditValue: (value: string) => void;
  onCommitEdit: (field: DashboardField) => void;
  onCancelEdit: () => void;
}) {
  const className = [
    "field-box",
    field.source === "dashboard_edit" ? "manual" : "",
    field.needs_confirmation ? "pending" : "",
    field.riskLinked ? "risk" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <label>{field.label}</label>
      {isEditing ? (
        <div className="inline-editor">
          <input
            autoFocus
            value={editingValue}
            onChange={(event) => onEditValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCommitEdit(field);
              if (event.key === "Escape") onCancelEdit();
            }}
          />
          <button title="确认" onClick={() => onCommitEdit(field)}>
            <Check size={15} />
          </button>
          <button title="取消" onClick={onCancelEdit}>
            <X size={15} />
          </button>
        </div>
      ) : (
        <button
          className="field-value"
          onDoubleClick={() => onStartEdit(field)}
          onClick={() => onStartEdit(field)}
        >
          <span>{field.displayValue}</span>
          <Edit3 size={14} />
        </button>
      )}
      <span className="field-source">{sourceLabel(field.source)}</span>
    </div>
  );
}

function RiskCard({ risks }: { risks: RiskFlag[] }) {
  if (risks.length === 0) {
    return (
      <section className="dash-card quiet-card">
        <div className="quiet-state">
          <ShieldAlert size={20} />
          <span>暂无强制风险触发</span>
        </div>
      </section>
    );
  }

  return (
    <section className="dash-card risk-card">
      <div className="card-heading">
        <div>
          <p>专家规则引擎</p>
          <h3>隐性施工风险</h3>
        </div>
        <AlertTriangle size={22} />
      </div>
      <div className="risk-list">
        {risks.map((risk) => (
          <article key={risk.id} className={`risk-item ${risk.level === "P0_BLOCKER" ? "blocker" : ""}`}>
            <strong>{risk.id}</strong>
            <span>{risk.text}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function KnowledgeCard({ hits }: { hits: KnowledgeHit[] }) {
  return (
    <section className="dash-card knowledge-card">
      <div className="card-heading">
        <div>
          <p>本地知识库</p>
          <h3>可引用资料命中</h3>
        </div>
        <span className="kb-count">{hits.length} 条</span>
      </div>
      <div className="knowledge-list">
        {hits.map((hit) => (
          <article key={hit.id} className="knowledge-hit">
            <div>
              <strong>
                <span>{hit.title}</span>
                <b>{knowledgeSourceLabel(hit.source_type)}</b>
              </strong>
              <span>{hit.excerpt}</span>
              {(hit.source_file || hit.retrieval_method) && (
                <small>
                  {[hit.source_file, retrievalMethodLabel(hit.retrieval_method)].filter(Boolean).join(" · ")}
                </small>
              )}
            </div>
            <em>{Math.round(hit.score * 100)}%</em>
          </article>
        ))}
      </div>
    </section>
  );
}

function retrievalMethodLabel(method: KnowledgeHit["retrieval_method"]) {
  if (method === "hybrid") return "向量混合检索";
  if (method === "vector") return "向量检索";
  if (method === "keyword") return "关键词检索";
  return null;
}

function knowledgeSourceLabel(sourceType: KnowledgeHit["source_type"]) {
  const labels: Record<KnowledgeHit["source_type"], string> = {
    rule: "规则",
    case: "案例",
    device_manual: "设备资料",
    template: "模板",
    quotation: "报价",
    boq: "BOQ",
    local_doc: "资料"
  };
  return labels[sourceType];
}

function CommercialSummaryCard({ hits }: { hits: KnowledgeHit[] }) {
  const summary = buildCommercialSummary(hits);

  if (!summary.hasSummary) {
    return (
      <section className="dash-card quiet-card">
        <div className="quiet-state">
          <ClipboardList size={20} />
          <span>报价/BOQ摘要将在命中报价清单后生成</span>
        </div>
      </section>
    );
  }

  return (
    <section className="dash-card commercial-card">
      <div className="card-heading">
        <div>
          <p>历史报价线索</p>
          <h3>报价与BOQ摘要</h3>
        </div>
        <span className="commercial-count">
          {summary.sourceFiles.length || summary.commercialHits.length} 个来源
        </span>
      </div>

      <div className="commercial-metrics">
        <Metric label="报价/BOQ行" value={`${summary.itemCount}项`} />
        <Metric label="命中片段" value={`${summary.commercialHits.length}条`} />
        <Metric label="设备类别" value={`${summary.categories.length || 1}类`} />
      </div>

      {summary.categories.length > 0 && (
        <div className="commercial-tags" aria-label="设备类别统计">
          {summary.categories.slice(0, 6).map((category) => (
            <span key={category}>{category}</span>
          ))}
        </div>
      )}

      {summary.lineItems.length > 0 ? (
        <div className="commercial-lines">
          {summary.lineItems.slice(0, 3).map((item) => (
            <article key={item.id} className="commercial-line">
              <div>
                <strong>{item.name}</strong>
                <span>
                  {[
                    item.category,
                    item.quantity && item.unit ? `${item.quantity}${item.unit}` : item.quantity
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </span>
              </div>
              <div className="commercial-price">
                <b>
                  {item.totalPrice
                    ? `${item.totalPrice}`
                    : item.unitPrice
                      ? `${item.unitPrice}/单价`
                      : "待复核"}
                </b>
                {item.unitPrice && item.totalPrice && <small>单价 {item.unitPrice}</small>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="commercial-note">{summary.commercialHits[0]?.excerpt}</p>
      )}

      <div className="commercial-source">
        <span>来源</span>
        <strong>{summary.sourceFiles.slice(0, 2).join("，") || "本地报价资料"}</strong>
      </div>
      <p className="commercial-disclaimer">
        仅作为历史报价线索，正式报价前仍需复核渠道价、税率、运费和施工条件。
      </p>
    </section>
  );
}

function SuggestionCard({ suggestion }: { suggestion: SessionSnapshot["suggestion"] }) {
  if (!suggestion) {
    return (
      <section className="dash-card quiet-card">
        <div className="quiet-state">
          <FileText size={20} />
          <span>配置建议将在规模口径确认后生成</span>
        </div>
      </section>
    );
  }

  return (
    <section className="dash-card suggestion-card">
      <div className="card-heading">
        <div>
          <p>测算建议</p>
          <h3>配置与导出摘要</h3>
        </div>
        {suggestion.stale && (
          <span className="stale-chip">
            <RefreshCw size={13} />
            已重算
          </span>
        )}
      </div>
      <div className="suggestion-grid">
        <Metric label="UPS容量" value={`${suggestion.upsCapacityKva}kVA`} />
        <Metric label="电池后备" value={`${suggestion.batteryRuntimeMinutes}分钟`} />
        <Metric label="精密空调" value={`${suggestion.coolingModelKw}kW`} />
        <Metric label="冗余模式" value={suggestion.coolingRedundancy} />
      </div>
      <div className="notes-list">
        <p>{suggestion.pduNote}</p>
        <p>{suggestion.structuralNote}</p>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ExportAssetCard({ asset }: { asset: ExportAsset }) {
  const canDownload = !asset.download_url.startsWith("#");
  return (
    <section className="dash-card asset-card">
      <div className="card-heading">
        <div>
          <p>导出结果</p>
          <h3>{asset.file_name}</h3>
        </div>
        <FileText size={22} />
      </div>
      <a
        href={asset.download_url}
        download={canDownload ? asset.file_name : undefined}
        onClick={(event) => {
          if (!canDownload) event.preventDefault();
        }}
      >
        {canDownload ? "下载生成文件" : "模拟文件已就绪"}
      </a>
      {asset.size_bytes && <small>{Math.round(asset.size_bytes / 1024)} KB</small>}
    </section>
  );
}

function ExportPaymentModal({
  request,
  isExporting,
  onClose,
  onPay,
  onPreview
}: {
  request: PaymentRequiredError;
  isExporting: boolean;
  onClose: () => void;
  onPay: () => void;
  onPreview: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <div className="payment-modal">
        <button className="close-modal" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
        <span className="modal-kicker">Word Export Gate</span>
        <h2 id="payment-title">生成正式版需求表</h2>
        <p>
          这版Word需求表会把本地知识库引用、项目概况、建设范围、关键设备口径、风险提示和待确认事项整理成可发给同事或供应商的正式文档。
          是否愿意支付 {request.billing_check.amount_rmb} RMB 生成并下载正式版？
        </p>
        <div className="modal-actions">
          <button className="pay-button" onClick={onPay} disabled={isExporting}>
            {isExporting ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
            愿意，生成正式版
          </button>
          <button className="preview-button" onClick={onPreview} disabled={isExporting}>
            先预览免费版
          </button>
          <button className="ghost-button" onClick={onClose} disabled={isExporting}>
            暂时不用
          </button>
        </div>
      </div>
    </div>
  );
}
