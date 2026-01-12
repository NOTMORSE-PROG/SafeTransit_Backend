// UploadThing Core Router Configuration
// Defines file upload endpoints with validation and middleware

import { createUploadthing, type FileRouter } from 'uploadthing/server';
import { verifyToken } from '../../services/auth/jwt';

const f = createUploadthing();

// File router for handling uploads
export const uploadRouter = {
  // Profile image upload endpoint
  profileImage: f({
    image: {
      maxFileSize: '4MB',
      maxFileCount: 1,
    },
  })
    .middleware(async ({ req }) => {
      // Extract and verify JWT token from Authorization header
      const authHeader = req.headers.get('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Unauthorized');
      }

      const token = authHeader.substring(7);
      const payload = verifyToken(token);

      if (!payload) {
        throw new Error('Invalid or expired token');
      }

      // Return user ID to be used in onUploadComplete
      return { userId: payload.userId };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      console.log('Upload complete for userId:', metadata.userId);
      console.log('File URL:', file.ufsUrl);

      // Return the file URL to the client
      return { uploadedBy: metadata.userId, url: file.ufsUrl };
    }),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
