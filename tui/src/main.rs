mod app;
mod ipc;
mod ui;

use std::process::Stdio;
use std::time::Duration;

use crossterm::{
    event::{
        DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
        Event, EventStream,
    },
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use futures::StreamExt;
use ratatui::{backend::CrosstermBackend, Terminal};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader as TokioBufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::time;

use app::App;
use ipc::{encode_command, parse_node_event, TuiCommand};

type BoxError = Box<dyn std::error::Error>;

#[tokio::main]
async fn main() -> Result<(), BoxError> {
    let aegis_bin = find_aegis_binary()?;

    enable_raw_mode()?;
    let mut stdout = std::io::stdout();
    execute!(
        stdout,
        EnterAlternateScreen,
        EnableMouseCapture,
        EnableBracketedPaste,
    )?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;

    let mut child = Command::new(&aegis_bin)
        .args(["chat", "--tui"])
        .env("AEGIS_LOG_STDERR", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", aegis_bin, e))?;

    let child_stdin = child.stdin.take().expect("piped stdin");
    let child_stdout = child.stdout.take().expect("piped stdout");

    let (node_tx, mut node_rx) = mpsc::unbounded_channel::<Option<ipc::NodeEvent>>();
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<TuiCommand>();

    let node_tx_clone = node_tx.clone();
    tokio::spawn(async move {
        let reader = TokioBufReader::new(child_stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            if let Some(ev) = parse_node_event(&line) {
                let _ = node_tx_clone.send(Some(ev));
            }
        }
        let _ = node_tx_clone.send(None);
    });

    let mut child_stdin = child_stdin;
    tokio::spawn(async move {
        while let Some(cmd) = cmd_rx.recv().await {
            let line = encode_command(&cmd) + "\n";
            if child_stdin.write_all(line.as_bytes()).await.is_err() {
                break;
            }
            let _ = child_stdin.flush().await;
        }
    });

    let mut app = App::new();
    let mut ticker = time::interval(Duration::from_millis(100));
    // EventStream handles Esc disambiguation and Tab detection properly — do
    // not poll with Duration::ZERO which races against crossterm's internal
    // escape-sequence timeout and causes Esc to be silently dropped.
    let mut events = EventStream::new();

    'main: loop {
        tokio::select! {
            ev = node_rx.recv() => {
                match ev {
                    Some(None) | None => {
                        app.backend_died();
                        terminal.draw(|f| ui::draw(f, &mut app))?;
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        break 'main;
                    }
                    Some(Some(event)) => {
                        app.handle_node_event(event);
                        loop {
                            match node_rx.try_recv() {
                                Ok(Some(e)) => app.handle_node_event(e),
                                _ => break,
                            }
                        }
                    }
                }
            }

            _ = ticker.tick() => {
                app.tick_spinner();
            }

            maybe_ev = events.next() => {
                match maybe_ev {
                    Some(Ok(Event::Key(key))) => {
                        let (cmd, quit) = app.on_key(key);
                        if let Some(c) = cmd {
                            let _ = cmd_tx.send(c);
                        }
                        if quit {
                            tokio::time::sleep(Duration::from_millis(150)).await;
                            break 'main;
                        }
                    }
                    Some(Ok(Event::Mouse(m))) => {
                        app.on_mouse(m);
                    }
                    Some(Ok(Event::Paste(text))) => {
                        app.on_paste(text);
                    }
                    Some(Ok(Event::Resize(_, _))) => {
                        terminal.autoresize()?;
                    }
                    _ => {}
                }
            }
        }

        terminal.draw(|f| ui::draw(f, &mut app))?;
    }

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        DisableBracketedPaste,
        DisableMouseCapture,
        LeaveAlternateScreen,
    )?;
    terminal.show_cursor()?;

    let _ = child.kill().await;

    Ok(())
}

fn find_aegis_binary() -> Result<String, BoxError> {
    if let Ok(bin) = std::env::var("AEGIS_BIN") {
        return Ok(bin);
    }

    for candidate in &["aegis", "zerion"] {
        if let Ok(output) = std::process::Command::new("which")
            .arg(candidate)
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(path);
                }
            }
        }
    }

    for rel in &["./zerion.js", "../zerion.js"] {
        if std::path::Path::new(rel).exists() {
            return Ok(format!("node {}", rel));
        }
    }

    Err("Could not find aegis binary. Run `npm link` in the aegis directory, or set AEGIS_BIN=<path>.".into())
}
