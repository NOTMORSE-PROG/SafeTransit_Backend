import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../../services/auth/jwt';
import { validatePhoneNumber } from '../../services/auth/validation';
import { UserRepository } from '../../services/repositories/userRepository';
import { UTApi } from 'uploadthing/server';

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

function extractFileKey(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\/f\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { base64, fileName, mimeType, phoneNumber, fullName, profileImageUrl, removePhoto } = req.body;

    if (base64 && fileName) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
      const fileType = mimeType || 'image/jpeg';
      if (!allowedTypes.includes(fileType)) {
        return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, and WEBP are allowed.' });
      }

      const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      if (buffer.length > 4 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size exceeds 4MB limit' });
      }

      const file = new File([buffer], fileName, { type: fileType });
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
      console.log('Upload successful:', uploadedFile.url);

      return res.status(200).json({
        success: true,
        url: uploadedFile.url,
        key: uploadedFile.key,
      });
    }

    if (phoneNumber) {
      const validation = validatePhoneNumber(phoneNumber);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error || 'Invalid phone number' });
      }

      const updatedUser = await UserRepository.updateProfile(payload.userId, {
        phone_number: validation.formatted,
      });

      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }

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
    }

    if (fullName === undefined && profileImageUrl === undefined && !removePhoto) {
      return res.status(400).json({
        error: 'At least one of fullName, profileImageUrl, phoneNumber, or removePhoto is required'
      });
    }

    const currentUser = await UserRepository.findById(payload.userId);
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldImageUrl = currentUser.profile_image_url;
    const shouldDeleteOldImage = oldImageUrl && (
      removePhoto ||
      (profileImageUrl && profileImageUrl !== oldImageUrl)
    );

    if (shouldDeleteOldImage && oldImageUrl) {
      const fileKey = extractFileKey(oldImageUrl);
      if (fileKey) {
        try {
          console.log('Deleting old profile image:', fileKey);
          await utapi.deleteFiles([fileKey]);
          console.log('Successfully deleted old profile image');
        } catch (deleteError) {
          console.error('Failed to delete old profile image:', deleteError);
        }
      }
    }

    const updateData: {
      full_name?: string;
      profile_image_url?: string | null;
    } = {};

    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || fullName.trim().length < 2) {
        return res.status(400).json({ error: 'Name must be at least 2 characters' });
      }
      updateData.full_name = fullName.trim();
    }

    if (removePhoto) {
      updateData.profile_image_url = null;
    } else if (profileImageUrl !== undefined) {
      updateData.profile_image_url = profileImageUrl;
    }

    const updatedUser = await UserRepository.updateProfile(payload.userId, updateData);

    if (!updatedUser) {
      return res.status(404).json({ error: 'Failed to update user' });
    }

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
    console.error('Profile API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
