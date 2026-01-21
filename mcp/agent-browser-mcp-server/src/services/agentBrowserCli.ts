import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CliRunRequest, CliRunResult, CliGlobalOptions } from '../types.js';
import {
  CHARACTER_LIMIT,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_BIN,
  ERR_TIMEOUT,
  ERR_INVALID_INPUT,
} from '../constants.js';

export async function runAgentBrowser(request: CliRunRequest): Promise<CliRunResult> {
  const { argv, options, saveOutputPath } = request;

  // 1. Input Validation
  validateInput(argv, saveOutputPath);

  // 2. Prepare Command
  const bin = process.env.AGENT_BROWSER_BIN || DEFAULT_BIN;
  const args = [...argv];

  // Append global options
  if (options) {
    if (options.session) args.push('--session', options.session);
    if (options.cdpPort) args.push('--cdp-port', options.cdpPort.toString());
    if (options.headed) args.push('--headed');
    if (options.debug) args.push('--debug');
    if (options.executablePath) args.push('--executable-path', options.executablePath);
    // Default to json unless explicitly disabled (though CLI might not support --no-json, usually just omitting it implies text, but instructions say "Default to passing --json unless explicitly disabled")
    // If json is undefined or true, pass --json. If false, don't.
    if (options.json !== false) args.push('--json');
  } else {
    // Default behavior if options undefined
    args.push('--json');
  }

  // 3. Execution
  return new Promise((resolve) => {
    const timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
    
    const child = spawn(bin, args, {
      shell: false,
      env: { ...process.env, NO_COLOR: '1' }, // Ensure clean output
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Timeout handling
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Force kill if it doesn't exit
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        signal: null,
        invoked: { bin, args },
        stdout: '',
        stderr: err.message,
        parsedJson: null,
        truncated: false,
        isError: true,
      });
    });

    child.on('close', async (code, signal) => {
      clearTimeout(timer);

      // Handle output saving
      if (saveOutputPath) {
        try {
          await fs.writeFile(saveOutputPath, stdout);
        } catch (writeErr: any) {
          stderr += `\nFailed to save output: ${writeErr.message}`;
        }
      }

      // Parse JSON
      let parsedJson: unknown | null = null;
      let truncated = false;

      // Try parsing JSON first (before truncation)
      // Only if we expect JSON (which we default to)
      try {
        // Attempt to find the last valid JSON object if mixed with logs
        // But for now, assume the CLI behaves well with --json.
        // Or simply try parsing the whole stdout.
        parsedJson = JSON.parse(stdout.trim());
      } catch (e) {
        // Not valid JSON
      }

      // Truncation Logic
      // "avoid truncating stdout when parsedJson is present. Otherwise truncate..."
      if (!parsedJson) {
        if (stdout.length > CHARACTER_LIMIT) {
          stdout = stdout.slice(0, CHARACTER_LIMIT) + '...[truncated]';
          truncated = true;
        }
      }
      
      if (stderr.length > CHARACTER_LIMIT) {
        stderr = stderr.slice(0, CHARACTER_LIMIT) + '...[truncated]';
      }

      const result: CliRunResult = {
        ok: code === 0 && !timedOut,
        exitCode: code,
        signal: signal,
        invoked: { bin, args },
        stdout,
        stderr: timedOut ? `${stderr}\n${ERR_TIMEOUT}` : stderr,
        parsedJson,
        truncated,
        savedOutputPath: saveOutputPath
      };

      resolve(result);
    });
  });
}

function validateInput(argv: string[], saveOutputPath?: string) {
  // Check NUL bytes
  for (const arg of argv) {
    if (arg.includes('\0')) {
      throw new Error(`${ERR_INVALID_INPUT}: NUL byte detected in argument`);
    }
  }

  // Check saveOutputPath
  if (saveOutputPath) {
    if (path.isAbsolute(saveOutputPath)) {
      throw new Error(`${ERR_INVALID_INPUT}: Absolute paths not allowed for output`);
    }
    // Simple traversal check
    const normalized = path.normalize(saveOutputPath);
    if (normalized.startsWith('..') || normalized.includes('..')) { // strict check
       throw new Error(`${ERR_INVALID_INPUT}: Path traversal not allowed`);
    }
    // Also NUL check for path
    if (saveOutputPath.includes('\0')) {
       throw new Error(`${ERR_INVALID_INPUT}: NUL byte in output path`);
    }
  }
}
