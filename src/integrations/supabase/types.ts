export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      managed_servers: {
        Row: {
          account_id: string | null
          created_at: string
          created_by: string | null
          external_id: string | null
          id: string
          ipv4: string | null
          label: string
          monthly_price: number | null
          plan: string | null
          provider: string
          region: string | null
          status: string
          synced_at: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          id?: string
          ipv4?: string | null
          label: string
          monthly_price?: number | null
          plan?: string | null
          provider: string
          region?: string | null
          status?: string
          synced_at?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          id?: string
          ipv4?: string | null
          label?: string
          monthly_price?: number | null
          plan?: string | null
          provider?: string
          region?: string | null
          status?: string
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_servers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "provider_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company: string | null
          created_at: string
          full_name: string | null
          id: string
          plan: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          plan?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          plan?: string
        }
        Relationships: []
      }
      provider_accounts: {
        Row: {
          auth_type: string
          checked_at: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          info: Json
          label: string
          provider: string
          secret: string
          status: string
        }
        Insert: {
          auth_type?: string
          checked_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          info?: Json
          label: string
          provider: string
          secret: string
          status?: string
        }
        Update: {
          auth_type?: string
          checked_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          info?: Json
          label?: string
          provider?: string
          secret?: string
          status?: string
        }
        Relationships: []
      }
      sending_domains: {
        Row: {
          account_id: string | null
          checked_at: string | null
          checks: Json
          created_at: string
          created_by: string | null
          dkim_priv_a: string
          dkim_priv_b: string
          dkim_pub_a: string
          dkim_pub_b: string
          domain: string
          id: string
          ip: string | null
          selector_a: string
          selector_b: string
          synced_at: string | null
          zone_id: string | null
        }
        Insert: {
          account_id?: string | null
          checked_at?: string | null
          checks?: Json
          created_at?: string
          created_by?: string | null
          dkim_priv_a: string
          dkim_priv_b: string
          dkim_pub_a: string
          dkim_pub_b: string
          domain: string
          id?: string
          ip?: string | null
          selector_a: string
          selector_b: string
          synced_at?: string | null
          zone_id?: string | null
        }
        Update: {
          account_id?: string | null
          checked_at?: string | null
          checks?: Json
          created_at?: string
          created_by?: string | null
          dkim_priv_a?: string
          dkim_priv_b?: string
          dkim_pub_a?: string
          dkim_pub_b?: string
          domain?: string
          id?: string
          ip?: string | null
          selector_a?: string
          selector_b?: string
          synced_at?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sending_domains_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "provider_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      server_agents: {
        Row: {
          agent_version: string | null
          applied_hash: string | null
          config_hash: string | null
          created_at: string
          kumo_version: string | null
          last_error: string | null
          last_seen: string | null
          metrics: Json
          server_id: string
          status: string
          token_hash: string
        }
        Insert: {
          agent_version?: string | null
          applied_hash?: string | null
          config_hash?: string | null
          created_at?: string
          kumo_version?: string | null
          last_error?: string | null
          last_seen?: string | null
          metrics?: Json
          server_id: string
          status?: string
          token_hash: string
        }
        Update: {
          agent_version?: string | null
          applied_hash?: string | null
          config_hash?: string | null
          created_at?: string
          kumo_version?: string | null
          last_error?: string | null
          last_seen?: string | null
          metrics?: Json
          server_id?: string
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_agents_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: true
            referencedRelation: "managed_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_domain_bindings: {
        Row: {
          created_at: string
          domain_id: string
          id: string
          installed_at: string | null
          last_error: string | null
          server_id: string
          status: string
        }
        Insert: {
          created_at?: string
          domain_id: string
          id?: string
          installed_at?: string | null
          last_error?: string | null
          server_id: string
          status?: string
        }
        Update: {
          created_at?: string
          domain_id?: string
          id?: string
          installed_at?: string | null
          last_error?: string | null
          server_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_domain_bindings_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_domain_bindings_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "managed_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_ips: {
        Row: {
          active: boolean
          address: string
          family: number
          id: string
          pool_id: string | null
          rdns: string | null
          server_id: string
          synced_at: string
        }
        Insert: {
          active?: boolean
          address: string
          family: number
          id?: string
          pool_id?: string | null
          rdns?: string | null
          server_id: string
          synced_at?: string
        }
        Update: {
          active?: boolean
          address?: string
          family?: number
          id?: string
          pool_id?: string | null
          rdns?: string | null
          server_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_ips_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "vmta_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_ips_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "managed_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vmta_pools: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          purpose: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          purpose?: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          purpose?: string
          status?: string
        }
        Relationships: []
      }
      warmup_plans: {
        Row: {
          created_at: string
          created_by: string | null
          current_day: number
          daily_limits: number[]
          id: string
          ip_id: string
          isp: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_day?: number
          daily_limits: number[]
          id?: string
          ip_id: string
          isp: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_day?: number
          daily_limits?: number[]
          id?: string
          ip_id?: string
          isp?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "warmup_plans_ip_id_fkey"
            columns: ["ip_id"]
            isOneToOne: false
            referencedRelation: "server_ips"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_tasks: {
        Row: {
          allowed_paths: string[]
          assigned_by: string | null
          created_at: string
          description: string | null
          id: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          allowed_paths?: string[]
          assigned_by?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          allowed_paths?: string[]
          assigned_by?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "superadmin" | "worker"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["superadmin", "worker"],
    },
  },
} as const
