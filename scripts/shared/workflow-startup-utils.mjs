export function parseCommandTokens(command) {
  if (typeof command !== "string" || !command.trim()) {
    return [];
  }

  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (
        (part.startsWith("\"") && part.endsWith("\"")) ||
        (part.startsWith("'") && part.endsWith("'"))
      ) {
        return part.slice(1, -1);
      }
      return part;
    });
}

export function resolveCodexCommand(command, fallbackBin = "codex") {
  const tokens = parseCommandTokens(command);
  if (tokens.length === 0) {
    return {
      codexBin: fallbackBin,
      extraArgs: []
    };
  }

  const [codexBin, ...rawArgs] = tokens;
  const extraArgs = [...rawArgs];
  if (extraArgs[0] === "app-server") {
    extraArgs.shift();
  }

  return {
    codexBin,
    extraArgs
  };
}

export function resolveDelegationPolicy(workflowStore, envDefaults) {
  const current = workflowStore.current();
  if (!current.ok) {
    return { ...envDefaults };
  }

  return {
    ...envDefaults,
    ...workflowStore.getDelegationPolicy()
  };
}

export function emitStructuredEvent(event, payload = {}) {
  process.stdout.write(
    `${JSON.stringify({
      type: event,
      at: new Date().toISOString(),
      ...payload
    })}\n`
  );
}
