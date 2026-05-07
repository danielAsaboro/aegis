use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect, Alignment},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};
use crate::app::{App, AppStatus, ChatLine, SPINNER};

// ── Palette ──────────────────────────────────────────────────────────────────

const C_BG:      Color = Color::Rgb(5, 5, 8);
const C_BORDER:  Color = Color::Rgb(40, 40, 55);
const C_USER:    Color = Color::Rgb(251, 191, 36);
const C_AGENT:   Color = Color::Rgb(0, 212, 255);
const C_TOOL:    Color = Color::Rgb(167, 139, 250);
const C_SUCCESS: Color = Color::Rgb(52, 211, 153);
const C_ERROR:   Color = Color::Rgb(248, 113, 113);
const C_HINT:    Color = Color::Rgb(80, 80, 100);
const C_DIM:     Color = Color::Rgb(120, 120, 140);
const C_CODE:    Color = Color::Rgb(250, 200, 100);
const C_APPROVAL_BORDER: Color = Color::Rgb(251, 191, 36);
const C_APPROVAL_BTN:    Color = Color::Rgb(251, 140, 0);

// ── Inline markdown ──────────────────────────────────────────────────────────

fn parse_md(text: &str, base: Style) -> Vec<(String, Style)> {
    let bold   = base.add_modifier(Modifier::BOLD);
    let italic = base.add_modifier(Modifier::ITALIC);
    let code   = Style::default().fg(C_CODE);

    let mut out: Vec<(String, Style)> = Vec::new();
    let mut rest = text;

    loop {
        if rest.is_empty() { break; }

        let p_bb = rest.find("**");
        let p_bt = rest.find('`');
        let p_bs = rest.find('*').filter(|&p| p_bb.map_or(true, |q| p != q));

        let first = [p_bb.map(|p| (p, 0u8)), p_bt.map(|p| (p, 1)), p_bs.map(|p| (p, 2))]
            .iter().flatten().copied().min_by_key(|&(p, _)| p);

        match first {
            None => { out.push((rest.to_string(), base)); break; }
            Some((pos, kind)) => {
                if pos > 0 { out.push((rest[..pos].to_string(), base)); }
                match kind {
                    0 => {
                        let after = &rest[pos + 2..];
                        if let Some(e) = after.find("**") {
                            out.extend(parse_md(&after[..e], bold));
                            rest = &after[e + 2..];
                        } else { out.push(("**".to_string(), base)); rest = after; }
                    }
                    1 => {
                        let after = &rest[pos + 1..];
                        if let Some(e) = after.find('`') {
                            out.push((after[..e].to_string(), code));
                            rest = &after[e + 1..];
                        } else { out.push(("`".to_string(), base)); rest = after; }
                    }
                    2 => {
                        let after = &rest[pos + 1..];
                        if let Some(e) = find_single_star(after) {
                            out.push((after[..e].to_string(), italic));
                            rest = &after[e + 1..];
                        } else { out.push(("*".to_string(), base)); rest = after; }
                    }
                    _ => unreachable!()
                }
            }
        }
    }
    out
}

fn find_single_star(text: &str) -> Option<usize> {
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c == '*' {
            let next = text[i + c.len_utf8()..].starts_with('*');
            if !next { return Some(i); }
            chars.next();
        }
    }
    None
}

fn segments_to_words(segs: &[(String, Style)]) -> Vec<(String, Style)> {
    let mut words = Vec::new();
    for (text, style) in segs {
        for word in text.split_whitespace() {
            if !word.is_empty() {
                words.push((word.to_string(), *style));
            }
        }
    }
    words
}

fn wrap_words(words: Vec<(String, Style)>, max_w: usize) -> Vec<Vec<(String, Style)>> {
    let mut lines: Vec<Vec<(String, Style)>> = Vec::new();
    let mut line: Vec<(String, Style)> = Vec::new();
    let mut width = 0usize;

    for (word, style) in words {
        let w = word.len();
        let needed = if line.is_empty() { w } else { w + 1 };
        if !line.is_empty() && width + needed > max_w {
            lines.push(line);
            line = Vec::new();
            width = 0;
        }
        width += if line.is_empty() { w } else { needed };
        line.push((word, style));
    }
    if !line.is_empty() { lines.push(line); }
    if lines.is_empty() { lines.push(Vec::new()); }
    lines
}

fn words_to_line(words: &[(String, Style)]) -> Line<'static> {
    let mut spans: Vec<Span<'static>> = Vec::new();
    for (i, (word, style)) in words.iter().enumerate() {
        if i > 0 { spans.push(Span::styled(" ".to_string(), *style)); }
        spans.push(Span::styled(word.clone(), *style));
    }
    Line::from(spans)
}

fn md_lines(text: &str, base: Style, max_w: usize) -> Vec<Line<'static>> {
    let segs  = parse_md(text, base);
    let words = segments_to_words(&segs);
    let rows  = wrap_words(words, max_w);
    rows.iter().map(|r| words_to_line(r)).collect()
}

fn now_hhmm() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let total_min = (secs / 60) % (24 * 60);
    let h = total_min / 60;
    let m = total_min % 60;
    format!("{:02}:{:02}", h, m)
}

// ── Status glyph (color-blind safe) ──────────────────────────────────────────

fn status_glyph(status: &AppStatus) -> &'static str {
    match status {
        AppStatus::Loading         => "◯",
        AppStatus::Idle            => "●",
        AppStatus::Thinking        => "◐",
        AppStatus::WaitingApproval => "⚠",
    }
}

// ── Layout ───────────────────────────────────────────────────────────────────

pub fn draw(frame: &mut Frame, app: &mut App) {
    let area = frame.area();

    frame.render_widget(
        Block::default().style(Style::default().bg(C_BG)),
        area,
    );

    let approval_height = if app.pending_approval.is_some() { 10u16 } else { 0 };
    let has_approval = app.pending_approval.is_some();

    // Compute input-bar height from newline count, capped to a third of the screen.
    let input_lines = (app.input.matches('\n').count() as u16) + 1;
    let input_cap = area.height.max(6) / 3;
    let input_height = (input_lines + 2).min(input_cap.max(3)).max(3);

    // Reserve 1 row for footer
    let footer_height = 1u16;
    // Optional unread pill row
    let pill_height = if app.unread_count > 0 && !app.pinned { 1u16 } else { 0 };

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),                  // title
            Constraint::Min(3),                     // chat
            Constraint::Length(approval_height),    // approval
            Constraint::Length(pill_height),        // unread pill
            Constraint::Length(footer_height),      // footer
            Constraint::Length(input_height),       // input
        ])
        .split(area);

    draw_title(frame, app, chunks[0]);
    draw_chat(frame, app, chunks[1]);
    if has_approval { draw_approval(frame, app, chunks[2]); }
    if pill_height > 0 { draw_unread_pill(frame, app, chunks[3]); }
    draw_footer(frame, app, chunks[4]);
    draw_input(frame, app, chunks[5]);
    draw_toast(frame, app, area);
    if !app.completions.is_empty() {
        draw_completions(frame, app, chunks[5]);
    }
}

// ── Title bar ────────────────────────────────────────────────────────────────

fn draw_title(frame: &mut Frame, app: &App, area: Rect) {
    let dot_color = match app.status {
        AppStatus::Loading         => C_HINT,
        AppStatus::Idle            => C_SUCCESS,
        AppStatus::Thinking        => C_USER,
        AppStatus::WaitingApproval => C_APPROVAL_BTN,
    };

    let mut title_spans = vec![
        Span::styled(" AEGIS ", Style::default().fg(C_AGENT).add_modifier(Modifier::BOLD)),
    ];
    if let Some(ref wallet) = app.wallet {
        let short = if wallet.len() > 10 {
            format!("[{}…]", &wallet[..6])
        } else {
            format!("[{}]", wallet)
        };
        title_spans.push(Span::styled(short, Style::default().fg(C_HINT)));
    }

    frame.render_widget(
        Paragraph::new(Line::from(title_spans)).style(Style::default().bg(C_BG)),
        area,
    );

    let glyph = status_glyph(&app.status);
    let model_w = (app.model.len() + glyph.len() + 4) as u16;
    if model_w < area.width {
        let model_area = Rect { x: area.x + area.width.saturating_sub(model_w), y: area.y, width: model_w, height: 1 };
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(format!("{} ", glyph), Style::default().fg(dot_color)),
                Span::styled(app.model.clone(), Style::default().fg(C_HINT)),
                Span::raw(" "),
            ])).style(Style::default().bg(C_BG)).alignment(Alignment::Right),
            model_area,
        );
    }
}

// ── Chat pane ────────────────────────────────────────────────────────────────

fn draw_chat(frame: &mut Frame, app: &mut App, area: Rect) {
    let block = Block::default()
        .borders(Borders::LEFT | Borders::RIGHT | Borders::TOP)
        .border_style(Style::default().fg(C_BORDER))
        .style(Style::default().bg(C_BG));

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let spinner = SPINNER[app.spinner_tick % SPINNER.len()];
    let max_w = inner.width.saturating_sub(2) as usize;

    // First-run banner takes over if the chat is empty and we're idle.
    if app.messages.is_empty() && app.status == AppStatus::Idle {
        draw_banner(frame, inner);
        return;
    }

    let focused_msg_idx: Option<usize> = if app.focus_mode {
        let navs = app.navigable_indices();
        navs.get(app.focus_nav_idx).copied()
    } else {
        None
    };

    let mut lines: Vec<Line<'static>> = Vec::new();

    if app.status == AppStatus::Loading && app.messages.is_empty() {
        lines.push(Line::from(vec![
            Span::styled(
                format!("  {} connecting to AEGIS…", spinner),
                Style::default().fg(C_HINT),
            ),
        ]));
    }

    let ts_prefix = if app.show_timestamps { format!("{} ", now_hhmm()) } else { String::new() };
    let ts_w = ts_prefix.len();

    for (msg_idx, msg) in app.messages.iter().enumerate() {
        match msg {
            ChatLine::User(text) => {
                lines.push(Line::from(vec![]));
                let is_focused = focused_msg_idx == Some(msg_idx);
                let agent_prefix_w = 9 + ts_w;
                let avail = max_w.saturating_sub(agent_prefix_w);
                let mut first = true;
                // Render user text preserving newlines.
                for paragraph in text.split('\n') {
                    if paragraph.is_empty() && !first {
                        lines.push(Line::from(vec![]));
                        continue;
                    }
                    for word_row in wrap_words(
                        vec![(paragraph.to_string(), Style::default().fg(C_USER))],
                        avail.max(1),
                    ) {
                        let prefix = if first {
                            let label_style = if is_focused {
                                Style::default().fg(C_BG).bg(C_USER).add_modifier(Modifier::BOLD)
                            } else {
                                Style::default().fg(C_USER).add_modifier(Modifier::BOLD)
                            };
                            let mut spans = Vec::new();
                            if !ts_prefix.is_empty() {
                                spans.push(Span::styled(ts_prefix.clone(), Style::default().fg(C_DIM)));
                            }
                            spans.push(Span::styled("  you  ", label_style));
                            spans
                        } else {
                            vec![Span::raw(" ".repeat(agent_prefix_w))]
                        };
                        let mut spans = prefix;
                        spans.extend(words_to_line(&word_row).spans);
                        lines.push(Line::from(spans));
                        first = false;
                    }
                }
            }

            ChatLine::AgentText(text) => {
                lines.push(Line::from(vec![]));
                let is_focused = focused_msg_idx == Some(msg_idx);
                let prefix_str = "  AEGIS  ";
                let prefix_w = prefix_str.len() + ts_w;
                let avail = max_w.saturating_sub(prefix_w);
                let base = Style::default().fg(C_AGENT);

                let mut first = true;
                for paragraph in text.split('\n') {
                    if paragraph.trim().is_empty() && !first {
                        lines.push(Line::from(vec![]));
                        continue;
                    }
                    for word_row in md_lines(paragraph, base, if avail > 0 { avail } else { 1 }) {
                        let mut spans: Vec<Span<'static>> = Vec::new();
                        if first {
                            if !ts_prefix.is_empty() {
                                spans.push(Span::styled(ts_prefix.clone(), Style::default().fg(C_DIM)));
                            }
                            let label_style = if is_focused {
                                Style::default().fg(C_BG).bg(C_AGENT).add_modifier(Modifier::BOLD)
                            } else {
                                Style::default().fg(C_AGENT).add_modifier(Modifier::BOLD)
                            };
                            spans.push(Span::styled(prefix_str.to_string(), label_style));
                        } else {
                            spans.push(Span::raw(" ".repeat(prefix_w)));
                        };
                        spans.extend(word_row.spans);
                        lines.push(Line::from(spans));
                        first = false;
                    }
                }
            }

            ChatLine::ToolStart { name, input_preview } => {
                let mut spans = vec![
                    Span::styled("  ▸ ", Style::default().fg(C_TOOL)),
                    Span::styled(format!("{}()", name), Style::default().fg(C_TOOL)),
                    Span::styled(format!("  {}", spinner), Style::default().fg(C_TOOL)),
                ];
                if let Some(prev) = input_preview {
                    let inline_room = max_w.saturating_sub(name.len() + 14);
                    if prev.len() <= inline_room {
                        spans.push(Span::styled(format!("  {}", prev), Style::default().fg(C_DIM)));
                        lines.push(Line::from(spans));
                    } else {
                        lines.push(Line::from(spans));
                        let truncated = truncate_to(prev, max_w.saturating_sub(8));
                        lines.push(Line::from(vec![
                            Span::styled(format!("        args: {}", truncated), Style::default().fg(C_DIM)),
                        ]));
                    }
                } else {
                    lines.push(Line::from(spans));
                }
            }

            ChatLine::ToolDone { name, success, duration_ms, input_preview, result_preview } => {
                let (mark, color) = if *success { ("✓", C_SUCCESS) } else { ("✗", C_ERROR) };
                let dur = duration_ms.map(|d| format!("{}ms", d)).unwrap_or_default();
                let right = format!("  {} {}", mark, dur);
                let left_w = name.len() + 6;
                let pad = max_w.saturating_sub(left_w + right.len());
                lines.push(Line::from(vec![
                    Span::styled("  ▸ ", Style::default().fg(C_TOOL)),
                    Span::styled(format!("{}()", name), Style::default().fg(C_TOOL)),
                    Span::raw(" ".repeat(pad.min(40))),
                    Span::styled(right, Style::default().fg(color)),
                ]));
                if let Some(prev) = input_preview {
                    let truncated = truncate_to(prev, max_w.saturating_sub(8));
                    lines.push(Line::from(vec![
                        Span::styled(format!("        args: {}", truncated), Style::default().fg(C_DIM)),
                    ]));
                }
                if *success {
                    if let Some(prev) = result_preview {
                        let truncated = truncate_to(prev, max_w.saturating_sub(8));
                        lines.push(Line::from(vec![
                            Span::styled(format!("        → {}", truncated), Style::default().fg(C_DIM)),
                        ]));
                    }
                }
            }

            ChatLine::ToolError { name, msg, input_preview } => {
                lines.push(Line::from(vec![
                    Span::styled("  ▸ ", Style::default().fg(C_ERROR)),
                    Span::styled(format!("{}()", name), Style::default().fg(C_ERROR)),
                    Span::styled(format!("  ✗ {}", msg), Style::default().fg(C_ERROR)),
                ]));
                if let Some(prev) = input_preview {
                    let truncated = truncate_to(prev, max_w.saturating_sub(8));
                    lines.push(Line::from(vec![
                        Span::styled(format!("        args: {}", truncated), Style::default().fg(C_DIM)),
                    ]));
                }
            }

            ChatLine::Note(text) => {
                lines.push(Line::from(vec![
                    Span::styled(format!("  · {}", text), Style::default().fg(C_DIM).add_modifier(Modifier::ITALIC)),
                ]));
            }

            ChatLine::Divider => {
                let dashes = "─".repeat(inner.width.saturating_sub(2) as usize);
                lines.push(Line::from(Span::styled(dashes, Style::default().fg(C_BORDER))));
            }
        }
    }

    // A2: render "thinking…" whenever Thinking AND no in-flight ToolStart is the
    // last visible activity. Once it resolves, "thinking…" reappears with the
    // most recent tool name as a contextual caption.
    if app.status == AppStatus::Thinking && !app.last_line_is_active_tool_start() {
        let stalled = app.is_stalled();
        let caption = if stalled {
            "still working…".to_string()
        } else if let Some(tool) = &app.last_tool_done {
            format!("composing after {}…", tool)
        } else {
            "thinking…".to_string()
        };
        lines.push(Line::from(vec![
            Span::styled(format!("  {} {}", spinner, caption), Style::default().fg(C_HINT)),
        ]));
    }

    let total = lines.len();
    let visible = inner.height as usize;
    let max_scroll = total.saturating_sub(visible);
    app.on_scroll_clamped(max_scroll);

    let para = Paragraph::new(Text::from(lines.into_iter().skip(app.scroll).collect::<Vec<_>>()))
        .style(Style::default().bg(C_BG))
        .wrap(Wrap { trim: false });
    frame.render_widget(para, inner);

    // Scrollbar (single column on the right edge of the chat block border)
    if max_scroll > 0 && inner.height > 2 {
        let track_h = inner.height as usize;
        let pos = ((app.scroll.min(max_scroll)) as f32 / (max_scroll.max(1)) as f32 * (track_h.saturating_sub(1)) as f32) as usize;
        let bar_x = area.x + area.width.saturating_sub(1);
        for y in 0..track_h {
            let glyph = if y == pos { "█" } else { "│" };
            let color = if y == pos { C_AGENT } else { C_BORDER };
            let cell_area = Rect { x: bar_x, y: inner.y + y as u16, width: 1, height: 1 };
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(glyph, Style::default().fg(color))))
                    .style(Style::default().bg(C_BG)),
                cell_area,
            );
        }
    }
}

fn truncate_to(s: &str, max_w: usize) -> String {
    if max_w == 0 { return String::new(); }
    if s.chars().count() <= max_w { return s.to_string(); }
    let mut out: String = s.chars().take(max_w.saturating_sub(1)).collect();
    out.push('…');
    out
}

// ── First-run banner ─────────────────────────────────────────────────────────

fn draw_banner(frame: &mut Frame, area: Rect) {
    let lines = vec![
        Line::from(vec![]),
        Line::from(vec![
            Span::styled("  Welcome to AEGIS", Style::default().fg(C_AGENT).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![]),
        Line::from(vec![
            Span::styled("  Type a message and hit Enter to begin.", Style::default().fg(C_HINT)),
        ]),
        Line::from(vec![]),
        Line::from(vec![
            Span::styled("    :help          ", Style::default().fg(C_DIM)),
            Span::styled("show all commands", Style::default().fg(C_HINT)),
        ]),
        Line::from(vec![
            Span::styled("    :skills        ", Style::default().fg(C_DIM)),
            Span::styled("list available agent skills", Style::default().fg(C_HINT)),
        ]),
        Line::from(vec![
            Span::styled("    Tab            ", Style::default().fg(C_DIM)),
            Span::styled("autocomplete commands or focus past responses", Style::default().fg(C_HINT)),
        ]),
        Line::from(vec![
            Span::styled("    Mouse / Shift+↑↓  ", Style::default().fg(C_DIM)),
            Span::styled("scroll the chat (hold Shift to native-select text)", Style::default().fg(C_HINT)),
        ]),
        Line::from(vec![
            Span::styled("    Ctrl+C         ", Style::default().fg(C_DIM)),
            Span::styled("quit", Style::default().fg(C_HINT)),
        ]),
    ];
    let para = Paragraph::new(Text::from(lines)).style(Style::default().bg(C_BG));
    frame.render_widget(para, area);
}

// ── Approval panel ───────────────────────────────────────────────────────────

fn draw_approval(frame: &mut Frame, app: &App, area: Rect) {
    if let Some(req) = &app.pending_approval {
        let block = Block::default()
            .title(Span::styled(
                " 🔐 Approval ",
                Style::default().fg(C_APPROVAL_BORDER).add_modifier(Modifier::BOLD),
            ))
            .borders(Borders::ALL)
            .border_style(Style::default().fg(C_APPROVAL_BORDER))
            .style(Style::default().bg(C_BG));

        let inner = block.inner(area);
        frame.render_widget(Clear, area);
        frame.render_widget(block, area);

        let pretty = req.args.as_ref()
            .and_then(|v| serde_json::to_string_pretty(v).ok())
            .unwrap_or_default();

        let mut content_lines: Vec<Line<'static>> = Vec::new();
        content_lines.push(Line::from(vec![
            Span::styled(
                format!("  {}", req.tool_name),
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
            ),
        ]));

        if !pretty.is_empty() {
            let max_w = inner.width.saturating_sub(4) as usize;
            for raw_line in pretty.lines() {
                // Hard-wrap long pretty-printed lines without splitting words awkwardly.
                let mut buf = String::from("  ");
                buf.push_str(raw_line);
                if buf.chars().count() <= max_w {
                    content_lines.push(Line::from(vec![
                        Span::styled(buf, Style::default().fg(C_DIM)),
                    ]));
                } else {
                    // Soft-wrap by char count.
                    let mut chars = buf.chars().collect::<Vec<_>>();
                    while !chars.is_empty() {
                        let take = chars.len().min(max_w);
                        let chunk: String = chars.drain(..take).collect();
                        content_lines.push(Line::from(vec![
                            Span::styled(chunk, Style::default().fg(C_DIM)),
                        ]));
                    }
                }
            }
        }

        // Reserve last 2 rows for buttons.
        let total = inner.height as usize;
        let body_h = total.saturating_sub(2);
        let scroll = app.approval_scroll.min(content_lines.len().saturating_sub(body_h.max(1)));
        let visible: Vec<Line<'static>> = content_lines.iter()
            .skip(scroll)
            .take(body_h.max(1))
            .cloned()
            .collect();

        let body_area = Rect { height: body_h.max(1) as u16, ..inner };
        frame.render_widget(
            Paragraph::new(Text::from(visible))
                .style(Style::default().bg(C_BG))
                .wrap(Wrap { trim: false }),
            body_area,
        );

        let btn_y = inner.y + inner.height.saturating_sub(1);
        let btn_area = Rect { x: inner.x, y: btn_y, width: inner.width, height: 1 };
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::raw("  "),
                Span::styled("[ y  Approve ]", Style::default().fg(C_BG).bg(C_SUCCESS).add_modifier(Modifier::BOLD)),
                Span::raw("    "),
                Span::styled("[ n  Deny ]", Style::default().fg(C_BG).bg(C_ERROR).add_modifier(Modifier::BOLD)),
                Span::raw("    "),
                Span::styled("↑↓ scroll args", Style::default().fg(C_HINT)),
            ])).style(Style::default().bg(C_BG)),
            btn_area,
        );
    }
}

// ── Unread pill ──────────────────────────────────────────────────────────────

fn draw_unread_pill(frame: &mut Frame, app: &App, area: Rect) {
    let label = format!("  ↓ {} new message{} — End / Shift+↓ to follow  ",
        app.unread_count, if app.unread_count == 1 { "" } else { "s" });
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            label,
            Style::default().fg(C_BG).bg(C_AGENT).add_modifier(Modifier::BOLD),
        ))).style(Style::default().bg(C_BG)),
        area,
    );
}

// ── Footer ───────────────────────────────────────────────────────────────────

fn draw_footer(frame: &mut Frame, app: &App, area: Rect) {
    let glyph = status_glyph(&app.status);
    let wallet_short = app.wallet.as_ref().map(|w| {
        if w.len() > 10 { format!("{}…", &w[..6]) } else { w.clone() }
    }).unwrap_or_else(|| "—".into());

    let session_short = if app.session_id.is_empty() {
        "—".to_string()
    } else if app.session_id.len() > 14 {
        format!("…{}", &app.session_id[app.session_id.len() - 12..])
    } else {
        app.session_id.clone()
    };

    let active_missions = app.active_missions().len();
    let mission_label = if active_missions == 1 { "mission" } else { "missions" };

    let mut left = vec![
        Span::styled(format!(" {} ", glyph), Style::default().fg(C_HINT)),
        Span::styled(app.model.clone(), Style::default().fg(C_DIM)),
        Span::styled("  •  ", Style::default().fg(C_BORDER)),
        Span::styled(format!("session {}", session_short), Style::default().fg(C_DIM)),
        Span::styled("  •  ", Style::default().fg(C_BORDER)),
        Span::styled(format!("wallet {}", wallet_short), Style::default().fg(C_DIM)),
        Span::styled("  •  ", Style::default().fg(C_BORDER)),
        Span::styled(
            format!("{} {}", active_missions, mission_label),
            Style::default().fg(if active_missions > 0 { C_HINT } else { C_DIM }),
        ),
    ];
    if app.unread_notifications > 0 {
        left.push(Span::styled("  •  ", Style::default().fg(C_BORDER)));
        left.push(Span::styled(
            format!("{} unread", app.unread_notifications),
            Style::default().fg(C_HINT),
        ));
    }

    let right = match app.status {
        AppStatus::Loading         => " connecting… ",
        AppStatus::Thinking        => " Esc to abort ",
        AppStatus::WaitingApproval => " press y/n ",
        AppStatus::Idle            => " :help for commands ",
    };

    frame.render_widget(
        Paragraph::new(Line::from(left)).style(Style::default().bg(C_BG)),
        area,
    );

    let right_w = right.len() as u16 + 2;
    if right_w < area.width {
        let right_area = Rect {
            x: area.x + area.width.saturating_sub(right_w),
            y: area.y,
            width: right_w,
            height: 1,
        };
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(right.to_string(), Style::default().fg(C_HINT))))
                .alignment(Alignment::Right)
                .style(Style::default().bg(C_BG)),
            right_area,
        );
    }
}

// ── Toast ────────────────────────────────────────────────────────────────────

fn draw_toast(frame: &mut Frame, app: &App, area: Rect) {
    if let Some(t) = &app.toast {
        let label = format!(" {} ", t.text);
        let w = (label.len() as u16).min(area.width.saturating_sub(2));
        let x = area.x + area.width.saturating_sub(w + 2);
        let y = area.y + area.height.saturating_sub(4);
        let toast_area = Rect { x, y, width: w, height: 1 };
        frame.render_widget(Clear, toast_area);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                label,
                Style::default().fg(C_BG).bg(C_SUCCESS).add_modifier(Modifier::BOLD),
            ))).style(Style::default().bg(C_BG)),
            toast_area,
        );
    }
}

// ── Completions popup ────────────────────────────────────────────────────────

fn draw_completions(frame: &mut Frame, app: &App, input_area: Rect) {
    if app.completions.is_empty() { return; }

    let max_item_len = app.completions.iter().map(|s| s.len()).max().unwrap_or(0);
    let popup_width = ((max_item_len + 4) as u16).min(input_area.width);
    let raw_height = (app.completions.len().min(6) + 2) as u16;
    let popup_height = raw_height.min(input_area.y);

    if popup_height == 0 { return; }

    let x = input_area.x;
    let y = input_area.y.saturating_sub(popup_height);

    let popup_area = Rect { x, y, width: popup_width, height: popup_height };

    let block = Block::default()
        .title(Span::styled(" tab ", Style::default().fg(C_HINT)))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(C_BORDER))
        .style(Style::default().bg(C_BG));

    let inner = block.inner(popup_area);
    frame.render_widget(Clear, popup_area);
    frame.render_widget(block, popup_area);

    let visible_count = inner.height as usize;
    let items: Vec<Line<'static>> = app.completions.iter().take(visible_count)
        .enumerate()
        .map(|(i, item)| {
            let is_selected = app.completion_idx == Some(i);
            if is_selected {
                Line::from(vec![
                    Span::styled("▶ ", Style::default().fg(C_AGENT)),
                    Span::styled(item.clone(), Style::default().fg(C_AGENT).add_modifier(Modifier::BOLD)),
                ])
            } else {
                Line::from(vec![
                    Span::raw("  "),
                    Span::styled(item.clone(), Style::default().fg(C_HINT)),
                ])
            }
        })
        .collect();

    frame.render_widget(
        Paragraph::new(Text::from(items)).style(Style::default().bg(C_BG)),
        inner,
    );
}

// ── Input bar ────────────────────────────────────────────────────────────────

fn draw_input(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(C_BORDER))
        .style(Style::default().bg(C_BG));

    let inner = block.inner(area);
    frame.render_widget(block, area);

    // Build per-line spans, splitting input by '\n'. Track cursor x/y for native cursor.
    // NOTE: width counts must use char count, not byte length — `▸` is 3 bytes
    // but 1 display column, so prompt_str.len() would push the cursor too far right.
    let prompt_str = "you ▸ ";
    let prompt_w = prompt_str.chars().count() as u16;

    let lines: Vec<Line<'static>> = app.input.split('\n').enumerate().map(|(i, line)| {
        let is_first = i == 0;
        let prefix = if is_first {
            Span::styled(prompt_str.to_string(), Style::default().fg(C_HINT))
        } else {
            Span::raw(" ".repeat(prompt_str.chars().count()))
        };
        Line::from(vec![
            prefix,
            Span::styled(line.to_string(), Style::default().fg(Color::White)),
        ])
    }).collect();

    // Compute cursor position: walk through input up to cursor_pos.
    let (cursor_line, cursor_col) = {
        let pre = &app.input[..app.cursor_pos];
        let mut col = 0usize;
        let mut line_idx = 0usize;
        for ch in pre.chars() {
            if ch == '\n' {
                line_idx += 1;
                col = 0;
            } else {
                col += 1;
            }
        }
        (line_idx, col)
    };

    frame.render_widget(
        Paragraph::new(Text::from(lines)).style(Style::default().bg(C_BG)),
        inner,
    );

    // Native cursor — terminal blink applies. Hide it during loading or approvals.
    if !matches!(app.status, AppStatus::WaitingApproval) {
        let cx = inner.x + prompt_w + cursor_col as u16;
        let cy = inner.y + cursor_line as u16;
        if cx < inner.x + inner.width && cy < inner.y + inner.height {
            frame.set_cursor_position((cx, cy));
        }
    }
}
