import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TELEGRAM_BOT_TOKEN ??= 'test_token';
process.env.ZERION_API_KEY ??= 'test_key';

const {
  renderTelegramAgentHtml,
  renderTelegramAgentPlain,
  sendTelegramReply,
} = await import('../../../engine/bot/formatters.mjs');

describe('Telegram agent reply formatter', () => {
  test('normalizes policy bullets and removes decorative backticks', () => {
    const input = [
      '## Current policies',
      '- `spend-limit`: max $25 per trade/tick',
      '- `daily-cap`: $100',
      '- `manual`: required for larger trades',
    ].join('\n');

    const output = renderTelegramAgentHtml(input);

    assert.equal(
      output,
      [
        '<b>Current policies</b>',
        '• <b>Spend limit:</b> max $25 per trade/tick',
        '• <b>Daily cap:</b> $100',
        '• <b>Manual:</b> required for larger trades',
      ].join('\n'),
    );
  });

  test('keeps code spans only for real commands and machine values', () => {
    const input = 'You can switch to `manual` mode with `/policy`, set `AEGIS_AGENT_AUTONOMY`, or edit `.env`.';
    const output = renderTelegramAgentHtml(input);

    assert.match(output, /manual mode/);
    assert.match(output, /<code>\/policy<\/code>/);
    assert.match(output, /<code>AEGIS_AGENT_AUTONOMY<\/code>/);
    assert.match(output, /<code>\.env<\/code>/);
    assert.doesNotMatch(output, /<code>manual<\/code>/);
    assert.doesNotMatch(output, /`/);
  });

  test('unwraps short fenced blocks into normal text', () => {
    const input = [
      'Here is the current status:',
      '```md',
      '- `chain-lock`: solana',
      '- `expiry-window`: 30m',
      '```',
    ].join('\n');

    const output = renderTelegramAgentHtml(input);

    assert.equal(
      output,
      [
        'Here is the current status:',
        '• <b>Chain lock:</b> solana',
        '• <b>Expiry window:</b> 30m',
      ].join('\n'),
    );
  });

  test('escapes HTML-sensitive text and safe markdown links', () => {
    const input = [
      '## Safety',
      '- `note`: <script>alert("x")</script> & keep going',
      '- docs: [Open docs](https://example.com/a?x=1&quote="yes")',
      '- unsafe: [bad](javascript:alert(1))',
    ].join('\n');

    const output = renderTelegramAgentHtml(input);

    assert.equal(
      output,
      [
        '<b>Safety</b>',
        '• <b>Note:</b> &lt;script&gt;alert("x")&lt;/script&gt; &amp; keep going',
        '• <b>Docs:</b> <a href="https://example.com/a?x=1&amp;quote=&quot;yes&quot;">Open docs</a>',
        '• <b>Unsafe:</b> bad: javascript:alert(1)',
      ].join('\n'),
    );
  });

  test('renders clear machine-value fenced blocks as code lines', () => {
    const input = [
      'Use this value:',
      '```',
      'AEGIS_AGENT_AUTONOMY',
      '```',
    ].join('\n');

    assert.equal(
      renderTelegramAgentHtml(input),
      ['Use this value:', '<code>AEGIS_AGENT_AUTONOMY</code>'].join('\n'),
    );
  });

  test('plain-text fallback strips markdown when Telegram rejects entities', async () => {
    const calls = [];
    const send = async (text, extra) => {
      calls.push({ text, extra });
      if (calls.length === 1) {
        const err = new Error("can't parse entities");
        err.description = "Bad Request: can't parse entities";
        throw err;
      }
      return { ok: true };
    };

    await sendTelegramReply(send, '## Policies\n- `spend-limit`: $25');

    assert.equal(calls.length, 2);
    assert.equal(calls[0].extra.parse_mode, 'HTML');
    assert.equal(calls[0].text, '<b>Policies</b>\n• <b>Spend limit:</b> $25');
    assert.equal(calls[1].extra.parse_mode, undefined);
    assert.equal(calls[1].text, renderTelegramAgentPlain('## Policies\n- `spend-limit`: $25'));
    assert.equal(calls[1].text, 'Policies\n• Spend limit: $25');
    assert.doesNotMatch(calls[1].text, /<[^>]+>|`|\*\*/);
  });
});
