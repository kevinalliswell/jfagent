import { useEffect, useMemo, useRef, useState } from "react";
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
  createProject,
  displayForField,
  getProjectDetail,
  getSessionSnapshot,
  getSessionExport,
  getKnowledgeStatus,
  initialSession,
  listProjects,
  postSessionChat,
  postSessionOverride,
  sessionApiMode,
  uploadKnowledgeFile,
  sourceLabel
} from "./sessionApi";
import type {
  ChatMessage,
  DashboardField,
  ExportAsset,
  KnowledgeIndexStatus,
  KnowledgeHit,
  PaymentRequiredError,
  ProjectContext,
  ProjectDetail,
  ProjectStage,
  ProjectSummary,
  RiskFlag,
  SessionSnapshotData,
  SessionSnapshot
} from "./types";

const demoPrompt = "某学校老机房改造，30平，UPS、电池、精密空调和动环，柜子还没定";
const maxKnowledgeUploadBytes = 20 * 1024 * 1024;

function cloneDashboardFields(fields: SessionSnapshot["dashboard_fields"]) {
  return Object.fromEntries(Object.entries(fields).map(([code, field]) => [code, { ...field }]));
}

function cloneKnowledgeHits(hits: KnowledgeHit[]) {
  return hits.map((hit) => ({ ...hit }));
}

function cloneTriggeredRisks(risks: RiskFlag[]) {
  return risks.map((risk) => ({
    ...risk,
    trigger_fields: [...risk.trigger_fields]
  }));
}

function cloneSuggestion(suggestion: SessionSnapshot["suggestion"]) {
  return suggestion ? { ...suggestion } : null;
}

function cloneProjectContext(project: ProjectContext | null) {
  return project ? { ...project } : null;
}

function projectStageLabel(stage: ProjectStage) {
  if (stage === "solution_ready") return "方案就绪";
  if (stage === "clarifying") return "待澄清";
  return "摸底中";
}

function projectStageClass(stage: ProjectStage) {
  if (stage === "solution_ready") return "stage-ready";
  if (stage === "clarifying") return "stage-clarifying";
  return "stage-intake";
}

function makeSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `sess_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `sess_${Date.now().toString(16)}`;
}

function buildQuickRepliesForSession(project: ProjectContext | null, ready = false) {
  if (!project) return [];
  if (ready) return ["生成Word需求表", "补充项目预算", "计划放置 10 个标准机柜"];
  return ["某医院老机房改造，50平，UPS后备2小时", "计划放置 10 个标准机柜", "预算 30 万以内"];
}

function createDraftSession(project: ProjectContext | null): SessionSnapshot {
  const dashboardFields = cloneDashboardFields(initialSession.dashboard_fields);

  return {
    ...initialSession,
    session_id: makeSessionId(),
    state_version: 1,
    fsm_state: "S0_IDLE",
    export_status: "draft",
    completion: completionForState("S0_IDLE", dashboardFields),
    messages: [
      makeMessage(
        "ai",
        project
          ? `已切换到 ${project.project_name}。先把客户原话、现场条件或预算线索发给我，我会把本轮对话直接绑定到这个项目。`
          : "先在左侧创建或选择一个项目，再把客户线索发给我。我会把后续聊天、看板和导出都挂到这个项目上。"
      )
    ],
    quick_replies: buildQuickRepliesForSession(project),
    dashboard_fields: dashboardFields,
    triggered_risks: [],
    suggestion: null,
    knowledge_hits: sessionApiMode === "mock" ? cloneKnowledgeHits(initialSession.knowledge_hits) : [],
    export_asset: null,
    project: cloneProjectContext(project)
  };
}

function hydrateSessionFromSnapshot(snapshot: SessionSnapshotData): SessionSnapshot {
  const dashboardFields = cloneDashboardFields(snapshot.session.dashboard_fields);

  return {
    session_id: snapshot.session.session_id,
    state_version: snapshot.session.state_version,
    fsm_state: snapshot.session.fsm_state,
    export_status: snapshot.session.export_status,
    completion: completionForState(snapshot.session.fsm_state, dashboardFields),
    messages: [
      makeMessage(
        "ai",
        snapshot.project
          ? `已载入 ${snapshot.project.project_name} 的项目快照。你可以继续补充需求，或直接检查右侧看板和导出状态。`
          : "已载入项目快照。你可以继续补充需求，或直接检查右侧看板和导出状态。"
      )
    ],
    quick_replies: buildQuickRepliesForSession(snapshot.project, snapshot.session.export_status === "ready"),
    dashboard_fields: dashboardFields,
    triggered_risks: cloneTriggeredRisks(snapshot.session.triggered_risks),
    suggestion: cloneSuggestion(snapshot.session.suggestion),
    knowledge_hits: cloneKnowledgeHits(snapshot.session.knowledge_hits),
    export_asset: null,
    project: cloneProjectContext(snapshot.project)
  };
}

function isProjectSessionBound(session: SessionSnapshot) {
  return Boolean(session.project && session.state_version > 1);
}

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

function snapshotFieldList(fields: Record<string, DashboardField>) {
  return Object.values(fields);
}

function countSnapshotFields(fields: Record<string, DashboardField>) {
  const snapshotFields = snapshotFieldList(fields);
  return {
    total: snapshotFields.length,
    captured: snapshotFields.filter((field) => field.value !== null && field.value !== "").length,
    pending: snapshotFields.filter((field) => field.value === null || field.needs_confirmation).length,
    manual: snapshotFields.filter((field) => field.source === "dashboard_edit").length
  };
}

function snapshotHighlightFields(fields: Record<string, DashboardField>, limit = 6) {
  const preferredOrder = [
    "customer_name",
    "project_type",
    "room_area_m2",
    "room_floor",
    "rack_count",
    "ups_backup_time_minutes",
    "brand_preference",
    "budget_range_high_rmb"
  ];

  return preferredOrder
    .map((code) => fields[code])
    .filter((field): field is DashboardField =>
      Boolean(field && field.value !== null && field.displayValue !== "待确认")
    )
    .slice(0, limit);
}

function formatTimestampLabel(value: string | null | undefined) {
  if (!value) return "待归档";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [session, setSession] = useState<SessionSnapshot>(() =>
    sessionApiMode === "backend" ? createDraftSession(null) : initialSession
  );
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequiredError | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectDraftName, setProjectDraftName] = useState("");
  const [projectsNotice, setProjectsNotice] = useState<string | null>(null);
  const [isProjectsLoading, setIsProjectsLoading] = useState(true);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isSwitchingProject, setIsSwitchingProject] = useState(false);
  const [activeProjectDetail, setActiveProjectDetail] = useState<ProjectDetail | null>(null);
  const [isProjectDetailLoading, setIsProjectDetailLoading] = useState(false);
  const isAdminMode = useMemo(() => new URLSearchParams(window.location.search).get("admin") === "1", []);
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeIndexStatus | null>(null);
  const [knowledgeUploadNotice, setKnowledgeUploadNotice] = useState<string | null>(null);
  const [isKnowledgeUploading, setIsKnowledgeUploading] = useState(false);

  const latestSession = useRef(session);
  latestSession.current = session;

  function announceProjectNotice(message: string) {
    setProjectsNotice(message);
    window.setTimeout(() => {
      setProjectsNotice((current) => (current === message ? null : current));
    }, 2600);
  }

  function announceSyncNotice(message: string) {
    setSyncNotice(message);
    window.setTimeout(() => {
      setSyncNotice((current) => (current === message ? null : current));
    }, 2600);
  }

  async function switchProject(project: ProjectSummary, silent = false) {
    setIsSwitchingProject(true);
    setPaymentRequest(null);
    setEditingField(null);
    setInput("");

    try {
      if (project.primary_session_id) {
        const snapshot = await getSessionSnapshot(project.primary_session_id);
        setSession(hydrateSessionFromSnapshot(snapshot));
      } else {
        setSession(
          createDraftSession({
            project_id: project.project_id,
            project_name: project.project_name,
            stage: project.stage
          })
        );
      }

      if (!silent) announceProjectNotice(`已切换到 ${project.project_name}`);
    } catch (error) {
      setSession(
        createDraftSession({
          project_id: project.project_id,
          project_name: project.project_name,
          stage: project.stage
        })
      );
      announceProjectNotice(error instanceof Error ? error.message : "项目快照读取失败，已回退到空白草稿。");
    } finally {
      setIsSwitchingProject(false);
    }
  }

  async function refreshProjects(autoSelectFirst = false, silent = false) {
    if (!silent) setIsProjectsLoading(true);

    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      setProjectsNotice(null);

      if (autoSelectFirst && !latestSession.current.project && nextProjects[0]) {
        await switchProject(nextProjects[0], true);
        return;
      }

      const currentProjectId = latestSession.current.project?.project_id;
      if (currentProjectId) {
        const matched = nextProjects.find((project) => project.project_id === currentProjectId);
        if (matched) {
          setSession((current) => ({
            ...current,
            project: {
              project_id: matched.project_id,
              project_name: matched.project_name,
              stage: matched.stage
            }
          }));
        }
      }
    } catch (error) {
      setProjectsNotice(error instanceof Error ? error.message : "项目列表读取失败");
    } finally {
      if (!silent) setIsProjectsLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdminMode) return;
    void refreshKnowledgeStatus();
  }, [isAdminMode]);

  useEffect(() => {
    void refreshProjects(true);
  }, []);

  useEffect(() => {
    if (!session.project) {
      setActiveProjectDetail(null);
      setIsProjectDetailLoading(false);
      return;
    }

    let cancelled = false;
    setIsProjectDetailLoading(true);

    void getProjectDetail(session.project.project_id)
      .then((detail) => {
        if (!cancelled) setActiveProjectDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setActiveProjectDetail(null);
      })
      .finally(() => {
        if (!cancelled) setIsProjectDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session.project?.project_id, session.state_version]);

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
    if (sessionApiMode === "backend" && !latestSession.current.project) {
      announceProjectNotice("请先在左侧创建或选择项目，再开始当前商机对话。");
      return;
    }

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
          suggestion: result.data.suggestion ?? current.suggestion,
          project: result.data.project ?? current.project
        };
      });
      void refreshProjects(false, true);
    } catch (error) {
      announceSyncNotice(error instanceof Error ? error.message : "对话同步失败");
    } finally {
      setIsSending(false);
    }
  }

  async function handleCreateProject() {
    if (isCreatingProject) return;

    setIsCreatingProject(true);
    try {
      const project = await createProject(projectDraftName);
      setProjectDraftName("");
      setProjects((current) => [
        project,
        ...current.filter((item) => item.project_id !== project.project_id)
      ]);
      await switchProject(project, true);
      announceProjectNotice(`已创建并打开 ${project.project_name}`);
    } catch (error) {
      announceProjectNotice(error instanceof Error ? error.message : "项目创建失败");
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function refreshKnowledgeStatus() {
    try {
      const result = await getKnowledgeStatus();
      setKnowledgeStatus(result.data);
    } catch (error) {
      setKnowledgeUploadNotice(error instanceof Error ? error.message : "知识库状态读取失败");
    }
  }

  async function uploadKnowledge(file: File | null) {
    if (!file || isKnowledgeUploading) return;
    if (file.size > maxKnowledgeUploadBytes) {
      setKnowledgeUploadNotice("单文件不能超过 20MB");
      return;
    }

    setIsKnowledgeUploading(true);
    setKnowledgeUploadNotice("正在上传并重建知识索引...");
    try {
      const contentBase64 = await fileToBase64(file);
      const result = await uploadKnowledgeFile({
        file_name: file.name,
        content_base64: contentBase64
      });
      setKnowledgeUploadNotice(
        `已导入 ${result.data.uploaded_file.original_file_name}，当前 ${result.data.index.chunk_count} 个知识片段`
      );
      await refreshKnowledgeStatus();
    } catch (error) {
      setKnowledgeUploadNotice(error instanceof Error ? error.message : "知识库上传失败");
    } finally {
      setIsKnowledgeUploading(false);
    }
  }

  async function commitOverride(field: DashboardField) {
    if (!editingField) return;
    if (sessionApiMode === "backend" && !isProjectSessionBound(latestSession.current)) {
      announceSyncNotice("请先发送一条项目线索，系统完成项目绑定后再做看板修正。");
      setEditingField(null);
      return;
    }

    const value = editingValue.trim();
    setEditingField(null);
    setSyncNotice("正在同步手动修正...");

    try {
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

      announceSyncNotice("已同步到导出上下文");
      void refreshProjects(false, true);
    } catch (error) {
      announceSyncNotice(error instanceof Error ? error.message : "手动修正同步失败");
    }
  }

  async function startExport(
    approved = false,
    paymentMode: "simulate_99_rmb" | "free_preview" = "simulate_99_rmb"
  ) {
    if (sessionApiMode === "backend" && !latestSession.current.project) {
      announceProjectNotice("请先创建或选择项目，再生成导出文件。");
      return;
    }
    if (sessionApiMode === "backend" && !isProjectSessionBound(latestSession.current)) {
      announceSyncNotice("请先发送一条项目线索，系统会先把导出绑定到当前项目。");
      return;
    }

    setIsExporting(true);
    try {
      const result = await getSessionExport({
        session: latestSession.current,
        payment_mode: paymentMode,
        approved
      });

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
    } catch (error) {
      announceSyncNotice(error instanceof Error ? error.message : "导出请求失败");
    } finally {
      setIsExporting(false);
    }
  }

  function resetSession() {
    setSession(createDraftSession(latestSession.current.project));
    setPaymentRequest(null);
    setInput("");
    setSyncNotice(null);
    if (latestSession.current.project) {
      announceProjectNotice(`已为 ${latestSession.current.project.project_name} 新开一轮摸底草稿`);
    }
  }

  return (
    <main className="app-shell">
      <Sidebar
        onReset={resetSession}
        projects={projects}
        activeProjectId={session.project?.project_id ?? null}
        projectDraftName={projectDraftName}
        projectsNotice={projectsNotice}
        isProjectsLoading={isProjectsLoading}
        isCreatingProject={isCreatingProject}
        isSwitchingProject={isSwitchingProject}
        isAdminMode={isAdminMode}
        knowledgeStatus={knowledgeStatus}
        knowledgeUploadNotice={knowledgeUploadNotice}
        isKnowledgeUploading={isKnowledgeUploading}
        onProjectDraftNameChange={setProjectDraftName}
        onCreateProject={handleCreateProject}
        onSelectProject={switchProject}
        onRefreshProjects={() => void refreshProjects(false)}
        onKnowledgeUpload={uploadKnowledge}
        onRefreshKnowledgeStatus={refreshKnowledgeStatus}
      />
      <section className="workbench">
        <ChatPanel
          session={session}
          projectDetail={activeProjectDetail}
          isProjectDetailLoading={isProjectDetailLoading}
          input={input}
          isSending={isSending}
          onInput={setInput}
          onSend={() => sendChat(input)}
          onQuickReply={sendChat}
        />
        <DashboardPanel
          session={session}
          projectDetail={activeProjectDetail}
          isProjectDetailLoading={isProjectDetailLoading}
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

function Sidebar({
  onReset,
  projects,
  activeProjectId,
  projectDraftName,
  projectsNotice,
  isProjectsLoading,
  isCreatingProject,
  isSwitchingProject,
  isAdminMode,
  knowledgeStatus,
  knowledgeUploadNotice,
  isKnowledgeUploading,
  onProjectDraftNameChange,
  onCreateProject,
  onSelectProject,
  onRefreshProjects,
  onKnowledgeUpload,
  onRefreshKnowledgeStatus
}: {
  onReset: () => void;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  projectDraftName: string;
  projectsNotice: string | null;
  isProjectsLoading: boolean;
  isCreatingProject: boolean;
  isSwitchingProject: boolean;
  isAdminMode: boolean;
  knowledgeStatus: KnowledgeIndexStatus | null;
  knowledgeUploadNotice: string | null;
  isKnowledgeUploading: boolean;
  onProjectDraftNameChange: (value: string) => void;
  onCreateProject: () => void | Promise<void>;
  onSelectProject: (project: ProjectSummary) => void | Promise<void>;
  onRefreshProjects: () => void;
  onKnowledgeUpload: (file: File | null) => void;
  onRefreshKnowledgeStatus: () => void;
}) {
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

      <section className="sidebar-section project-section">
        <div className="project-section-head">
          <span className="section-label">项目协作</span>
          <button
            className="admin-refresh"
            type="button"
            onClick={onRefreshProjects}
            disabled={isProjectsLoading}
          >
            {isProjectsLoading ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
            刷新
          </button>
        </div>

        <div className="project-create">
          <input
            value={projectDraftName}
            onChange={(event) => onProjectDraftNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void onCreateProject();
            }}
            placeholder="输入项目名，可留空生成默认名"
          />
          <button
            type="button"
            className="primary-action compact"
            onClick={onCreateProject}
            disabled={isCreatingProject}
          >
            {isCreatingProject ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            新建
          </button>
        </div>

        {projectsNotice && <p className="sidebar-note">{projectsNotice}</p>}

        <div className="project-list">
          {projects.length === 0 ? (
            <div className="project-empty">
              <Building2 size={16} />
              <span>{isProjectsLoading ? "正在读取项目列表..." : "还没有项目，先创建一个再开始摸底。"}</span>
            </div>
          ) : (
            projects.map((project) => (
              <button
                key={project.project_id}
                className={`project-item ${activeProjectId === project.project_id ? "active" : ""}`}
                onClick={() => void onSelectProject(project)}
                disabled={isSwitchingProject}
              >
                <Building2 size={16} />
                <span className="project-item-body">
                  <strong>{project.project_name}</strong>
                  <small>
                    {projectStageLabel(project.stage)}
                    {project.primary_session_id ? " · 已绑定会话" : " · 待首轮沟通"}
                  </small>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      {isAdminMode && (
        <AdminKnowledgeUpload
          status={knowledgeStatus}
          notice={knowledgeUploadNotice}
          isUploading={isKnowledgeUploading}
          onUpload={onKnowledgeUpload}
          onRefresh={onRefreshKnowledgeStatus}
        />
      )}

      <div className="sidebar-foot">
        <ShieldAlert size={16} />
        <span>先选项目再开聊，后续看板、会话快照和导出都会按项目归档。</span>
      </div>
    </aside>
  );
}

function AdminKnowledgeUpload({
  status,
  notice,
  isUploading,
  onUpload,
  onRefresh
}: {
  status: KnowledgeIndexStatus | null;
  notice: string | null;
  isUploading: boolean;
  onUpload: (file: File | null) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="admin-upload">
      <div className="admin-upload-title">
        <FolderUp size={17} />
        <span>管理员知识上传</span>
      </div>
      <label className={`kb-action upload-label ${isUploading ? "disabled" : ""}`}>
        {isUploading ? <Loader2 className="spin" size={17} /> : <FolderUp size={17} />}
        上传资料并重建
        <input
          type="file"
          accept=".md,.txt,.docx,.pdf,.xlsx,.csv,.tsv"
          disabled={isUploading}
          onChange={(event) => {
            onUpload(event.currentTarget.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <button className="admin-refresh" type="button" onClick={onRefresh} disabled={isUploading}>
        <RefreshCw size={14} />
        刷新状态
      </button>
      <div className="admin-status">
        <span>{status ? `${status.index.chunk_count} 个片段` : "状态待读取"}</span>
        <small>
          {status?.last_uploaded_file
            ? `最近：${status.last_uploaded_file.original_file_name ?? status.last_uploaded_file.stored_file_name}`
            : "支持 md/txt/docx/pdf/xlsx/csv/tsv"}
        </small>
      </div>
      {notice && <p>{notice}</p>}
    </section>
  );
}

function ChatPanel({
  session,
  projectDetail,
  isProjectDetailLoading,
  input,
  isSending,
  onInput,
  onSend,
  onQuickReply
}: {
  session: SessionSnapshot;
  projectDetail: ProjectDetail | null;
  isProjectDetailLoading: boolean;
  input: string;
  isSending: boolean;
  onInput: (value: string) => void;
  onSend: () => void;
  onQuickReply: (value: string) => void;
}) {
  const projectTitle = session.project?.project_name
    ? session.project.project_name
    : session.dashboard_fields.customer_name.value
      ? session.dashboard_fields.customer_name.displayValue
      : "请选择项目后开始摸底";

  return (
    <section className="chat-panel">
      <header className="panel-header chat-titlebar">
        <div>
          <p>{session.project ? `当前项目 · ${projectStageLabel(session.project.stage)}` : "当前商机"}</p>
          <h2>{projectTitle}</h2>
        </div>
        <div className={`completion-pill completion-${session.completion >= 95 ? "ready" : "active"}`}>
          采集率 {session.completion}%
        </div>
      </header>

      {session.project && (
        <ProjectOverviewStrip
          session={session}
          projectDetail={projectDetail}
          isLoading={isProjectDetailLoading}
        />
      )}

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
  projectDetail,
  isProjectDetailLoading,
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
  projectDetail: ProjectDetail | null;
  isProjectDetailLoading: boolean;
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
        <ProjectContextCard
          session={session}
          projectDetail={projectDetail}
          isLoading={isProjectDetailLoading}
        />
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

function ProjectOverviewStrip({
  session,
  projectDetail,
  isLoading
}: {
  session: SessionSnapshot;
  projectDetail: ProjectDetail | null;
  isLoading: boolean;
}) {
  const snapshotStats = countSnapshotFields(session.dashboard_fields);
  const highlightFields = snapshotHighlightFields(session.dashboard_fields);
  const archivedSessionId =
    projectDetail?.primary_session_id ?? (isProjectSessionBound(session) ? session.session_id : null);

  return (
    <section className="project-overview">
      <div className="project-overview-grid">
        <Metric label="已采集字段" value={`${snapshotStats.captured}/${snapshotStats.total}`} />
        <Metric label="待确认" value={`${snapshotStats.pending}项`} />
        <Metric label="风险提示" value={`${session.triggered_risks.length}条`} />
        <Metric label="资料命中" value={`${session.knowledge_hits.length}条`} />
      </div>

      {highlightFields.length > 0 ? (
        <ProjectSnapshotChips fields={highlightFields} />
      ) : (
        <p className="project-overview-empty">
          当前项目还没有形成可复用快照，先把客户原话、面积、楼层、UPS或机柜线索发进来。
        </p>
      )}

      <p className="project-overview-note">
        {isLoading ? (
          <Loader2 className="spin" size={14} />
        ) : archivedSessionId ? (
          <Check size={14} />
        ) : (
          <RefreshCw size={14} />
        )}
        <span>
          {archivedSessionId
            ? `项目快照已归档到会话 ${archivedSessionId.slice(-8)} · 最近同步 ${formatTimestampLabel(projectDetail?.updated_at)}`
            : "当前还是项目草稿，发一条项目线索后会自动写入项目档案。"}
        </span>
      </p>
    </section>
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

function ProjectContextCard({
  session,
  projectDetail,
  isLoading
}: {
  session: SessionSnapshot;
  projectDetail: ProjectDetail | null;
  isLoading: boolean;
}) {
  if (!session.project) {
    return (
      <section className="dash-card quiet-card">
        <div className="quiet-state">
          <Building2 size={20} />
          <span>先在左侧创建或选择项目，聊天与导出才会写入项目协作上下文。</span>
        </div>
      </section>
    );
  }

  const hasArchivedSnapshot = Boolean(
    projectDetail?.primary_session_id && snapshotFieldList(projectDetail.dashboard_snapshot).length > 0
  );
  const snapshotSource =
    hasArchivedSnapshot && projectDetail ? projectDetail.dashboard_snapshot : session.dashboard_fields;
  const snapshotStats = countSnapshotFields(snapshotSource);
  const highlightFields = snapshotHighlightFields(snapshotSource, 5);

  return (
    <section className="dash-card project-context-card">
      <div className="card-heading">
        <div>
          <p>项目协作上下文</p>
          <h3>{session.project.project_name}</h3>
        </div>
        <span className={`stage-chip ${projectStageClass(session.project.stage)}`}>
          {projectStageLabel(session.project.stage)}
        </span>
      </div>
      <div className="project-context-grid">
        <Metric label="项目阶段" value={projectStageLabel(session.project.stage)} />
        <Metric label="会话版本" value={`v${session.state_version}`} />
        <Metric label="当前会话" value={session.session_id.slice(-8)} />
      </div>
      <div className="project-context-grid project-context-secondary">
        <Metric label="已采集字段" value={`${snapshotStats.captured}/${snapshotStats.total}`} />
        <Metric label="待确认" value={`${snapshotStats.pending}项`} />
        <Metric
          label="最近归档"
          value={
            hasArchivedSnapshot && projectDetail?.updated_at
              ? formatTimestampLabel(projectDetail.updated_at)
              : "待归档"
          }
        />
      </div>
      {highlightFields.length > 0 ? (
        <ProjectSnapshotChips fields={highlightFields} compact />
      ) : (
        <p className="project-context-note">
          {isLoading ? "正在读取项目快照..." : "当前项目还没有可展示的归档字段。"}
        </p>
      )}
      <p className="project-context-note">
        {isProjectSessionBound(session)
          ? `当前对话已绑定到后端项目${projectDetail?.primary_session_id ? `（归档会话 ${projectDetail.primary_session_id.slice(-8)}）` : ""}，会随着聊天、看板修正和导出一起推进。`
          : "当前是项目草稿会话。先发一条项目线索，系统才会把本轮摸底正式绑定到后端项目。"}
      </p>
    </section>
  );
}

function ProjectSnapshotChips({ fields, compact = false }: { fields: DashboardField[]; compact?: boolean }) {
  return (
    <div className={`project-snapshot-chips ${compact ? "compact" : ""}`}>
      {fields.map((field) => (
        <span key={field.code} className="project-snapshot-chip">
          <b>{field.label}</b>
          <strong>{field.displayValue}</strong>
        </span>
      ))}
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
