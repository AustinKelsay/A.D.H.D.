export class RuntimeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.details = details;
  }
}

export class TransitionError extends RuntimeError {
  constructor(from, to) {
    super("INVALID_TRANSITION", `Invalid state transition: ${from} -> ${to}`, {
      from,
      to
    });
    this.name = "TransitionError";
  }
}

export function assert(condition, code, message, details = undefined) {
  if (!condition) {
    throw new RuntimeError(code, message, details);
  }
}
