import { HOG_B64 } from "./errorPage";

export function buildNewTabPage(): string {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #1a1a1a;
    color: #e8e8e8;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 40px 20px;
  }
  .container {
    text-align: center;
    max-width: 460px;
  }
  .hog {
    width: 160px;
    height: auto;
    margin: 0 auto 28px;
    filter: drop-shadow(0 8px 32px rgba(0,0,0,.6));
  }
  h1 {
    font-size: 24px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.3px;
    margin-bottom: 10px;
  }
  p {
    font-size: 14px;
    line-height: 1.65;
    color: #888;
    max-width: 400px;
  }
  .footer {
    margin-top: 24px;
    font-size: 11px;
    color: #444;
    letter-spacing: 0.5px;
  }
</style>
</head>
<body>
<div class="container">
  <img class="hog" src="data:image/png;base64,${HOG_B64}" alt="" />
  <h1>Hedge Browser</h1>
  <p>A lightweight browser built right into your workspace. Check things quickly without breaking your flow.</p>
  <div class="footer">you still have the option to open links in your preferred browser</div>
</div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
