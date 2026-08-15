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
          created_at: string | null
          id: string
          is_template: boolean | null
          items: Json | null
          name: string
          season_id: string
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_template?: boolean | null
          items?: Json | null
          name?: string
          season_id: string
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_template?: boolean | null
          items?: Json | null
          name?: string
          season_id?: string
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklists_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
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
      invites: {
        Row: {
          code: string
          created_at: string | null
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          team_id: string
          use_count: number
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          team_id: string
          use_count?: number
        }
        Update: {
          code?: string
          created_at?: string | null
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
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      match_plans: {
        Row: {
          alliance_team: string | null
          created_at: string | null
          drawing_data: Json | null
          id: string
          match_number: number | null
          notes: string | null
          partner_autonomous: boolean
          partner_park: boolean
          season_id: string
          team_id: string
          title: string | null
          updated_at: string | null
        }
        Insert: {
          alliance_team?: string | null
          created_at?: string | null
          drawing_data?: Json | null
          id?: string
          match_number?: number | null
          notes?: string | null
          partner_autonomous?: boolean
          partner_park?: boolean
          season_id: string
          team_id: string
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          alliance_team?: string | null
          created_at?: string | null
          drawing_data?: Json | null
          id?: string
          match_number?: number | null
          notes?: string | null
          partner_autonomous?: boolean
          partner_park?: boolean
          season_id?: string
          team_id?: string
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_plans_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
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
      scouting_reports: {
        Row: {
          created_at: string | null
          created_by: string | null
          data: Json | null
          event_name: string | null
          id: string
          match_number: number | null
          opponent_team_number: string
          season_id: string
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          data?: Json | null
          event_name?: string | null
          id?: string
          match_number?: number | null
          opponent_team_number: string
          season_id: string
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          data?: Json | null
          event_name?: string | null
          id?: string
          match_number?: number | null
          opponent_team_number?: string
          season_id?: string
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scouting_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scouting_reports_created_by_team_fkey"
            columns: ["created_by", "team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "scouting_reports_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
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
          created_at: string | null
          field_image_data: string | null
          id: string
          name: string
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          field_image_data?: string | null
          id?: string
          name: string
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          field_image_data?: string | null
          id?: string
          name?: string
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
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
          created_at: string | null
          id: string
          member_ids: string[] | null
          name: string
          season_id: string | null
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          member_ids?: string[] | null
          name: string
          season_id?: string | null
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          member_ids?: string[] | null
          name?: string
          season_id?: string | null
          team_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sub_teams_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
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
          checklist: Json | null
          created_at: string | null
          description: string | null
          due_date: string | null
          id: string
          season_id: string
          status: string
          sub_team_id: string | null
          tags: string[] | null
          team_id: string
          timeline: Json | null
          title: string
          type: string
          updated_at: string | null
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          checklist?: Json | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          season_id: string
          status?: string
          sub_team_id?: string | null
          tags?: string[] | null
          team_id: string
          timeline?: Json | null
          title: string
          type?: string
          updated_at?: string | null
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          checklist?: Json | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          season_id?: string
          status?: string
          sub_team_id?: string | null
          tags?: string[] | null
          team_id?: string
          timeline?: Json | null
          title?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_team_fkey"
            columns: ["assigned_to", "team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "tasks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_sub_team_id_fkey"
            columns: ["sub_team_id"]
            isOneToOne: false
            referencedRelation: "sub_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_sub_team_team_fkey"
            columns: ["sub_team_id", "team_id"]
            isOneToOne: false
            referencedRelation: "sub_teams"
            referencedColumns: ["id", "team_id"]
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
          is_billing_active: boolean
          joined_at: string | null
          role: string
          status: string
          team_id: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_billing_active?: boolean
          joined_at?: string | null
          role?: string
          status?: string
          team_id: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_billing_active?: boolean
          joined_at?: string | null
          role?: string
          status?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
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
          created_at: string | null
          id: string
          name: string
          owner_id: string
          team_number: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          owner_id: string
          team_number?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          owner_id?: string
          team_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_attestations: {
        Row: {
          attestation_type: string
          attested_at: string | null
          id: string
          user_id: string
          version: string
        }
        Insert: {
          attestation_type: string
          attested_at?: string | null
          id?: string
          user_id: string
          version?: string
        }
        Update: {
          attestation_type?: string
          attested_at?: string | null
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
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          age_classification?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email: string
          full_name?: string | null
          id: string
          updated_at?: string | null
        }
        Update: {
          age_classification?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_team_as_coach: {
        Args: { team_name: string; team_number?: string }
        Returns: Json
      }
      get_user_team_ids: { Args: { user_uuid: string }; Returns: string[] }
      is_team_coach: {
        Args: { p_team_id: string; p_user_id: string }
        Returns: boolean
      }
      is_team_member: {
        Args: { p_team_id: string; p_user_id: string }
        Returns: boolean
      }
      join_team_with_invite: { Args: { invite_code: string }; Returns: Json }
      update_user_age_classification: {
        Args: { classification: string }
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

