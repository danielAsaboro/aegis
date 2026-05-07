use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── Node.js → Rust ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SessionMeta {
    pub id: String,
    pub first_msg: String,
    pub last_seen: String,
    pub msg_count: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MissionMeta {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
    #[serde(default, rename = "budgetUsd")]
    pub budget_usd: Option<f64>,
    #[serde(default, rename = "spentUsd")]
    pub spent_usd: f64,
    #[serde(default, rename = "perTxCapUsd")]
    pub per_tx_cap_usd: Option<f64>,
    #[serde(default, rename = "expiresAt")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Notification {
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default, rename = "missionId")]
    pub mission_id: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NodeEvent {
    Ready {
        model: String,
        models: Vec<String>,
        #[serde(default)]
        wallet: Option<String>,
        #[serde(default)]
        session_id: String,
    },
    ToolStart {
        #[serde(rename = "toolName")]
        tool_name: String,
        input: Option<Value>,
    },
    ToolFinish {
        #[serde(rename = "toolName")]
        tool_name: String,
        success: bool,
        #[serde(rename = "durationMs")]
        duration_ms: Option<u64>,
        #[serde(default, rename = "resultPreview")]
        result_preview: Option<String>,
    },
    ToolError {
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(rename = "errorMsg")]
        error_msg: String,
    },
    Response {
        text: String,
    },
    ApprovalRequest {
        #[serde(rename = "approvalId")]
        approval_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        args: Option<Value>,
    },
    Error {
        message: String,
    },
    SkillsList {
        skills: Vec<String>,
    },
    SessionsList {
        sessions: Vec<SessionMeta>,
    },
    SessionResumed {
        session_id: String,
    },
    Aborted,
    MissionList {
        missions: Vec<MissionMeta>,
    },
    MissionUpdate {
        #[serde(default)]
        mission: Option<MissionMeta>,
        #[serde(default, rename = "lastEvent")]
        last_event: Option<Value>,
    },
    Notification {
        #[serde(default)]
        level: String,
        #[serde(default)]
        title: String,
        #[serde(default)]
        body: String,
        #[serde(default, rename = "missionId")]
        mission_id: Option<String>,
        #[serde(default)]
        timestamp: Option<String>,
    },
    ExcursionRequest {
        #[serde(rename = "missionId")]
        mission_id: String,
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        proposal: Value,
    },
    Status {
        #[serde(default)]
        model: Option<String>,
        #[serde(default)]
        wallet: Option<String>,
        #[serde(default, rename = "startedAt")]
        started_at: Option<String>,
        #[serde(default)]
        missions: Vec<MissionMeta>,
    },
    Pong { #[serde(default)] ts: u64 },
    Bye,
    CommitMissionOk { mission: MissionMeta },
    PauseMissionOk { #[serde(rename = "missionId")] mission_id: String, status: String },
    ResumeMissionOk { #[serde(rename = "missionId")] mission_id: String, status: String },
    CancelMissionOk { #[serde(rename = "missionId")] mission_id: String, status: String },
    Execution {
        success: bool,
        #[serde(default)]
        result: Option<Value>,
    },
    StrategyDenied { #[serde(default)] reason: Option<String>, #[serde(default, rename = "missionId")] mission_id: Option<String> },
    StrategyExecuted { #[serde(default, rename = "missionId")] mission_id: Option<String>, #[serde(default, rename = "txHash")] tx_hash: Option<String> },
    StrategyFailed { #[serde(default, rename = "missionId")] mission_id: Option<String>, #[serde(default)] reason: Option<String> },
}

pub fn parse_node_event(line: &str) -> Option<NodeEvent> {
    serde_json::from_str(line).ok()
}

// ── Rust → Node.js ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TuiCommand {
    Message { text: String },
    Approval { #[serde(rename = "approvalId")] approval_id: String, approved: bool },
    Model { model: String },
    Reset,
    Quit,
    Abort,
    ListSkills,
    ListSessions,
    ResumeSession { session_id: String },
    // Mission control (only meaningful when attached to a daemon socket)
    ListMissions,
    PauseMission { #[serde(rename = "missionId")] mission_id: String },
    ResumeMission { #[serde(rename = "missionId")] mission_id: String },
    CancelMission { #[serde(rename = "missionId")] mission_id: String },
    Status,
    AckExcursion {
        #[serde(rename = "missionId")] mission_id: String,
        #[serde(rename = "toolCallId")] tool_call_id: String,
        approved: bool,
    },
}

pub fn encode_command(cmd: &TuiCommand) -> String {
    serde_json::to_string(cmd).unwrap_or_default()
}
