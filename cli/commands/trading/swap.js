import { getSwapQuote, executeSwap } from "../../utils/trading/swap.js";
import { requireAgentToken, parseTimeout, parseSlippage, handleTradingError } from "../../utils/trading/guards.js";
import { resolveWallet } from "../../utils/wallet/resolve.js";
import { print, printError } from "../../utils/common/output.js";
import { formatSwapQuote } from "../../utils/common/format.js";
import { validateTradingChainAsync } from "../../utils/common/validate.js";

// AEGIS policy enforcement — lazy-loaded so `zerion --help` works without env.
// At trade time the engine is required and there is no bypass flag.
async function loadAegis() {
  const [engine, types] = await Promise.all([
    import("../../../engine/policies/engine.mjs"),
    import("../../../engine/core/types.mjs"),
  ]);
  return {
    runPolicies: engine.runPolicies,
    getDefaultPolicies: engine.getDefaultPolicies,
    createTradeProposal: types.createTradeProposal,
  };
}

/**
 * Same-chain token swap.
 * Usage: zerion swap <chain> <amount> <from-token> <to-token>
 *
 * Cross-chain conversion is handled by `zerion bridge`. Keeping `swap` to a
 * single chain makes the arg order unambiguous: chain first, then the action
 * (amount + from + to).
 */
export default async function swap(args, flags) {
  const [chain, amount, fromToken, toToken] = args;

  if (!chain || !amount || !fromToken || !toToken) {
    printError("missing_args", "Usage: zerion swap <chain> <amount> <from-token> <to-token>", {
      example: "zerion swap base 1 USDC ETH",
    });
    process.exit(1);
  }

  if (Number.isNaN(parseFloat(amount))) {
    printError("invalid_amount", `Amount must be a number, got "${amount}". Did you mean: zerion swap ${chain} <amount> ${amount} ${fromToken}?`, {
      example: "zerion swap base 1 USDC ETH",
    });
    process.exit(1);
  }

  // Source wallet resolves against `chain` so Solana picks base58 and EVM
  // picks 0x.
  const { walletName, address } = resolveWallet({ ...flags, chain });

  const chainCheck = await validateTradingChainAsync(chain, "trade");
  if (chainCheck.error) {
    printError(chainCheck.error.code, chainCheck.error.message, { supportedChains: chainCheck.error.supportedChains });
    process.exit(1);
  }

  try {
    const quote = await getSwapQuote({
      fromToken,
      toToken,
      amount,
      fromChain: chain,
      toChain: chain,
      walletAddress: address,
      outputReceiver: address,
      slippage: parseSlippage(flags.slippage),
    });

    if (quote.preconditions.enough_balance === false) {
      printError("insufficient_funds", `Insufficient ${quote.from.symbol} balance for this swap`, {
        suggestion: `Fund your wallet: zerion wallet fund --wallet ${walletName}`,
      });
      process.exit(1);
    }

    // AEGIS policy gate — every trade must pass. No bypass flag.
    const { runPolicies, getDefaultPolicies, createTradeProposal } = await loadAegis();
    const proposal = createTradeProposal({
      strategyId: "cli-swap",
      strategyType: "manual",
      fromToken: fromToken.toUpperCase(),
      toToken: toToken.toUpperCase(),
      amount: parseFloat(amount),
      chain,
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

    const quoteSummary = {
      swap: {
        chain,
        input: `${amount} ${quote.from.symbol}`,
        output: `~${quote.estimatedOutput} ${quote.to.symbol}`,
        minOutput: quote.outputMin,
        fee: quote.fee,
        source: quote.liquiditySource,
        estimatedTime: `${quote.estimatedSeconds || "?"}s`,
        sender: address,
        policiesChecked: true,
        policiesPassed: policyResult.results.map((r) => r.policy),
      },
    };

    const passphrase = await requireAgentToken("for trading", walletName);
    const timeout = parseTimeout(flags.timeout);
    const result = await executeSwap(quote, walletName, passphrase, { timeout });

    print({
      ...quoteSummary,
      tx: {
        hash: result.hash,
        status: result.status,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
      },
      executed: true,
    }, formatSwapQuote);
  } catch (err) {
    handleTradingError(err, "swap_error");
  }
}
