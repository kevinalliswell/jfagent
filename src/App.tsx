import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Calculator,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  Edit3,
  FileText,
  FolderUp,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Send,
  ServerCog,
  ShieldAlert,
  Ticket,
  UserRound,
  X
} from "lucide-react";
import {
  completionForState,
  createProject,
  displayForField,
  getProjectDetail,
  getRuntimeStatus,
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
import {
  adminGenerateLicenses,
  adminListLicenses,
  clearAuthToken,
  getAuthMode,
  getMe,
  postLogin,
  postRedeem,
  postRegister,
  readAuthToken,
  writeAuthToken
} from "./authApi";
import { buildPresalesCockpit, projectStageClass, projectStageLabel } from "./presalesCockpit";
import type { PresalesCockpit } from "./presalesCockpit";
import type {
  AdminRuntimeStatus,
  AgentRuntimeSummary,
  ChatMessage,
  DashboardField,
  ExportAsset,
  KnowledgeIndexStatus,
  KnowledgeHit,
  LicenseRecord,
  PaymentRequiredError,
  ProjectContext,
  ProjectDetail,
  ProjectSummary,
  PublicUser,
  RiskFlag,
  SessionSnapshotData,
  SessionSnapshot
} from "./types";

const maxKnowledgeUploadBytes = 20 * 1024 * 1024;
const lastProjectStorageKey = "jfagent:last-project-id";

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

function cloneAgentRuntime(agentRuntime: AgentRuntimeSummary | null) {
  return agentRuntime ? { ...agentRuntime } : null;
}

function readLastProjectId() {
  try {
    return window.localStorage.getItem(lastProjectStorageKey);
  } catch {
    return null;
  }
}

function writeLastProjectId(projectId: string) {
  try {
    window.localStorage.setItem(lastProjectStorageKey, projectId);
  } catch {
    // Ignore storage failures in private or restricted environments.
  }
}

function makeSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `sess_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `sess_${Date.now().toString(16)}`;
}

const quickStartPresets = [
  "某医院机房改造，50平，3楼，UPS后备2小时，10个机柜，预算30万",
  "某学校新建中心机房，80平，计划12个机柜，要求国产优先",
  "园区机房扩容，现有机房利旧，新增6个机柜，月底前要出方案"
];

function buildQuickRepliesForSession(project: ProjectContext | null, ready = false) {
  if (!project) return [];
  if (ready) return ["整理交付稿", "补充项目预算", "计划放置 10 个标准机柜"];
  return ["某医院老机房改造，50平，UPS后备2小时", "计划放置 10 个标准机柜", "预算 30 万以内"];
}

function isInternalProjectName(name: string) {
  return /持久化|测试|demo|sample|示例/i.test(name);
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
          ? `已切换到 ${project.project_name}。先把客户原话、现场条件或预算线索发给我，我会继续补齐这份项目档案。`
          : "先在左侧创建或选择一个项目，再把客户线索发给我。后续沟通记录、需求字段和交付整理都会归到这个项目。"
      )
    ],
    quick_replies: buildQuickRepliesForSession(project),
    dashboard_fields: dashboardFields,
    triggered_risks: [],
    suggestion: null,
    knowledge_hits: sessionApiMode === "mock" ? cloneKnowledgeHits(initialSession.knowledge_hits) : [],
    export_asset: null,
    project: cloneProjectContext(project),
    agent_runtime: sessionApiMode === "mock" ? cloneAgentRuntime(initialSession.agent_runtime) : null
  };
}

function hydrateSessionFromSnapshot(snapshot: SessionSnapshotData): SessionSnapshot {
  const dashboardFields = cloneDashboardFields(snapshot.session.dashboard_fields);
  const persistedMessages = (snapshot.session.messages ?? []).map((message) => ({ ...message }));

  return {
    session_id: snapshot.session.session_id,
    state_version: snapshot.session.state_version,
    fsm_state: snapshot.session.fsm_state,
    export_status: snapshot.session.export_status,
    completion: completionForState(snapshot.session.fsm_state, dashboardFields),
    messages: persistedMessages.length
      ? persistedMessages
      : [
          makeMessage(
            "ai",
            snapshot.project
              ? `已载入 ${snapshot.project.project_name} 的项目资料。你可以继续补充需求，或直接开始整理方案与交付内容。`
              : "已载入项目资料。你可以继续补充需求，或直接开始整理方案与交付内容。"
          )
        ],
    quick_replies: buildQuickRepliesForSession(snapshot.project, snapshot.session.export_status === "ready"),
    dashboard_fields: dashboardFields,
    triggered_risks: cloneTriggeredRisks(snapshot.session.triggered_risks),
    suggestion: cloneSuggestion(snapshot.session.suggestion),
    knowledge_hits: cloneKnowledgeHits(snapshot.session.knowledge_hits),
    export_asset: null,
    project: cloneProjectContext(snapshot.project),
    agent_runtime: cloneAgentRuntime(snapshot.session.agent_runtime)
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
  const [runtimeStatus, setRuntimeStatus] = useState<AdminRuntimeStatus | null>(null);
  const [knowledgeUploadNotice, setKnowledgeUploadNotice] = useState<string | null>(null);
  const [isKnowledgeUploading, setIsKnowledgeUploading] = useState(false);
  const [authUser, setAuthUser] = useState<PublicUser | null>(null);
  const [authRequired, setAuthRequired] = useState(sessionApiMode === "backend");
  const [isAuthBootstrapping, setIsAuthBootstrapping] = useState(sessionApiMode === "backend");
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const isAuthed = sessionApiMode !== "backend" || !authRequired || Boolean(authUser);

  const latestSession = useRef(session);
  latestSession.current = session;

  useEffect(() => {
    if (sessionApiMode !== "backend") return;
    let cancelled = false;

    void (async () => {
      try {
        if (readAuthToken()) {
          const me = await getMe();
          if (cancelled) return;
          setAuthUser(me.user);
          setAuthRequired(me.auth_required);
          return;
        }
        const mode = await getAuthMode();
        if (cancelled) return;
        setAuthRequired(mode.auth_required);
        if (!mode.auth_required) {
          const me = await getMe();
          if (!cancelled) setAuthUser(me.user);
        }
      } catch {
        if (!cancelled) {
          clearAuthToken();
          setAuthUser(null);
        }
      } finally {
        if (!cancelled) setIsAuthBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshAuthUser() {
    if (sessionApiMode !== "backend") return;
    try {
      const me = await getMe();
      setAuthUser(me.user);
    } catch {
      // Keep the stale user object; the next 401 will route back to login.
    }
  }

  function handleLogout() {
    clearAuthToken();
    window.location.reload();
  }

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
    writeLastProjectId(project.project_id);

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

  async function refreshProjects(restoreLastSelected = false, silent = false) {
    if (!silent) setIsProjectsLoading(true);

    try {
      const nextProjects = await listProjects();
      setProjects(nextProjects);
      setProjectsNotice(null);

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
        return;
      }

      if (restoreLastSelected) {
        const lastProjectId = readLastProjectId();
        const matched = lastProjectId
          ? nextProjects.find((project) => project.project_id === lastProjectId)
          : null;
        if (matched) {
          await switchProject(matched, true);
        }
      }
    } catch (error) {
      setProjectsNotice(error instanceof Error ? error.message : "项目列表读取失败");
    } finally {
      if (!silent) setIsProjectsLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdminMode || !isAuthed) return;
    void refreshKnowledgeStatus();
    void refreshRuntimeStatus();
  }, [isAdminMode, isAuthed]);

  useEffect(() => {
    if (!isAuthed) return;
    void refreshProjects(true);
  }, [isAuthed]);

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

  const cockpit = useMemo(
    () => buildPresalesCockpit(session, activeProjectDetail),
    [session, activeProjectDetail]
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
          project: result.data.project ?? current.project,
          agent_runtime: cloneAgentRuntime(result.data.agent_runtime)
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

  async function handleQuickStart() {
    if (isCreatingProject || isSending) return;

    setIsCreatingProject(true);
    try {
      const project = await createProject(projectDraftName);
      const projectContext = {
        project_id: project.project_id,
        project_name: project.project_name,
        stage: project.stage
      } satisfies ProjectContext;
      const nextSession = createDraftSession(projectContext);

      setProjectDraftName("");
      setProjects((current) => [
        project,
        ...current.filter((item) => item.project_id !== project.project_id)
      ]);
      writeLastProjectId(project.project_id);
      latestSession.current = nextSession;
      setSession(nextSession);
      setPaymentRequest(null);
      setEditingField(null);
      announceProjectNotice(`已创建并打开 ${project.project_name}`);

      if (input.trim()) {
        await sendChat(input);
      }
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

  async function refreshRuntimeStatus() {
    try {
      const result = await getRuntimeStatus();
      setRuntimeStatus(result.data);
    } catch (error) {
      setKnowledgeUploadNotice(error instanceof Error ? error.message : "运行状态读取失败");
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
      announceSyncNotice("请先发送一条客户线索，让项目先形成第一版资料，再修改需求字段。");
      setEditingField(null);
      return;
    }

    const value = editingValue.trim();
    setEditingField(null);
    setSyncNotice("正在保存手动修改...");

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
          messages: [
            ...current.messages,
            makeMessage("ai", `已更新「${field.label}」，后续方案建议和交付整理会按这个口径继续。`)
          ]
        };
      });

      announceSyncNotice("已同步到项目资料");
      void refreshProjects(false, true);
    } catch (error) {
      announceSyncNotice(error instanceof Error ? error.message : "手动修正同步失败");
    }
  }

  async function startExport(approved = false, paymentMode?: "credit" | "free_preview") {
    if (sessionApiMode === "backend" && !latestSession.current.project) {
      announceProjectNotice("请先创建或选择项目，再生成导出文件。");
      return;
    }
    if (sessionApiMode === "backend" && !isProjectSessionBound(latestSession.current)) {
      announceSyncNotice("请先发送一条项目线索，系统会先整理出项目资料，再继续生成交付文件。");
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
      const isPreviewResult = result.data.export_status === "preview_ready";
      const creditsBalance = result.data.billing_check.credits_balance;
      if (!isPreviewResult && typeof creditsBalance === "number") {
        setAuthUser((current) => (current ? { ...current, export_credits: creditsBalance } : current));
      }
      setSession((current) => ({
        ...current,
        state_version: result.state_version,
        export_status: isPreviewResult ? current.export_status : "exported",
        export_asset: result.data.asset,
        messages: [
          ...current.messages,
          makeMessage(
            "ai",
            isPreviewResult
              ? "预览稿已生成，可以先核对需求、风险和章节结构。预览不消耗导出额度。"
              : "正式交付稿已生成，章节、风险提示、测算结果和价格占位已经整理完成。"
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

  if (sessionApiMode === "backend" && isAuthBootstrapping) {
    return (
      <main className="auth-shell">
        <div className="auth-card auth-loading">
          <Loader2 className="spin" size={28} />
          <p>正在连接机房售前工作台...</p>
        </div>
      </main>
    );
  }

  if (sessionApiMode === "backend" && authRequired && !authUser) {
    return (
      <AuthScreen
        onAuthed={(user) => {
          setAuthUser(user);
        }}
      />
    );
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
        runtimeStatus={runtimeStatus}
        knowledgeUploadNotice={knowledgeUploadNotice}
        isKnowledgeUploading={isKnowledgeUploading}
        authUser={authUser}
        authRequired={authRequired}
        onLogout={handleLogout}
        onOpenRedeem={() => setShowRedeemModal(true)}
        onProjectDraftNameChange={setProjectDraftName}
        onCreateProject={handleCreateProject}
        onSelectProject={switchProject}
        onRefreshProjects={() => void refreshProjects(false)}
        onKnowledgeUpload={uploadKnowledge}
        onRefreshKnowledgeStatus={refreshKnowledgeStatus}
        onRefreshRuntimeStatus={refreshRuntimeStatus}
      />
      <section className="workstation-shell">
        <CockpitPanel
          session={session}
          cockpit={cockpit}
          isProjectDetailLoading={isProjectDetailLoading}
          projects={projects}
          projectDraftName={projectDraftName}
          isSwitchingProject={isSwitchingProject}
          input={input}
          isSending={isSending}
          isCreatingProject={isCreatingProject}
          onProjectDraftNameChange={setProjectDraftName}
          onInput={setInput}
          onSend={() => sendChat(input)}
          onQuickReply={sendChat}
          onQuickStart={handleQuickStart}
          onSelectProject={switchProject}
          editingField={editingField}
          editingValue={editingValue}
          syncNotice={syncNotice}
          onStartEdit={(field) => {
            setEditingField(field.code);
            setEditingValue(field.value === null ? "" : String(field.value));
          }}
          onEditValue={setEditingValue}
          onCommitEdit={commitOverride}
          onCancelEdit={() => setEditingField(null)}
        />
        <OperationsPanel
          session={session}
          cockpit={cockpit}
          projects={projects}
          projectDetail={activeProjectDetail}
          isProjectDetailLoading={isProjectDetailLoading}
          isExporting={isExporting}
          onExport={() => startExport(false)}
        />
      </section>
      {paymentRequest && (
        <ExportReviewModal
          request={paymentRequest}
          authUser={authUser}
          isExporting={isExporting}
          onClose={() => setPaymentRequest(null)}
          onPay={() => startExport(true)}
          onPreview={() => startExport(true, "free_preview")}
          onRedeemed={(user) => {
            setAuthUser(user);
            void refreshAuthUser();
          }}
        />
      )}
      {showRedeemModal && (
        <RedeemModal
          onClose={() => setShowRedeemModal(false)}
          onRedeemed={(user) => {
            setAuthUser(user);
            setShowRedeemModal(false);
          }}
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
  runtimeStatus,
  knowledgeUploadNotice,
  isKnowledgeUploading,
  authUser,
  authRequired,
  onLogout,
  onOpenRedeem,
  onProjectDraftNameChange,
  onCreateProject,
  onSelectProject,
  onRefreshProjects,
  onKnowledgeUpload,
  onRefreshKnowledgeStatus,
  onRefreshRuntimeStatus
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
  runtimeStatus: AdminRuntimeStatus | null;
  knowledgeUploadNotice: string | null;
  isKnowledgeUploading: boolean;
  authUser: PublicUser | null;
  authRequired: boolean;
  onLogout: () => void;
  onOpenRedeem: () => void;
  onProjectDraftNameChange: (value: string) => void;
  onCreateProject: () => void | Promise<void>;
  onSelectProject: (project: ProjectSummary) => void | Promise<void>;
  onRefreshProjects: () => void;
  onKnowledgeUpload: (file: File | null) => void;
  onRefreshKnowledgeStatus: () => void;
  onRefreshRuntimeStatus: () => void;
}) {
  const visibleProjects = isAdminMode
    ? projects
    : projects.filter((project) => !isInternalProjectName(project.project_name));

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">
          <ServerCog size={24} />
        </div>
        <div>
          <h1>机房售前工作台</h1>
          <p>需求整理 · 风险核查 · 方案协同</p>
        </div>
      </div>

      <button className="primary-action" onClick={onReset}>
        <Plus size={18} />
        新建项目
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
          {visibleProjects.length === 0 ? (
            <div className="project-empty">
              <Building2 size={16} />
              <span>{isProjectsLoading ? "正在读取项目列表..." : "还没有项目，先创建一个再开始摸底。"}</span>
            </div>
          ) : (
            visibleProjects.map((project) => (
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
                    {project.primary_session_id ? " · 进行中" : " · 待整理"}
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
          runtimeStatus={runtimeStatus}
          notice={knowledgeUploadNotice}
          isUploading={isKnowledgeUploading}
          onUpload={onKnowledgeUpload}
          onRefresh={onRefreshKnowledgeStatus}
          onRefreshRuntime={onRefreshRuntimeStatus}
        />
      )}

      {isAdminMode && sessionApiMode === "backend" && (!authRequired || authUser?.role === "admin") && (
        <AdminLicensePanel />
      )}

      {sessionApiMode === "backend" && authRequired && authUser && (
        <section className="user-chip">
          <div className="user-chip-head">
            <UserRound size={16} />
            <div className="user-chip-name">
              <strong>{authUser.display_name}</strong>
              <small>{authUser.role === "admin" ? "管理员" : authUser.email}</small>
            </div>
          </div>
          <div className="user-chip-credits">
            <Ticket size={14} />
            <span>
              导出额度 <b>{authUser.role === "admin" ? "不限" : `${authUser.export_credits} 份`}</b>
            </span>
          </div>
          <div className="user-chip-actions">
            {authUser.role !== "admin" && (
              <button type="button" onClick={onOpenRedeem}>
                <KeyRound size={13} />
                兑换额度
              </button>
            )}
            <button type="button" onClick={onLogout}>
              <LogOut size={13} />
              退出
            </button>
          </div>
        </section>
      )}

      <div className="sidebar-foot">
        <ShieldAlert size={16} />
        <span>项目中心</span>
      </div>
    </aside>
  );
}

function AuthScreen({ onAuthed }: { onAuthed: (user: PublicUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    if (isSubmitting) return;
    if (!email.trim() || !password) {
      setNotice("请输入邮箱和密码。");
      return;
    }
    setIsSubmitting(true);
    setNotice(null);
    try {
      const result =
        mode === "login"
          ? await postLogin({ email: email.trim(), password })
          : await postRegister({
              email: email.trim(),
              password,
              display_name: displayName.trim() || undefined
            });
      writeAuthToken(result.token);
      onAuthed(result.user);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">
            <ServerCog size={26} />
          </div>
          <div>
            <h1>机房售前工作台</h1>
            <p>需求整理 · 风险核查 · 测算报价 · 交付文档</p>
          </div>
        </div>

        <div className="auth-tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            登录
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            注册
          </button>
        </div>

        <div className="auth-form">
          {mode === "register" && (
            <label>
              <span>姓名 / 团队称呼</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：售前一组 小王"
              />
            </label>
          )}
          <label>
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              placeholder={mode === "register" ? "至少 8 位" : "请输入密码"}
            />
          </label>
        </div>

        {notice && <p className="auth-notice">{notice}</p>}

        <button className="primary-action auth-submit" type="button" onClick={() => void submit()}>
          {isSubmitting ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
          {mode === "login" ? "登录工作台" : "注册并进入"}
        </button>

        <p className="auth-foot">
          {mode === "register"
            ? "新账号自带免费导出额度，可先完整体验一次正式交付稿。"
            : "首次部署时注册的第一个账号将自动成为管理员。"}
        </p>
      </div>
    </main>
  );
}

function RedeemModal({
  onClose,
  onRedeemed
}: {
  onClose: () => void;
  onRedeemed: (user: PublicUser) => void;
}) {
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    if (isSubmitting || !code.trim()) return;
    setIsSubmitting(true);
    setNotice(null);
    try {
      const result = await postRedeem(code.trim());
      setNotice(`已到账 ${result.credits_added} 份导出额度，当前余额 ${result.balance_after} 份。`);
      onRedeemed(result.user);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "兑换失败，请核对激活码。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="payment-modal">
        <button className="close-modal" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
        <span className="modal-kicker">导出额度</span>
        <h2>兑换激活码</h2>
        <p>输入销售提供的激活码（格式 JF-XXXXX-XXXXX），额度立即到账，用于生成正式交付稿。</p>
        <div className="redeem-row">
          <input
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder="JF-XXXXX-XXXXX"
          />
          <button className="pay-button" onClick={() => void submit()} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
            兑换
          </button>
        </div>
        {notice && <p className="redeem-notice">{notice}</p>}
      </div>
    </div>
  );
}

function AdminLicensePanel() {
  const [count, setCount] = useState("5");
  const [credits, setCredits] = useState("5");
  const [note, setNote] = useState("");
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  async function refresh() {
    try {
      setLicenses(await adminListLicenses());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "激活码列表读取失败");
    }
  }

  async function generate() {
    if (isWorking) return;
    setIsWorking(true);
    setNotice(null);
    try {
      const created = await adminGenerateLicenses({
        count: Number(count) || 1,
        credits: Number(credits) || 1,
        note: note.trim() || undefined
      });
      setNotice(`已生成 ${created.length} 个激活码，每个含 ${created[0]?.credits ?? "-"} 份额度。`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "激活码生成失败");
    } finally {
      setIsWorking(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const activeCodes = licenses.filter((license) => license.status === "active");

  return (
    <section className="admin-upload admin-license">
      <div className="admin-upload-title">
        <Ticket size={17} />
        <span>激活码管理</span>
      </div>
      <div className="license-form">
        <label>
          数量
          <input value={count} onChange={(event) => setCount(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          额度/个
          <input value={credits} onChange={(event) => setCredits(event.target.value)} inputMode="numeric" />
        </label>
      </div>
      <input
        className="license-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="备注（客户/渠道）"
      />
      <button className="admin-refresh" type="button" onClick={() => void generate()} disabled={isWorking}>
        {isWorking ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}
        生成激活码
      </button>
      <div className="admin-status">
        <span>
          未使用 {activeCodes.length} / 共 {licenses.length} 个
        </span>
        {activeCodes.slice(0, 5).map((license) => (
          <small key={license.code} className="license-code">
            {license.code} · {license.credits}份{license.note ? ` · ${license.note}` : ""}
          </small>
        ))}
      </div>
      {notice && <p>{notice}</p>}
    </section>
  );
}

function AdminKnowledgeUpload({
  status,
  runtimeStatus,
  notice,
  isUploading,
  onUpload,
  onRefresh,
  onRefreshRuntime
}: {
  status: KnowledgeIndexStatus | null;
  runtimeStatus: AdminRuntimeStatus | null;
  notice: string | null;
  isUploading: boolean;
  onUpload: (file: File | null) => void;
  onRefresh: () => void;
  onRefreshRuntime: () => void;
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
      <button className="admin-refresh" type="button" onClick={onRefreshRuntime} disabled={isUploading}>
        <RefreshCw size={14} />
        刷新模型状态
      </button>
      <div className="admin-status">
        <span>{status ? `${status.index.chunk_count} 个片段` : "状态待读取"}</span>
        <small>
          {status?.last_uploaded_file
            ? `最近：${status.last_uploaded_file.original_file_name ?? status.last_uploaded_file.stored_file_name}`
            : "支持 md/txt/docx/pdf/xlsx/csv/tsv"}
        </small>
      </div>
      <div className="admin-status">
        <span>
          {runtimeStatus
            ? `${runtimeStatus.agent.llm_configured ? "已连接模型服务" : "未连接模型服务"}`
            : "模型状态待读取"}
        </span>
        <small>
          {runtimeStatus
            ? `${runtimeStatus.agent.model} · ${runtimeStatus.agent.base_url}`
            : "读取后可确认当前模型配置"}
        </small>
        {runtimeStatus && <small>数据目录：{runtimeStatus.storage.database_path}</small>}
      </div>
      {notice && <p>{notice}</p>}
    </section>
  );
}

function CockpitPanel({
  session,
  cockpit,
  isProjectDetailLoading,
  projects,
  projectDraftName,
  isSwitchingProject,
  input,
  isSending,
  isCreatingProject,
  onProjectDraftNameChange,
  onInput,
  onSend,
  onQuickReply,
  onQuickStart,
  onSelectProject,
  editingField,
  editingValue,
  syncNotice,
  onStartEdit,
  onEditValue,
  onCommitEdit,
  onCancelEdit
}: {
  session: SessionSnapshot;
  cockpit: PresalesCockpit;
  isProjectDetailLoading: boolean;
  projects: ProjectSummary[];
  projectDraftName: string;
  isSwitchingProject: boolean;
  input: string;
  isSending: boolean;
  isCreatingProject: boolean;
  onProjectDraftNameChange: (value: string) => void;
  onInput: (value: string) => void;
  onSend: () => void;
  onQuickReply: (value: string) => void;
  onQuickStart: () => void | Promise<void>;
  onSelectProject: (project: ProjectSummary) => void | Promise<void>;
  editingField: string | null;
  editingValue: string;
  syncNotice: string | null;
  onStartEdit: (field: DashboardField) => void;
  onEditValue: (value: string) => void;
  onCommitEdit: (field: DashboardField) => void;
  onCancelEdit: () => void;
}) {
  const highlightFields = snapshotHighlightFields(session.dashboard_fields);
  if (!cockpit.hasProject) {
    return (
      <section className="cockpit-panel">
        <div className="cockpit-scroll">
          <EmptyProjectState
            projects={projects}
            isSwitchingProject={isSwitchingProject}
            projectDraftName={projectDraftName}
            input={input}
            isCreatingProject={isCreatingProject}
            isSending={isSending}
            onProjectDraftNameChange={onProjectDraftNameChange}
            onInput={onInput}
            onQuickStart={onQuickStart}
            onSelectProject={onSelectProject}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="cockpit-panel">
      <div className="cockpit-scroll">
        <section className="hero-card">
          <div className="hero-copy">
            <span className="hero-kicker">当前项目</span>
            <div className="hero-title-row">
              <h2>{cockpit.projectName}</h2>
              <span className={`stage-chip ${cockpit.stageClass}`}>{cockpit.stageLabel}</span>
            </div>
            <p>{cockpit.attentionLine}</p>
          </div>
          <div className={`hero-readiness tone-${cockpit.deliverable.tone}`}>
            <span className={`readiness-chip tone-${cockpit.deliverable.tone}`}>
              {cockpit.deliverable.label}
            </span>
            <strong>{cockpit.deliverable.readinessScore}%</strong>
            <small>交付准备度</small>
          </div>
          <div className="hero-next-action">
            <span className="section-label">建议下一步</span>
            <strong>{cockpit.nextAction}</strong>
            <p>{cockpit.deliverable.note}</p>
          </div>
          <div className="hero-metrics">
            <Metric label="已采集字段" value={`${cockpit.capturedFieldCount}/9`} />
            <Metric label="待确认" value={`${cockpit.pendingFieldCount} 项`} />
            <Metric label="阻塞风险" value={`${cockpit.riskSummary.blockingCount} 条`} />
            <Metric label="资料依据" value={`${cockpit.evidenceSummary.totalHitCount} 条`} />
          </div>
        </section>

        <div className="cockpit-grid">
          <CockpitCompletenessCard cockpit={cockpit} />
          <DeliverableStatusCard cockpit={cockpit} asset={session.export_asset} />
          <RiskCard risks={session.triggered_risks} />
          <EvidenceOverviewCard cockpit={cockpit} hits={session.knowledge_hits} />
        </div>

        <div className="project-workbench-shell">
          <div className="project-workbench-main">
            <RequirementWorkbenchCard
              cockpit={cockpit}
              editingField={editingField}
              editingValue={editingValue}
              syncNotice={syncNotice}
              onStartEdit={onStartEdit}
              onEditValue={onEditValue}
              onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit}
            />
          </div>

          <ProjectActivityCard
            session={session}
            cockpit={cockpit}
            highlightFields={highlightFields}
            isProjectDetailLoading={isProjectDetailLoading}
            snapshotSync={cockpit.snapshotSync}
            input={input}
            isSending={isSending}
            onInput={onInput}
            onSend={onSend}
            onQuickReply={onQuickReply}
          />
        </div>
      </div>
    </section>
  );
}

function EmptyProjectState({
  projects,
  isSwitchingProject,
  projectDraftName,
  input,
  isCreatingProject,
  isSending,
  onProjectDraftNameChange,
  onInput,
  onQuickStart,
  onSelectProject
}: {
  projects: ProjectSummary[];
  isSwitchingProject: boolean;
  projectDraftName: string;
  input: string;
  isCreatingProject: boolean;
  isSending: boolean;
  onProjectDraftNameChange: (value: string) => void;
  onInput: (value: string) => void;
  onQuickStart: () => void | Promise<void>;
  onSelectProject: (project: ProjectSummary) => void | Promise<void>;
}) {
  const recentProjects = projects
    .filter((project) => !isInternalProjectName(project.project_name))
    .slice(0, 4);
  const visibleProjects = projects.filter((project) => !isInternalProjectName(project.project_name));
  const stageCounts = {
    intake: visibleProjects.filter((project) => project.stage === "intake").length,
    clarifying: visibleProjects.filter((project) => project.stage === "clarifying").length,
    ready: visibleProjects.filter((project) => project.stage === "solution_ready").length
  };

  return (
    <section className="empty-cockpit">
      <div className="empty-starter-grid">
        <section className="dash-card starter-card">
          <div className="card-heading">
            <div>
              <p>快速开工</p>
              <h3>先建项目，再录入客户原话</h3>
            </div>
          </div>
          <div className="starter-form">
            <div className="project-create starter-project-create">
              <input
                value={projectDraftName}
                onChange={(event) => onProjectDraftNameChange(event.target.value)}
                placeholder="项目名称，可留空自动生成"
              />
            </div>
            <textarea
              value={input}
              onChange={(event) => onInput(event.target.value)}
              placeholder="直接粘贴客户原话，例如：某医院机房改造，50平，3楼，UPS后备2小时，10个机柜，预算30万。"
            />
          </div>
          <div className="quick-replies compact starter-presets">
            {quickStartPresets.map((preset) => (
              <button key={preset} type="button" onClick={() => onInput(preset)}>
                {preset}
              </button>
            ))}
          </div>
          <div className="starter-actions">
            <button
              className="primary-action"
              type="button"
              onClick={() => void onQuickStart()}
              disabled={isCreatingProject || isSending}
            >
              {isCreatingProject || isSending ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
              {input.trim() ? "创建项目并开始整理" : "创建空白项目"}
            </button>
          </div>
        </section>

        <section className="dash-card empty-card overview-card">
          <div className="card-heading">
            <div>
              <p>项目漏斗</p>
              <h3>当前项目池</h3>
            </div>
          </div>
          <div className="project-context-grid pipeline-grid">
            <Metric label="全部项目" value={`${visibleProjects.length}个`} />
            <Metric label="摸底中" value={`${stageCounts.intake}个`} />
            <Metric label="待澄清" value={`${stageCounts.clarifying}个`} />
            <Metric label="方案就绪" value={`${stageCounts.ready}个`} />
          </div>
          <div className="empty-project-list project-inbox-list">
            {recentProjects.length === 0 ? (
              <div className="project-empty">
                <Building2 size={16} />
                <span>还没有近期项目，先从左侧或中间开工台创建一个。</span>
              </div>
            ) : (
              recentProjects.map((project) => (
                <button
                  key={project.project_id}
                  className="project-item"
                  onClick={() => void onSelectProject(project)}
                  disabled={isSwitchingProject}
                >
                  <Building2 size={16} />
                  <span className="project-item-body">
                    <strong>{project.project_name}</strong>
                    <small>
                      {projectStageLabel(project.stage)} · 最近更新 {formatTimestampLabel(project.updated_at)}
                    </small>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function EmptyOperationsState({ projectCount }: { projectCount: number }) {
  return (
    <div className="empty-operations">
      <section className="dash-card empty-card overview-card">
        <div className="card-heading">
          <div>
            <p>工作台看板</p>
            <h3>进入项目后显示实时状态</h3>
          </div>
        </div>
        <div className="project-context-grid pipeline-grid">
          <Metric label="当前项目数" value={`${projectCount}个`} />
          <Metric label="交付状态" value="待开始" />
          <Metric label="阻塞风险" value="待计算" />
        </div>
      </section>

      <section className="dash-card empty-card placeholder-card">
        <div className="card-heading">
          <div>
            <p>待显示模块</p>
            <h3>项目阶段、风险、依据、交付</h3>
          </div>
        </div>
        <div className="placeholder-board">
          <div className="placeholder-row">
            <strong>项目阶段</strong>
            <span>未选择项目</span>
          </div>
          <div className="placeholder-row">
            <strong>风险清单</strong>
            <span>等待计算</span>
          </div>
          <div className="placeholder-row">
            <strong>资料依据</strong>
            <span>等待命中</span>
          </div>
          <div className="placeholder-row">
            <strong>交付整理</strong>
            <span>等待开始</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function CockpitCompletenessCard({ cockpit }: { cockpit: PresalesCockpit }) {
  return (
    <section className="dash-card summary-card">
      <div className="card-heading">
        <div>
          <p>需求完整度</p>
          <h3>按售前工作语义分组</h3>
        </div>
      </div>
      <div className="completeness-list">
        {cockpit.completenessGroups.map((group) => (
          <article key={group.id} className="completeness-item">
            <div className="completeness-item-head">
              <div>
                <strong>{group.label}</strong>
                <span>{group.description}</span>
              </div>
              <b>
                {group.captured}/{group.total}
              </b>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${group.completion}%` }} />
            </div>
            <p className="completeness-note">
              {group.missing.length > 0
                ? `待补：${group.missing.join("、")}`
                : "这一组已经具备继续推进条件。"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function DeliverableStatusCard({ cockpit, asset }: { cockpit: PresalesCockpit; asset: ExportAsset | null }) {
  return (
    <section className={`dash-card delivery-card tone-${cockpit.deliverable.tone}`}>
      <div className="card-heading">
        <div>
          <p>交付状态</p>
          <h3>{cockpit.deliverable.label}</h3>
        </div>
        <Download size={20} />
      </div>
      <div className="delivery-score">
        <strong>{cockpit.deliverable.readinessScore}%</strong>
        <span>准备度</span>
      </div>
      <p className="delivery-note">{cockpit.deliverable.note}</p>
      {cockpit.deliverable.missingCoreLabels.length > 0 && (
        <div className="delivery-list">
          {cockpit.deliverable.missingCoreLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      )}
      {asset && (
        <p className="delivery-foot">
          最近文件：<strong>{asset.file_name}</strong>
        </p>
      )}
    </section>
  );
}

function EvidenceOverviewCard({ cockpit, hits }: { cockpit: PresalesCockpit; hits: KnowledgeHit[] }) {
  return (
    <section className="dash-card evidence-card">
      <div className="card-heading">
        <div>
          <p>依据与材料</p>
          <h3>当前方案不是空口生成</h3>
        </div>
        <span className="kb-count">{cockpit.evidenceSummary.totalHitCount} 条</span>
      </div>
      <div className="commercial-metrics">
        <Metric label="资料命中" value={`${cockpit.evidenceSummary.totalHitCount} 条`} />
        <Metric label="报价/BOQ" value={`${cockpit.evidenceSummary.commercialHitCount} 条`} />
        <Metric label="关键引用" value={`${Math.min(cockpit.evidenceSummary.topTitles.length, 3)} 条`} />
      </div>
      {hits.length > 0 ? (
        <div className="evidence-list">
          {cockpit.evidenceSummary.topTitles.map((title) => (
            <article key={title}>
              <strong>{title}</strong>
            </article>
          ))}
        </div>
      ) : (
        <p className="commercial-note">当前还没有资料命中，继续聊天或上传内部资料后这里会更新。</p>
      )}
    </section>
  );
}

function ProjectActivityCard({
  session,
  cockpit,
  highlightFields,
  isProjectDetailLoading,
  snapshotSync,
  input,
  isSending,
  onInput,
  onSend,
  onQuickReply
}: {
  session: SessionSnapshot;
  cockpit: PresalesCockpit;
  highlightFields: DashboardField[];
  isProjectDetailLoading: boolean;
  snapshotSync: PresalesCockpit["snapshotSync"];
  input: string;
  isSending: boolean;
  onInput: (value: string) => void;
  onSend: () => void;
  onQuickReply: (value: string) => void;
}) {
  const [showFullFeed, setShowFullFeed] = useState(false);
  const timelineSummary = [
    {
      label: "当前阶段",
      value: cockpit.stageLabel,
      note: cockpit.nextAction
    },
    {
      label: "当前重点",
      value:
        cockpit.deliverable.blockerIds.length > 0
          ? `先处理 ${cockpit.deliverable.blockerIds.length} 条阻塞项`
          : cockpit.deliverable.missingCoreLabels.length > 0
            ? cockpit.deliverable.missingCoreLabels.slice(0, 2).join(" / ")
            : "进入人工确认与方案整理",
      note:
        cockpit.deliverable.blockerIds.length > 0
          ? "风险未清前不建议直接进入正式交付。"
          : cockpit.deliverable.missingCoreLabels.length > 0
            ? "这些口径补齐后，工作台会继续提升交付准备度。"
            : "当前已具备继续细化配置和整理交付稿的条件。"
    },
    {
      label: "交付状态",
      value: cockpit.deliverable.label,
      note: snapshotSync.hasArchivedSnapshot
        ? `项目档案已同步 · ${formatTimestampLabel(snapshotSync.updatedAt)}`
        : "当前还没有形成可复用的归档快照。"
    }
  ];

  useEffect(() => {
    setShowFullFeed(false);
  }, [session.project?.project_id]);

  const visibleMessages = showFullFeed ? session.messages : session.messages.slice(-3);

  return (
    <section className="workspace-card project-activity-card">
      <div className="card-heading">
        <div>
          <p>项目时间线</p>
          <h3>线索、整理与确认记录</h3>
        </div>
        {session.messages.length > 3 && (
          <button
            className="feed-toggle"
            type="button"
            onClick={() => setShowFullFeed((current) => !current)}
          >
            {showFullFeed ? "收起时间线" : "展开全部"}
          </button>
        )}
      </div>

      <div className="activity-summary-grid">
        {timelineSummary.map((item) => (
          <article key={item.label} className="activity-summary-item">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.note}</small>
          </article>
        ))}
      </div>

      <div className="workspace-sync">
        <p className="project-overview-note">
          {isProjectDetailLoading ? (
            <Loader2 className="spin" size={14} />
          ) : snapshotSync.archivedSessionId ? (
            <Check size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          <span>
            {snapshotSync.hasArchivedSnapshot
              ? `项目档案已同步 · 最近更新 ${formatTimestampLabel(snapshotSync.updatedAt)}`
              : "补充客户线索后，项目档案会自动更新。"}
          </span>
        </p>

        {highlightFields.length > 0 ? (
          <ProjectSnapshotChips fields={highlightFields} compact />
        ) : (
          <p className="project-overview-empty">
            当前项目还没有形成可复用快照，先把客户原话、面积、楼层、UPS 或机柜线索发进来。
          </p>
        )}
      </div>

      <div className="activity-list">
        {visibleMessages.map((message) => (
          <article key={message.id} className={`activity-item ${message.sender}`}>
            <span className={`activity-dot ${message.sender}`} aria-hidden="true" />
            <div className="activity-body">
              <div className="activity-meta">
                <span className={`activity-tag ${message.sender}`}>
                  {message.sender === "ai" ? "系统整理" : "客户补充"}
                </span>
                <small>{formatTimestampLabel(message.timestamp)}</small>
              </div>
              <p>{message.text}</p>
            </div>
          </article>
        ))}
      </div>

      {session.quick_replies.length > 0 && (
        <div className="activity-actions">
          <span className="section-label">常用补充</span>
          <div className="quick-replies compact">
            {session.quick_replies.map((reply) => (
              <button key={reply} onClick={() => onQuickReply(reply)}>
                {reply}
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="chat-input-bar activity-input-bar">
        <input
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSend();
          }}
          placeholder="例如：新增 2 台机柜，预算上限 45 万，客户希望国产优先。"
        />
        <button className="send-button" onClick={onSend} disabled={isSending || !input.trim()}>
          {isSending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
          记录线索
        </button>
      </div>
    </section>
  );
}

function OperationsPanel({
  session,
  cockpit,
  projects,
  projectDetail,
  isProjectDetailLoading,
  isExporting,
  onExport
}: {
  session: SessionSnapshot;
  cockpit: PresalesCockpit;
  projects: ProjectSummary[];
  projectDetail: ProjectDetail | null;
  isProjectDetailLoading: boolean;
  isExporting: boolean;
  onExport: () => void;
}) {
  if (!cockpit.hasProject) {
    return (
      <aside className="operations-panel">
        <div className="operations-scroll">
          <EmptyOperationsState
            projectCount={projects.filter((project) => !isInternalProjectName(project.project_name)).length}
          />
        </div>

        <div className="action-zone passive">
          <div className="delivery-brief tone-attention">
            <strong>未进入项目</strong>
            <span>选择项目后开始整理</span>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="operations-panel">
      <div className="operations-scroll">
        <ProjectContextCard
          session={session}
          projectDetail={projectDetail}
          cockpit={cockpit}
          isLoading={isProjectDetailLoading}
        />
        <SuggestionCard suggestion={session.suggestion} />
        <KnowledgeCard hits={session.knowledge_hits} />
        <CommercialSummaryCard hits={session.knowledge_hits} />

        {session.export_asset && <ExportAssetCard asset={session.export_asset} />}
      </div>

      <div className="action-zone">
        <div className={`delivery-brief tone-${cockpit.deliverable.tone}`}>
          <strong>{cockpit.deliverable.label}</strong>
          <span>{cockpit.nextAction}</span>
        </div>
        <button className="export-button" onClick={onExport} disabled={isExporting}>
          {isExporting ? <Loader2 className="spin" size={20} /> : <Download size={20} />}
          整理交付稿
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

function RequirementWorkbenchCard({
  cockpit,
  editingField,
  editingValue,
  syncNotice,
  onStartEdit,
  onEditValue,
  onCommitEdit,
  onCancelEdit
}: {
  cockpit: PresalesCockpit;
  editingField: string | null;
  editingValue: string;
  syncNotice: string | null;
  onStartEdit: (field: DashboardField) => void;
  onEditValue: (value: string) => void;
  onCommitEdit: (field: DashboardField) => void;
  onCancelEdit: () => void;
}) {
  return (
    <section className="dash-card requirement-card">
      <div className="card-heading">
        <div>
          <p>需求工作区</p>
          <h3>关键字段与人工确认</h3>
        </div>
        {syncNotice && <span className="sync-chip">{syncNotice}</span>}
      </div>
      <div className="requirement-groups">
        {cockpit.completenessGroups.map((group) => (
          <section key={group.id} className="field-group">
            <div className="field-group-head">
              <div>
                <h4>{group.label}</h4>
                <p>{group.description}</p>
              </div>
              <span className="group-progress">
                {group.captured}/{group.total}
              </span>
            </div>
            <p className="field-group-missing">
              {group.missing.length > 0
                ? `待补：${group.missing.join("、")}`
                : "这一组已经具备推进条件，可继续做人工确认。"}
            </p>
            <div className="field-grid">
              {group.fields.map((field) => (
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
        ))}
      </div>
    </section>
  );
}

function ProjectContextCard({
  session,
  projectDetail,
  cockpit,
  isLoading
}: {
  session: SessionSnapshot;
  projectDetail: ProjectDetail | null;
  cockpit: PresalesCockpit;
  isLoading: boolean;
}) {
  if (!session.project) {
    return (
      <section className="dash-card quiet-card">
        <div className="quiet-state">
          <Building2 size={20} />
          <span>选择一个项目后，这里会汇总阶段、交付状态、风险数量和资料依据。</span>
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
          <p>项目档案</p>
          <h3>{session.project.project_name}</h3>
        </div>
        <span className={`stage-chip ${projectStageClass(session.project.stage)}`}>
          {projectStageLabel(session.project.stage)}
        </span>
      </div>
      <div className="project-context-grid">
        <Metric label="项目阶段" value={projectStageLabel(session.project.stage)} />
        <Metric label="交付状态" value={cockpit.deliverable.label} />
        <Metric label="风险数量" value={`${cockpit.riskSummary.total}条`} />
      </div>
      <div className="project-context-grid project-context-secondary">
        <Metric label="已采集字段" value={`${snapshotStats.captured}/${snapshotStats.total}`} />
        <Metric label="待确认" value={`${snapshotStats.pending}项`} />
        <Metric label="资料依据" value={`${cockpit.evidenceSummary.totalHitCount}条`} />
      </div>
      {highlightFields.length > 0 ? (
        <ProjectSnapshotChips fields={highlightFields} compact />
      ) : (
        <p className="project-context-note">
          {isLoading ? "正在读取项目快照..." : "当前项目还没有可展示的归档字段。"}
        </p>
      )}
      <p className="project-context-note">
        {isLoading
          ? "正在读取项目快照..."
          : isProjectSessionBound(session)
            ? "当前沟通、字段修正和交付整理都会同步到这个项目档案。"
            : "发出第一条客户线索后，这个项目会开始自动沉淀信息。"}
      </p>
      {hasArchivedSnapshot && projectDetail?.updated_at && (
        <p className="project-context-note">最近归档：{formatTimestampLabel(projectDetail.updated_at)}</p>
      )}
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
          <span>当前没有触发强制阻塞风险，可以继续推进项目。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="dash-card risk-card">
      <div className="card-heading">
        <div>
          <p>风险与确认项</p>
          <h3>当前需要盯住的事项</h3>
        </div>
        <AlertTriangle size={22} />
      </div>
      <div className="risk-list">
        {risks.map((risk) => (
          <article key={risk.id} className={`risk-item ${risk.level === "P0_BLOCKER" ? "blocker" : ""}`}>
            <strong>{risk.blocking ? "阻塞风险" : "重点确认项"}</strong>
            <span>{risk.text}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function KnowledgeCard({ hits }: { hits: KnowledgeHit[] }) {
  if (hits.length === 0) {
    return (
      <section className="dash-card quiet-card">
        <div className="quiet-state">
          <FileText size={20} />
          <span>继续聊天或上传资料后，这里会显示当前项目的引用依据。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="dash-card knowledge-card">
      <div className="card-heading">
        <div>
          <p>证据明细</p>
          <h3>当前项目引用到的资料</h3>
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
          <h3>报价与 BOQ 摘要</h3>
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

function formatWanRange(low: number | null | undefined, high: number | null | undefined) {
  if (!low || !high) return null;
  return `${Math.round(low / 10000)}-${Math.round(high / 10000)} 万`;
}

function calculationStatusLabel(status: "confirmed" | "provisional" | "blocked") {
  if (status === "confirmed") return "口径已确认";
  if (status === "blocked") return "缺关键口径";
  return "含暂估口径";
}

function SuggestionCard({ suggestion }: { suggestion: SessionSnapshot["suggestion"] }) {
  if (!suggestion) {
    return (
      <section className="dash-card quiet-card">
        <div className="quiet-state">
          <Calculator size={20} />
          <span>配置测算与造价估算将在规模口径确认后生成</span>
        </div>
      </section>
    );
  }

  const estimateRange = formatWanRange(suggestion.estimatedCostLowRmb, suggestion.estimatedCostHighRmb);

  return (
    <section className="dash-card suggestion-card">
      <div className="card-heading">
        <div>
          <p>测算建议</p>
          <h3>配置测算与造价参考</h3>
        </div>
        {suggestion.calculationStatus ? (
          <span className={`calc-status-chip calc-${suggestion.calculationStatus}`}>
            {calculationStatusLabel(suggestion.calculationStatus)}
          </span>
        ) : (
          suggestion.stale && (
            <span className="stale-chip">
              <RefreshCw size={13} />
              已重算
            </span>
          )
        )}
      </div>
      <div className="suggestion-grid">
        <Metric
          label="总IT负载"
          value={suggestion.totalItLoadKw ? `${suggestion.totalItLoadKw}kW` : "待测算"}
        />
        <Metric label="UPS容量" value={`${suggestion.upsCapacityKva}kVA`} />
        <Metric label="电池后备" value={`${suggestion.batteryRuntimeMinutes}分钟`} />
        <Metric
          label="精密空调"
          value={
            suggestion.coolingUnitCount
              ? `${suggestion.coolingModelKw}kW×${suggestion.coolingUnitCount}台`
              : `${suggestion.coolingModelKw}kW`
          }
        />
        <Metric label="冗余模式" value={suggestion.coolingRedundancy} />
        <Metric
          label="电池规模"
          value={suggestion.batteryCount ? `约${suggestion.batteryCount}只` : "待确认"}
        />
      </div>
      {estimateRange && (
        <div className="estimate-banner">
          <Calculator size={16} />
          <div>
            <strong>内部参考估算 {estimateRange}</strong>
            <small>
              含设备、施工与调试；预算安全线约{" "}
              {suggestion.estimatedBudgetFloorRmb
                ? `${Math.round(suggestion.estimatedBudgetFloorRmb / 10000)} 万`
                : "-"}
              。非正式报价。
            </small>
          </div>
        </div>
      )}
      <div className="notes-list">
        <p>{suggestion.pduNote}</p>
        <p>{suggestion.structuralNote}</p>
        {suggestion.batteryNote && <p>{suggestion.batteryNote}</p>}
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
          <p>交付文件</p>
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

function ExportReviewModal({
  request,
  authUser,
  isExporting,
  onClose,
  onPay,
  onPreview,
  onRedeemed
}: {
  request: PaymentRequiredError;
  authUser: PublicUser | null;
  isExporting: boolean;
  onClose: () => void;
  onPay: () => void;
  onPreview: () => void;
  onRedeemed: (user: PublicUser) => void;
}) {
  const [code, setCode] = useState("");
  const [redeemNotice, setRedeemNotice] = useState<string | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);

  const isCreditMode = request.billing_check.mode === "credit";
  const outOfCredits = request.billing_check.status === "no_credits";
  const adminBypass = Boolean(request.billing_check.admin_bypass);
  const balance = request.billing_check.credits_balance;

  async function redeemAndRetry() {
    if (isRedeeming || !code.trim()) return;
    setIsRedeeming(true);
    setRedeemNotice(null);
    try {
      const result = await postRedeem(code.trim());
      onRedeemed(result.user);
      setRedeemNotice(`已到账 ${result.credits_added} 份额度，正在生成正式稿...`);
      onPay();
    } catch (error) {
      setRedeemNotice(error instanceof Error ? error.message : "兑换失败，请核对激活码。");
    } finally {
      setIsRedeeming(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <div className="payment-modal">
        <button className="close-modal" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
        <span className="modal-kicker">正式整理流程</span>
        <h2 id="payment-title">{outOfCredits ? "导出额度不足" : "生成正式交付稿"}</h2>
        {outOfCredits ? (
          <>
            <p>
              当前账户剩余导出额度 <b>{balance ?? 0} 份</b>
              ，生成正式交付稿需要 1 份。请输入激活码兑换额度，或先生成免费预览稿核对内容。
            </p>
            <div className="redeem-row">
              <input
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void redeemAndRetry();
                }}
                placeholder="JF-XXXXX-XXXXX"
              />
              <button
                className="pay-button"
                onClick={() => void redeemAndRetry()}
                disabled={isRedeeming || isExporting}
              >
                {isRedeeming ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
                兑换并生成
              </button>
            </div>
            {redeemNotice && <p className="redeem-notice">{redeemNotice}</p>}
            <p className="modal-subnote">没有激活码？联系你的服务对接人获取（按导出份数计）。</p>
          </>
        ) : (
          <p>
            系统会把当前项目的需求、风险、测算结果、资料依据和价格占位整理成正式 Word 文档。
            {isCreditMode &&
              !adminBypass &&
              (typeof balance === "number"
                ? `本次将消耗 1 份导出额度（当前剩余 ${balance} 份）。`
                : "本次将消耗 1 份导出额度。")}
            {isCreditMode && adminBypass && "管理员账号生成正式稿不消耗额度。"}
            {authUser?.role === "admin" && !isCreditMode && ""}
          </p>
        )}
        <div className="modal-actions">
          {!outOfCredits && (
            <button className="pay-button" onClick={onPay} disabled={isExporting}>
              {isExporting ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
              确认生成正式稿
            </button>
          )}
          <button className="preview-button" onClick={onPreview} disabled={isExporting}>
            先看免费预览稿
          </button>
          <button className="ghost-button" onClick={onClose} disabled={isExporting}>
            暂时不用
          </button>
        </div>
      </div>
    </div>
  );
}
