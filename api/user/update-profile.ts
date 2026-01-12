// Update User Profile API Endpoint
// Handles profile updates including name and profile image URL
// Auto-deletes old profile images from UploadThing when replaced

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../services/auth/jwt';
import { UserRepository } from '../../services/repositories/userRepository';
import { UTApi } from 'uploadthing/server';

// Initialize UploadThing API for file deletion
const utapi = new UTApi({
  token: process.env.UPLOADTHING_TOKEN,
});

/**
 * Extract UploadThing file key from URL
 * UploadThing URLs look like: https://utfs.io/f/{fileKey}
 */
function extractFileKey(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Handle both utfs.io and uploadthing.com URLs
    const pathname = urlObj.pathname;
    // The file key is typically after /f/
    const match = pathname.match(/\/f\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow both PUT and POST for flexibility
  if (req.method !== 'PUT' && req.method !== 'POST') {
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

    const { fullName, profileImageUrl, removePhoto } = req.body;

    // At least one field must be provided
    if (fullName === undefined && profileImageUrl === undefined && !removePhoto) {
      return res.status(400).json({ 
        error: 'At least one of fullName, profileImageUrl, or removePhoto is required' 
      });
    }

    // Get current user to check for existing profile image
    const currentUser = await UserRepository.findById(payload.userId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Handle photo removal or replacement - delete old image from UploadThing
    const oldImageUrl = currentUser.profile_image_url;
    const shouldDeleteOldImage = oldImageUrl && (
      removePhoto || // User explicitly wants to remove photo
      (profileImageUrl && profileImageUrl !== oldImageUrl) // User is uploading a new photo
    );

    if (shouldDeleteOldImage && oldImageUrl) {
      const fileKey = extractFileKey(oldImageUrl);
      if (fileKey) {
        try {
          console.log('Deleting old profile image:', fileKey);
          await utapi.deleteFiles([fileKey]);
          console.log('Successfully deleted old profile image');
        } catch (deleteError) {
          // Log but don't fail the request if deletion fails
          console.error('Failed to delete old profile image:', deleteError);
        }
      }
    }

    // Prepare update data
    const updateData: {
      full_name?: string;
      profile_image_url?: string | null;
    } = {};

    if (fullName !== undefined) {
      // Validate name
      if (typeof fullName !== 'string' || fullName.trim().length < 2) {
        return res.status(400).json({ error: 'Name must be at least 2 characters' });
      }
      updateData.full_name = fullName.trim();
    }

    if (removePhoto) {
      // Clear the profile image URL
      updateData.profile_image_url = null;
    } else if (profileImageUrl !== undefined) {
      updateData.profile_image_url = profileImageUrl;
    }

    // Update user profile
    const updatedUser = await UserRepository.updateProfile(payload.userId, updateData);

    if (!updatedUser) {
      return res.status(404).json({ error: 'Failed to update user' });
    }

    // Return formatted user data
    return res.status(200).json({
      success: true,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.full_name,
        profileImageUrl: updatedUser.profile_image_url,
        phoneNumber: updatedUser.phone_number,
        onboardingCompleted: updatedUser.onboarding_completed,
        hasGoogleLinked: !!updatedUser.google_id,
        hasPasswordSet: !!updatedUser.password_hash,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
