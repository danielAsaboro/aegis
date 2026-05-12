/**
 * Daemon ↔ client IPC over a Unix domain socket.
 *
 * Protocol: NDJSON, one message per line, bidirectional. The daemon
 * listens on ~/.zerion/aegis/daemon.sock; multiple clients (TUIs,
 * Telegram bot, scripts) attach concurrently. Daemon broadcasts events
 * (mission updates, tool calls, notifications) to every attached
 * client; clients send commands (commit_mission, pause_mission, etc.)
 * back to the daemon.
 *
 * Message types — see plan §4 for the full list. The most important:
 *   client → daemon
 *     { type: "ping" }
 *     { type: "status" }
 *     { type: "list_missions" }
 *     { type: "commit_mission", title, intent, kind, policies, ... }
 *     { type: "pause_mission" | "resume_mission" | "cancel_mission", missionId }
 *     { type: "ack_excursion", missionId, toolCallId, approved }
 *     { type: "message", text, session_id?, user_id?, chat_id? } // chat input
 *     { type: "approval", approvalId, approved }
 *
 *   daemon → clients (broadcast)
 *     { type: "mission_list", missions }
 *     { type: "mission_update", mission, lastEvent? }
 *     { type: "notification", level, title, body, missionId }
 *     { type: "approval_request", approvalId, toolName, args }
 *     { type: "tool_start" | "tool_finish" | "tool_error", ... }
 *     { type: "response", text }
 *     { type: "turn_complete" | "turn_error", messageId, errorMsg? }
 *     { type: "status", model, wallet, missions, channels, started_at }
 */

import { createServer } from 'node:net';
import { unlinkSync, existsSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import bus from '../core/event-bus.mjs';
import { createLogger } from '../core/logger.mjs';
import {
  listMissions as listMissionsImpl,
  pauseMission as pauseMissionImpl,
  resumeMission as resumeMissionImpl,
  cancelMission as cancelMissionImpl,
  commitMission as commitMissionImpl,
  getMission as getMissionImpl,
} from '../missions/index.mjs';

const log = createLogger('ipc');

let _server = null;
let _clients = new Set();
let _onMessage = null;
let _onApproval = null;
let _state = { startedAt: null, model: null, wallet: null, statusFn: null };

function writeLine(socket, obj) {
  if (!socket || socket.destroyed) return;
  try {
    socket.write(JSON.stringify(obj) + '\n');
  } catch (err) {
    log.warn({ err: err.message }, 'socket write failed');
  }
}

function broadcast(obj) {
  for (const client of _clients) {
    writeLine(client, obj);
  }
}

async function handleCommand(socket, cmd) {
  switch (cmd.type) {
    case 'ping':
      writeLine(socket, { type: 'pong', ts: Date.now() });
      return;
    case 'status': {
      const missions = await listMissionsImpl({ status: 'active' });
      const extra = typeof _state.statusFn === 'function'
        ? await _state.statusFn()
        : {};
      writeLine(socket, {
        type: 'status',
        startedAt: _state.startedAt,
        model: _state.model,
        wallet: _state.wallet,
        missions: missions.map((m) => ({
          id: m.id, title: m.title, kind: m.kind, status: m.status,
          spentUsd: m.spentUsd, budgetUsd: m.budgetUsd, perTxCapUsd: m.perTxCapUsd,
        })),
        ...extra,
      });
      return;
    }
    case 'list_missions': {
      const missions = await listMissionsImpl({});
      writeLine(socket, { type: 'mission_list', missions });
      return;
    }
    case 'commit_mission': {
      try {
        const mission = await commitMissionImpl(cmd);
        broadcast({ type: 'mission_update', mission });
        writeLine(socket, { type: 'commit_mission_ok', mission });
      } catch (err) {
        writeLine(socket, { type: 'error', code: err.code || 'commit_failed', message: err.message });
      }
      return;
    }
    case 'pause_mission':
    case 'resume_mission':
    case 'cancel_mission': {
      const ops = {
        pause_mission: pauseMissionImpl,
        resume_mission: resumeMissionImpl,
        cancel_mission: cancelMissionImpl,
      };
      try {
        const mission = await ops[cmd.type](cmd.missionId, cmd.reason);
        broadcast({ type: 'mission_update', mission });
        writeLine(socket, { type: `${cmd.type}_ok`, missionId: cmd.missionId, status: mission.status });
      } catch (err) {
        writeLine(socket, { type: 'error', code: 'mission_op_failed', message: err.message });
      }
      return;
    }
    case 'get_mission': {
      const mission = await getMissionImpl(cmd.missionId);
      writeLine(socket, { type: 'mission_update', mission });
      return;
    }
    case 'message': {
      if (typeof _onMessage === 'function') {
        try {
          await _onMessage({
            text: String(cmd.text || ''),
            socket,
            sessionId: cmd.session_id,
            userId: cmd.user_id,
            chatId: cmd.chat_id,
          });
        } catch (err) {
          writeLine(socket, { type: 'error', message: err.message });
        }
      } else {
        writeLine(socket, { type: 'error', message: 'no chat handler attached' });
      }
      return;
    }
    case 'approval':
    case 'ack_excursion': {
      if (typeof _onApproval === 'function') {
        _onApproval({
          approvalId: cmd.approvalId || cmd.toolCallId,
          approved: !!cmd.approved,
        });
      }
      return;
    }
    case 'quit':
      writeLine(socket, { type: 'bye' });
      socket.end();
      return;
    default:
      writeLine(socket, { type: 'error', message: `unknown command "${cmd.type}"` });
  }
}

/**
 * Start the daemon-side socket server.
 *
 * @param {object} opts
 * @param {string} opts.sockPath
 * @param {object} [opts.state] — { model, wallet, startedAt } for status replies
 * @param {(payload: { text, socket, sessionId }) => Promise<void>} [opts.onMessage]
 * @param {({ approvalId, approved }) => void} [opts.onApproval]
 */
export async function startSocketServer({ sockPath, state, onMessage, onApproval } = {}) {
  if (_server) return _server;
  if (!sockPath) throw new Error('startSocketServer: sockPath required');

  // Ensure parent dir exists; remove any stale socket file.
  mkdirSync(dirname(sockPath), { recursive: true });
  if (existsSync(sockPath)) {
    try { unlinkSync(sockPath); } catch { /* ignore */ }
  }

  _state = { ...(_state || {}), ...(state || {}), startedAt: state?.startedAt || new Date().toISOString() };
  _onMessage = onMessage || null;
  _onApproval = onApproval || null;

  _server = createServer((socket) => {
    _clients.add(socket);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let cmd;
        try { cmd = JSON.parse(line); }
        catch (err) {
          writeLine(socket, { type: 'error', message: `invalid json: ${err.message}` });
          continue;
        }
        handleCommand(socket, cmd).catch((err) => {
          writeLine(socket, { type: 'error', message: err.message });
        });
      }
    });
    socket.on('close', () => _clients.delete(socket));
    socket.on('error', (err) => {
      log.debug({ err: err.message }, 'client socket error');
      _clients.delete(socket);
    });
    writeLine(socket, {
      type: 'ready',
      model: _state.model,
      wallet: _state.wallet,
      startedAt: _state.startedAt,
    });
  });

  await new Promise((resolve, reject) => {
    _server.once('error', reject);
    _server.listen(sockPath, () => {
      try { chmodSync(sockPath, 0o600); } catch { /* best-effort */ }
      log.info({ sockPath }, 'IPC socket listening');
      resolve();
    });
  });

  // Bridge engine bus events to attached clients. NOTIFICATION is emitted
  // by the log channel; EXECUTION_COMPLETE / EXECUTION_FAILED come from
  // the executor.
  bus.on('NOTIFICATION', (notification) => {
    broadcast({ type: 'notification', ...notification });
  });
  bus.on('EXECUTION_COMPLETE', (result) => {
    broadcast({ type: 'execution', success: true, result });
  });
  bus.on('EXECUTION_FAILED', (result) => {
    broadcast({ type: 'execution', success: false, result });
  });

  return _server;
}

export function broadcastEvent(obj) {
  broadcast(obj);
}

export async function stopSocketServer() {
  if (!_server) return;
  for (const client of _clients) {
    try { client.end(); } catch { /* ignore */ }
  }
  _clients.clear();
  await new Promise((resolve) => _server.close(() => resolve()));
  _server = null;
}

/**
 * Write the daemon pid + sock path to disk so other processes can find it.
 */
export function writeDaemonStateFiles({ pidPath, sockPath, pid }) {
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, `${pid}\n`, 'utf8');
  writeFileSync(`${pidPath}.sock`, sockPath, 'utf8');
}
