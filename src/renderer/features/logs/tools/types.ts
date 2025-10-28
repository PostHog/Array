export interface BaseToolViewProps<TArgs = unknown, TResult = unknown> {
  args: TArgs;
  result?: TResult;
}

export interface ShellResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface ShellStatus {
  stdout?: string;
  stderr?: string;
  status?: string;
}

export interface BashArgs {
  command: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

export interface BashOutputArgs {
  bash_id: string;
  filter?: string;
}

export interface ReadArgs {
  file_path: string;
  offset?: number;
  limit?: number;
}

export interface WriteArgs {
  file_path: string;
  content: string;
}

export interface EditArgs {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: "content" | "files_with_matches" | "count";
  "-i"?: boolean;
  "-n"?: boolean;
  "-A"?: number;
  "-B"?: number;
  "-C"?: number;
  multiline?: boolean;
  head_limit?: number;
}

export interface GrepResult {
  matches?: string[];
  count?: number;
}

export interface GlobArgs {
  pattern: string;
  path?: string;
}

export interface TaskArgs {
  description: string;
  prompt: string;
  subagent_type: string;
}

export interface WebSearchArgs {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

export interface WebSearchResultItem {
  title?: string;
  url?: string;
  snippet?: string;
}

export interface WebSearchResult {
  results?: WebSearchResultItem[];
}

export interface WebFetchArgs {
  url: string;
  prompt: string;
}

export interface KillShellArgs {
  shell_id: string;
}

export interface KillShellResult {
  success?: boolean;
  message?: string;
}

export interface NotebookEditArgs {
  notebook_path: string;
  cell_id?: string;
  cell_type?: "code" | "markdown";
  edit_mode?: "replace" | "insert" | "delete";
  new_source: string;
}

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface TodoWriteArgs {
  todos: Todo[];
}

export interface SlashCommandArgs {
  command: string;
}

export interface ExitPlanModeArgs {
  plan: string;
}
