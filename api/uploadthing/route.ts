// UploadThing API Route Handler for Vercel
// Handles POST requests from UploadThing client

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createRouteHandler } from 'uploadthing/server';
import { uploadRouter } from './core';

// Create the route handler
const handlers = createRouteHandler({
  router: uploadRouter,
  config: {
    token: process.env.UPLOADTHING_TOKEN,
  },
});

export default async function (req: VercelRequest, res: VercelResponse) {
  // Only allow POST method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Convert Vercel request to Web Request format for UploadThing
    const url = `https://${req.headers.host}${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        headers.set(key, value.join(', '));
      }
    }

    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body: JSON.stringify(req.body),
    });

    // Call the UploadThing handler
    const response = await handlers(webRequest);

    // Convert Web Response back to Vercel response
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('UploadThing route error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

