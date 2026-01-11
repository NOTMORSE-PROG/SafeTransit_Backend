// SafeTransit Backend API Homepage
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SafeTransit API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 600px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 2.5em;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 1.1em;
    }
    .status {
      background: #10b981;
      color: white;
      padding: 10px 20px;
      border-radius: 50px;
      display: inline-block;
      margin-bottom: 30px;
      font-weight: 600;
    }
    .endpoints {
      background: #f9fafb;
      padding: 20px;
      border-radius: 10px;
      margin-top: 20px;
    }
    .endpoint {
      margin: 10px 0;
      padding: 10px;
      background: white;
      border-radius: 5px;
      border-left: 4px solid #667eea;
    }
    .method {
      color: #667eea;
      font-weight: bold;
      margin-right: 10px;
    }
    .path {
      color: #333;
      font-family: monospace;
    }
    .footer {
      margin-top: 30px;
      text-align: center;
      color: #999;
      font-size: 0.9em;
    }
    a {
      color: #667eea;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 SafeTransit API</h1>
    <p class="subtitle">Backend services for SafeTransit mobile app</p>

    <div class="status">✓ API Online</div>

    <div class="endpoints">
      <h3>Available Endpoints</h3>

      <div class="endpoint">
        <span class="method">POST</span>
        <span class="path">/api/auth/google</span>
        <p style="margin-top: 5px; color: #666; font-size: 0.9em;">Google Sign-In/Sign-Up</p>
      </div>

      <div class="endpoint">
        <span class="method">POST</span>
        <span class="path">/api/auth/login</span>
        <p style="margin-top: 5px; color: #666; font-size: 0.9em;">Email/Password Login</p>
      </div>

      <div class="endpoint">
        <span class="method">POST</span>
        <span class="path">/api/auth/signup</span>
        <p style="margin-top: 5px; color: #666; font-size: 0.9em;">User Registration</p>
      </div>

      <div class="endpoint">
        <span class="method">GET</span>
        <span class="path">/api/auth/verify</span>
        <p style="margin-top: 5px; color: #666; font-size: 0.9em;">Verify JWT Token</p>
      </div>

      <div class="endpoint">
        <span class="method">POST</span>
        <span class="path">/api/auth/link-google</span>
        <p style="margin-top: 5px; color: #666; font-size: 0.9em;">Link Google to Account</p>
      </div>
    </div>

    <div class="footer">
      <p>Built with ❤️ for SafeTransit</p>
      <p><a href="https://github.com/NOTMORSE-PROG/SafeTransit_Backend" target="_blank">View on GitHub</a></p>
    </div>
  </div>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
}
