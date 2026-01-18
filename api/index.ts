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
    body {
      font-family: monospace;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      color: #fff;
      margin-bottom: 10px;
    }
    .status {
      color: #4ec9b0;
      margin-bottom: 30px;
    }
    h2 {
      color: #dcdcaa;
      margin-top: 30px;
      margin-bottom: 15px;
    }
    .endpoint {
      margin: 15px 0;
      padding: 12px;
      background: #252526;
      border-left: 3px solid #007acc;
    }
    .method {
      color: #4ec9b0;
      font-weight: bold;
    }
    .path {
      color: #ce9178;
    }
    .desc {
      color: #858585;
      margin-top: 5px;
    }
    a {
      color: #4fc1ff;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <h1>SafeTransit API</h1>
  <div class="status">Status: Online</div>

  <h2>Endpoints</h2>

  <div class="endpoint">
    <span class="method">POST</span>
    <span class="path">/api/auth/google</span>
    <div class="desc">Google Sign-In/Sign-Up</div>
  </div>

  <div class="endpoint">
    <span class="method">POST</span>
    <span class="path">/api/auth/login</span>
    <div class="desc">Email/Password Login</div>
  </div>

  <div class="endpoint">
    <span class="method">POST</span>
    <span class="path">/api/auth/signup</span>
    <div class="desc">User Registration</div>
  </div>

  <div class="endpoint">
    <span class="method">GET</span>
    <span class="path">/api/auth/verify</span>
    <div class="desc">Verify JWT Token</div>
  </div>

  <div class="endpoint">
    <span class="method">POST</span>
    <span class="path">/api/auth/link-google</span>
    <div class="desc">Link Google to Account</div>
  </div>

  <div class="endpoint">
    <span class="method">POST/PUT</span>
    <span class="path">/api/user/profile</span>
    <div class="desc">Update Profile (Name, Photo, Phone, Image Upload)</div>
  </div>

  <div class="endpoint">
    <span class="method">GET</span>
    <span class="path">/api/contacts/emergency</span>
    <div class="desc">Get Emergency Contacts</div>
  </div>

  <div class="endpoint">
    <span class="method">POST</span>
    <span class="path">/api/contacts/emergency</span>
    <div class="desc">Save Emergency Contacts</div>
  </div>

  <div class="endpoint">
    <span class="method">GET</span>
    <span class="path">/api/locations/search</span>
    <div class="desc">Search Locations (Proximity + Ranking)</div>
  </div>

  <div class="endpoint">
    <span class="method">GET</span>
    <span class="path">/api/locations/reverse</span>
    <div class="desc">Reverse Geocoding</div>
  </div>

  <div class="endpoint">
    <span class="method">GET</span>
    <span class="path">/api/locations/pickup-points</span>
    <div class="desc">Get Pickup Points for Location (Grab-style Multi-Entrance)</div>
  </div>

  <div class="endpoint">
    <span class="method">GET/POST/PUT/DELETE</span>
    <span class="path">/api/user/saved-places</span>
    <div class="desc">User Saved Places (Home, Work, Favorites)</div>
  </div>

  <div class="endpoint">
    <span class="method">GET</span>
    <span class="path">/api/user/suggestions</span>
    <div class="desc">Personalized Location Suggestions</div>
  </div>

  <div class="endpoint">
    <span class="method">POST</span>
    <span class="path">/api/user/track-location</span>
    <div class="desc">Track User Location Actions</div>
  </div>

  <div class="endpoint">
    <span class="method">POST</span>
    <span class="path">/api/uploadthing</span>
    <div class="desc">UploadThing File Upload Handler</div>
  </div>

  <p style="margin-top: 40px; color: #858585;">
    <a href="https://github.com/NOTMORSE-PROG/SafeTransit_Backend">GitHub</a>
  </p>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
}
