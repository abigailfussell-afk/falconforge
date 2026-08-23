export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      checklists: {
        Row: {
          created_at: string
          id: string
          is_template: boolean
          items: Json
          name: string
          season_id: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_template?: boolean
          items?: Json
          name?: string
          season_id: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_template?: boolean
          items?: Json
          name?: string
          season_id?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_season_id_team_id_fkey"
            columns: ["season_id", "team_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "checklists_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "checklists_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      extra_team_grants: {
        Row: {
          created_at: string
          granted_by: string
          id: string
          notes: string | null
          used_at: string | null
          used_team_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by: string
          id?: string
          notes?: string | null
          used_at?: string | null
          used_team_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string
          id?: string
          notes?: string | null
          used_at?: string | null
          used_team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extra_team_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extra_team_grants_used_team_id_fkey"
            columns: ["used_team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "extra_team_grants_used_team_id_fkey"
            columns: ["used_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extra_team_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_consents: {
        Row: {
          consent_type: string
          consented_at: string
          guardian_user_id: string
          id: string
          managed_profile_id: string
          updated_at: string
          version: string
        }
        Insert: {
          consent_type: string
          consented_at?: string
          guardian_user_id: string
          id?: string
          managed_profile_id: string
          updated_at?: string
          version: string
        }
        Update: {
          consent_type?: string
          consented_at?: string
          guardian_user_id?: string
          id?: string
          managed_profile_id?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_consents_managed_profile_id_guardian_user_id_fkey"
            columns: ["managed_profile_id", "guardian_user_id"]
            isOneToOne: false
            referencedRelation: "managed_profiles"
            referencedColumns: ["id", "guardian_user_id"]
          },
        ]
      }
      invites: {
        Row: {
          code: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          team_id: string
          use_count: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          team_id: string
          use_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          team_id?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      license_grants: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          revoked_at: string | null
          seats: number | null
          source: string
          team_id: string
          team_member_id: string | null
          updated_at: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          revoked_at?: string | null
          seats?: number | null
          source: string
          team_id: string
          team_member_id?: string | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          revoked_at?: string | null
          seats?: number | null
          source?: string
          team_id?: string
          team_member_id?: string | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "license_grants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "license_grants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "license_grants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "license_grants_team_member_id_team_id_fkey"
            columns: ["team_member_id", "team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      managed_profiles: {
        Row: {
          created_at: string
          full_name: string
          guardian_user_id: string
          id: string
          notes: string | null
          promoted_at: string | null
          promoted_to_user_id: string | null
          promotion_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          guardian_user_id: string
          id?: string
          notes?: string | null
          promoted_at?: string | null
          promoted_to_user_id?: string | null
          promotion_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          guardian_user_id?: string
          id?: string
          notes?: string | null
          promoted_at?: string | null
          promoted_to_user_id?: string | null
          promotion_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "managed_profiles_guardian_user_id_fkey"
            columns: ["guardian_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_profiles_promoted_to_user_id_fkey"
            columns: ["promoted_to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      match_plans: {
        Row: {
          alliance_team: string | null
          created_at: string
          drawing_data: Json
          id: string
          match_number: number | null
          notes: string | null
          partner_autonomous: boolean
          partner_park: boolean
          season_id: string
          team_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          alliance_team?: string | null
          created_at?: string
          drawing_data?: Json
          id?: string
          match_number?: number | null
          notes?: string | null
          partner_autonomous?: boolean
          partner_park?: boolean
          season_id: string
          team_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          alliance_team?: string | null
          created_at?: string
          drawing_data?: Json
          id?: string
          match_number?: number | null
          notes?: string | null
          partner_autonomous?: boolean
          partner_park?: boolean
          season_id?: string
          team_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_plans_season_id_team_id_fkey"
            columns: ["season_id", "team_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "match_plans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "match_plans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_attendance: {
        Row: {
          attested_at: string | null
          attested_by: string | null
          created_at: string
          id: string
          meeting_id: string
          method: string
          notes: string | null
          status: string
          team_id: string
          team_member_id: string
          updated_at: string
        }
        Insert: {
          attested_at?: string | null
          attested_by?: string | null
          created_at?: string
          id?: string
          meeting_id: string
          method?: string
          notes?: string | null
          status?: string
          team_id: string
          team_member_id: string
          updated_at?: string
        }
        Update: {
          attested_at?: string | null
          attested_by?: string | null
          created_at?: string
          id?: string
          meeting_id?: string
          method?: string
          notes?: string | null
          status?: string
          team_id?: string
          team_member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_attendance_attested_by_team_id_fkey"
            columns: ["attested_by", "team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "meeting_attendance_meeting_id_team_id_fkey"
            columns: ["meeting_id", "team_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "meeting_attendance_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "meeting_attendance_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_attendance_team_member_id_team_id_fkey"
            columns: ["team_member_id", "team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      meetings: {
        Row: {
          attendance_required: boolean
          checkin_closes_at: string | null
          checkin_opens_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          event_type: string
          id: string
          location: string | null
          public_code: string | null
          recurrence_rule: string | null
          season_id: string
          series_id: string | null
          starts_at: string
          team_id: string
          title: string
          updated_at: string
        }
        Insert: {
          attendance_required?: boolean
          checkin_closes_at?: string | null
          checkin_opens_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          event_type?: string
          id?: string
          location?: string | null
          public_code?: string | null
          recurrence_rule?: string | null
          season_id: string
          series_id?: string | null
          starts_at: string
          team_id: string
          title: string
          updated_at?: string
        }
        Update: {
          attendance_required?: boolean
          checkin_closes_at?: string | null
          checkin_opens_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          event_type?: string
          id?: string
          location?: string | null
          public_code?: string | null
          recurrence_rule?: string | null
          season_id?: string
          series_id?: string | null
          starts_at?: string
          team_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_created_by_team_id_fkey"
            columns: ["created_by", "team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "meetings_season_id_team_id_fkey"
            columns: ["season_id", "team_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "meetings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "meetings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_actions: {
        Row: {
          action: string
          created_at: string
          detail: Json
          id: string
          notes: string | null
          operator_user_id: string
          team_id: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: Json
          id?: string
          notes?: string | null
          operator_user_id: string
          team_id: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: Json
          id?: string
          notes?: string | null
          operator_user_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_actions_operator_user_id_fkey"
            columns: ["operator_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_actions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "operator_actions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_operators: {
        Row: {
          created_at: string
          notes: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          notes?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_operators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      scouting_reports: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          event_name: string | null
          id: string
          match_number: number | null
          opponent_team_number: string
          season_id: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json
          event_name?: string | null
          id?: string
          match_number?: number | null
          opponent_team_number: string
          season_id: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          event_name?: string | null
          id?: string
          match_number?: number | null
          opponent_team_number?: string
          season_id?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scouting_reports_created_by_team_id_fkey"
            columns: ["created_by", "team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "scouting_reports_season_id_team_id_fkey"
            columns: ["season_id", "team_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "scouting_reports_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "scouting_reports_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          field_image_data: string | null
          game_title: string | null
          id: string
          is_archived: boolean
          name: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_image_data?: string | null
          game_title?: string | null
          id?: string
          is_archived?: boolean
          name: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_image_data?: string | null
          game_title?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "seasons_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_teams: {
        Row: {
          created_at: string
          id: string
          member_ids: string[]
          name: string
          season_id: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_ids?: string[]
          name: string
          season_id: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          member_ids?: string[]
          name?: string
          season_id?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_teams_season_id_team_id_fkey"
            columns: ["season_id", "team_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "sub_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "sub_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          checklist: Json
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          season_id: string
          status: string
          sub_team_id: string | null
          tags: string[]
          team_id: string
          timeline: Json
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          checklist?: Json
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          season_id: string
          status?: string
          sub_team_id?: string | null
          tags?: string[]
          team_id: string
          timeline?: Json
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          checklist?: Json
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          season_id?: string
          status?: string
          sub_team_id?: string | null
          tags?: string[]
          team_id?: string
          timeline?: Json
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_team_id_fkey"
            columns: ["assigned_to", "team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "tasks_season_id_team_id_fkey"
            columns: ["season_id", "team_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "tasks_sub_team_id_team_id_fkey"
            columns: ["sub_team_id", "team_id"]
            isOneToOne: false
            referencedRelation: "sub_teams"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          avatar_url: string | null
          email: string | null
          full_name: string | null
          id: string
          joined_at: string
          managed_profile_id: string | null
          role: string
          seat_assigned: boolean
          status: string
          team_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          joined_at?: string
          managed_profile_id?: string | null
          role?: string
          seat_assigned?: boolean
          status?: string
          team_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          joined_at?: string
          managed_profile_id?: string | null
          role?: string
          seat_assigned?: boolean
          status?: string
          team_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_managed_profile_id_fkey"
            columns: ["managed_profile_id"]
            isOneToOne: false
            referencedRelation: "managed_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "team_entitlement"
            referencedColumns: ["team_id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          pending_admin_member_id: string | null
          pending_admin_nominated_at: string | null
          pending_admin_nominated_by: string | null
          program: string
          team_number: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          pending_admin_member_id?: string | null
          pending_admin_nominated_at?: string | null
          pending_admin_nominated_by?: string | null
          program?: string
          team_number?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          pending_admin_member_id?: string | null
          pending_admin_nominated_at?: string | null
          pending_admin_nominated_by?: string | null
          program?: string
          team_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_pending_admin_member_fkey"
            columns: ["pending_admin_member_id", "id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "teams_pending_admin_nominated_by_fkey"
            columns: ["pending_admin_nominated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_attestations: {
        Row: {
          attestation_type: string
          attested_at: string
          id: string
          user_id: string
          version: string
        }
        Insert: {
          attestation_type: string
          attested_at?: string
          id?: string
          user_id: string
          version?: string
        }
        Update: {
          attestation_type?: string
          attested_at?: string
          id?: string
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_attestations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          age_classification: string | null
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          age_classification?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          age_classification?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      team_entitlement: {
        Row: {
          is_probation: boolean | null
          lapsed_at: string | null
          seats_total: number | null
          seats_unlimited: boolean | null
          seats_used: number | null
          sources: string[] | null
          status: string | null
          team_id: string | null
          valid_until: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_team_admin_nomination: {
        Args: { p_team_id: string }
        Returns: Json
      }
      admin_nomination_ttl: { Args: never; Returns: string }
      can_manage_billing: { Args: { p_team_id: string }; Returns: boolean }
      can_manage_content: { Args: { p_team_id: string }; Returns: boolean }
      can_manage_meetings: { Args: { p_team_id: string }; Returns: boolean }
      can_manage_roster: { Args: { p_team_id: string }; Returns: boolean }
      can_manage_structure: { Args: { p_team_id: string }; Returns: boolean }
      cancel_team_admin_nomination: {
        Args: { p_team_id: string }
        Returns: Json
      }
      check_in_with_code: {
        Args: { p_code: string; p_method?: string; p_team_id: string }
        Returns: Json
      }
      claim_managed_profile: { Args: { p_code: string }; Returns: Json }
      close_meeting_checkin: {
        Args: { p_meeting_id: string; p_team_id: string }
        Returns: Json
      }
      create_team_as_admin: {
        Args: { season_name: string; team_name: string; team_number?: string }
        Returns: Json
      }
      current_season_end: { Args: never; Returns: string }
      current_team_member_id: { Args: { p_team_id: string }; Returns: string }
      current_team_role: { Args: { p_team_id: string }; Returns: string }
      get_user_team_ids: { Args: never; Returns: string[] }
      grant_team_license: {
        Args: {
          p_notes?: string
          p_seats?: number
          p_team_id: string
          p_valid_until?: string
        }
        Returns: Json
      }
      guardian_member_ids: { Args: { p_team_id: string }; Returns: string[] }
      is_platform_operator: { Args: never; Returns: boolean }
      is_profile_guardian: { Args: { p_profile_id: string }; Returns: boolean }
      is_team_guardian: { Args: { p_team_id: string }; Returns: boolean }
      is_team_member: { Args: { p_team_id: string }; Returns: boolean }
      join_team_with_invite: { Args: { invite_code: string }; Returns: Json }
      join_team_with_invite_for_child: {
        Args: { invite_code: string; p_managed_profile_id: string }
        Returns: Json
      }
      meeting_checkin_closes: {
        Args: { p_meeting: Database["public"]["Tables"]["meetings"]["Row"] }
        Returns: string
      }
      meeting_checkin_opens: {
        Args: { p_meeting: Database["public"]["Tables"]["meetings"]["Row"] }
        Returns: string
      }
      meeting_season_is_open: {
        Args: { p_meeting_id: string; p_team_id: string }
        Returns: boolean
      }
      nominate_team_admin: {
        Args: { p_new_member_id: string; p_team_id: string }
        Returns: Json
      }
      offer_managed_profile_promotion: {
        Args: { p_managed_profile_id: string }
        Returns: Json
      }
      operator_extend_to_season: {
        Args: { p_notes?: string; p_team_id: string }
        Returns: Json
      }
      operator_grant_extra_team: {
        Args: { p_notes?: string; p_user_id: string }
        Returns: Json
      }
      operator_new_teams: {
        Args: { p_limit?: number }
        Returns: {
          admin_email: string
          admin_name: string
          age_days: number
          content_rows: number
          created_at: string
          has_been_used: boolean
          is_probation: boolean
          members_total: number
          program: string
          team_id: string
          team_name: string
          team_number: string
          valid_until: string
        }[]
      }
      operator_revoke_license: {
        Args: {
          p_all?: boolean
          p_grant_id?: string
          p_notes?: string
          p_team_id: string
        }
        Returns: Json
      }
      operator_team_detail: { Args: { p_team_id: string }; Returns: Json }
      operator_team_directory: {
        Args: { p_search?: string }
        Returns: {
          admin_email: string
          admin_member_id: string
          admin_name: string
          created_at: string
          entitlement_status: string
          members_approved: number
          members_pending: number
          seats_total: number
          seats_unlimited: boolean
          seats_used: number
          team_id: string
          team_name: string
          team_number: string
          valid_until: string
        }[]
      }
      operator_transfer_team_admin: {
        Args: { p_new_member_id: string; p_notes?: string; p_team_id: string }
        Returns: Json
      }
      season_is_open: {
        Args: { p_season_id: string; p_team_id: string }
        Returns: boolean
      }
      team_can_write: { Args: { p_team_id: string }; Returns: boolean }
      team_seats_remaining: { Args: { p_team_id: string }; Returns: number }
      transfer_team_admin: {
        Args: { p_new_member_id: string; p_team_id: string }
        Returns: Json
      }
      update_user_age_classification: {
        Args: { classification: string }
        Returns: Json
      }
      withdraw_managed_profile_promotion: {
        Args: { p_managed_profile_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

