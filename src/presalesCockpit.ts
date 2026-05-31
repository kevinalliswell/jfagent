import type { DashboardField, ProjectDetail, ProjectStage, RiskFlag, SessionSnapshot } from "./types";

type CockpitTone = "blocked" | "attention" | "ready";

interface CockpitGroupDefinition {
  id: string;
  label: string;
  description: string;
  fieldCodes: string[];
}

export interface CockpitCompletenessGroup {
  id: string;
  label: string;
  description: string;
  fields: DashboardField[];
  captured: number;
  total: number;
  pending: number;
  completion: number;
  missing: string[];
}

export interface PresalesCockpit {
  hasProject: boolean;
  projectName: string;
  stageLabel: string;
  stageClass: string;
  capturedFieldCount: number;
  pendingFieldCount: number;
  nextAction: string;
  attentionLine: string;
  completenessGroups: CockpitCompletenessGroup[];
  riskSummary: {
    total: number;
    blockingCount: number;
    highPriorityCount: number;
    topRisks: RiskFlag[];
  };
  evidenceSummary: {
    totalHitCount: number;
    commercialHitCount: number;
    topTitles: string[];
    topFiles: string[];
  };
  deliverable: {
    tone: CockpitTone;
    label: string;
    note: string;
    readinessScore: number;
    missingCoreLabels: string[];
    blockerIds: string[];
  };
  snapshotSync: {
    archivedSessionId: string | null;
    updatedAt: string | null;
    hasArchivedSnapshot: boolean;
  };
}

const cockpitGroups: CockpitGroupDefinition[] = [
  {
    id: "project_basics",
    label: "基础项目口径",
    description: "先确定谁的项目、是什么类型、面向什么行业。",
    fieldCodes: ["customer_name", "customer_industry", "project_type"]
  },
  {
    id: "engineering_scale",
    label: "规模与现场条件",
    description: "面积、楼层、机柜规模决定方案级别和施工边界。",
    fieldCodes: ["room_area_m2", "room_floor", "rack_count"]
  },
  {
    id: "delivery_constraints",
    label: "约束与交付条件",
    description: "后备时间、品牌偏好、预算决定交付路径与方案取舍。",
    fieldCodes: ["ups_backup_time_minutes", "brand_preference", "budget_range_high_rmb"]
  }
];

const coreDeliverableFieldCodes = [
  "customer_name",
  "project_type",
  "room_area_m2",
  "rack_count",
  "ups_backup_time_minutes"
];

function hasFieldValue(field: DashboardField | undefined) {
  return field !== undefined && field.value !== null && String(field.value).trim() !== "";
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

function groupFields(fields: SessionSnapshot["dashboard_fields"]) {
  return cockpitGroups.map((group) => {
    const groupFields = group.fieldCodes
      .map((fieldCode) => fields[fieldCode])
      .filter((field): field is DashboardField => Boolean(field));
    const captured = groupFields.filter((field) => hasFieldValue(field)).length;
    const pending = groupFields.filter((field) => field.needs_confirmation).length;
    const missing = groupFields.filter((field) => !hasFieldValue(field)).map((field) => field.label);

    return {
      id: group.id,
      label: group.label,
      description: group.description,
      fields: groupFields,
      captured,
      total: groupFields.length,
      pending,
      completion: groupFields.length ? Math.round((captured / groupFields.length) * 100) : 0,
      missing
    } satisfies CockpitCompletenessGroup;
  });
}

function buildNextAction(args: {
  hasProject: boolean;
  blockingCount: number;
  missingCoreCount: number;
  hasSuggestion: boolean;
  hasEvidence: boolean;
  exportStatus: SessionSnapshot["export_status"];
}) {
  if (!args.hasProject) return "先创建或选择项目，再录入客户原话。";
  if (args.blockingCount > 0) return "先清掉阻塞风险，再决定是否进入正式交付整理。";
  if (args.missingCoreCount > 0) return "先补齐核心工程口径，再推进方案整理。";
  if (!args.hasSuggestion || !args.hasEvidence) return "补充方案依据和配置建议，再形成可交付初稿。";
  if (args.exportStatus === "exported") return "交付稿已形成，建议立刻安排内部复核与对外发送。";
  if (args.exportStatus === "ready") return "可以整理交付稿，并安排内部复核。";
  return "继续补充细节，即可进入正式交付整理。";
}

function buildDeliverable(args: {
  hasProject: boolean;
  blockingRisks: RiskFlag[];
  missingCoreLabels: string[];
  hasSuggestion: boolean;
  hasEvidence: boolean;
  exportStatus: SessionSnapshot["export_status"];
  capturedFieldCount: number;
  totalFieldCount: number;
}) {
  if (!args.hasProject) {
    return {
      tone: "blocked" as CockpitTone,
      label: "待进入项目",
      note: "当前还没有项目上下文，先选项目再推进需求整理。",
      readinessScore: 0,
      missingCoreLabels: args.missingCoreLabels,
      blockerIds: []
    };
  }

  if (args.blockingRisks.length > 0) {
    return {
      tone: "blocked" as CockpitTone,
      label: "阻塞待清",
      note: `存在 ${args.blockingRisks.length} 条阻塞风险，正式交付前必须先确认。`,
      readinessScore: Math.max(12, 40 - args.blockingRisks.length * 10),
      missingCoreLabels: args.missingCoreLabels,
      blockerIds: args.blockingRisks.map((risk) => risk.id)
    };
  }

  if (args.missingCoreLabels.length > 0) {
    return {
      tone: "attention" as CockpitTone,
      label: "核心口径未齐",
      note: `仍缺 ${args.missingCoreLabels.join("、")}，建议先补齐再整理正式稿。`,
      readinessScore: Math.max(35, 68 - args.missingCoreLabels.length * 8),
      missingCoreLabels: args.missingCoreLabels,
      blockerIds: []
    };
  }

  const baseScore = Math.round((args.capturedFieldCount / Math.max(args.totalFieldCount, 1)) * 100);
  const evidenceBonus = args.hasEvidence ? 10 : 0;
  const suggestionBonus = args.hasSuggestion ? 10 : 0;
  const readinessScore = Math.min(100, baseScore + evidenceBonus + suggestionBonus);

  if (args.exportStatus === "exported") {
    return {
      tone: "ready" as CockpitTone,
      label: "交付稿已生成",
      note: "本轮已生成交付文件，建议继续做内部复核和版本整理。",
      readinessScore,
      missingCoreLabels: [],
      blockerIds: []
    };
  }

  if (args.hasEvidence && args.hasSuggestion) {
    return {
      tone: "ready" as CockpitTone,
      label: "可整理交付稿",
      note: "核心需求、方案建议与资料依据已经齐备，可以进入正式整理。",
      readinessScore,
      missingCoreLabels: [],
      blockerIds: []
    };
  }

  return {
    tone: "attention" as CockpitTone,
    label: "可整理初稿",
    note: "已经具备基本整理条件，但最好再补一轮依据或配置建议。",
    readinessScore: Math.max(60, readinessScore),
    missingCoreLabels: [],
    blockerIds: []
  };
}

export function buildPresalesCockpit(
  session: SessionSnapshot,
  projectDetail: ProjectDetail | null = null
): PresalesCockpit {
  const completenessGroups = groupFields(session.dashboard_fields);
  const allFields = completenessGroups.flatMap((group) => group.fields);
  const capturedFieldCount = allFields.filter((field) => hasFieldValue(field)).length;
  const pendingFieldCount = allFields.filter((field) => field.needs_confirmation).length;
  const blockingRisks = session.triggered_risks.filter(
    (risk) => risk.blocking || risk.level === "P0_BLOCKER"
  );
  const highPriorityRisks = session.triggered_risks.filter(
    (risk) => risk.level === "P0_BLOCKER" || risk.level === "P1_HIGH"
  );
  const evidenceSummary = {
    totalHitCount: session.knowledge_hits.length,
    commercialHitCount: session.knowledge_hits.filter(
      (hit) => hit.source_type === "quotation" || hit.source_type === "boq"
    ).length,
    topTitles: session.knowledge_hits.slice(0, 3).map((hit) => hit.title),
    topFiles: Array.from(
      new Set(
        session.knowledge_hits
          .map((hit) => hit.source_file)
          .filter((value): value is string => Boolean(value))
      )
    ).slice(0, 3)
  };
  const missingCoreLabels = coreDeliverableFieldCodes
    .map((fieldCode) => session.dashboard_fields[fieldCode])
    .filter((field): field is DashboardField => Boolean(field))
    .filter((field) => !hasFieldValue(field))
    .map((field) => field.label);
  const hasProject = Boolean(session.project);
  const deliverable = buildDeliverable({
    hasProject,
    blockingRisks,
    missingCoreLabels,
    hasSuggestion: Boolean(session.suggestion),
    hasEvidence: evidenceSummary.totalHitCount > 0,
    exportStatus: session.export_status,
    capturedFieldCount,
    totalFieldCount: allFields.length
  });
  const snapshotFields =
    projectDetail?.dashboard_snapshot && Object.keys(projectDetail.dashboard_snapshot).length > 0
      ? Object.values(projectDetail.dashboard_snapshot)
      : [];

  return {
    hasProject,
    projectName: session.project?.project_name ?? "未选择项目",
    stageLabel: session.project ? projectStageLabel(session.project.stage) : "待进入项目",
    stageClass: session.project ? projectStageClass(session.project.stage) : "stage-intake",
    capturedFieldCount,
    pendingFieldCount,
    nextAction: buildNextAction({
      hasProject,
      blockingCount: blockingRisks.length,
      missingCoreCount: missingCoreLabels.length,
      hasSuggestion: Boolean(session.suggestion),
      hasEvidence: evidenceSummary.totalHitCount > 0,
      exportStatus: session.export_status
    }),
    attentionLine: hasProject ? deliverable.note : "项目、聊天、看板修正和导出会围绕同一个项目档案推进。",
    completenessGroups,
    riskSummary: {
      total: session.triggered_risks.length,
      blockingCount: blockingRisks.length,
      highPriorityCount: highPriorityRisks.length,
      topRisks: session.triggered_risks.slice(0, 3)
    },
    evidenceSummary,
    deliverable,
    snapshotSync: {
      archivedSessionId: projectDetail?.primary_session_id ?? null,
      updatedAt: projectDetail?.updated_at ?? null,
      hasArchivedSnapshot: snapshotFields.some((field) => hasFieldValue(field))
    }
  };
}

export { cockpitGroups, projectStageClass, projectStageLabel };
