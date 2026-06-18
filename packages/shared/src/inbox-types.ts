export interface AvailableSuggestedReviewer {
  uuid: string;
  name: string;
  email: string;
  github_login: string;
}

export type SourceProduct =
  | "session_replay"
  | "error_tracking"
  | "llm_analytics"
  | "github"
  | "linear"
  | "zendesk"
  | "conversations"
  | "pganalyze"
  | "signals_scout";
