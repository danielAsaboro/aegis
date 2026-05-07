use serde_json::Value;
use std::time::Instant;
use crate::ipc::{NodeEvent, TuiCommand, SessionMeta, MissionMeta, Notification};

pub const SPINNER: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

#[derive(Debug, Clone)]
pub enum ChatLine {
    User(String),
    AgentText(String),
    ToolStart { name: String, input_preview: Option<String> },
    ToolDone { name: String, success: bool, duration_ms: Option<u64>, input_preview: Option<String>, result_preview: Option<String> },
    ToolError { name: String, msg: String, input_preview: Option<String> },
    Note(String),
    Divider,
}

#[derive(Debug, Clone)]
pub struct ApprovalRequest {
    pub approval_id: String,
    pub tool_name: String,
    pub args: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AppStatus {
    Loading,
    Idle,
    Thinking,
    WaitingApproval,
}

pub struct Toast {
    pub text: String,
    pub expires_at: Instant,
}

pub struct App {
    pub messages: Vec<ChatLine>,
    pub input: String,
    pub cursor_pos: usize,
    pub scroll: usize,
    pub pinned: bool,
    pub status: AppStatus,
    pub model: String,
    pub models: Vec<String>,
    pub wallet: Option<String>,
    pub pending_approval: Option<ApprovalRequest>,
    pub approval_scroll: usize,
    pub spinner_tick: usize,
    pub approval_focused: bool,
    pub history: Vec<String>,
    pub history_idx: Option<usize>,
    history_stash: String,
    // Phase 2
    pub completions: Vec<String>,
    pub completion_idx: Option<usize>,
    pub focus_mode: bool,
    pub focus_nav_idx: usize,
    pub session_id: String,
    pub session_list: Vec<SessionMeta>,
    last_esc_at: Option<Instant>,
    // Phase 3 — UX overhaul
    pub unread_count: usize,
    pub last_event_at: Instant,
    pub last_tool_done: Option<String>,
    pub clear_armed: bool,
    pub show_timestamps: bool,
    pub toast: Option<Toast>,
    pub last_user_msg: Option<String>,
    // Mission control + notifications (populated when attached to daemon)
    pub missions: Vec<MissionMeta>,
    pub notifications: Vec<Notification>,
    pub unread_notifications: usize,
}

impl App {
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            input: String::new(),
            cursor_pos: 0,
            scroll: 0,
            pinned: true,
            status: AppStatus::Loading,
            model: String::from("…"),
            models: Vec::new(),
            wallet: None,
            pending_approval: None,
            approval_scroll: 0,
            spinner_tick: 0,
            approval_focused: false,
            history: Vec::new(),
            history_idx: None,
            history_stash: String::new(),
            completions: Vec::new(),
            completion_idx: None,
            focus_mode: false,
            focus_nav_idx: 0,
            session_id: String::new(),
            session_list: Vec::new(),
            last_esc_at: None,
            unread_count: 0,
            last_event_at: Instant::now(),
            last_tool_done: None,
            clear_armed: false,
            show_timestamps: false,
            toast: None,
            last_user_msg: None,
            missions: Vec::new(),
            notifications: Vec::new(),
            unread_notifications: 0,
        }
    }

    /// Replace or insert a mission in the local cache. Returns true if the
    /// existing row was mutated in place (vs. appended).
    pub fn upsert_mission(&mut self, m: MissionMeta) -> bool {
        if let Some(existing) = self.missions.iter_mut().find(|x| x.id == m.id) {
            *existing = m;
            true
        } else {
            self.missions.push(m);
            false
        }
    }

    pub fn active_missions(&self) -> Vec<&MissionMeta> {
        self.missions.iter().filter(|m| m.status == "active").collect()
    }

    pub fn clear_unread_notifications(&mut self) {
        self.unread_notifications = 0;
    }

    fn note_event(&mut self) {
        self.last_event_at = Instant::now();
    }

    fn note_new_message(&mut self) {
        if !self.pinned {
            self.unread_count += 1;
        }
    }

    pub fn handle_node_event(&mut self, event: NodeEvent) {
        self.note_event();
        match event {
            NodeEvent::Ready { model, models, wallet, session_id } => {
                self.model = model;
                self.models = models;
                self.wallet = wallet;
                self.session_id = session_id;
                self.status = AppStatus::Idle;
            }
            NodeEvent::ToolStart { tool_name, input } => {
                self.status = AppStatus::Thinking;
                let preview = input.and_then(|v| format_tool_input(&v));
                self.messages.push(ChatLine::ToolStart { name: tool_name, input_preview: preview });
                self.note_new_message();
                self.scroll_to_bottom();
            }
            NodeEvent::ToolFinish { tool_name, success, duration_ms, result_preview } => {
                let replaced = self.replace_tool_start(&tool_name, success, duration_ms, result_preview.clone());
                if !replaced {
                    self.messages.push(ChatLine::ToolDone {
                        name: tool_name.clone(),
                        success,
                        duration_ms,
                        input_preview: None,
                        result_preview,
                    });
                }
                // A2: keep status Thinking. Tool boundaries are NOT turn boundaries.
                self.last_tool_done = Some(tool_name);
                self.note_new_message();
                self.scroll_to_bottom();
            }
            NodeEvent::ToolError { tool_name, error_msg } => {
                let replaced = self.replace_tool_start_with_error(&tool_name, &error_msg);
                if !replaced {
                    self.messages.push(ChatLine::ToolError {
                        name: tool_name.clone(),
                        msg: error_msg,
                        input_preview: None,
                    });
                }
                // A2: keep status Thinking until Response/ApprovalRequest/Error/Aborted.
                self.last_tool_done = Some(tool_name);
                self.note_new_message();
                self.scroll_to_bottom();
            }
            NodeEvent::Response { text } => {
                self.messages.push(ChatLine::AgentText(text));
                self.status = AppStatus::Idle;
                self.last_tool_done = None;
                self.note_new_message();
                self.scroll_to_bottom();
            }
            NodeEvent::ApprovalRequest { approval_id, tool_name, args } => {
                self.pending_approval = Some(ApprovalRequest { approval_id, tool_name, args });
                self.approval_scroll = 0;
                self.status = AppStatus::WaitingApproval;
                self.approval_focused = true;
                self.scroll_to_bottom();
            }
            NodeEvent::Error { message } => {
                self.messages.push(ChatLine::AgentText(format!("error: {}", message)));
                self.status = AppStatus::Idle;
                self.last_tool_done = None;
                self.note_new_message();
                self.scroll_to_bottom();
            }
            NodeEvent::SkillsList { skills } => {
                let text = if skills.is_empty() {
                    "No skills found. Drop a folder with SKILL.md into .agents/skills/ or ~/.config/aegis/skills/".to_string()
                } else {
                    skills.iter().map(|s| format!("• {}", s)).collect::<Vec<_>>().join("\n")
                };
                self.messages.push(ChatLine::AgentText(text));
                self.pinned = true;
                self.scroll_to_bottom();
            }
            NodeEvent::SessionsList { sessions } => {
                let lines = sessions.iter().enumerate()
                    .map(|(i, s)| format!("  {:>2}  {:<18}  {}", i + 1, s.last_seen, s.first_msg))
                    .collect::<Vec<_>>();
                let header = "   #  when               first message";
                let footer = "\n  :resume <n>  to load a session";
                let text = format!("{}\n{}\n{}", header, lines.join("\n"), footer);
                self.messages.push(ChatLine::AgentText(text));
                self.session_list = sessions;
                self.pinned = true;
                self.scroll_to_bottom();
            }
            NodeEvent::Aborted => {
                self.status = AppStatus::Idle;
                self.last_tool_done = None;
            }
            NodeEvent::SessionResumed { session_id } => {
                self.session_id = session_id.clone();
                self.messages.push(ChatLine::Divider);
                self.messages.push(ChatLine::AgentText(format!("Resumed session {}", &session_id)));
                self.pinned = true;
                self.scroll_to_bottom();
            }
            NodeEvent::MissionList { missions } => {
                self.missions = missions;
            }
            NodeEvent::MissionUpdate { mission, .. } => {
                if let Some(m) = mission {
                    self.upsert_mission(m);
                }
            }
            NodeEvent::Notification { level, title, body, mission_id, timestamp } => {
                let n = Notification { level, title, body, mission_id, timestamp };
                self.notifications.push(n);
                self.unread_notifications = self.unread_notifications.saturating_add(1);
                // Cap inbox at 200 entries.
                if self.notifications.len() > 200 {
                    let drop = self.notifications.len() - 200;
                    self.notifications.drain(..drop);
                }
            }
            NodeEvent::ExcursionRequest { mission_id, tool_call_id, proposal } => {
                let summary = serde_json::to_string(&proposal).unwrap_or_else(|_| "<proposal>".into());
                self.messages.push(ChatLine::Note(format!(
                    "🚨 Excursion request — mission {} call {}: {}",
                    mission_id, tool_call_id, summary
                )));
                self.pending_approval = Some(ApprovalRequest {
                    approval_id: tool_call_id,
                    tool_name: format!("excursion:{}", mission_id),
                    args: Some(proposal),
                });
                self.status = AppStatus::WaitingApproval;
                self.approval_focused = true;
                self.scroll_to_bottom();
            }
            NodeEvent::Status { model, wallet, missions, .. } => {
                if let Some(m) = model { self.model = m; }
                if let Some(w) = wallet { self.wallet = Some(w); }
                self.missions = missions;
            }
            NodeEvent::CommitMissionOk { mission } => {
                self.upsert_mission(mission);
            }
            NodeEvent::PauseMissionOk { mission_id, status }
            | NodeEvent::ResumeMissionOk { mission_id, status }
            | NodeEvent::CancelMissionOk { mission_id, status } => {
                if let Some(m) = self.missions.iter_mut().find(|x| x.id == mission_id) {
                    m.status = status;
                }
            }
            NodeEvent::Pong { .. } | NodeEvent::Bye => {}
            NodeEvent::Execution { .. }
            | NodeEvent::StrategyDenied { .. }
            | NodeEvent::StrategyExecuted { .. }
            | NodeEvent::StrategyFailed { .. } => {
                // Surfaced through Notification when the daemon notifies.
            }
        }
    }

    pub fn backend_died(&mut self) {
        self.messages.push(ChatLine::AgentText("⚠ backend disconnected".into()));
        self.status = AppStatus::Idle;
        self.pinned = true;
        self.scroll_to_bottom();
    }

    pub fn tick_spinner(&mut self) {
        self.spinner_tick = (self.spinner_tick + 1) % SPINNER.len();
        // Toast auto-expires
        if let Some(t) = &self.toast {
            if Instant::now() >= t.expires_at {
                self.toast = None;
            }
        }
    }

    /// Returns true if we've been in `Thinking` with no events for >5s.
    pub fn is_stalled(&self) -> bool {
        self.status == AppStatus::Thinking
            && self.last_event_at.elapsed().as_secs() >= 5
    }

    pub fn scroll_up(&mut self, n: usize) {
        self.scroll = self.scroll.saturating_sub(n);
        self.pinned = false;
    }

    pub fn scroll_down(&mut self, n: usize) {
        self.scroll = self.scroll.saturating_add(n);
    }

    pub fn scroll_to_bottom(&mut self) {
        if self.pinned {
            self.scroll = usize::MAX;
        }
    }

    pub fn on_scroll_clamped(&mut self, max_scroll: usize) {
        if self.scroll >= max_scroll {
            self.scroll = max_scroll;
            if !self.pinned {
                self.pinned = true;
                self.unread_count = 0;
            }
        }
    }

    #[cfg(test)]
    fn mock_mission(id: &str, status: &str) -> MissionMeta {
        MissionMeta {
            id: id.to_string(),
            title: format!("mission {id}"),
            kind: "agent".to_string(),
            status: status.to_string(),
            budget_usd: Some(100.0),
            spent_usd: 0.0,
            per_tx_cap_usd: Some(10.0),
            expires_at: None,
        }
    }

    fn show_toast(&mut self, text: impl Into<String>) {
        self.toast = Some(Toast {
            text: text.into(),
            expires_at: Instant::now() + std::time::Duration::from_secs(1),
        });
    }

    // ── Focus mode ───────────────────────────────────────────────────────────

    pub fn navigable_indices(&self) -> Vec<usize> {
        self.messages.iter().enumerate()
            .filter(|(_, m)| matches!(m, ChatLine::AgentText(_) | ChatLine::User(_)))
            .map(|(i, _)| i)
            .collect()
    }

    fn copy_focused_to_clipboard(&mut self) -> bool {
        let navs = self.navigable_indices();
        if let Some(&msg_idx) = navs.get(self.focus_nav_idx) {
            let text = match self.messages.get(msg_idx) {
                Some(ChatLine::AgentText(t)) => Some(t.clone()),
                Some(ChatLine::User(t)) => Some(t.clone()),
                _ => None,
            };
            if let Some(t) = text {
                if let Ok(mut cb) = arboard::Clipboard::new() {
                    if cb.set_text(t).is_ok() {
                        self.show_toast("copied");
                        return true;
                    }
                }
            }
        }
        false
    }

    // ── Mouse ────────────────────────────────────────────────────────────────

    pub fn on_mouse(&mut self, ev: crossterm::event::MouseEvent) {
        use crossterm::event::MouseEventKind;
        match ev.kind {
            MouseEventKind::ScrollUp => self.scroll_up(3),
            MouseEventKind::ScrollDown => self.scroll_down(3),
            _ => {}
        }
    }

    // ── Paste ────────────────────────────────────────────────────────────────

    pub fn on_paste(&mut self, text: String) {
        // Insert at cursor; preserve newlines for multiline input.
        for ch in text.chars() {
            // Skip carriage returns; keep newlines.
            if ch == '\r' { continue; }
            self.input.insert(self.cursor_pos, ch);
            self.cursor_pos += ch.len_utf8();
        }
    }

    // ── Completion helpers ───────────────────────────────────────────────────

    fn clear_completions(&mut self) {
        self.completions.clear();
        self.completion_idx = None;
    }

    fn compute_completions(&self) -> Vec<String> {
        const ALL_COMMANDS: &[&str] = &[
            ":clear", ":copy", ":help", ":inbox", ":missions",
            ":model ", ":models", ":pause-mission ", ":q", ":quit",
            ":reset", ":resume ", ":resume-mission ", ":cancel-mission ",
            ":retry", ":sessions", ":settings", ":skills", ":timestamps",
        ];

        let input = &self.input;

        if let Some(partial) = input.strip_prefix(":model ") {
            return self.models.iter()
                .filter(|m| m.starts_with(partial))
                .map(|m| format!(":model {}", m))
                .collect();
        }

        if input.starts_with(":resume ") {
            return self.session_list.iter().enumerate()
                .map(|(i, _)| format!(":resume {}", i + 1))
                .collect();
        }

        ALL_COMMANDS.iter()
            .filter(|cmd| cmd.starts_with(input.as_str()))
            .map(|cmd| cmd.to_string())
            .collect()
    }

    // ── Cursor helpers ───────────────────────────────────────────────────────

    fn cursor_move_left(&mut self) {
        if self.cursor_pos > 0 {
            let prev = self.input[..self.cursor_pos]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
            self.cursor_pos = prev;
        }
    }

    fn cursor_move_right(&mut self) {
        if self.cursor_pos < self.input.len() {
            let ch = self.input[self.cursor_pos..].chars().next().unwrap();
            self.cursor_pos += ch.len_utf8();
        }
    }

    fn is_word_char(c: char) -> bool {
        c.is_alphanumeric() || c == '_'
    }

    fn word_left(&self) -> usize {
        if self.cursor_pos == 0 { return 0; }
        let s = &self.input[..self.cursor_pos];
        let mut chars: Vec<(usize, char)> = s.char_indices().collect();
        // Skip trailing whitespace/punct
        while let Some(&(_, c)) = chars.last() {
            if !Self::is_word_char(c) { chars.pop(); } else { break; }
        }
        // Skip word chars
        while let Some(&(_, c)) = chars.last() {
            if Self::is_word_char(c) { chars.pop(); } else { break; }
        }
        chars.last().map(|&(i, c)| i + c.len_utf8()).unwrap_or(0)
    }

    fn word_right(&self) -> usize {
        if self.cursor_pos >= self.input.len() { return self.input.len(); }
        let s = &self.input[self.cursor_pos..];
        let mut iter = s.char_indices().peekable();
        // Skip leading non-word chars
        while let Some(&(_, c)) = iter.peek() {
            if !Self::is_word_char(c) { iter.next(); } else { break; }
        }
        // Skip word chars
        while let Some(&(_, c)) = iter.peek() {
            if Self::is_word_char(c) { iter.next(); } else { break; }
        }
        let offset = iter.peek().map(|&(i, _)| i).unwrap_or(s.len());
        self.cursor_pos + offset
    }

    fn delete_word_left(&mut self) {
        let end = self.cursor_pos;
        let start = self.word_left();
        if start < end {
            self.input.drain(start..end);
            self.cursor_pos = start;
        }
    }

    fn delete_to_line_start(&mut self) {
        // Delete to start of current line (within multiline input).
        let s = &self.input[..self.cursor_pos];
        let line_start = s.rfind('\n').map(|i| i + 1).unwrap_or(0);
        if line_start < self.cursor_pos {
            self.input.drain(line_start..self.cursor_pos);
            self.cursor_pos = line_start;
        }
    }

    fn delete_to_line_end(&mut self) {
        let s = &self.input[self.cursor_pos..];
        let line_end_rel = s.find('\n').unwrap_or(s.len());
        let end = self.cursor_pos + line_end_rel;
        if end > self.cursor_pos {
            self.input.drain(self.cursor_pos..end);
        }
    }

    // ── History helpers ──────────────────────────────────────────────────────

    fn history_up(&mut self) {
        if self.history.is_empty() {
            return;
        }
        match self.history_idx {
            None => {
                self.history_stash = self.input.clone();
                let idx = self.history.len() - 1;
                self.history_idx = Some(idx);
                self.input = self.history[idx].clone();
                self.cursor_pos = self.input.len();
            }
            Some(0) => {}
            Some(n) => {
                let idx = n - 1;
                self.history_idx = Some(idx);
                self.input = self.history[idx].clone();
                self.cursor_pos = self.input.len();
            }
        }
    }

    fn history_down(&mut self) {
        match self.history_idx {
            None => {}
            Some(n) if n + 1 >= self.history.len() => {
                self.history_idx = None;
                self.input = self.history_stash.clone();
                self.cursor_pos = self.input.len();
                self.history_stash.clear();
            }
            Some(n) => {
                let idx = n + 1;
                self.history_idx = Some(idx);
                self.input = self.history[idx].clone();
                self.cursor_pos = self.input.len();
            }
        }
    }

    // ── Submit ───────────────────────────────────────────────────────────────

    fn submit_message(&mut self, text: String) -> Option<TuiCommand> {
        self.history.push(text.clone());
        self.last_user_msg = Some(text.clone());
        self.messages.push(ChatLine::User(text.clone()));
        self.status = AppStatus::Thinking;
        self.last_tool_done = None;
        self.last_event_at = Instant::now();
        self.pinned = true;
        self.unread_count = 0;
        self.scroll_to_bottom();
        Some(TuiCommand::Message { text })
    }

    // ── Key handler ──────────────────────────────────────────────────────────

    /// Returns (optional command to send, should_quit).
    pub fn on_key(&mut self, key: crossterm::event::KeyEvent) -> (Option<TuiCommand>, bool) {
        use crossterm::event::{KeyCode, KeyModifiers};

        // Clear completions on any key except Tab
        if key.code != KeyCode::Tab {
            self.clear_completions();
        }

        // `:clear` arming resets on any key that isn't another Enter of `:clear!`.
        // (Handled inline in Enter path.)

        // Double-Esc: clear the input box (second Esc within 500 ms)
        if key.code == KeyCode::Esc {
            let now = Instant::now();
            if self.last_esc_at
                .map_or(false, |t| now.duration_since(t).as_millis() < 500)
            {
                self.input.clear();
                self.cursor_pos = 0;
                self.focus_mode = false;
                self.last_esc_at = None;
                return (None, false);
            }
            self.last_esc_at = Some(now);
        } else {
            self.last_esc_at = None;
        }

        // Approval panel navigation (handled first, Esc here = deny)
        if self.approval_focused && self.pending_approval.is_some() {
            match key.code {
                KeyCode::Char('y') | KeyCode::Char('Y') => {
                    let req = self.pending_approval.take().unwrap();
                    self.approval_focused = false;
                    self.status = AppStatus::Thinking;
                    self.last_event_at = Instant::now();
                    return (Some(TuiCommand::Approval { approval_id: req.approval_id, approved: true }), false);
                }
                KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
                    let req = self.pending_approval.take().unwrap();
                    let tool_name = req.tool_name.clone();
                    self.approval_focused = false;
                    self.status = AppStatus::Idle;
                    self.messages.push(ChatLine::Note(format!("declined approval for {}", tool_name)));
                    self.scroll_to_bottom();
                    return (Some(TuiCommand::Approval { approval_id: req.approval_id, approved: false }), false);
                }
                KeyCode::Up => {
                    self.approval_scroll = self.approval_scroll.saturating_sub(1);
                    return (None, false);
                }
                KeyCode::Down => {
                    self.approval_scroll = self.approval_scroll.saturating_add(1);
                    return (None, false);
                }
                _ => return (None, false),
            }
        }

        // Focus mode: intercept navigation keys
        if self.focus_mode {
            match key.code {
                KeyCode::Esc => {
                    self.focus_mode = false;
                    return (None, false);
                }
                KeyCode::Up => {
                    self.focus_nav_idx = self.focus_nav_idx.saturating_sub(1);
                    return (None, false);
                }
                KeyCode::Down => {
                    let navs = self.navigable_indices();
                    self.focus_nav_idx = (self.focus_nav_idx + 1)
                        .min(navs.len().saturating_sub(1));
                    return (None, false);
                }
                KeyCode::Enter | KeyCode::Char('c') | KeyCode::Char('C') => {
                    self.copy_focused_to_clipboard();
                    self.focus_mode = false;
                    return (None, false);
                }
                _ => {
                    self.focus_mode = false;
                    // fall through to normal handling
                }
            }
        }

        match key.code {
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                return (Some(TuiCommand::Quit), true);
            }

            // Ctrl+V — explicit paste from clipboard for terminals without bracketed paste
            KeyCode::Char('v') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                if let Ok(mut cb) = arboard::Clipboard::new() {
                    if let Ok(text) = cb.get_text() {
                        self.on_paste(text);
                    }
                }
            }

            // Ctrl+W — delete previous word
            KeyCode::Char('w') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.delete_word_left();
            }

            // Ctrl+U — delete to start of line
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.delete_to_line_start();
            }

            // Ctrl+K — delete to end of line
            KeyCode::Char('k') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.delete_to_line_end();
            }

            // Ctrl+A / Ctrl+E — line start / end (within current line)
            KeyCode::Char('a') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                let s = &self.input[..self.cursor_pos];
                self.cursor_pos = s.rfind('\n').map(|i| i + 1).unwrap_or(0);
            }
            KeyCode::Char('e') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                let s = &self.input[self.cursor_pos..];
                let off = s.find('\n').unwrap_or(s.len());
                self.cursor_pos += off;
            }

            KeyCode::Esc => {
                if self.status == AppStatus::Thinking {
                    return (Some(TuiCommand::Abort), false);
                }
            }

            KeyCode::Tab => {
                if self.input.is_empty() {
                    let navs = self.navigable_indices();
                    if !navs.is_empty() {
                        self.focus_mode = true;
                        self.focus_nav_idx = navs.len() - 1;
                    }
                } else {
                    if self.completion_idx.is_none() {
                        self.completions = self.compute_completions();
                    }
                    if !self.completions.is_empty() {
                        let next = self.completion_idx
                            .map_or(0, |i| (i + 1) % self.completions.len());
                        self.completion_idx = Some(next);
                        self.input = self.completions[next].clone();
                        self.cursor_pos = self.input.len();
                    }
                }
            }

            // Multiline: Alt+Enter or Shift+Enter inserts newline; bare Enter submits.
            KeyCode::Enter if key.modifiers.contains(KeyModifiers::ALT)
                          || key.modifiers.contains(KeyModifiers::SHIFT) => {
                self.input.insert(self.cursor_pos, '\n');
                self.cursor_pos += 1;
            }

            KeyCode::Enter => {
                let raw = self.input.clone();
                let text = raw.trim().to_string();
                self.input.clear();
                self.cursor_pos = 0;
                self.history_idx = None;
                self.history_stash.clear();

                if text.is_empty() {
                    return (None, false);
                }

                if text == ":quit" || text == ":q" {
                    return (Some(TuiCommand::Quit), true);
                }
                if text == ":reset" {
                    self.messages.push(ChatLine::Divider);
                    return (Some(TuiCommand::Reset), false);
                }
                if let Some(model_id) = text.strip_prefix(":model ") {
                    let m = model_id.trim().to_string();
                    self.model = m.clone();
                    return (Some(TuiCommand::Model { model: m }), false);
                }
                if text == ":help" {
                    self.messages.push(ChatLine::AgentText(
                        "  :model <id>   switch model\n  :models       list available models\n  :skills       list agent skills\n  :sessions     list past sessions\n  :resume <n>   resume session n from :sessions\n  :missions     list missions (active + inactive)\n  :inbox        show notifications\n  :pause-mission <id>   pause an active mission\n  :resume-mission <id>  resume a paused mission\n  :cancel-mission <id>  cancel a mission\n  :settings     show current config\n  :clear        clear chat pane (requires :clear! to confirm)\n  :copy         copy last AI response to clipboard\n  :reset        clear agent memory\n  :retry        re-send last user message\n  :timestamps   toggle HH:MM timestamps on messages\n  :quit / :q    exit\n  Esc           abort running turn (or close approval / focus)\n  Tab           (empty input) focus mode to navigate responses\n  Tab           (:command) autocomplete commands/models\n  ↑↓            input history    Alt+↑↓ / Shift+↑↓ scroll chat\n  PgUp/PgDn     scroll chat by page\n  Mouse wheel   scroll chat (hold Shift for native text selection)\n  Alt+Enter     insert newline (multiline input)\n  Ctrl+V        paste at cursor       Ctrl+W  delete word\n  Ctrl+U/K      delete to line start/end\n  Ctrl+←/→      jump word boundary".into()
                    ));
                    self.pinned = true;
                    self.scroll_to_bottom();
                    return (None, false);
                }
                if text == ":models" {
                    let list = if self.models.is_empty() {
                        "(no models loaded yet)".into()
                    } else {
                        self.models.join("\n")
                    };
                    self.messages.push(ChatLine::AgentText(list));
                    self.pinned = true;
                    self.scroll_to_bottom();
                    return (None, false);
                }
                if text == ":skills" {
                    return (Some(TuiCommand::ListSkills), false);
                }
                if text == ":missions" {
                    let lines = if self.missions.is_empty() {
                        "(no missions yet — commit one with the agent)".to_string()
                    } else {
                        self.missions.iter().map(|m| {
                            let spent = m.spent_usd;
                            let budget = m.budget_usd.unwrap_or(0.0);
                            let pct = if budget > 0.0 { (spent / budget * 100.0).clamp(0.0, 100.0) as u32 } else { 0 };
                            let bar_w = 12usize;
                            let filled = (pct as usize * bar_w / 100).min(bar_w);
                            let bar: String = "█".repeat(filled) + &"░".repeat(bar_w - filled);
                            let cap = m.per_tx_cap_usd.map(|c| format!(" cap ${:.0}", c)).unwrap_or_default();
                            format!(
                                "  {:<10} {:<8} {} {} ${:.2}/${:.2}{}",
                                m.kind, m.status, m.title, bar, spent, budget, cap
                            )
                        }).collect::<Vec<_>>().join("\n")
                    };
                    self.messages.push(ChatLine::AgentText(format!(
                        "Missions ({} total, {} active):\n{}",
                        self.missions.len(),
                        self.active_missions().len(),
                        lines
                    )));
                    self.pinned = true;
                    self.scroll_to_bottom();
                    return (Some(TuiCommand::ListMissions), false);
                }
                if text == ":inbox" {
                    let lines = if self.notifications.is_empty() {
                        "(empty inbox)".to_string()
                    } else {
                        self.notifications.iter().rev().take(20).map(|n| {
                            let mid = n.mission_id.as_deref().unwrap_or("-");
                            format!("  [{}] {} — {} ({})", n.level, n.title, n.body, mid)
                        }).collect::<Vec<_>>().join("\n")
                    };
                    self.messages.push(ChatLine::AgentText(format!(
                        "Inbox ({} unread):\n{}",
                        self.unread_notifications, lines
                    )));
                    self.clear_unread_notifications();
                    self.pinned = true;
                    self.scroll_to_bottom();
                    return (None, false);
                }
                if let Some(rest) = text.strip_prefix(":pause-mission ") {
                    let id = rest.trim().to_string();
                    if !id.is_empty() {
                        return (Some(TuiCommand::PauseMission { mission_id: id }), false);
                    }
                    return (None, false);
                }
                if let Some(rest) = text.strip_prefix(":resume-mission ") {
                    let id = rest.trim().to_string();
                    if !id.is_empty() {
                        return (Some(TuiCommand::ResumeMission { mission_id: id }), false);
                    }
                    return (None, false);
                }
                if let Some(rest) = text.strip_prefix(":cancel-mission ") {
                    let id = rest.trim().to_string();
                    if !id.is_empty() {
                        return (Some(TuiCommand::CancelMission { mission_id: id }), false);
                    }
                    return (None, false);
                }
                if text == ":sessions" {
                    return (Some(TuiCommand::ListSessions), false);
                }
                if let Some(n_str) = text.strip_prefix(":resume ") {
                    if let Ok(n) = n_str.trim().parse::<usize>() {
                        if n >= 1 && n <= self.session_list.len() {
                            let id = self.session_list[n - 1].id.clone();
                            return (Some(TuiCommand::ResumeSession { session_id: id }), false);
                        } else {
                            let msg = if self.session_list.is_empty() {
                                "Run :sessions first to see available sessions.".into()
                            } else {
                                format!("Session {} not found. Run :sessions to list sessions.", n)
                            };
                            self.messages.push(ChatLine::AgentText(msg));
                        }
                    }
                    return (None, false);
                }
                if text == ":settings" {
                    let wallet_line = self.wallet.as_ref()
                        .map(|w| if w.len() > 12 { format!("{}…", &w[..8]) } else { w.clone() })
                        .unwrap_or_else(|| "(none)".into());
                    let settings_text = format!(
                        "  Model:    {}\n  Wallet:   {}\n  Session:  {}",
                        self.model, wallet_line, self.session_id
                    );
                    self.messages.push(ChatLine::AgentText(settings_text));
                    self.pinned = true;
                    self.scroll_to_bottom();
                    return (None, false);
                }
                if text == ":clear" {
                    self.clear_armed = true;
                    self.messages.push(ChatLine::Note(
                        "press :clear! to confirm clearing the chat pane".into()
                    ));
                    self.pinned = true;
                    self.scroll_to_bottom();
                    return (None, false);
                }
                if text == ":clear!" {
                    self.messages.clear();
                    self.focus_mode = false;
                    self.unread_count = 0;
                    self.clear_armed = false;
                    return (None, false);
                }
                if text == ":timestamps" {
                    self.show_timestamps = !self.show_timestamps;
                    let state = if self.show_timestamps { "on" } else { "off" };
                    self.messages.push(ChatLine::Note(format!("timestamps {}", state)));
                    self.pinned = true;
                    self.scroll_to_bottom();
                    return (None, false);
                }
                if text == ":retry" {
                    if let Some(prev) = self.last_user_msg.clone() {
                        return (self.submit_message(prev), false);
                    } else {
                        self.messages.push(ChatLine::Note("nothing to retry".into()));
                        self.pinned = true;
                        self.scroll_to_bottom();
                        return (None, false);
                    }
                }
                if text == ":copy" {
                    let found = self.messages.iter().rev()
                        .find_map(|m| if let ChatLine::AgentText(t) = m { Some(t.clone()) } else { None });
                    if let Some(txt) = found {
                        if let Ok(mut cb) = arboard::Clipboard::new() {
                            if cb.set_text(txt).is_ok() {
                                self.show_toast("copied");
                            }
                        }
                    }
                    return (None, false);
                }

                // Reset clear-arming on any other submission.
                self.clear_armed = false;

                // Submit (use the trimmed-of-edges raw input, preserving internal newlines).
                let to_send = raw.trim_matches(|c: char| c == ' ' || c == '\t').to_string();
                let to_send = to_send.trim_matches('\n').to_string();
                if !to_send.is_empty() {
                    return (self.submit_message(to_send), false);
                }
                return (None, false);
            }

            // Cursor movement
            KeyCode::Left if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.cursor_pos = self.word_left();
            }
            KeyCode::Right if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.cursor_pos = self.word_right();
            }
            KeyCode::Left => self.cursor_move_left(),
            KeyCode::Right => self.cursor_move_right(),
            KeyCode::Home => self.cursor_pos = 0,
            KeyCode::End => self.cursor_pos = self.input.len(),

            // Delete at/before cursor
            KeyCode::Backspace if key.modifiers.contains(KeyModifiers::ALT) => {
                self.delete_word_left();
            }
            KeyCode::Backspace => {
                if self.cursor_pos > 0 {
                    let prev = self.input[..self.cursor_pos]
                        .char_indices()
                        .next_back()
                        .map(|(i, _)| i)
                        .unwrap_or(0);
                    self.input.remove(prev);
                    self.cursor_pos = prev;
                }
            }
            KeyCode::Delete => {
                if self.cursor_pos < self.input.len() {
                    self.input.remove(self.cursor_pos);
                }
            }

            // Input history (Up/Down) or chat scroll (Alt+Up/Down, Shift+Up/Down)
            KeyCode::Up => {
                if key.modifiers.contains(KeyModifiers::ALT)
                    || key.modifiers.contains(KeyModifiers::SHIFT) {
                    self.scroll_up(1);
                } else {
                    self.history_up();
                }
            }
            KeyCode::Down => {
                if key.modifiers.contains(KeyModifiers::ALT)
                    || key.modifiers.contains(KeyModifiers::SHIFT) {
                    self.scroll_down(1);
                } else {
                    self.history_down();
                }
            }
            KeyCode::PageUp => self.scroll_up(10),
            KeyCode::PageDown => self.scroll_down(10),

            KeyCode::Char(c) => {
                if !key.modifiers.contains(KeyModifiers::CONTROL)
                    && !key.modifiers.contains(KeyModifiers::ALT)
                {
                    self.input.insert(self.cursor_pos, c);
                    self.cursor_pos += c.len_utf8();
                }
            }

            _ => {}
        }
        (None, false)
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    fn replace_tool_start(
        &mut self,
        name: &str,
        success: bool,
        duration_ms: Option<u64>,
        result_preview: Option<String>,
    ) -> bool {
        for line in self.messages.iter_mut().rev() {
            if let ChatLine::ToolStart { name: n, input_preview } = line {
                if n == name {
                    let preview = input_preview.clone();
                    *line = ChatLine::ToolDone {
                        name: name.to_string(),
                        success,
                        duration_ms,
                        input_preview: preview,
                        result_preview,
                    };
                    return true;
                }
            }
        }
        false
    }

    fn replace_tool_start_with_error(&mut self, name: &str, msg: &str) -> bool {
        for line in self.messages.iter_mut().rev() {
            if let ChatLine::ToolStart { name: n, input_preview } = line {
                if n == name {
                    let preview = input_preview.clone();
                    *line = ChatLine::ToolError {
                        name: name.to_string(),
                        msg: msg.to_string(),
                        input_preview: preview,
                    };
                    return true;
                }
            }
        }
        false
    }

    pub fn last_line_is_active_tool_start(&self) -> bool {
        matches!(self.messages.last(), Some(ChatLine::ToolStart { .. }))
    }
}

/// Render JSON tool input as a single-line preview, truncated to ~120 chars.
pub fn format_tool_input(v: &Value) -> Option<String> {
    let s = match v {
        Value::Object(m) if m.is_empty() => return None,
        Value::Null => return None,
        _ => serde_json::to_string(v).ok()?,
    };
    if s.is_empty() { return None; }
    const MAX: usize = 120;
    if s.chars().count() > MAX {
        let mut out: String = s.chars().take(MAX).collect();
        out.push('…');
        Some(out)
    } else {
        Some(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn finish(name: &str) -> NodeEvent {
        NodeEvent::ToolFinish {
            tool_name: name.into(),
            success: true,
            duration_ms: Some(10),
            result_preview: None,
        }
    }
    fn start(name: &str) -> NodeEvent {
        NodeEvent::ToolStart { tool_name: name.into(), input: Some(json!({"path": "x"})) }
    }

    #[test]
    fn tool_finish_keeps_thinking() {
        let mut a = App::new();
        a.status = AppStatus::Thinking;
        a.handle_node_event(start("read"));
        a.handle_node_event(finish("read"));
        assert_eq!(a.status, AppStatus::Thinking);
        a.handle_node_event(NodeEvent::Response { text: "done".into() });
        assert_eq!(a.status, AppStatus::Idle);
    }

    #[test]
    fn scroll_up_unpins_then_repins_on_clamp() {
        let mut a = App::new();
        a.scroll_up(1);
        assert!(!a.pinned);
        // Simulate draw clamping with max_scroll = 0 (less than current scroll)
        a.scroll = 5;
        a.on_scroll_clamped(0);
        assert!(a.pinned);
    }

    #[test]
    fn unread_count_increments_when_unpinned() {
        let mut a = App::new();
        a.scroll_up(1); // unpin
        assert!(!a.pinned);
        a.handle_node_event(NodeEvent::Response { text: "hi".into() });
        assert_eq!(a.unread_count, 1);
    }

    #[test]
    fn paste_inserts_at_cursor() {
        let mut a = App::new();
        a.input = "hello ".into();
        a.cursor_pos = 6;
        a.on_paste("world".into());
        assert_eq!(a.input, "hello world");
        assert_eq!(a.cursor_pos, 11);
    }

    #[test]
    fn ctrl_w_deletes_word() {
        let mut a = App::new();
        a.input = "foo bar baz".into();
        a.cursor_pos = 11;
        a.delete_word_left();
        assert_eq!(a.input, "foo bar ");
    }

    #[test]
    fn format_tool_input_truncates() {
        let big = json!({ "s": "x".repeat(200) });
        let s = format_tool_input(&big).unwrap();
        assert!(s.ends_with('…'));
        assert!(s.chars().count() <= 121);
    }

    #[test]
    fn mission_update_replaces_in_place() {
        let mut a = App::new();
        let m1 = App::mock_mission("m-1", "active");
        let appended = a.upsert_mission(m1.clone());
        assert!(!appended);
        assert_eq!(a.missions.len(), 1);

        let mut m2 = m1.clone();
        m2.status = "paused".to_string();
        m2.spent_usd = 25.0;
        let replaced = a.upsert_mission(m2);
        assert!(replaced);
        assert_eq!(a.missions.len(), 1);
        assert_eq!(a.missions[0].status, "paused");
        assert_eq!(a.missions[0].spent_usd, 25.0);
    }

    #[test]
    fn notification_bumps_unread() {
        let mut a = App::new();
        a.handle_node_event(NodeEvent::Notification {
            level: "info".into(),
            title: "tick".into(),
            body: "ok".into(),
            mission_id: None,
            timestamp: None,
        });
        assert_eq!(a.notifications.len(), 1);
        assert_eq!(a.unread_notifications, 1);
        a.clear_unread_notifications();
        assert_eq!(a.unread_notifications, 0);
    }
}
