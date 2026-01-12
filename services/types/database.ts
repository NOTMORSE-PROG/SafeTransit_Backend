// Database Type Definitions for SafeTransit
// Matches the PostgreSQL schema created by migrations

// ==============================================================================
// Enum Types
// ==============================================================================

export type VerificationStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type TipCategory = 'lighting' | 'safety' | 'transit' | 'harassment' | 'safe_haven';
export type TimeRelevance = 'morning' | 'afternoon' | 'evening' | 'night' | '24/7';
export type TipStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type VoteType = 'up' | 'down';
export type FamilyRole = 'creator' | 'member';
export type VerificationRequestStatus = 'pending' | 'approved' | 'rejected';

// ==============================================================================
// Query Result Types
// ==============================================================================

export interface QueryResult {
  count: number;
}

// ==============================================================================
// Users & Authentication
// ==============================================================================

export interface User {
  id: string; // UUID
  email: string;
  password_hash: string | null; // Nullable for Google-only accounts
  full_name: string;
  profile_image_url: string | null;
  phone_number: string | null;
  is_verified: boolean;
  verification_status: VerificationStatus;
  google_id: string | null;
  onboarding_completed: boolean;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

export interface PasswordResetToken {
  id: string; // UUID
  user_id: string; // UUID
  token: string;
  expires_at: string; // ISO timestamp
  used_at: string | null; // ISO timestamp
  created_at: string; // ISO timestamp
}

// ==============================================================================
// Emergency Contacts
// ==============================================================================

export interface EmergencyContact {
  id: string; // UUID
  user_id: string; // UUID
  name: string;
  phone_number: string;
  order: number;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

// ==============================================================================
// Community Tips
// ==============================================================================

export interface Tip {
  id: string; // UUID
  author_id: string; // UUID
  title: string;
  message: string;
  category: TipCategory;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  time_relevance: TimeRelevance;
  is_temporary: boolean;
  expires_at: string | null; // ISO timestamp
  status: TipStatus;
  upvotes: number;
  downvotes: number;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

export interface TipVote {
  tip_id: string; // UUID
  user_id: string; // UUID
  vote_type: VoteType;
  created_at: string; // ISO timestamp
}

// ==============================================================================
// Comments
// ==============================================================================

export interface Comment {
  id: string; // UUID
  tip_id: string; // UUID
  author_id: string; // UUID
  parent_id: string | null; // UUID - for threaded replies
  content: string;
  likes: number;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

export interface CommentLike {
  comment_id: string; // UUID
  user_id: string; // UUID
  created_at: string; // ISO timestamp
}

// ==============================================================================
// Family Features
// ==============================================================================

export interface Family {
  id: string; // UUID
  name: string;
  invite_code: string;
  created_by: string; // UUID
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

export interface FamilyMember {
  family_id: string; // UUID
  user_id: string; // UUID
  role: FamilyRole;
  joined_at: string; // ISO timestamp
}

export interface FamilyLocation {
  id: string; // UUID
  user_id: string; // UUID
  latitude: number;
  longitude: number;
  accuracy: number | null;
  is_live: boolean;
  timestamp: string; // ISO timestamp
}

// ==============================================================================
// Notifications
// ==============================================================================

export interface Notification {
  id: string; // UUID
  user_id: string; // UUID
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown> | null; // JSONB field
  is_read: boolean;
  created_at: string; // ISO timestamp
}

export interface NotificationSettings {
  user_id: string; // UUID - Primary Key
  community_activity: boolean;
  followed_locations: boolean;
  safety_alerts: boolean;
  system_updates: boolean;
  family_alerts: boolean;
  push_enabled: boolean;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

// ==============================================================================
// Verification
// ==============================================================================

export interface VerificationRequest {
  id: string; // UUID
  user_id: string; // UUID
  face_image_url: string;
  id_front_url: string;
  id_back_url: string | null;
  id_type: string;
  status: VerificationRequestStatus;
  rejection_reason: string | null;
  reviewed_at: string | null; // ISO timestamp
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
}

// ==============================================================================
// Followed Locations
// ==============================================================================

export interface FollowedLocation {
  user_id: string; // UUID
  location_name: string;
  latitude: number;
  longitude: number;
  radius: number; // meters
  created_at: string; // ISO timestamp
}

// ==============================================================================
// Helper Types for Inserts (Omit auto-generated fields)
// ==============================================================================

export type UserInsert = Omit<User, 'id' | 'created_at' | 'updated_at' | 'is_verified' | 'verification_status' | 'onboarding_completed'> & {
  is_verified?: boolean;
  verification_status?: VerificationStatus;
  onboarding_completed?: boolean;
};

export type TipInsert = Omit<Tip, 'id' | 'created_at' | 'updated_at' | 'upvotes' | 'downvotes' | 'status'> & {
  upvotes?: number;
  downvotes?: number;
  status?: TipStatus;
};

export type CommentInsert = Omit<Comment, 'id' | 'created_at' | 'updated_at' | 'likes'> & {
  likes?: number;
};

export type FamilyInsert = Omit<Family, 'id' | 'created_at' | 'updated_at'>;

export type NotificationInsert = Omit<Notification, 'id' | 'created_at' | 'is_read'> & {
  is_read?: boolean;
};
