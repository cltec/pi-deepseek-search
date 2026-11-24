import { getAgentDir, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDeepSeek } from "./wiring.ts";

export default function extension(pi: ExtensionAPI): void {
  registerDeepSeek(pi, { agentDir: getAgentDir(), env: process.env, queueFileMutation: withFileMutationQueue });
}
