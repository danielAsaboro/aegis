/**
 * /schedule — Manage generic scheduled agent jobs.
 *
 * Syntax:
 *   /schedule list
 *   /schedule show <job-id>
 *   /schedule cron <cron-expr> :: <prompt>
 *   /schedule every <30s|15m|2h|900000> :: <prompt>
 *   /schedule at <iso-datetime> :: <prompt>
 *   /schedule pause <job-id>
 *   /schedule resume <job-id>
 *   /schedule cancel <job-id>
 */

import cron from 'node-cron';
import {
  createScheduledJob,
  listScheduledJobs,
  updateScheduledJob,
} from '../../runtime/scheduled-jobs.mjs';
import { syncJobs } from '../../monitors/scheduler.mjs';
import { formatScheduledJob, formatScheduledJobList } from '../formatters.mjs';

export function parseScheduleParts(text) {
  const parts = String(text || '').split(' ').slice(1);
  return { subcommand: (parts[0] || '').toLowerCase(), rest: parts.slice(1) };
}

export function parsePromptSpec(rest) {
  const raw = rest.join(' ').trim();
  const divider = raw.indexOf('::');
  if (divider === -1) {
    throw new Error('Use `::` to separate the schedule from the prompt.');
  }
  const scheduleValue = raw.slice(0, divider).trim();
  const prompt = raw.slice(divider + 2).trim();
  if (!scheduleValue) throw new Error('Missing schedule value before `::`.');
  if (!prompt) throw new Error('Missing prompt after `::`.');
  return { scheduleValue, prompt };
}

export function parseEveryMs(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) throw new Error('Interval must be a number of ms or use suffix ms|s|m|h|d.');
  const value = Number(match[1]);
  const unit = match[2];
  const mult = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return value * mult;
}

export function buildTitle(prompt) {
  const clean = String(prompt || '').trim().replace(/\s+/g, ' ');
  return clean.length <= 48 ? clean : `${clean.slice(0, 45)}...`;
}

async function getJobForChat(chatId, jobId) {
  const jobs = await listScheduledJobs({ chatId });
  return jobs.find((job) => job.id === jobId) || null;
}

export function registerSchedule(bot) {
  bot.command('schedule', async (ctx) => {
    try {
      const { subcommand, rest } = parseScheduleParts(ctx.message?.text || '');

      if (!subcommand || subcommand === 'list') {
        const jobs = await listScheduledJobs({ chatId: ctx.chat.id });
        await ctx.replyWithMarkdown(formatScheduledJobList(jobs));
        return;
      }

      if (subcommand === 'show' || subcommand === 'status') {
        const jobId = rest[0];
        if (!jobId) {
          await ctx.reply('Usage: /schedule show <job-id>');
          return;
        }
        const job = await getJobForChat(ctx.chat.id, jobId);
        if (!job) {
          await ctx.reply(`Scheduled job ${jobId} not found`);
          return;
        }
        await ctx.replyWithMarkdown(formatScheduledJob(job));
        return;
      }

      if (subcommand === 'pause' || subcommand === 'resume' || subcommand === 'cancel') {
        const jobId = rest[0];
        if (!jobId) {
          await ctx.reply(`Usage: /schedule ${subcommand} <job-id>`);
          return;
        }
        const job = await getJobForChat(ctx.chat.id, jobId);
        if (!job) {
          await ctx.reply(`Scheduled job ${jobId} not found`);
          return;
        }
        const status = subcommand === 'pause' ? 'paused' : subcommand === 'resume' ? 'active' : 'cancelled';
        const updated = await updateScheduledJob(jobId, { status });
        await syncJobs();
        await ctx.replyWithMarkdown(`Scheduled job \`${updated.id}\` → *${updated.status}*`);
        return;
      }

      if (subcommand === 'cron' || subcommand === 'every' || subcommand === 'at') {
        const { scheduleValue, prompt } = parsePromptSpec(rest);
        const scheduleKind = subcommand;
        const normalizedValue = scheduleKind === 'every'
          ? String(parseEveryMs(scheduleValue))
          : scheduleValue;
        if (scheduleKind === 'cron' && !cron.validate(normalizedValue)) {
          throw new Error(`Invalid cron expression: ${normalizedValue}`);
        }
        if (scheduleKind === 'at' && Number.isNaN(new Date(scheduleValue).getTime())) {
          throw new Error('`at` requires a valid ISO datetime.');
        }
        const nextRunAt = scheduleKind === 'at' ? scheduleValue : null;
        const job = await createScheduledJob({
          kind: 'agent_turn',
          scheduleKind,
          scheduleValue: normalizedValue,
          userId: ctx.from.id,
          chatId: ctx.chat.id,
          prompt,
          title: buildTitle(prompt),
          nextRunAt,
        });
        await syncJobs();
        await ctx.replyWithMarkdown(`✅ Scheduled job created\n\n${formatScheduledJob(job)}`);
        return;
      }

      await ctx.reply(
        'Usage:\n' +
        '/schedule list\n' +
        '/schedule show <job-id>\n' +
        '/schedule cron <cron-expr> :: <prompt>\n' +
        '/schedule every <30s|15m|2h|900000> :: <prompt>\n' +
        '/schedule at <iso-datetime> :: <prompt>\n' +
        '/schedule pause <job-id>\n' +
        '/schedule resume <job-id>\n' +
        '/schedule cancel <job-id>'
      );
    } catch (err) {
      await ctx.reply(`Schedule error: ${err.message}`);
    }
  });
}
