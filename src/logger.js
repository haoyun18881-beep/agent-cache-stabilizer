export function createLogger(config = {}) {
  const log = (line) => {
    const stamp = new Date().toISOString();
    console.log(`${stamp} ${line}`);
  };

  return {
    info(line) {
      log(line);
    },
    warn(line) {
      log(line);
    },
    error(line) {
      log(line);
    },
    token(laneLabel, usage) {
      const prompt = usage?.prompt_tokens ?? 0;
      const completion = usage?.completion_tokens ?? 0;
      const total = usage?.total_tokens ?? prompt + completion;
      const cacheHit =
        usage?.prompt_cache_hit_tokens ??
        usage?.prompt_tokens_details?.cached_tokens ??
        usage?.cached_tokens ??
        0;
      const cacheMiss = Math.max(0, prompt - cacheHit);
      const cacheRate = prompt > 0 ? ((cacheHit / prompt) * 100).toFixed(1) : "0.0";
      log(
        `${laneLabel} Token prompt=${prompt} completion=${completion} total=${total} cacheHit=${cacheHit} cacheMiss=${cacheMiss} cacheRate=${cacheRate}%`
      );

      const threshold = config.logging?.fingerprintOnCacheRateBelow ?? 90;
      return Number(cacheRate) < threshold;
    }
  };
}

export function formatK(tokens) {
  if (!Number.isFinite(tokens)) return "0K";
  return `${Math.round(tokens / 1000)}K`;
}
