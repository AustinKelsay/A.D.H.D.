import { JOB_STATES } from "../runtime/state-machine.js";

export const ALLOWED_JOB_STATES = new Set(Object.values(JOB_STATES));
