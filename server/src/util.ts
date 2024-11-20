import { exec, spawn } from "child_process";
import { promisify } from "util";

/**
 * Turns a uri into a local file path
 */
export const unuri = (uri: string) =>
  uri.replace("file:///", "").replace("%3A", ":");

/**
 * A promise version of `spawn`
 */
export function awaitSpawn(
  command: string,
  args: string[],
  inputText?: string
  //
): Promise<string> {
  //
  return new Promise((resolve, reject) => {
    const cliProcess = spawn(command, args);
    console.log(cliProcess.spawnargs);

    let stdout = "";
    let stderr = "";

    // Collect stdout data
    cliProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    // Collect stderr data
    cliProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Handle process exit
    cliProcess.on("close", (code) => {
      console.log("Closing cppfront");
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    // Send input text to stdin
    console.log("Writing input text now");
    if (inputText) {
      cliProcess.stdin.write(inputText);
      cliProcess.stdin.end();
    }
  });
}

/**
 * Check if a string is null or empty/only whitespace
 */
export function isStringEmpty(input: string | null | undefined): boolean {
  return !input || input.trim() == "";
}
