/**
 * Type definitions for API requests and responses
 */

// ============================================================================
// Authentication Types
// ============================================================================

export interface UserRegisterRequest {
  email: string;
  username: string;
  password: string;
}

export interface UserLoginRequest {
  email: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface UserResponse {
  id: string;
  email: string;
  username: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  updated_at?: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

// ============================================================================
// Folder Types
// ============================================================================

export interface FolderCreate {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parent_id?: string;
  position?: number;
}

export interface FolderUpdate {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  parent_id?: string;
  position?: number;
}

export interface FolderMove {
  parent_id?: string;
  position?: number;
}

export interface FolderResponse {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parent_id?: string;
  position: number;
  created_at: string;
  updated_at?: string;
  children?: FolderResponse[];
}

export interface FolderTree {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  parent_id?: string;
  position: number;
  children: FolderTree[];
  bookmark_count?: number;
}

export interface FolderBulkDelete {
  folder_ids: string[];
}

export interface FolderBulkMove {
  folder_ids: string[];
  target_parent_id?: string;
}

// ============================================================================
// Bookmark Types (for future implementation)
// ============================================================================

export interface BookmarkCreate {
  norma_key: string;
  norma_data: any; // JSON object
  folder_id?: string;
  tags?: string[];
  notes?: string;
}

export interface BookmarkResponse {
  id: string;
  norma_key: string;
  norma_data: any;
  folder_id?: string;
  tags: string[];
  notes?: string;
  created_at: string;
  updated_at?: string;
}

// ============================================================================
// Annotation Types (for future implementation)
// ============================================================================

export type AnnotationType = 'note' | 'question' | 'important' | 'follow_up' | 'summary';

export interface AnnotationCreate {
  norma_key: string;
  content: string;
  annotation_type?: AnnotationType;
  bookmark_id?: string;
  text_context?: string;
  position?: string;
}

export interface AnnotationResponse {
  id: string;
  norma_key: string;
  content: string;
  annotation_type: AnnotationType;
  bookmark_id?: string;
  text_context?: string;
  position?: string;
  created_at: string;
  updated_at?: string;
}

// ============================================================================
// Highlight Types (for future implementation)
// ============================================================================

export interface HighlightCreate {
  norma_key: string;
  text: string;
  color: string;
  start_offset?: number;
  end_offset?: number;
  container_id?: string;
  note?: string;
  bookmark_id?: string;
}

export interface HighlightResponse {
  id: string;
  norma_key: string;
  text: string;
  color: string;
  start_offset?: number;
  end_offset?: number;
  container_id?: string;
  note?: string;
  bookmark_id?: string;
  created_at: string;
  updated_at?: string;
}

// ============================================================================
// API Error Types
// ============================================================================

export interface APIError {
  status?: number;
  message: string;
  data?: any;
}
