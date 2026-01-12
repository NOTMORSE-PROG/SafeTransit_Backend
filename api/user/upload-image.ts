// Direct Image Upload API Endpoint
// Handles file upload from React Native via base64 and uploads to UploadThing

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../services/auth/jwt';
import { UTApi } from 'uploadthing/server';

// Initialize UploadThing API
const utapi = new UTApi({
  token: process.env.UPLOADTHING_TOKEN,
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb',
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { base64, fileName, mimeType } = req.body;

    if (!base64 || !fileName) {
      return res.status(400).json({ error: 'base64 and fileName are required' });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const fileType = mimeType || 'image/jpeg';
    if (!allowedTypes.includes(fileType)) {
      return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, and WEBP are allowed.' });
    }

    // Convert base64 to buffer
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Check file size (4MB limit)
    if (buffer.length > 4 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds 4MB limit' });
    }

    // Create a File object for UploadThing
    const file = new File([buffer], fileName, { type: fileType });

    // Upload to UploadThing
    console.log('Uploading file to UploadThing:', fileName, 'size:', buffer.length);
    const uploadResult = await utapi.uploadFiles([file]);

    if (!uploadResult[0] || uploadResult[0].error) {
      console.error('UploadThing error:', uploadResult[0]?.error);
      return res.status(500).json({ 
        error: 'Failed to upload file',
        details: uploadResult[0]?.error?.message 
      });
    }

    const uploadedFile = uploadResult[0].data;
    console.log('Upload successful:', uploadedFile.ufsUrl);

    return res.status(200).json({
      success: true,
      url: uploadedFile.ufsUrl,
      key: uploadedFile.key,
    });
  } catch (error) {
    console.error('Upload image error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
