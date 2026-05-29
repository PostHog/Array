import type { AvailableSuggestedReviewer } from "@posthog/shared/domain-types";

export interface CurrentSuggestedReviewerUser {
  uuid: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface SuggestedReviewerFilterOption {
  uuid: string;
  name: string;
  email: string;
  github_login: string;
  isMe: boolean;
  showSeparatorBelow: boolean;
}

function normalizeString(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildCurrentUserName(
  currentUser?: CurrentSuggestedReviewerUser | null,
): string {
  const firstName = normalizeString(currentUser?.first_name);
  const lastName = normalizeString(currentUser?.last_name);
  return [firstName, lastName].filter(Boolean).join(" ");
}

function sortReviewerOptionsByName(
  reviewers: SuggestedReviewerFilterOption[],
): SuggestedReviewerFilterOption[] {
  return [...reviewers].sort((a, b) => {
    const aName = normalizeString(a.name).toLowerCase();
    const bName = normalizeString(b.name).toLowerCase();
    const aEmail = normalizeString(a.email).toLowerCase();
    const bEmail = normalizeString(b.email).toLowerCase();

    return (
      aName.localeCompare(bName) ||
      aEmail.localeCompare(bEmail) ||
      a.uuid.localeCompare(b.uuid)
    );
  });
}

export function getSuggestedReviewerDisplayName(
  reviewer: Pick<SuggestedReviewerFilterOption, "name" | "email" | "isMe">,
): string {
  const baseLabel =
    normalizeString(reviewer.name) ||
    normalizeString(reviewer.email) ||
    "Unknown user";

  return reviewer.isMe ? `${baseLabel} (Me)` : baseLabel;
}

export function buildSuggestedReviewerFilterOptions(
  reviewers: AvailableSuggestedReviewer[],
  currentUser?: CurrentSuggestedReviewerUser | null,
): SuggestedReviewerFilterOption[] {
  const byUuid = new Map<string, SuggestedReviewerFilterOption>();

  for (const reviewer of reviewers) {
    const uuid = normalizeString(reviewer.uuid);
    if (!uuid || byUuid.has(uuid)) {
      continue;
    }

    byUuid.set(uuid, {
      uuid,
      name: normalizeString(reviewer.name),
      email: normalizeString(reviewer.email),
      github_login: normalizeString(reviewer.github_login),
      isMe: false,
      showSeparatorBelow: false,
    });
  }

  const currentUserUuid = normalizeString(currentUser?.uuid);
  if (currentUserUuid) {
    const existing = byUuid.get(currentUserUuid);
    byUuid.set(currentUserUuid, {
      uuid: currentUserUuid,
      name: buildCurrentUserName(currentUser) || existing?.name || "",
      email: normalizeString(currentUser?.email) || existing?.email || "",
      github_login: existing?.github_login || "",
      isMe: true,
      showSeparatorBelow: true,
    });
  }

  const options = Array.from(byUuid.values());
  const meOption = options.find((option) => option.isMe) ?? null;
  const otherOptions = sortReviewerOptionsByName(
    options.filter((option) => !option.isMe),
  );

  return meOption ? [meOption, ...otherOptions] : otherOptions;
}
