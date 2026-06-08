import fs from "node:fs";

const [reportPath, outPath] = process.argv.slice(2);
const MARKER = "<!-- react-doctor:summary -->";
const slug = process.env.GITHUB_REPOSITORY;
const server = (process.env.GITHUB_SERVER_URL || "https://github.com").replace(
  /\/$/,
  "",
);
const head = (
  process.env.REACT_DOCTOR_HEAD_SHA ||
  process.env.GITHUB_SHA ||
  ""
).trim();

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const inline = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const byFileThenLine = (a, b) =>
  a.filePath === b.filePath
    ? a.line - b.line
    : a.filePath < b.filePath
      ? -1
      : 1;
const fileLink = (file, line) =>
  slug && head
    ? `[\`${file}:${line}\`](${server}/${slug}/blob/${head}/${file}#L${line})`
    : `\`${file}:${line}\``;

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch {
  report = null;
}

const lines = [MARKER, ""];

if (!report) {
  lines.push("**React Doctor** could not produce a report.");
} else if (!report.ok) {
  lines.push(
    "**React Doctor** could not complete this scan.",
    "",
    `> ${inline(report.error?.message) || "scan failed"}`,
  );
} else {
  const summary = report.summary ?? {};
  const total = summary.totalDiagnosticCount ?? 0;
  const diagnostics = (report.projects ?? []).flatMap(
    (project) => project.diagnostics ?? [],
  );

  if (total === 0) {
    lines.push("**React Doctor** found no issues in the changed files. 🎉");
  } else {
    const severity = [];
    if (summary.errorCount) severity.push(plural(summary.errorCount, "error"));
    if (summary.warningCount)
      severity.push(plural(summary.warningCount, "warning"));
    const severityTail = severity.length ? ` · ${severity.join(" & ")}` : "";
    lines.push(
      `**React Doctor** found **${plural(total, "issue")}** in ${plural(summary.affectedFileCount ?? 0, "file")}${severityTail}.`,
    );

    const errors = diagnostics
      .filter((d) => d.severity === "error")
      .sort(byFileThenLine);
    if (errors.length) {
      lines.push("", "**Errors**", "");
      for (const error of errors) {
        const title = inline(error.title);
        lines.push(
          `- ❌ ${fileLink(error.filePath, error.line)}${title ? ` ${title}` : ""} \`${error.rule}\``,
        );
      }
    }

    const warnings = diagnostics
      .filter((d) => d.severity === "warning")
      .sort(byFileThenLine);
    if (warnings.length) {
      lines.push(
        "",
        `<details><summary>${plural(warnings.length, "warning")}</summary>`,
        "",
      );
      let currentFile = null;
      for (const warning of warnings.slice(0, 50)) {
        if (warning.filePath !== currentFile) {
          if (currentFile !== null) lines.push("");
          lines.push(`**\`${warning.filePath}\`**`);
          currentFile = warning.filePath;
        }
        const title = inline(warning.title);
        lines.push(
          `- ⚠️ ${fileLink(warning.filePath, warning.line)}${title ? ` ${title}` : ""} \`${warning.rule}\``,
        );
      }
      if (warnings.length > 50)
        lines.push(
          "",
          `${plural(warnings.length - 50, "more warning")} not shown.`,
        );
      lines.push("", "</details>");
    }
  }
}

const commit = head ? ` for commit \`${head.slice(0, 7)}\`` : "";
lines.push(
  "",
  `<sub>Reviewed by [React Doctor](https://react.doctor)${commit}.</sub>`,
);

fs.writeFileSync(
  outPath,
  `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`,
);
