export interface CliGlobalOptions {
  session?: string;
  cdpPort?: number;
  headed?: boolean;
  debug?: boolean;
  executablePath?: string;
  json?: boolean;
  timeoutMs?: number;
}

export interface CliRunRequest {
  argv: string[];
  options?: CliGlobalOptions;
  saveOutputPath?: string;
}

export interface CliInvocation {
  bin: string;
  args: string[];
}

export interface CliRunResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  invoked: CliInvocation;
  stdout: string;
  stderr: string;
  parsedJson: unknown | null;
  truncated: boolean;
  savedOutputPath?: string;
  isError?: boolean;
}
