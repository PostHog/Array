#!/usr/bin/env node

import { chromium } from "playwright";

const args = process.argv.slice(2);
const portArgIndex = args.indexOf("--port");
const roundsArgIndex = args.indexOf("--rounds");
const port = Number(
  portArgIndex >= 0
    ? args[portArgIndex + 1]
    : (process.env.POSTHOG_CODE_CDP_PORT ?? 9222),
);
const rounds = Number(roundsArgIndex >= 0 ? args[roundsArgIndex + 1] : 7);
const titles = args.filter(
  (_, index) =>
    index !== portArgIndex &&
    index !== portArgIndex + 1 &&
    index !== roundsArgIndex &&
    index !== roundsArgIndex + 1,
);

if (titles.length !== 2 || !Number.isInteger(rounds) || rounds < 1) {
  console.error(
    'Usage: node scripts/measure-task-switch.mjs [--port 9222] [--rounds 7] "Task A" "Task B"',
  );
  process.exit(1);
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts().flatMap((context) => context.pages())[0];

if (!page) {
  throw new Error(`No renderer page found on CDP port ${port}`);
}

async function switchTask(title) {
  return page.evaluate(async (taskTitle) => {
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      let current = element;
      while (current) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        current = current.parentElement;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const getActiveTaskId = () =>
      [...document.querySelectorAll("[data-task-detail-id]")]
        .find(isVisible)
        ?.getAttribute("data-task-detail-id");
    const button = [
      ...document.querySelectorAll('button[draggable="true"]'),
    ].find(
      (candidate) =>
        !candidate.closest("#tabbed-panel-tab-bar") &&
        [...candidate.querySelectorAll("span")].some(
          (span) =>
            span.childElementCount === 0 &&
            span.textContent?.trim() === taskTitle,
        ),
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Task button not found: ${taskTitle}`);
    }

    const previousTaskId = getActiveTaskId();
    const startedAt = performance.now();

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Task detail did not switch: ${taskTitle}`));
      }, 15000);
      const observer = new MutationObserver(() => {
        const taskId = getActiveTaskId();
        if (
          !taskId ||
          taskId === previousTaskId ||
          button.getAttribute("data-active") !== "true"
        ) {
          return;
        }

        observer.disconnect();
        window.clearTimeout(timeout);
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      observer.observe(document.body, {
        attributeFilter: ["data-task-detail-id", "style"],
        attributes: true,
        childList: true,
        subtree: true,
      });
      button.click();
    });

    return performance.now() - startedAt;
  }, title);
}

const firstTaskIsActive = await page.evaluate((title) => {
  const button = [
    ...document.querySelectorAll('button[draggable="true"]'),
  ].find((candidate) => candidate.textContent?.includes(title));
  return button?.getAttribute("data-active") === "true";
}, titles[0]);
let currentTitleIndex = firstTaskIsActive ? 0 : 1;
currentTitleIndex = (currentTitleIndex + 1) % 2;
await switchTask(titles[currentTitleIndex]);
const samples = [];
const directionalSamples = new Map(titles.map((title) => [title, []]));
for (let index = 0; index < rounds; index++) {
  currentTitleIndex = (currentTitleIndex + 1) % 2;
  const destinationTitle = titles[currentTitleIndex];
  const duration = await switchTask(destinationTitle);
  samples.push(duration);
  directionalSamples.get(destinationTitle).push(duration);
}

samples.sort((left, right) => left - right);
const median = samples[Math.floor(samples.length / 2)];
const directions = Object.fromEntries(
  [...directionalSamples].map(([destinationTitle, durations]) => {
    durations.sort((left, right) => left - right);
    return [
      destinationTitle,
      {
        median: durations[Math.floor(durations.length / 2)],
        samples: durations,
      },
    ];
  }),
);
console.log(JSON.stringify({ median, samples, directions }));
await browser.close();
