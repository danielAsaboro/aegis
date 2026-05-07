import { getSwapQuote, executeSwap } from "../../utils/trading/swap.js";
import { requireAgentToken, parseTimeout, handleTradingError } from "../../utils/trading/guards.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { print, printError } from "../../utils/common/output.js";
import { getConfigValue } from "../../utils/config.js";
import { formatSwapQuote } from "../../utils/common/format.js";
import { validateChain } from "../../utils/common/validate.js";

// AEGIS policy enforcement — lazy-loaded so `zerion --help` works without env.
// At trade time the engine is required and there is no bypass flag.
async function loadAegis() {
  const [engine, types] = await Promise.all([
    import("../../engine/policies/engine.mjs"),
    import("../../engine/core/types.mjs"),
  ]);
  return {
    runPolicies: engine.runPolicies,
    getDefaultPolicies: engine.getDefaultPolicies,
    createTradeProposal: types.createTradeProposal,
  };
}

export default async function swap(args, flags) {
  const [fromToken, toToken, amount] = args;

  if (!fromToken || !toToken) {
    printError("missing_args", "Usage: zerion swap <from> <to> [amount]", {
      example: "zerion swap ETH USDC 0.1 --chain base",
    });
    process.exit(1);
  }

  if (!amount) {
    printError("missing_amount", "Specify an amount to swap", {
      example: `zerion swap ${fromToken} ${toToken} 0.1`,
    });
    process.exit(1);
  }

  const chainErr = validateChain(flags.chain) || validateChain(flags["from-chain"]) || validateChain(flags["to-chain"]);
  if (chainErr) {
    printError(chainErr.code, chainErr.message, { supportedChains: chainErr.supportedChains });
    process.exit(1);
  }

  const { walletName, address } = resolveWallet(flags);
  const fromChain = flags.chain || flags["from-chain"] || getConfigValue("defaultChain") || "ethereum";
  const toChain = flags["to-chain"] || fromChain;

  try {
    // 1. Get quote
    const quote = await getSwapQuote({
      fromToken,
      toToken,
      amount,
      fromChain,
      toChain,
      walletAddress: address,
      slippage: flags.slippage ? parseFloat(flags.slippage) : undefined,
    });

    // 2. Check balance
    if (quote.preconditions.enough_balance === false) {
      printError("insufficient_funds", `Insufficient ${quote.from.symbol} balance for this swap`, {
        suggestion: `Fund your wallet: zerion wallet fund --wallet ${walletName}`,
      });
      process.exit(1);
    }

    // 3. Run AEGIS policy checks — every trade must pass. No bypass flag.
    const { runPolicies, getDefaultPolicies, createTradeProposal } = await loadAegis();
    const proposal = createTradeProposal({
      strategyId: "cli-swap",
      strategyType: "manual",
      fromToken: fromToken.toUpperCase(),
      toToken: toToken.toUpperCase(),
      amount: parseFloat(amount),
      chain: fromChain,
      reason: "CLI swap command",
    });

    const policyConfig = {
      "spend-limit": { perTick: 1000, daily: 5000 },
      ...getDefaultPolicies("manual"),
    };

    const policyResult = await runPolicies(proposal, policyConfig);
    if (!policyResult.approved) {
      printError("policy_denied", `Trade blocked by policy: ${policyResult.deniedBy}`, {
        reason: policyResult.reason,
        suggestion: "Adjust trade size or policy config; bypass is intentionally not supported.",
      });
      process.exit(1);
    }
    proposal.policyResult = policyResult;

    // 4. Show quote
    const isCrossChain = fromChain !== toChain;
    const quoteSummary = {
      swap: {
        input: `${amount} ${quote.from.symbol}`,
        output: `~${quote.estimatedOutput} ${quote.to.symbol}`,
        minOutput: quote.outputMin,
        fee: quote.fee,
        source: quote.liquiditySource,
        estimatedTime: `${quote.estimatedSeconds}s`,
        fromChain,
        toChain: isCrossChain ? toChain : undefined,
        chain: isCrossChain ? `${fromChain} → ${toChain}` : fromChain,
        policiesChecked: true,
        policiesPassed: policyResult.results.map((r) => r.policy),
      },
    };

    // 5. Execute — agent token required (no interactive passphrase for trading)
    const passphrase = await requireAgentToken("for trading", walletName);
    const timeout = parseTimeout(flags.timeout);
    const result = await executeSwap(quote, walletName, passphrase, { timeout });

    const resultData = {
      ...quoteSummary,
      tx: {
        hash: result.hash,
        status: result.status,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
      },
      executed: true,
    };
    print(resultData, formatSwapQuote);
  } catch (err) {
    handleTradingError(err, "swap_error");
  }
}
