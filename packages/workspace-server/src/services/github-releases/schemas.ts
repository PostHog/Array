import { z } from "zod";

export const githubReleaseApiItem = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
  html_url: z.string(),
});

export const githubReleasesApiResponse = z.array(githubReleaseApiItem);

export const releaseItem = z.object({
  version: z.string(),
  name: z.string(),
  notes: z.string(),
  date: z.string().nullable(),
  isPrerelease: z.boolean(),
  htmlUrl: z.string(),
});

export const listReleasesOutput = z.object({
  releases: z.array(releaseItem),
});

export type ReleaseItem = z.infer<typeof releaseItem>;
export type ListReleasesOutput = z.infer<typeof listReleasesOutput>;
