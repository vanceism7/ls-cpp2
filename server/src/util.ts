import { exec } from "child_process";
import { promisify } from "util";

/**
 * Turns a uri into a local file path
 */
export const unuri = (uri: string) =>
  uri.replace("file:///", "").replace("%3A", ":");

/** A promise version of `exec` */
export const awaitExec = promisify(exec);
